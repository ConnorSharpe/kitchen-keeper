# TASK-038 — Recipe Photo Picker Fix + Recipe URL Import

Version: DRAFT-3 (post-architect review, round 2) — **APPROVED FOR IMPLEMENTATION**

---

## Architect Review History

| Round | Verdict | Key changes |
|---|---|---|
| DRAFT-2 | 9.8/10 — approve after remaining hardening | **Adopted (important)**: the SSRF IPv4 blocklist was incomplete — it covered loopback/RFC1918-private/link-local/"this network" but not several other IANA special-purpose ranges that shouldn't be reachable from this endpoint: `100.64.0.0/10` (shared/CGNAT), `192.0.0.0/24` (IETF protocol assignments), `192.0.2.0/24`/`198.51.100.0/24`/`203.0.113.0/24` (documentation/TEST-NET), `198.18.0.0/15` (benchmarking), `224.0.0.0/4` (multicast), and `240.0.0.0/4` (reserved/future-use, including the `255.255.255.255` broadcast address). Replaced the ad-hoc per-octet `if` checks with a small CIDR-matching helper (`ipv4InCidr`) plus an explicit, auditable list of blocked ranges (`IPV4_BLOCKED_CIDRS`) — easier to verify for completeness than scattered conditionals, and easier to extend if another range needs adding later. IPv6 additionally now blocks `::` (unspecified) and the `2001:db8::/32` documentation range, alongside the existing loopback/unique-local/link-local checks. **Adopted (medium)**: (1) `readBodyWithLimit`'s `finally` block now also calls `reader.cancel()` (best-effort, wrapped so a cancel failure can't mask the real error) before `releaseLock()` — previously only `releaseLock()` ran, which stops *this code* from reading further but doesn't tell the underlying connection to stop sending, so a non-size-check error (e.g. from `Buffer.concat`) could leave the body still downloading in the background. (2) `extractPageText` now does a lightweight smarter truncation (`truncatePageText`) instead of a blind `slice(0, 8000)` — if an "Ingredients" heading is found more than ~150 characters into the page (i.e. there's a lot of nav/preamble junk before it), the slice starts ~150 characters before that heading instead of from the very top, so the character budget is spent on the actual recipe instead of boilerplate. Falls back to slicing from the start when no such heading is found, unchanged from DRAFT-2. (3) `extractJsonLdRecipe`'s `tags` field is now deduplicated (`[...new Set(...)]`) — `recipeCategory`/`recipeCuisine` can legitimately overlap (e.g. both list "Italian"). (4) The enrichable-field list moves out of the route and becomes an exported `RECIPE_ENRICHABLE_FIELDS` constant in `aiService.js`, imported by the route — keeps the prompt (which references these field names) and the merge-allowlist contract (D-13) from silently drifting apart if one is edited without the other. **Documented, not implemented (per the review's own framing — these were raised as things to comment, not build)**: (a) `dns.lookup(..., { all: true })` returning both an IPv4 and IPv6 address for one hostname is handled correctly today (rejects if *either* resolves to a blocked range) — added a comment stating this is intentional so a future edit doesn't "optimize" it into checking only the first address. (b) IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) are not recursively checked against the IPv4 blocklist — documented as a residual gap in Known Risks rather than closed, consistent with this spec's existing DNS-rebinding risk-acceptance for this specific, authenticated, rate-limited endpoint. (c) The JSON-LD instruction flattener doesn't handle the rarer `HowToSection` → `ItemList` → `ListItem` nesting variant (only the more common `itemListElement` form) — added as a code comment; `parseRecipeText`/manual fallback remain the safety net for sites using it. |
| DRAFT-1 | 9.4/10 — approve after one revision | **Adopted (required)**: JSON-LD was previously treated as final once it contained any ingredients/steps, permanently skipping AI even when servings/prepMins/cookMins/description/tags were missing. Added a new best-effort enrichment tier — when JSON-LD extraction succeeds but is missing those specific metadata fields, a cheap `gpt-4o-mini` call (`aiService.enrichRecipeFields`) is given the already-extracted recipe plus page text and asked to fill in *only* the missing fields. Scoped deliberately narrower than the review's literal phrasing ("fill missing important fields"): the enrichment call is never allowed to touch `name`/`ingredients`/`steps`, even if those are present but low-quality — judging instruction-text *quality* is a subjective call this task isn't taking on, and `RecipeReviewModal` already exists as the fix-it-yourself backstop for that, same as it is for the photo-upload path. The merge is an explicit allowlist (`raw.servings = raw.servings ?? enrichment.servings ?? null`, etc.), not a blind spread — guards against the model returning fields it wasn't asked for and those silently overwriting good JSON-LD data. The call is wrapped so any failure (timeout, malformed JSON, API error) is swallowed and logged, not thrown — enrichment is a nice-to-have layered on top of an already-successful Tier 1 extraction, so it must never turn a working import into a failed one. **Adopted (medium)**: (1) response body is now read via a streaming reader with an incremental byte-count check (`readBodyWithLimit`), not `res.arrayBuffer()` — the prior `Content-Length` check only rejected servers that were honest about a large size; a server omitting or lying about that header could still have its full body buffered into memory before the post-hoc size check ran. (2) `MAX_REDIRECTS` raised from 3 to 5 — recipe sites commonly chain http→https→www→locale→canonical, and 3 was flagged as slightly tight for that. (3) The AI text-extraction prompt (`parseRecipeText`) and the new enrichment prompt both now explicitly say to prefer sections labeled "Ingredients"/"Instructions" — reduces failures on long pages with lots of surrounding content. (4) `extractPageText` now also strips `aside`, `form`, `iframe`, `button` in addition to the original `script`/`style`/`nav`/`footer`/`header`/`noscript`/`svg` — same reasoning, less boilerplate reaching the AI calls. **Documented, not implemented (per the review's own scoping — explicitly called "not required for v1")**: (a) non-UTF-8 charset handling (`Content-Type`/`<meta charset>` sniffing) — noted as a Known Risk rather than built, since it would need a decoding dependency (e.g. `iconv-lite`) beyond this task's already-approved `cheerio` addition; most recipe blogs are UTF-8 today. (b) A written constraint against expanding `UNIT_WORDS` over time — added directly as a code comment and a spec Constraint, per the review's own "endless maintenance trap" framing; the ingredient parser's job is to improve the editing experience, not achieve perfect parsing. **Affirmed, no change**: the review's own "would not change" list (no Puppeteer/Playwright/headless rendering, no Redis/caching, no `robots.txt` handling, no BYOK/provider-abstraction changes) matches this spec's existing Out of Scope section exactly — recorded here as confirmation the original scoping was correct, not as a new decision. |

---

## Origin

Two related recipe-submission gaps, raised by the user in conversation (not from a written backlog — confirmed no `ai/architecture/` or roadmap doc exists in this repo):

1. On iPhone, tapping the recipe-photo upload control jumps straight to the camera with no option to pick an existing photo from the library. Root cause (confirmed by reading `RecipeUpload.jsx`/`ReceiptUpload.jsx`): both use a single `<input type="file" capture="environment">`, and `capture="environment"` has forced iOS Safari straight to the camera, skipping the picker, since iOS 10.3 (2017) — this is a long-standing platform behavior, not a regression.
2. No way to import a recipe from a URL today — only photo upload (`parse-recipe-image`) and "Find Recipes Online" (Spoonacular/TheMealDB's structured APIs, not page scraping) exist.

Research done ahead of this spec (user-directed) found: (a) the standard, widely-used fix for #1 is two separate file inputs behind two explicit buttons — one with `capture="environment"` (forces camera), one without (opens the full native picker: Photos/Library/Browse on iOS, gallery/file manager on Android); (b) the most efficient, robust approach for #2 is tiered — most recipe blogs already embed `schema.org/Recipe` structured data as `<script type="application/ld+json">` specifically to get Google's recipe rich-snippet treatment, so extracting that first is free, fast, and high-coverage; an AI text-extraction pass (reusing this app's existing recipe-extraction JSON contract) is the fallback for sites without it.

## Current Behavior (confirmed by reading the code, not assumed)

- `client/src/components/recipes/RecipeUpload.jsx`: single `fileInputRef`, always rendered with `capture="environment"` (line 272) — forces camera on both iOS and Android, no library option, regardless of device.
- `client/src/components/pantry/ReceiptUpload.jsx`: same underlying input, but already has an `isMobile` check (`matchMedia('(hover: none) and (pointer: coarse)')`) that conditionally applies `capture` — still only one input, still camera-only when mobile, no library alternative offered either way.
- No HTML-parsing library is installed anywhere in this repo (`grep`'d `server/package.json` — no `cheerio`/`jsdom`/etc.).
- `server/services/recipeSearchService.js` already has a `fetchWithTimeout` pattern (`AbortController` + `setTimeout`) for outbound HTTP calls to Spoonacular/TheMealDB — reused as the model for this task's own fetch, not literally imported (that helper is module-private and scoped to those two APIs).
- `server/services/aiService.js`'s image/utility functions — `parseRecipeImage`, `parseReceipt`, `eatThisNow`, `expandSuggestion` — all construct `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` directly. Only `chat()` (and, per TASK-037, `transcribe.js`) go through `resolveProvider`/BYOK. This is an existing, deliberate-looking split between "conversational AI" (BYOK-aware) and "utility AI calls" (always platform key) — this task's new function follows the *utility* convention, matching its closest sibling (`parseRecipeImage`), not `chat()`.
- `client/src/components/recipes/RecipeReviewModal.jsx` already provides full manual editing of every recipe field (name, description, servings/prep/cook time, ingredients, steps, tags) before saving, and is the shared "review AI-extracted recipe" UI for the photo-upload path today. It hardcodes `source: 'upload'` in its save payload (line 112) — the only change this task needs there is making that configurable.
- `server/db/schema.js`'s `recipes` table already has plain `source` (`text`, no enum constraint) and `sourceUrl` (`text`) columns (lines 81–82) — already populated by the web-suggestion save path (`RecipesPage.jsx`'s `source: 'web_suggested'`). No schema change needed for this task.
- `server/routes/ai.js` mounts `router.use(clerkAuth)` then `router.use(aiRateLimit)` (lines 20–21) before any route — every route added to this file, including this task's new one, is automatically authenticated and rate-limited with zero extra wiring.
- `server/app.js` sets a global `express.json({ limit: '10mb' })` body parser — irrelevant to this task's actual risk surface, since the new endpoint's *inbound* request body is just `{ url }` (trivially small); the *fetched page* is what needs its own size cap, enforced inside this task's new service.

---

## Part A — Camera vs. Photo Library Choice

### Design

Replace the single `capture="environment"` input with two hidden inputs behind two explicit controls, shown only on mobile (reusing the existing `isMobile` matchMedia check):

- **"Take Photo"** → hidden `<input type="file" accept="image/*" capture="environment">` — same forced-camera behavior as today, now opt-in.
- **"Choose from Library"** → hidden `<input type="file" accept="image/*">` (no `capture`) — opens the native picker (Photos/Library/Browse on iOS; gallery/file manager on Android).

Desktop is unaffected: `capture` was already meaningless there (desktop browsers just open the normal file browser regardless), so the existing single dropzone (drag-and-drop + click-to-browse) stays exactly as-is, just re-pointed at the renamed "library" input. No change to `uploadFile`/`scanFile` or any upload/scan network logic in either file — this is purely which input's `change` event fires.

### `client/src/components/recipes/RecipeUpload.jsx` — changes

Add `isMobile` state (new to this file; mirrors `ReceiptUpload.jsx`'s existing pattern exactly) near the other `useState` calls:

```jsx
const [isMobile, setIsMobile] = useState(false);
const cameraInputRef = useRef(null);
const libraryInputRef = useRef(null); // replaces the old fileInputRef

useEffect(() => {
  setIsMobile(window.matchMedia('(hover: none) and (pointer: coarse)').matches);
}, []);
```

Remove the old `fileInputRef` declaration; all `fileInputRef.current?.click()` references become `libraryInputRef.current?.click()`.

Replace the "Phase: idle" block's contents:

```jsx
{phase === 'idle' && (
  <div>
    {!isMobile && (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => libraryInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-orange-400 bg-orange-50'
            : 'border-gray-300 hover:border-orange-300 hover:bg-gray-50'
        }`}
      >
        <p className="text-5xl mb-4">📸</p>
        <p className="text-sm font-medium text-gray-700">
          Take a photo or upload a recipe image
        </p>
        <p className="text-xs text-gray-400 mt-1">
          JPEG, PNG, WebP or HEIC — max 10 MB
        </p>
      </div>
    )}

    {isMobile && (
      <div className="flex flex-col items-center py-8 gap-4">
        <p className="text-5xl">📸</p>
        <p className="text-sm font-medium text-gray-700 text-center">
          Add a recipe photo
        </p>
        <div className="flex gap-3 w-full">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1 py-2.5 px-3 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            📷 Take Photo
          </button>
          <button
            onClick={() => libraryInputRef.current?.click()}
            className="flex-1 py-2.5 px-3 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            🖼️ Choose from Library
          </button>
        </div>
        <p className="text-xs text-gray-400">
          JPEG, PNG, WebP or HEIC — max 10 MB
        </p>
      </div>
    )}

    <input
      ref={cameraInputRef}
      type="file"
      accept="image/*"
      capture="environment"
      onChange={handleFileChange}
      className="hidden"
    />
    <input
      ref={libraryInputRef}
      type="file"
      accept="image/*"
      onChange={handleFileChange}
      className="hidden"
    />
  </div>
)}
```

`handleFileChange`, `handleDrop`, `uploadFile`, `resizeImage`, and everything else in the file is unchanged.

### `client/src/components/pantry/ReceiptUpload.jsx` — changes

Same shape of change. Existing `isMobile` state/effect (lines 22–29) stays as-is. Replace `fileInputRef` with `cameraInputRef` + `libraryInputRef`, and replace the "Phase: upload" block's single conditionally-captured input with the same two-branch pattern as above (desktop keeps the existing dropzone pointed at `libraryInputRef`; mobile gets the same "📷 Take Photo" / "🖼️ Choose from Library" two-button row; both hidden inputs call the existing `handleFileChange`). Copy for the button row: "Add a receipt photo" / "📷 Take Photo" / "🖼️ Choose from Library". `scanFile`, `handleDrop`, `handleConfirm`, and everything else in the file is unchanged.

---

## Part B — Recipe URL Import

### Design

Three-tier server-side extraction, orchestrated by a new route, `POST /api/ai/parse-recipe-url`:

1. **Tier 1 — JSON-LD (free, no AI call)**: fetch the URL's HTML, parse out `<script type="application/ld+json">` blocks, find a node with `@type: "Recipe"` (handling both flat arrays and `@graph`-wrapped documents), map schema.org fields onto this app's existing `parsedRecipeSchema` shape (the same shape `parse-recipe-image` already returns).
2. **Tier 1b — AI enrichment (best-effort, only when Tier 1 succeeds but is incomplete)**: JSON-LD quality varies a lot in practice — many sites publish `name`/`recipeIngredient`/`recipeInstructions` but omit `servings`/`prepTime`/`cookTime`/`description`/`recipeCategory`. When Tier 1 found usable ingredients/steps but is missing any of those specific fields, a cheap `gpt-4o-mini` call (`aiService.enrichRecipeFields`) is given the already-extracted recipe plus the page text and asked to fill in *only* the fields that are missing — never `name`/`ingredients`/`steps`, which stay exactly as JSON-LD provided them even if their quality is poor. This call is best-effort: any failure (timeout, malformed response, API error) is caught, logged, and ignored — Tier 1's result is used as-is rather than letting an enrichment failure block an otherwise-successful import.
3. **Tier 2 — AI text extraction (fallback, only when Tier 1 found nothing usable)**: if no JSON-LD Recipe is found, or the one found has neither ingredients nor steps, strip the page down to visible text and run it through a new `aiService.parseRecipeText` call — reuses the exact same JSON contract as `parseRecipeImage`, just text-in instead of image-in, and a cheaper text-only model.
4. **Total failure (neither tier produced ingredients or steps)**: respond `422` with a best-effort page-`<title>` guess. The client opens the existing `RecipeReviewModal` prefilled with just that title guess and nothing else — the user pastes/types in the rest themselves, using the review modal's existing full editing UI. No new manual-entry component is built; this is a direct reuse.

All outcomes funnel into the same save path recipes already use (`RecipeReviewModal` → `POST /api/recipes`).

**Security**: fetching a user-supplied URL server-side is an SSRF vector. Mitigated by: rejecting non-`http(s)` schemes, resolving the hostname via DNS and rejecting loopback/private/link-local/reserved-range IPs (including the `169.254.169.254` cloud-metadata address), and re-validating every redirect hop against the same check (redirects are followed manually, not via `fetch`'s automatic `redirect: 'follow'`, specifically so each hop can be inspected before it's taken). See Known Risks for the accepted residual gap (DNS rebinding) and why it's an acceptable trade-off for this specific, authenticated, rate-limited endpoint.

### New file: `server/services/recipeUrlImportService.js`

Non-AI logic only (URL safety, fetching, JSON-LD mapping, text extraction) — keeps `aiService.js` scoped to OpenAI calls, matching this codebase's existing per-concern service layering.

```js
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
    /^([\d.\/½⅓¼¾⅔⅛⅜⅝⅞\s]+)\s+([a-zA-Z]+\.?)?\s*(.*)$/
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
```

### New file: `server/services/recipeUrlImportService.test.js`

DB-free, network-free — covers the SSRF-critical `isDisallowedIp` directly (flagged High severity in architect review round 2), plus the JSON-LD/text-extraction pure functions via their exported entry points. Mirrors this codebase's existing convention of unit-testing DB-free/network-free logic in isolation (`cachedLoader.test.js`, `aiRateLimitKeyGenerator.test.js`).

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDisallowedIp,
  extractJsonLdRecipe,
  extractPageText,
  extractPageTitle,
} from './recipeUrlImportService.js';

test('isDisallowedIp blocks loopback, private, and link-local IPv4', () => {
  assert.equal(isDisallowedIp('127.0.0.1'), true);
  assert.equal(isDisallowedIp('10.1.2.3'), true);
  assert.equal(isDisallowedIp('172.16.0.5'), true);
  assert.equal(isDisallowedIp('192.168.1.1'), true);
  assert.equal(isDisallowedIp('169.254.169.254'), true); // cloud metadata
});

test('isDisallowedIp blocks the extended IANA special-purpose ranges (round 2)', () => {
  assert.equal(isDisallowedIp('100.64.0.1'), true); // shared/CGNAT
  assert.equal(isDisallowedIp('192.0.0.1'), true); // IETF protocol assignments
  assert.equal(isDisallowedIp('192.0.2.1'), true); // documentation
  assert.equal(isDisallowedIp('198.18.0.1'), true); // benchmarking
  assert.equal(isDisallowedIp('198.51.100.1'), true); // documentation
  assert.equal(isDisallowedIp('203.0.113.1'), true); // documentation
  assert.equal(isDisallowedIp('224.0.0.1'), true); // multicast
  assert.equal(isDisallowedIp('240.0.0.1'), true); // reserved
  assert.equal(isDisallowedIp('255.255.255.255'), true); // broadcast
});

test('isDisallowedIp allows ordinary public IPv4 addresses', () => {
  assert.equal(isDisallowedIp('93.184.216.34'), false); // example.com-range public IP
  assert.equal(isDisallowedIp('8.8.8.8'), false);
});

test('isDisallowedIp blocks IPv6 loopback, unspecified, ULA, link-local, and documentation ranges', () => {
  assert.equal(isDisallowedIp('::1'), true);
  assert.equal(isDisallowedIp('::'), true);
  assert.equal(isDisallowedIp('fd00::1'), true);
  assert.equal(isDisallowedIp('fe80::1'), true);
  assert.equal(isDisallowedIp('2001:db8::1'), true);
});

test('isDisallowedIp allows an ordinary public IPv6 address', () => {
  assert.equal(isDisallowedIp('2606:4700:4700::1111'), false);
});

test('isDisallowedIp rejects non-IP input', () => {
  assert.equal(isDisallowedIp('not-an-ip'), true);
});

test('extractJsonLdRecipe maps a flat Recipe node, including duration/yield parsing and tag dedup', () => {
  const html = `<html><head><script type="application/ld+json">
    ${JSON.stringify({
      '@type': 'Recipe',
      name: 'Test Soup',
      recipeIngredient: ['2 cups broth', '1 tsp salt'],
      recipeInstructions: ['Boil it.', 'Season it.'],
      recipeYield: '4 servings',
      prepTime: 'PT15M',
      cookTime: 'PT1H30M',
      recipeCategory: 'Dinner',
      recipeCuisine: 'Dinner',
    })}
  </script></head><body></body></html>`;
  const recipe = extractJsonLdRecipe(html);
  assert.equal(recipe.name, 'Test Soup');
  assert.equal(recipe.servings, 4);
  assert.equal(recipe.prepMins, 15);
  assert.equal(recipe.cookMins, 90);
  assert.deepEqual(recipe.steps, ['Boil it.', 'Season it.']);
  assert.equal(recipe.tags.length, 1); // 'Dinner' deduped, not duplicated
});

test('extractJsonLdRecipe finds a Recipe node inside an @graph array', () => {
  const html = `<html><head><script type="application/ld+json">
    ${JSON.stringify({
      '@graph': [
        { '@type': 'WebSite', name: 'Some Blog' },
        { '@type': 'Recipe', name: 'Graph Recipe', recipeIngredient: ['1 egg'] },
      ],
    })}
  </script></head><body></body></html>`;
  assert.equal(extractJsonLdRecipe(html).name, 'Graph Recipe');
});

test('extractJsonLdRecipe returns null when no Recipe JSON-LD is present', () => {
  assert.equal(extractJsonLdRecipe('<html><body>no recipe here</body></html>'), null);
});

test('extractPageText truncates near an Ingredients heading when there is a long preamble', () => {
  const preamble = 'This is my grandmother\'s story. '.repeat(30); // > 150 chars
  const html = `<html><body><p>${preamble}</p><h2>Ingredients</h2><p>2 eggs, 1 cup flour</p></body></html>`;
  const text = extractPageText(html);
  const ingredientsIndex = text.toLowerCase().indexOf('ingredients');
  assert.ok(ingredientsIndex >= 0 && ingredientsIndex < 200);
});

test('extractPageTitle returns the <title> text, or null if absent', () => {
  assert.equal(
    extractPageTitle('<html><head><title> My Recipe </title></head></html>'),
    'My Recipe'
  );
  assert.equal(extractPageTitle('<html><head></head></html>'), null);
});
```

### `server/services/aiService.js` — add `parseRecipeText`

New function, added after `parseRecipeImage`. No new imports needed (`OpenAI`, `wrapAIError`, `safeParseJSON`, `AIProviderError` are already imported at the top of this file).

```js
/**
 * Parses recipe data out of a page's plain text — the Tier 2 fallback when a
 * URL import finds no schema.org JSON-LD. Mirrors parseRecipeImage's JSON
 * contract, but is a text-only chat completion (cheaper, no vision needed)
 * since the input is already plain text.
 * Returns a structured recipe object, or null if AI returns malformed JSON
 * or an unusable result (no name, no ingredients, no steps).
 */
export async function parseRecipeText(pageText, sourceUrl, requestId = 'n/a') {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = 'gpt-4o-mini';

  const requestOptions = {
    model,
    messages: [
      {
        role: 'user',
        content:
          `The following is the extracted text of a recipe web page (${sourceUrl}). ` +
          'Find the actual recipe content and ignore navigation, ads, comments, ' +
          'related-post links, and other boilerplate. Prefer content under or near ' +
          'headings like "Ingredients" and "Instructions"/"Directions"/"Method" over ' +
          'prose elsewhere on the page (e.g. a blog post preamble). ' +
          'Return JSON: { "name": string, "description": string, ' +
          '"ingredients": [{"name": string, "quantity": number|string|null, "unit": string|null}], ' +
          '"steps": [string], "servings": number|null, "prepMins": number|null, ' +
          '"cookMins": number|null, "tags": [string] }. ' +
          'If this page does not contain a recipe at all, return ' +
          '{ "name": "", "ingredients": [], "steps": [] }. ' +
          'Return ONLY a raw JSON object. No markdown, no explanation.\n\n' +
          `PAGE TEXT:\n${pageText}`,
      },
    ],
    max_tokens: 2000,
  };

  let text;
  try {
    const response = await openai.chat.completions.create(requestOptions);
    text = response.choices[0].message.content ?? 'null';
  } catch (err) {
    throw wrapAIError(new AIProviderError('OpenAI text extraction error', err));
  }

  const result = safeParseJSON(text, null);
  const usable =
    result && (result.name || result.ingredients?.length || result.steps?.length);
  console.log(
    `[kitchen-keeper] request_id=${requestId} function=parseRecipeText model=${model}` +
      ` usable=${!!usable}`
  );
  return usable ? result : null;
}

// Recipe fields eligible for AI enrichment when JSON-LD extraction succeeds
// but is incomplete (Tier 1b in server/routes/ai.js). Exported so the
// route's missing-field detection and this file's enrichment prompt/merge
// contract can't silently drift apart if one is edited without the other
// (architect review round 2 — previously a route-local constant).
export const RECIPE_ENRICHABLE_FIELDS = [
  'servings',
  'prepMins',
  'cookMins',
  'description',
  'tags',
];

/**
 * Best-effort enrichment for a recipe already extracted from JSON-LD that's
 * missing secondary metadata (servings/prepMins/cookMins/description/tags).
 * Given the already-extracted recipe as grounding context, asks the model to
 * fill in ONLY the named missing fields — never asked to touch (and the
 * caller must never trust it for) name/ingredients/steps, which stay exactly
 * as JSON-LD provided them. Returns a partial object with just the fields
 * the model could find, or null on any failure — this is a nice-to-have
 * layered on an already-successful extraction, so a failure here must never
 * fail the overall import (architect review round 1).
 */
export async function enrichRecipeFields(
  partialRecipe,
  missingFields,
  pageText,
  sourceUrl,
  requestId = 'n/a'
) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = 'gpt-4o-mini';

  const requestOptions = {
    model,
    messages: [
      {
        role: 'user',
        content:
          `This recipe was already extracted from a web page (${sourceUrl}): ` +
          `${JSON.stringify({ name: partialRecipe.name, ingredients: partialRecipe.ingredients, steps: partialRecipe.steps })}. ` +
          `It is missing these fields: ${missingFields.join(', ')}. ` +
          'Using the page text below, find ONLY those missing fields. Prefer content ' +
          'near headings like "Ingredients"/"Instructions" for context, but you are ' +
          'filling in metadata (servings, times, description, tags), not re-extracting ' +
          'ingredients or steps. Do not include "name", "ingredients", or "steps" in ' +
          'your response even if you can infer them — they are already correct. ' +
          'Return JSON containing only whichever of these you can confidently determine: ' +
          '{ "description": string, "servings": number, "prepMins": number, ' +
          '"cookMins": number, "tags": [string] }. Omit any field you cannot determine ' +
          "rather than guessing. Return ONLY a raw JSON object. No markdown, no explanation.\n\n" +
          `PAGE TEXT:\n${pageText}`,
      },
    ],
    max_tokens: 500,
  };

  try {
    const response = await openai.chat.completions.create(requestOptions);
    const text = response.choices[0].message.content ?? 'null';
    const result = safeParseJSON(text, null);
    console.log(
      `[kitchen-keeper] request_id=${requestId} function=enrichRecipeFields model=${model}` +
        ` found=${result ? Object.keys(result).join(',') : 'none'}`
    );
    return result;
  } catch (err) {
    console.error(
      `[kitchen-keeper] request_id=${requestId} function=enrichRecipeFields failed:`,
      err.message
    );
    return null;
  }
}
```

### `server/routes/ai.js` — new route

Add import at top: `import * as recipeUrlImportService from '../services/recipeUrlImportService.js';`

Add after the existing `parse-recipe-image` route (reuses that route's `parsedRecipeSchema`, defined just above it):

```js
// POST /api/ai/parse-recipe-url
// Imports a recipe from a URL. Tries schema.org JSON-LD first (free, no AI
// call — most recipe blogs already publish it for Google's rich-snippet
// treatment); if found but missing servings/times/description/tags, a cheap
// best-effort AI enrichment call fills in just those fields (never touches
// name/ingredients/steps). Falls back to a full AI text-extraction pass over
// the page's visible text if no JSON-LD Recipe is found at all. Returns
// { recipe: validated } on success. On total failure (nothing produced a
// usable recipe), responds 422 with { error, titleGuess } so the client can
// fall back to a manual paste/edit review, prefilled with the page's <title>.

const urlImportSchema = z.object({
  url: z.string().url().max(2000),
});

router.post(
  '/parse-recipe-url',
  validate(urlImportSchema),
  async (req, res) => {
    const requestId = randomUUID().split('-')[0];

    let html;
    try {
      html = await recipeUrlImportService.fetchRecipePage(req.body.url);
    } catch (err) {
      return res.status(err.status || 502).json({ error: err.message });
    }

    let raw = recipeUrlImportService.extractJsonLdRecipe(html);
    let tier = 'json-ld';
    const jsonLdUsable = raw && (raw.ingredients?.length || raw.steps?.length);

    if (jsonLdUsable) {
      // Tier 1b: JSON-LD succeeded but may be missing secondary metadata
      // fields it doesn't always include. Best-effort AI fill-in — never
      // touches name/ingredients/steps (architect review round 1).
      const missingFields = aiService.RECIPE_ENRICHABLE_FIELDS.filter((f) =>
        Array.isArray(raw[f]) ? raw[f].length === 0 : raw[f] == null
      );
      if (missingFields.length > 0) {
        const pageText = recipeUrlImportService.extractPageText(html);
        const enrichment = await aiService.enrichRecipeFields(
          raw,
          missingFields,
          pageText,
          req.body.url,
          requestId
        );
        if (enrichment) {
          raw = {
            ...raw,
            servings: raw.servings ?? enrichment.servings ?? null,
            prepMins: raw.prepMins ?? enrichment.prepMins ?? null,
            cookMins: raw.cookMins ?? enrichment.cookMins ?? null,
            description: raw.description ?? enrichment.description ?? null,
            tags: raw.tags?.length ? raw.tags : (enrichment.tags ?? []),
          };
          tier = 'json-ld+enriched';
        }
      }
    } else {
      const pageText = recipeUrlImportService.extractPageText(html);
      raw = await aiService.parseRecipeText(pageText, req.body.url, requestId);
      tier = 'ai-text';
    }

    const usable = raw && (raw.ingredients?.length || raw.steps?.length);
    let validated = null;
    if (usable) {
      try {
        validated = parsedRecipeSchema.parse(raw);
      } catch {
        validated = null;
      }
    }

    if (!validated) {
      const titleGuess = recipeUrlImportService.extractPageTitle(html);
      return res.status(422).json({
        error:
          "Couldn't automatically find a recipe on that page. You can add the details manually.",
        titleGuess,
      });
    }

    console.log(
      `[kitchen-keeper] request_id=${requestId} function=parseRecipeUrl tier=${tier}`
    );
    res.json({ recipe: validated, sourceUrl: req.body.url });
  }
);
```

### New file: `client/src/components/recipes/RecipeUrlImport.jsx`

Mirrors `RecipeUpload.jsx`'s phase state machine (`idle` / `fetching` / `error`) and cancel-on-close pattern, but with a URL text input instead of a file picker.

```jsx
import { useState, useRef, useEffect } from 'react';

export default function RecipeUrlImport({
  onExtracted,
  onNeedsManualEntry,
  onClose,
}) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState('idle'); // 'idle' | 'fetching' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setPhase('fetching');
    setErrorMsg('');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai/parse-recipe-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
        signal: AbortSignal.any
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
          : controller.signal,
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (res.status === 422) {
        onNeedsManualEntry(data.titleGuess ?? '', trimmed);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || `Import failed (${res.status})`);
      }

      onExtracted(data.recipe, trimmed);
    } catch (err) {
      if (err.name === 'AbortError') return; // user closed modal
      setErrorMsg(err.message || 'Failed to import recipe from that URL');
      setPhase('error');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          abortRef.current?.abort();
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Import Recipe from URL
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Paste a link to a recipe page
            </p>
          </div>
          <button
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {phase !== 'fetching' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/recipe"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              autoFocus
            />
            {phase === 'error' && (
              <p className="text-sm text-red-600">{errorMsg}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  onClose();
                }}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-orange-500 text-white text-sm rounded-md hover:bg-orange-600 transition-colors"
              >
                Import
              </button>
            </div>
          </form>
        )}

        {phase === 'fetching' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-9 h-9 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mb-5" />
            <p className="text-sm font-medium text-gray-700">
              Reading recipe from page…
            </p>
            <p className="text-xs text-gray-400 mt-1">
              This takes a few seconds
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
```

### `client/src/components/recipes/RecipeReviewModal.jsx` — changes

Add two props with defaults that preserve today's image-upload behavior byte-for-byte:

```jsx
export default function RecipeReviewModal({
  recipe,
  source = 'upload',
  sourceUrl = null,
  onSave,
  onClose,
}) {
```

In `handleSave`'s payload, replace the hardcoded `source: 'upload'` with:

```jsx
      source,
      sourceUrl,
```

Header subtitle: keep the existing "AI extracted this — please review before saving" when `!sourceUrl`; when `sourceUrl` is set, show `Imported from ${sourceUrl} — please review before saving` instead (covers both the successful-import and manual-fallback cases — in the fallback case the fields are simply mostly empty, which is self-explanatory).

### `client/src/pages/RecipesPage.jsx` — changes

New state, alongside the existing `showUpload`/`reviewRecipe`/`reviewImage`:

```jsx
const [showUrlImport, setShowUrlImport] = useState(false);
const [reviewSourceUrl, setReviewSourceUrl] = useState(null);
```

New handlers, alongside the existing `handleExtracted`:

```jsx
function handleUrlExtracted(recipe, url) {
  setShowUrlImport(false);
  setReviewRecipe(recipe);
  setReviewImage(null);
  setReviewSourceUrl(url);
}

function handleNeedsManualEntry(titleGuess, url) {
  setShowUrlImport(false);
  setReviewRecipe({
    name: titleGuess ?? '',
    description: null,
    ingredients: [],
    steps: [],
    servings: null,
    prepMins: null,
    cookMins: null,
    tags: [],
  });
  setReviewImage(null);
  setReviewSourceUrl(url);
  toast(
    "Couldn't auto-extract that recipe — add the details below.",
    { icon: 'ℹ️' }
  );
}
```

New button, next to the existing "📸 Upload Recipe Image" button:

```jsx
<button
  onClick={() => setShowUrlImport(true)}
  className="text-sm px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
>
  🔗 Import from URL
</button>
```

New modal render, alongside the existing `{showUpload && <RecipeUpload .../>}`:

```jsx
{showUrlImport && (
  <RecipeUrlImport
    onExtracted={handleUrlExtracted}
    onNeedsManualEntry={handleNeedsManualEntry}
    onClose={() => setShowUrlImport(false)}
  />
)}
```

Update the existing `RecipeReviewModal` render to pass the new props through, and clear `reviewSourceUrl` on close:

```jsx
{reviewRecipe && (
  <RecipeReviewModal
    recipe={reviewRecipe}
    source={reviewSourceUrl ? 'url_import' : 'upload'}
    sourceUrl={reviewSourceUrl}
    onSave={handleReviewSave}
    onClose={() => {
      setReviewRecipe(null);
      setReviewImage(null);
      setReviewSourceUrl(null);
    }}
  />
)}
```

Add import: `import RecipeUrlImport from '../components/recipes/RecipeUrlImport.jsx';`

Filter dropdown — add one option alongside the existing `upload`/`ai_suggested`/`web_suggested`/`manual`:

```jsx
<option value="url_import">Imported from URL</option>
```

`handleReviewSave` itself needs no change — it already just spreads whatever `RecipeReviewModal` hands it into the `POST /api/recipes` payload, and `RecipeReviewModal` now includes the correct `source`/`sourceUrl` in that payload.

### `server/package.json` — new dependency

```json
"cheerio": "^1.0.0"
```

Added to `dependencies`, alongside the existing `openai`, `zod`, etc.

### Decisions

- **D-1**: Two separate file inputs (camera-forcing vs. no-`capture`) behind two explicit buttons on mobile, rather than trying to coax one input into offering both — matches confirmed iOS/Android platform behavior (`capture` forces the camera; its absence opens the full picker).
- **D-2**: Desktop keeps today's single dropzone unchanged — `capture` was already irrelevant there, no forced-camera problem exists to fix.
- **D-3**: JSON-LD is tried before any AI call — free, and reuses SEO markup nearly every recipe blog already publishes for Google's rich-snippet treatment.
- **D-4**: The AI fallback reuses the existing `parsedRecipeSchema` JSON contract (same shape `parse-recipe-image` returns) rather than inventing a new one, so all three extraction paths (image, JSON-LD, AI-text) feed the same review/save pipeline. This also means Tier 1's ingredient-quantity strings (e.g. `"2"`, `"1/2"`) can be handed straight to the existing `fractionalQuantity` Zod transform already defined in `ai.js` — no duplicate parsing logic needed.
- **D-5**: The AI text-extraction fallback uses `gpt-4o-mini`, not `gpt-4o` — the input is already plain text (no vision needed), and text extraction is a lighter task than transcribing a photographed recipe card. `parseRecipeImage` keeps `gpt-4o` unchanged.
- **D-6**: Follows the existing utility-call convention (`parseRecipeImage`/`parseReceipt`) of calling OpenAI directly with the platform key, not `resolveProvider`/BYOK. Changing that split is out of scope here.
- **D-7**: On total extraction failure, the client opens the existing `RecipeReviewModal` with a mostly-blank recipe (just a page-title guess) instead of building a separate manual-entry form — 100% reuse of existing UI.
- **D-8**: `source`/`sourceUrl` become configurable props on `RecipeReviewModal` (defaulting to `'upload'`/`null`, preserving today's photo-upload behavior exactly) so the URL-import and manual-fallback paths can tag saved recipes correctly. Reuses the `recipes.source`/`recipes.source_url` columns that already exist — zero schema change.
- **D-9**: SSRF mitigation — reject non-`http(s)` schemes, DNS-resolve the hostname and reject loopback/private/link-local/reserved-range IPs, and re-validate every redirect hop against the same check. See Known Risks for the accepted residual DNS-rebinding gap.
- **D-10**: New file `server/services/recipeUrlImportService.js` holds all non-AI logic — consistent with this codebase's existing service-per-concern layering (`recipeSearchService.js`, `platformSettingsService.js`, etc.); `aiService.js` stays scoped to OpenAI calls only.
- **D-11**: `cheerio` is a new dependency — the standard, high-adoption choice for server-side HTML/JSON-LD parsing in Node; avoids a hand-rolled regex HTML parser, which would be more brittle for pulling `<script>` tag contents and stripping boilerplate for the text-extraction fallback.
- **D-12** *(round 1)*: JSON-LD is treated as authoritative-but-possibly-incomplete, not final — when it produces usable ingredients/steps but is missing `servings`/`prepMins`/`cookMins`/`description`/`tags`, a best-effort `enrichRecipeFields` call fills in only those named gaps. Deliberately narrower than "fill missing important fields" generally: `name`/`ingredients`/`steps` are never eligible for enrichment even if their quality is poor, since judging text *quality* (versus mere absence) is a subjective call this task isn't taking on — `RecipeReviewModal` remains the correctness backstop for that, same as for every other extraction path.
- **D-13** *(round 1)*: The enrichment merge is an explicit per-field allowlist (`raw.servings = raw.servings ?? enrichment.servings ?? null`, etc.), not a blind object spread — guards against the model returning fields it wasn't asked for (e.g. it hallucinates an `ingredients` array despite instructions not to) silently overwriting good JSON-LD data.
- **D-14** *(round 1)*: The enrichment call is best-effort and failure-swallowing — any error (timeout, malformed JSON, API error) is caught and logged, and the import proceeds with the Tier 1 JSON-LD result unenriched, rather than letting a nice-to-have metadata pass turn an already-successful extraction into a failed one.
- **D-15** *(round 1)*: Response bodies are read via a streaming reader with an incremental size check (`readBodyWithLimit`), not `res.arrayBuffer()` followed by a post-hoc length check — closes the gap where a server omitting or lying about `Content-Length` could otherwise have its entire body buffered into memory before any size check ran.
- **D-16** *(round 1)*: `UNIT_WORDS` is intentionally non-exhaustive and documented as staying that way — the ingredient parser only needs to improve the editing experience for common cases; `RecipeReviewModal` is the backstop for the rest. Not to be expanded piecemeal over time.
- **D-17** *(round 1)*: Non-UTF-8 page encodings (`ISO-8859-1`, `windows-1252`, etc.) are not detected or decoded — pages are read as UTF-8 unconditionally. Documented as a Known Risk rather than built, since correct handling would need a decoding dependency beyond this task's already-approved `cheerio` addition; most recipe blogs are UTF-8 today.
- **D-18** *(round 2)*: The SSRF IPv4 blocklist is a complete, explicit list of IANA special-purpose ranges (`IPV4_BLOCKED_CIDRS`), matched via a small CIDR helper — not just RFC1918 private space plus loopback/link-local as in DRAFT-2. Chosen over the review's offered alternative (documenting the gap as intentionally partial) because completing it was cheap and doesn't add complexity, unlike most of this task's other declined hardening suggestions.
- **D-19** *(round 2)*: IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) are not unwrapped and re-checked against `IPV4_BLOCKED_CIDRS` — the one piece of D-18's completeness explicitly not chased further, since closing it fully starts to approach the same diminishing-returns territory as the already-accepted DNS-rebinding gap (D-9). Documented in Known Risks rather than silently left uncovered.
- **D-20** *(round 2)*: `readBodyWithLimit` now cancels the stream reader (best-effort, failure-swallowing) before releasing its lock, on every exit path — not just the size-limit-exceeded path. Closes a gap where a non-size-check error could leave the underlying connection still downloading in the background.
- **D-21** *(round 2)*: `extractPageText` truncation now does a single, bounded heading search (`truncatePageText`) to avoid spending the character budget on nav/preamble junk before an "Ingredients" heading, rather than a blind `slice(0, limit)`. Deliberately not a general section-parser — one heading search, one fallback path.
- **D-22** *(round 2)*: `RECIPE_ENRICHABLE_FIELDS` is exported from `aiService.js` and imported by the route, replacing a route-local constant of the same field names — keeps the enrichment prompt/merge contract (D-12/D-13) and the route's missing-field detection from silently drifting apart if one is edited without the other.

---

## Deployment Prerequisites

None — no schema change, no env vars, no dashboard config. Only operational note: `npm install` needs to run once (locally and in CI/deploy) to pick up the new `cheerio` dependency before this code can run.

## Overall Allowed Files

- New: `server/services/recipeUrlImportService.js`, `server/services/recipeUrlImportService.test.js`, `client/src/components/recipes/RecipeUrlImport.jsx`
- Modified: `client/src/components/recipes/RecipeUpload.jsx` (picker fix), `client/src/components/pantry/ReceiptUpload.jsx` (picker fix), `client/src/components/recipes/RecipeReviewModal.jsx` (`source`/`sourceUrl` props), `client/src/pages/RecipesPage.jsx` (new button, new modal wiring, new state, filter option), `server/routes/ai.js` (new route + import), `server/services/aiService.js` (new `parseRecipeText`/`enrichRecipeFields` functions + `RECIPE_ENRICHABLE_FIELDS` export), `server/package.json` (add `cheerio`)

## Overall Forbidden Files

- `server/db/schema.js`, any migration file — no schema change needed; `source`/`sourceUrl` already exist on `recipes`
- `server/services/ai/resolveProvider.js`, `providerInterface.js`, `openaiProvider.js` — this task's new AI call follows the existing direct-platform-key utility convention (D-6), doesn't touch BYOK resolution
- `server/services/chat/**`, chat prompts/tool schemas — unrelated
- `server/middleware/aiRateLimit.js`, `aiRateLimitKeyGenerator.js`, `server/services/platformSettingsService.js` — the new route inherits rate limiting automatically via `ai.js`'s existing `router.use(aiRateLimit)`; no changes needed there
- `client/src/components/pantry/AddItemModal.jsx` and other pantry files not touched by this task
- `ai/tasks/archive/`

## Constraints

- New dependency limited to `cheerio` only — no headless browser (Puppeteer/Playwright). This keeps the feature lightweight and fast, but means JS-only-rendered recipe pages (nothing in the server-rendered HTML) can't be extracted by either tier — see Out of Scope.
- Zero database schema changes.
- The photo-picker fix must not touch upload/scan request logic at all — purely which input element's `change` event fires; `uploadFile`/`scanFile` are unchanged in both files.
- The new route's fetched-page size cap (5 MB) and timeout (10 s) are independent of Express's existing global `express.json({ limit: '10mb' })` body parser — that parser only ever sees this route's tiny `{ url }` request body.
- `UNIT_WORDS` (ingredient-parsing helper) is not to be expanded piecemeal over time (D-16) — it exists to improve the editing experience for common cases, not to achieve exhaustive parsing; `RecipeReviewModal` is the correctness backstop.
- The AI enrichment tier (D-12) must never be given write access to `name`/`ingredients`/`steps` — enforced by the explicit per-field allowlist merge (D-13), not by trusting the prompt alone.

## Out of Scope (considered, explicitly declined for this task)

- **Headless-browser rendering** for JS-only recipe sites (no JSON-LD in the server-rendered HTML, content only appears after client-side JS runs) — a real coverage gap, but would need Puppeteer/Playwright, a much heavier dependency than this task's scope calls for. Revisit if this proves common in practice.
- **`robots.txt` / crawl-etiquette handling, or a site allowlist/denylist** — a household member pasting a URL they're already viewing in their own browser is a fundamentally different, much lower-risk case than an automated crawler; not implemented.
- **Caching fetched pages or parsed recipes by URL** — every import is a fresh fetch; not needed at this app's expected usage volume.
- **Fully closing the DNS-rebinding TOCTOU gap** (e.g. pinning the resolved IP onto the actual socket via a custom `http.Agent`) — the pre-fetch DNS check (D-9) is judged sufficient given this endpoint's authenticated, rate-limited trust boundary. Revisit if this endpoint's exposure ever changes.
- **Applying URL import to pantry/receipts** — the user's ask was specifically about recipes.

## Known Risks

- **DNS-rebinding TOCTOU gap in the SSRF guard**: an attacker-controlled domain could theoretically resolve to a safe IP at check time and a private IP at actual-fetch time. Accepted for now — this endpoint requires an authenticated household session and inherits the app-wide AI rate limit; it's a household member pointing the app at a URL of their own choosing, not a public unauthenticated SSRF-as-a-service surface.
- **IPv4-mapped IPv6 addresses aren't unwrapped for the SSRF check** (D-19) — `::ffff:127.0.0.1` and similar aren't recognized as equivalent to their embedded IPv4 address by `isDisallowedIp`'s IPv6 branch, even though the IPv4 blocklist (`IPV4_BLOCKED_CIDRS`, D-18) is otherwise now complete against the well-known IANA special-purpose ranges. Same acceptance reasoning as the DNS-rebinding gap above — authenticated, rate-limited endpoint, not a public surface.
- **AI fallback costs real OpenAI tokens per non-JSON-LD import** — mitigated by `gpt-4o-mini` (D-5) and the 8,000-character page-text cap, but a user could still spam imports of non-recipe URLs for trivial token spend. Same rate-limit backstop as every other AI endpoint in this app (TASK-037); no additional mitigation added here.
- **JSON-LD quality varies across sites** — some omit `prepTime`/`cookTime`/`recipeYield`, or phrase ingredients in ways the best-effort quantity/unit splitter can't cleanly parse. The metadata-enrichment tier (D-12) covers the "missing fields" case for `servings`/times/`description`/`tags`, but `name`/`ingredients`/`steps` are never re-touched even when their extracted quality is poor — `RecipeReviewModal` is the safety net for fixing those, exactly as it already is for the photo-upload path today.
- **JS-only-rendered recipe sites** will fail both extraction tiers and land on the manual-fallback path — see Out of Scope.
- **Some publishers (e.g. paywalled or aggressively bot-gated sites) may reject the fetch outright** (403/429) — surfaces as the ordinary fetch-failure error path, no site-specific handling built.
- **Non-UTF-8 page encodings aren't handled** (D-17) — a recipe page served as `ISO-8859-1`/`windows-1252`/etc. (common on older WordPress sites) will decode with mangled characters (typically garbled accented characters/punctuation) rather than failing outright. Since the ingredient/step text still reaches `RecipeReviewModal` for review either way, this degrades to a cosmetic annoyance the user can hand-fix, not a silent data-loss bug — but it's a real gap on some older sites, worth revisiting if it comes up in practice.

## Verification Steps

1. **Photo picker, mobile**: on a real iPhone (capture/picker behavior isn't reliable in devtools emulation), tap "Take Photo" → camera opens directly; separately tap "Choose from Library" → Photos picker opens (not the camera). Repeat for both `RecipeUpload` and `ReceiptUpload`.
2. **Photo picker, desktop**: confirm zero regression — dropzone click still opens the normal OS file browser, drag-and-drop still works.
3. **URL import, JSON-LD path (complete data)**: import from a recipe blog confirmed (via view-source) to have `application/ld+json` with `@type: "Recipe"` and all of `prepTime`/`cookTime`/`recipeYield`/`description`/`recipeCategory` present; confirm name/ingredients/steps/servings/times populate in the review modal, and confirm via server logs that `tier=json-ld` with no `enrichRecipeFields` or `parseRecipeText` log line (proves both AI calls were skipped when nothing was missing).
4. **URL import, JSON-LD + enrichment path**: import from a recipe blog whose JSON-LD has ingredients/steps but is missing `servings`/`prepTime`/`cookTime` (common on many blogs); confirm the review modal shows those fields filled in anyway, confirm `tier=json-ld+enriched` in the logs, and confirm — by comparing the saved `ingredients`/`steps` against the page's actual JSON-LD — that the enrichment call did not alter them.
5. **URL import, enrichment failure doesn't block the import**: temporarily force `aiService.enrichRecipeFields` to throw (e.g. point `OPENAI_API_KEY` at an invalid value for this one call in a scratch test) and confirm the same JSON-LD page still successfully imports with `tier=json-ld` (unenriched) rather than failing the whole request.
6. **URL import, AI fallback path**: import from a page with no JSON-LD Recipe; confirm `tier=ai-text` in the logs and a usable recipe still populates.
7. **URL import, total failure**: import a non-recipe URL (e.g. a news article); confirm the client opens `RecipeReviewModal` with just the page title prefilled and every other field empty/editable, with the "couldn't auto-extract" toast shown.
8. **SSRF guard, core ranges**: attempt to import `http://localhost:<port>/`, `http://127.0.0.1/`, and `http://169.254.169.254/`; confirm all three are rejected with 400 before any outbound fetch occurs.
9. **SSRF guard, extended IANA ranges (round 2)**: covered by `recipeUrlImportService.test.js`'s `isDisallowedIp` unit tests (not a live fetch — no real server exists at most of these addresses to fetch from); confirm those tests pass, covering every newly-added range plus the existing loopback/private/link-local/IPv6 cases.
10. **Redirect handling**: import a URL that redirects to a real recipe page (proves redirects are followed, now up to 5 hops); separately confirm a URL redirecting to `http://127.0.0.1/` is rejected (proves the SSRF check applies per-hop).
11. **Streaming size cap**: import from a test URL serving a response body larger than 5 MB *without* a `Content-Length` header (e.g. a chunked-transfer-encoded response) and confirm the import is still rejected once the streamed byte count crosses the cap, proving the size limit isn't solely dependent on a trustworthy `Content-Length` (D-15). Separately confirm (via a log/breakpoint check) that `reader.cancel()` is actually invoked on this path (D-20).
12. **Smarter truncation**: import from a recipe page with a long preamble (a typical food-blog personal-story intro) before the "Ingredients" heading; confirm via a temporary log of the text handed to the AI call that the sent text starts near "Ingredients" rather than at the top of the page (D-21).
13. **Tag dedup**: import from a page whose JSON-LD `recipeCategory` and `recipeCuisine` overlap (e.g. both include "Italian"); confirm the saved recipe's `tags` contains no duplicates.
14. **Saved-recipe tagging**: confirm a JSON-LD-imported recipe saves with `source: 'url_import'` and the pasted `sourceUrl`; confirm a manual-fallback save also saves with `source: 'url_import'` and the originally-pasted URL; confirm the existing image-upload path still saves with `source: 'upload'`, `sourceUrl: null` — no regression.
15. **Filter dropdown**: confirm the new "Imported from URL" option correctly filters to just those recipes.
16. **Rate limiting**: confirm `/api/ai/parse-recipe-url` is covered by the router-wide `aiRateLimit` (inherited automatically — no route-level bypass introduced).
17. **Regression**: existing image-upload recipe flow (`RecipeUpload.jsx` → `parse-recipe-image` → `RecipeReviewModal` → save) and existing receipt-scan flow (`ReceiptUpload.jsx`) both still work end-to-end, unchanged.
18. `npm test` (root, includes server `node --test`), `npm run lint`, `npm run build` all pass with `cheerio` installed.
