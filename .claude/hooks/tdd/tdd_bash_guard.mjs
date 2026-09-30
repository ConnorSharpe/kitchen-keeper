// PreToolUse hook (matcher: Bash) — Rule 11 backstop against a Bash-based bypass of
// the test lock (rm, sed -i, truncating redirection, mv/cp overwriting a locked test).
//
// HONEST LIMITATION (see Rule 12's "what it cannot actually guarantee"): this is a
// heuristic over free-form shell text, not a shell parser. It catches the obvious,
// literal forms. It will miss a deliberately obfuscated command (base64, a script
// that writes the file indirectly, `python -c "..."`, etc). Raising the bar, not
// airtight — the git pre-commit backstop is what holds regardless.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseHookInput,
  projectDirFrom,
  getConfig,
  toRel,
  matchesAny,
  approvalsPath,
  consumedLogPath,
  auditLogPath,
  readJsonSafe,
  writeJsonAtomic,
  appendLine,
  nowIso,
  touchDirty,
  allow,
  denyPreToolUse,
} from './lib_tdd_common.mjs';

const input = await parseHookInput();
const projectDir = projectDirFrom(input);
const config = getConfig(projectDir);
const cmd = input.tool_input?.command || '';
if (!cmd.trim()) allow();

function stripQuotes(s) {
  return s.replace(/^['"]|['"]$/g, '');
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Scope detection to individual statements (split on &&, ||, ;, and newline), not
// the whole command blob. An earlier whole-blob version flagged a harmless
// `git diff tests/foo.test.ts` any time an unrelated `rm` appeared ANYWHERE else in
// the same chained command (e.g. `rm somethingelse.tmp && git diff tests/foo.test.ts`)
// — caught by testing a realistic multi-statement command, not by inspection. Still
// not a real shell parser: quoted separators or subshells can still confuse this.
const statements = cmd
  .split(/\n|&&|\|\||;/)
  .map((s) => s.trim())
  .filter(Boolean);

let flagged = null;

for (const stmt of statements) {
  const tokens = stmt.split(/\s+/).filter(Boolean).map(stripQuotes);
  const redirectTargets = [...stmt.matchAll(/>>?\s*([^\s>|&;]+)/g)].map((m) => stripQuotes(m[1]));
  const candidates = new Set([...tokens, ...redirectTargets]);

  const hasRm = /(^|[\s])rm\b/.test(stmt);
  const hasSedInPlace = /\bsed\b[^\n]*-i\b/.test(stmt);
  const hasTruncate = /\btruncate\b/.test(stmt);
  const hasRedirect = redirectTargets.length > 0;

  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith('-')) continue;
    const rel = toRel(projectDir, candidate);
    if (!matchesAny(rel, config.testFilePatterns)) continue;

    const absPath = path.isAbsolute(candidate) ? candidate : path.resolve(projectDir, candidate);
    if (!fs.existsSync(absPath)) continue; // doesn't exist yet — not locked

    const isRedirectDestination = redirectTargets.some((t) => stripQuotes(t) === candidate);
    const isMvCpDestination = new RegExp(`\\b(mv|cp)\\b[^|;&]*\\s${escapeRe(candidate)}\\s*($|[;&|])`).test(stmt + ' ');

    if (hasRm || hasSedInPlace || hasTruncate || (hasRedirect && isRedirectDestination) || isMvCpDestination) {
      flagged = rel;
      break;
    }
  }
  if (flagged) break;
}

if (!flagged) allow();

const approvals = readJsonSafe(approvalsPath(projectDir), {});
const token = approvals[flagged];
const now = Date.now();

if (token && !token.used && token.expiresAt > now) {
  token.used = true;
  token.usedAt = nowIso();
  writeJsonAtomic(approvalsPath(projectDir), approvals);
  appendLine(
    consumedLogPath(projectDir),
    JSON.stringify({ path: flagged, reason: token.reason, issuedAt: token.issuedAt, usedAt: token.usedAt, tool: 'Bash' })
  );
  appendLine(auditLogPath(projectDir), `${nowIso()} ALLOW-REWRITE(bash) ${flagged}: ${token.reason}`);
  touchDirty(projectDir);
  allow();
}

denyPreToolUse(
  `Rule 11 (Test Locking): this command appears to modify, delete, or overwrite the locked test file ` +
    `"${flagged}" via Bash (rm/sed -i/truncate/redirection/mv/cp). That is blocked the same as a direct ` +
    `Edit/Write would be. If the user has explicitly named this file and granted permission, run ` +
    `\`bash .claude/hooks/tdd/approve_test_rewrite.sh "${flagged}" "<reason>"\` first, then retry.`
);
