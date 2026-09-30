// PostToolUse hook (matcher: Bash) — updates the case's gate phase from a test
// command's actual outcome. This is the mechanism that flips awaiting_red ->
// red_confirmed (Rule 10 rule 1) and red_confirmed -> green (rule 3).
//
// HONEST LIMITATION (Rule 12): pass/fail and "right reason" detection are heuristics
// over Bash tool_response text, not a real test-framework result parser. A pass while
// still awaiting_red is logged as a possible test-after violation but NOT silently
// promoted to green — see below.
//
// DISCOVERED HOST LIMITATION (TASK-018, 2026-09-14): in this specific harness, this
// PostToolUse hook is never invoked at all when the Bash tool call it's attached to
// itself exits non-zero (confirmed empirically: a bare `exit 1` produced no invocation,
// while any exit-0 command did). Since a genuinely failing test IS a non-zero exit,
// this hook could never observe a real Red-phase failure without a workaround. Fix:
// tdd-config.json's singleFileTestCommand is suffixed with `; true` so the Bash tool
// call itself always reports success while the real pass/fail text is still present
// for the heuristics below to parse. tdd-config.json's testCommand (used only by
// tdd_stop_gate.mjs via spawnSync, never via the Bash tool) is deliberately NOT
// suffixed this way — spawnSync gets a real exit code regardless of this host quirk,
// and wrapping it would break that hook's own red/green detection instead.
import {
  parseHookInput,
  projectDirFrom,
  getConfig,
  readGate,
  writeGate,
  lastRunPath,
  auditLogPath,
  writeJsonAtomic,
  appendLine,
  nowIso,
  tailLines,
  stripAnsi,
  clearDirty,
} from './lib_tdd_common.mjs';

const input = await parseHookInput();
const projectDir = projectDirFrom(input);
const config = getConfig(projectDir);
const cmd = (input.tool_input?.command || '').trim();
if (!cmd) process.exit(0);

function isTestCommand(command) {
  if (command === config.testCommand.trim()) return true;
  // `node ... --test` added for repos on the built-in node:test runner (kitchen-keeper install).
  return /\bvitest\b/.test(command) || /\bnpm\s+(run\s+)?test\b/.test(command) || /\bnode\b.*\s--test\b/.test(command);
}
function isFullSuiteCommand(command) {
  return command === config.testCommand.trim();
}

if (!isTestCommand(cmd)) process.exit(0);

const response = input.tool_response || {};
const exitCode =
  typeof response.exitCode === 'number'
    ? response.exitCode
    : typeof response.exit_code === 'number'
      ? response.exit_code
      : typeof response.success === 'boolean'
        ? response.success
          ? 0
          : 1
        : null;

const outputText = stripAnsi(`${response.stdout || ''}\n${response.stderr || ''}`);

let passed;
if (exitCode !== null) {
  passed = exitCode === 0;
} else if (/\b\d+\s+failed\b/i.test(outputText)) {
  passed = false;
} else if (/\bpassed\b/i.test(outputText) && !/\bfailed\b/i.test(outputText)) {
  passed = true;
} else {
  passed = null;
}

writeJsonAtomic(lastRunPath(projectDir), { command: cmd, passed, at: nowIso(), tail: tailLines(outputText, 40) });

if (passed === null) {
  appendLine(auditLogPath(projectDir), `${nowIso()} UNKNOWN result for "${cmd}" — could not determine pass/fail from tool_response.`);
  process.exit(0);
}

function looksLikeWrongReasonFailure(text) {
  return /Cannot find module|SyntaxError|is not defined|ReferenceError:|Unexpected token/i.test(text);
}

const gate = readGate(projectDir);

if (gate.phase === 'awaiting_red') {
  if (!passed) {
    if (looksLikeWrongReasonFailure(outputText)) {
      appendLine(
        auditLogPath(projectDir),
        `${nowIso()} RED-BUT-WRONG-REASON: "${cmd}" failed, but output suggests a broken test/setup (missing module, syntax error), not a missing-behavior failure. NOT confirming red — fix the test itself first.`
      );
    } else {
      gate.phase = 'red_confirmed';
      gate.redConfirmedAt = nowIso();
      writeGate(projectDir, gate);
      appendLine(auditLogPath(projectDir), `${nowIso()} RED-CONFIRMED case=${gate.currentCase || '?'}: ${cmd}`);
    }
  } else {
    appendLine(
      auditLogPath(projectDir),
      `${nowIso()} WARNING: "${cmd}" passed while gate phase was awaiting_red (case=${gate.currentCase || '?'}) — possible test-after. Phase NOT advanced to green; if this is a real Red-phase pass for an unrelated reason, declare the case again once the actual Red-phase test exists.`
    );
  }
} else if (gate.phase === 'red_confirmed') {
  if (passed) {
    gate.phase = 'green';
    gate.greenAt = nowIso();
    writeGate(projectDir, gate);
    appendLine(auditLogPath(projectDir), `${nowIso()} GREEN case=${gate.currentCase || '?'}: ${cmd}`);
  } else {
    appendLine(auditLogPath(projectDir), `${nowIso()} still red case=${gate.currentCase || '?'}: ${cmd}`);
  }
} else {
  appendLine(auditLogPath(projectDir), `${nowIso()} test run recorded (phase=${gate.phase}): ${cmd} -> ${passed ? 'pass' : 'fail'}`);
}

if (passed && isFullSuiteCommand(cmd)) {
  clearDirty(projectDir);
}

process.exit(0);
