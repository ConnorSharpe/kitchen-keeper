// PreToolUse hook (matcher: Edit|Write|MultiEdit) — Rule 10, Red-before-Green ordering
// on source-file edits.
//
// Runs alongside tdd_test_lock.sh (which owns test files); this one only acts on
// non-test files. Default is enforcing: a source edit is blocked unless a case has
// been declared (tdd_new_case.sh) and confirmed red (tdd_record_result.sh, via a real
// failing test run), or the case has reached green (Refactor phase). The only named
// exemption is cosmetic-UI-only (Rule 10, "Minor," precisely, Rev 12) — checked against
// cosmeticUiPatterns AND the actual edit content for logic keywords, with
// sensitivePathPatterns overriding the exemption regardless of path match.
//
// HONEST LIMITATION (Rule 12): this gate is real for a task's first declared case and
// depends on tdd_new_case.sh actually being invoked for each subsequent one — it has
// no way to verify a case's test cases were actually derived from Acceptance Criteria,
// only that *a* red-confirmed run happened.
import {
  parseHookInput,
  projectDirFrom,
  getConfig,
  toRel,
  matchesAny,
  containsLogicKeywords,
  readGate,
  touchDirty,
  allow,
  denyPreToolUse,
} from './lib_tdd_common.mjs';

const input = await parseHookInput();
const projectDir = projectDirFrom(input);
const config = getConfig(projectDir);

const filePath = input.tool_input?.file_path;
if (!filePath) allow();

const rel = toRel(projectDir, filePath);

if (matchesAny(rel, config.testFilePatterns)) allow(); // tdd_test_lock.sh's concern
if (matchesAny(rel, config.alwaysExemptPatterns)) allow();

const isSensitive = matchesAny(rel, config.sensitivePathPatterns);
const pathLooksCosmetic = matchesAny(rel, config.cosmeticUiPatterns) && !isSensitive;

if (pathLooksCosmetic) {
  const editedText =
    input.tool_input?.new_string ??
    input.tool_input?.content ??
    (Array.isArray(input.tool_input?.edits) ? input.tool_input.edits.map((e) => e.new_string).join('\n') : '');
  if (!containsLogicKeywords(editedText)) {
    touchDirty(projectDir);
    allow();
  }
  // Cosmetic path, but the edit itself introduces logic — falls through to the
  // normal gate below rather than getting the "minor" exemption.
}

const gate = readGate(projectDir);
if (gate.phase === 'red_confirmed' || gate.phase === 'green') {
  touchDirty(projectDir);
  allow();
}

denyPreToolUse(
  `Rule 10 (TDD, Red before Green): no confirmed-red failing test is on record for this task. ` +
    `Before editing "${rel}": derive the test case(s) from Acceptance Criteria, run ` +
    `\`bash .claude/hooks/tdd/tdd_new_case.sh <test-file-path>\`, write the failing test, run it, and confirm ` +
    `it fails for the right reason (missing implementation, not a broken test/import). Only then does this ` +
    `gate open for the Green-phase edit. If this really is a cosmetic-UI-only change (styling/spacing/color/ ` +
    `layout, no added logic) it should already be covered by cosmeticUiPatterns in .claude/tdd-config.json — ` +
    `if it isn't, that's a config gap to raise, not a reason to bypass this gate. Current gate phase: ${gate.phase}.`
);
