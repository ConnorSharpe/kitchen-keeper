// Run yourself (not a hook): declares a new TDD case and resets the source-edit gate
// to 'awaiting_red'. Call this at the start of each new piece of behavior, per Rule
// 10's Test-Driven Development Protocol step 1 — before writing the test.
//
// Usage: node tdd_new_case.mjs <test-file-relative-path> [case-id]
import { projectDirFrom, toRel, readGate, writeGate, auditLogPath, appendLine, nowIso } from './lib_tdd_common.mjs';

const args = process.argv.slice(2);
const testFileArg = args[0];
if (!testFileArg) {
  console.error('Usage: tdd_new_case.sh <test-file-relative-path> [case-id]');
  process.exit(1);
}

const projectDir = projectDirFrom({});
const rel = toRel(projectDir, testFileArg);
const caseId = args[1] || `case-${Date.now()}`;

const gate = readGate(projectDir);
const history = Array.isArray(gate.history) ? gate.history : [];
if (gate.currentCase) {
  history.push({ caseId: gate.currentCase, testFile: gate.testFile, endedPhase: gate.phase, endedAt: nowIso() });
}

const newGate = {
  phase: 'awaiting_red',
  currentCase: caseId,
  testFile: rel,
  declaredAt: nowIso(),
  history,
};
writeGate(projectDir, newGate);
appendLine(auditLogPath(projectDir), `${nowIso()} NEW-CASE ${caseId} testFile=${rel} phase=awaiting_red`);

console.log(`Declared case "${caseId}" for ${rel}. Gate phase: awaiting_red.`);
console.log('Write the failing test now, run it, and confirm it fails for the right reason.');
console.log(
  'Run it via tdd-config.json\'s singleFileTestCommand (substitute {file}), not a raw `npx vitest run` ' +
    'invocation — in this harness, PostToolUse hooks are not invoked for a Bash tool call that itself exits ' +
    'non-zero, so a genuinely failing test would otherwise never be observed. singleFileTestCommand is ' +
    'already suffixed with `; true` for exactly this reason (see TASK-018 handoff for how this was found).',
);
