// PreToolUse hook (matcher: Edit|Write|MultiEdit) — Rule 11, Test Locking.
//
// Denies edits/overwrites to a test file that already exists on disk, unless a
// valid, unexpired, unused approval token exists for that exact path (issued by
// approve_test_rewrite.sh after the user explicitly named the file). A test file
// that does not yet exist is never locked (Rule 11, rule 4) — creating one is
// unrestricted.
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

const filePath = input.tool_input?.file_path;
if (!filePath) allow();

const rel = toRel(projectDir, filePath);
if (!matchesAny(rel, config.testFilePatterns)) allow();

const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectDir, filePath);
if (!fs.existsSync(absPath)) allow(); // new test file — not locked yet

const approvals = readJsonSafe(approvalsPath(projectDir), {});
const token = approvals[rel];
const now = Date.now();

if (token && !token.used && token.expiresAt > now) {
  token.used = true;
  token.usedAt = nowIso();
  writeJsonAtomic(approvalsPath(projectDir), approvals);
  appendLine(
    consumedLogPath(projectDir),
    JSON.stringify({ path: rel, reason: token.reason, issuedAt: token.issuedAt, usedAt: token.usedAt, tool: input.tool_name })
  );
  appendLine(auditLogPath(projectDir), `${nowIso()} ALLOW-REWRITE ${rel} via ${input.tool_name}: ${token.reason}`);
  touchDirty(projectDir);
  allow();
}

denyPreToolUse(
  `Rule 11 (Test Locking): "${rel}" is a locked test file — it already exists and cannot be edited, ` +
    `overwritten, or deleted without a single-use approval token. This is not something you can grant ` +
    `yourself: only proceed if the user has, in this conversation, explicitly named this exact file and ` +
    `granted permission to rewrite it. If so, run ` +
    `\`bash .claude/hooks/tdd/approve_test_rewrite.sh "${rel}" "<reason quoting the user's actual permission>"\` ` +
    `and retry this edit once. General permission ("fix the tests if needed") does not count. If the test ` +
    `looks wrong but you don't have that permission yet, this is an Escalation Rules trigger — ask the user, ` +
    `don't route around the lock.`
);
