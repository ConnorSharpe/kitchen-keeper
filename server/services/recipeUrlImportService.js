import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import net from 'node:net';

const FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_REDIRECTS = 5; // recipe sites commonly chain http->https->www->locale->canonical
const PAGE_TEXT_CHAR_LIMIT = 8000; // bounds the AI fallback call's token cost
const USER_AGENT =
  'KitchenKeeperRecipeImport/1.0 (+https://kitchenkeeper.kitchen)';

export class UnsafeUrlError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// IANA special-purpose IPv4 ranges (RFC 6890 and successors) that shouldn't
// be reachable from this endpoint — not just RFC1918 private space. Kept as
// an explicit, auditable list rather than scattered per-octet conditionals
// (architect review round 2) so completeness can be checked at a glance.
const IPV4_BLOCKED_CIDRS = [
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // private
  '100.64.0.0/10', // shared address space (CGNAT)
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, incl. cloud metadata (169.254.169.254)
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // documentation (TEST-NET-1)
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // documentation (TEST-NET-2)
  '203.0.113.0/24', // documentation (TEST-NET-3)
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved/future-use, incl. 255.255.255.255 broadcast
];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function ipv4InCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

// Blocks reserved/private/link-local IPv4 ranges (IPV4_BLOCKED_CIDRS above)
// and the equivalent well-known IPv6 ranges, to reduce SSRF exposure. Not
// airtight: (1) not a guard against DNS-rebinding between this check and the
// actual fetch (see TASK-038-spec.md Known Risks) — accepted for now, this
// endpoint sits behind clerkAuth + the router-wide aiRateLimit, not a public
// unauthenticated surface; (2) IPv4-mapped IPv6 addresses (::ffff:a.b.c.d)
// are not unwrapped and re-checked against IPV4_BLOCKED_CIDRS — documented
// as a residual gap in Known Risks rather than closed.
// Exported (unlike assertSafeUrl, which needs a real DNS lookup) so this
// security-critical logic is directly unit-testable without any network I/O
// — see recipeUrlImportService.test.js.
export function isDisallowedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    return IPV4_BLOCKED_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true; // unspecified / loopback
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('2001:db8')) return true; // documentation
    return false;
  }
  return true; // not a valid IP at all — reject
}

async function assertSafeUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new UnsafeUrlError('Not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs are supported.');
  }
  if (url.hostname === 'localhost') {
    throw new UnsafeUrlError('That URL is not allowed.');
  }
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new UnsafeUrlError('Could not resolve that URL.');
  }
  // A hostname can resolve to multiple addresses (e.g. both an A and AAAA
  // record). Intentional: reject if ANY resolved address is blocked, not
  // just the first — do not "optimize" this into checking addresses[0] only
  // (architect review round 2).
  if (
    addresses.length === 0 ||
    addresses.some((a) => isDisallowedIp(a.address))
  ) {
    throw new UnsafeUrlError('That URL is not allowed.');
  }
}

// Reads a response body via the streaming reader, aborting as soon as the
// byte count exceeds maxBytes — rather than buffering the whole body first
// and checking its size after (architect review round 1: a server that
// omits or lies about Content-Length could otherwise have its entire body
// pulled into memory before a post-hoc check ever ran).
async function readBodyWithLimit(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        const err = new Error('That page is too large to import.');
        err.status = 422;
        throw err;
      }
      chunks.push(value);
    }
  } finally {
    // Best-effort cancel before releasing the lock — releaseLock() alone
    // stops this function from reading further, but doesn't tell the
    // underlying connection to stop sending. Without an explicit cancel, an
    // error thrown by something other than the size check (e.g. a future
    // change to Buffer.concat below) could leave the body still downloading
    // in the background (architect review round 2).
    try {
      await reader.cancel();
    } catch {
      /* already closed/errored — nothing to do */
    }
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

// Fetches with a timeout and a streaming response-size cap. Redirects are
// followed manually (not via fetch's redirect: 'follow') so every hop — not
// just the original URL — is re-validated against assertSafeUrl before being
// taken.
//
// Decoded as UTF-8 unconditionally — most recipe blogs are UTF-8 today, but
// this doesn't sniff Content-Type/<meta charset> for legacy encodings
// (ISO-8859-1, windows-1252, etc.). Documented as a known limitation rather
// than built for v1 — see TASK-038-spec.md Known Risks.
export async function fetchRecipePage(urlString) {
  let currentUrl = urlString;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });
    } catch {
      const err = new Error('Could not reach that URL.');
      err.status = 502;
      err.expose = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new UnsafeUrlError('Redirect with no location.');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!res.ok) {
      const err = new Error(`Could not fetch that page (${res.status}).`);
      err.status = 422;
      throw err;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      const err = new Error('That URL did not return a web page.');
      err.status = 422;
      throw err;
    }
    const contentLength = Number(res.headers.get('content-length') ?? 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      const err = new Error('That page is too large to import.');
      err.status = 422;
      throw err;
    }
    const buffer = await readBodyWithLimit(res, MAX_RESPONSE_BYTES);
    return buffer.toString('utf-8');
  }
  throw new UnsafeUrlError('Too many redirects.');
}

// ---- schema.org Recipe JSON-LD extraction (Tier 1) ----

function parseIsoDurationToMinutes(iso) {
  if (typeof iso !== 'string') return null;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return total > 0 ? total : null;
}

function parseYield(y) {
  const value = Array.isArray(y) ? y[0] : y;
  if (typeof value === 'number') return Math.round(value);
  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    return match ? Number(match[0]) : null;
  }
  return null;
}

// schema.org recipeIngredient is a flat array of free-text strings
// ("2 cups flour", "1 tsp salt") with no separate quantity/unit fields.
// Best-effort split of a leading numeric quantity + short unit word; falls
// back to putting the whole string in `name` (still usable — the user can
// fix it in the review modal) rather than dropping the ingredient.
//
// Deliberately not exhaustive, and not meant to become so — do not keep
// expanding this list (dash, stick, package, bunch, sprig, ear, fillet,
// head, bulb, ...). It only needs to improve the editing experience for
// common cases; RecipeReviewModal is the correctness backstop for the rest
// (architect review round 1).
const UNIT_WORDS = new Set([
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon',
  'teaspoons', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'g', 'gram', 'grams', 'kg', 'ml', 'l', 'liter', 'liters', 'pinch',
  'clove', 'cloves', 'can', 'cans', 'slice', 'slices',
]);

function parseIngredientLine(line) {
  const trimmed = line.trim();
  const match = trimmed.match(
    /^([\d./½⅓¼¾⅔⅛⅜⅝⅞\s]+)\s+([a-zA-Z]+\.?)?\s*(.*)$/
  );
  if (!match) return { name: trimmed, quantity: null, unit: null };
  const [, qtyRaw, unitRaw, rest] = match;
  const unitClean = unitRaw?.replace(/\.$/, '').toLowerCase();
  const unit =
    unitClean && UNIT_WORDS.has(unitClean) ? unitRaw.replace(/\.$/, '') : null;
  const name = unit ? rest.trim() : `${unitRaw ?? ''} ${rest}`.trim();
  return { name: name || trimmed, quantity: qtyRaw.trim() || null, unit };
}

// recipeInstructions can be: a plain string, an array of strings, an array
// of HowToStep objects ({ text }), or HowToSection objects nesting another
// itemListElement array — flatten all shapes to a flat string array.
//
// Does not handle the rarer HowToSection -> ItemList -> ListItem nesting
// variant some sites use instead of itemListElement — intentionally left
// unhandled (architect review round 2); parseRecipeText/the manual-fallback
// path remain the safety net for sites using it.
function flattenInstructions(instructions) {
  if (!instructions) return [];
  if (typeof instructions === 'string') {
    return instructions
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(instructions)) return [];
  return instructions.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (
      item?.['@type'] === 'HowToSection' &&
      Array.isArray(item.itemListElement)
    ) {
      return flattenInstructions(item.itemListElement);
    }
    if (typeof item?.text === 'string') return [item.text];
    return [];
  });
}

function hasRecipeType(node) {
  const type = node?.['@type'];
  if (typeof type === 'string') return type === 'Recipe';
  if (Array.isArray(type)) return type.includes('Recipe');
  return false;
}

function findRecipeNode(jsonLd) {
  const nodes = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  for (const node of nodes) {
    const graph = node?.['@graph'];
    if (Array.isArray(graph)) {
      const found = graph.find((n) => hasRecipeType(n));
      if (found) return found;
    }
    if (hasRecipeType(node)) return node;
  }
  return null;
}

export function extractJsonLdRecipe(html) {
  const $ = cheerio.load(html);
  let recipeNode = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (recipeNode) return;
    let parsed;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    recipeNode = findRecipeNode(parsed);
  });
  if (!recipeNode) return null;

  return {
    name: recipeNode.name ?? '',
    description: recipeNode.description ?? null,
    ingredients: (recipeNode.recipeIngredient ?? [])
      .filter((s) => typeof s === 'string')
      .map(parseIngredientLine),
    steps: flattenInstructions(recipeNode.recipeInstructions),
    servings: parseYield(recipeNode.recipeYield),
    prepMins: parseIsoDurationToMinutes(recipeNode.prepTime),
    cookMins: parseIsoDurationToMinutes(recipeNode.cookTime),
    tags: [
      ...new Set(
        [
          ...(Array.isArray(recipeNode.recipeCategory)
            ? recipeNode.recipeCategory
            : [recipeNode.recipeCategory]),
          ...(Array.isArray(recipeNode.recipeCuisine)
            ? recipeNode.recipeCuisine
            : [recipeNode.recipeCuisine]),
        ].filter(Boolean)
      ),
    ],
  };
}

// ---- plain-text extraction (Tier 2 input) ----

// A blind slice(0, limit) risks spending the whole character budget on
// nav/preamble junk before the actual recipe. If an "Ingredients" heading
// appears well into the text, start the slice a little before it instead of
// at the very top, so the AI call sees the recipe rather than boilerplate.
// Deliberately simple (a single heading search, not a general section
// parser) — falls back to slicing from the start when no such heading is
// found (architect review round 2).
function truncatePageText(text, limit) {
  const match = text.match(/ingredients/i);
  if (match && match.index > 150) {
    const start = Math.max(0, match.index - 150);
    return text.slice(start, start + limit);
  }
  return text.slice(0, limit);
}

export function extractPageText(html) {
  const $ = cheerio.load(html);
  $(
    'script, style, nav, footer, header, noscript, svg, aside, form, iframe, button'
  ).remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return truncatePageText(text, PAGE_TEXT_CHAR_LIMIT);
}

export function extractPageTitle(html) {
  const $ = cheerio.load(html);
  return $('title').first().text().trim() || null;
}
