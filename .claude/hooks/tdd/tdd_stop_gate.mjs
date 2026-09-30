// Stop hook — blocks the turn from ending if the configured test command is failing.
// Only actually runs the suite when something has changed since the last confirmed
// green run (a 'dirty' marker set by the PreToolUse hooks on any allowed source/test
// edit) — this keeps a no-op Stop event cheap rather than re-running vitest on every
// single turn.
//
// stop_hook_active is checked first, per the documented convention, to avoid an
// infinite loop; Claude Code also caps at 8 consecutive blocks regardless.
import { spawnSync } from 'node:child_process';
import {
  parseHookInput,
  projectDirFrom,
  getConfig,
  isDirty,
  clearDirty,
  lastRunPath,
  auditLogPath,
  writeJsonAtomic,
  appendLine,
  nowIso,
  tailLines,
  stopAllow,
  stopBlock,
} from './lib_tdd_common.mjs';

const input = await parseHookInput();
if (input.stop_hook_active) stopAllow();

const projectDir = projectDirFrom(input);
if (!isDirty(projectDir)) stopAllow();

const config = getConfig(projectDir);
const timeout = config.stopGateTimeoutMs || 120000;

const result =
  process.platform === 'win32'
    ? spawnSync('cmd', ['/d', '/s', '/c', config.testCommand], { cwd: projectDir, timeout, encoding: 'utf8' })
    : spawnSync('sh', ['-c', config.testCommand], { cwd: projectDir, timeout, encoding: 'utf8' });

const outputText = `${result.stdout || ''}\n${result.stderr || ''}`;
const timedOut = result.error && result.error.code === 'ETIMEDOUT';
const passed = !timedOut && result.status === 0;

writeJsonAtomic(lastRunPath(projectDir), {
  command: config.testCommand,
  passed,
  at: nowIso(),
  tail: tailLines(outputText, 60),
});

if (passed) {
  clearDirty(projectDir);
  appendLine(auditLogPath(projectDir), `${nowIso()} STOP-GATE: suite green, allowing stop`);
  stopAllow();
}

appendLine(auditLogPath(projectDir), `${nowIso()} STOP-GATE: suite red${timedOut ? ' (timed out)' : ''}, blocking stop`);
stopBlock(
  `Test suite ("${config.testCommand}") is ${timedOut ? 'timing out' : 'failing'}. Fix it before ending the turn — ` +
    `do not weaken, skip, or delete the failing test(s) (Rule 10 rule 5 / Rule 11). If a failure is a flaky, ` +
    `non-deterministic test rather than a wrong one, quarantine it via .claude/flaky-quarantine.json instead of ` +
    `editing the test file. Output tail:\n${tailLines(outputText, 40)}`
);
