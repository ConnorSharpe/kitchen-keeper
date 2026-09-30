// Run yourself (not a hook): issues a single-use approval token letting exactly one
// subsequent Edit/Write/MultiEdit or Bash op rewrite one specific, already-locked test
// file. Never run this speculatively — only after the user has, in this conversation,
// explicitly named this exact file and granted permission to delete/rewrite it.
//
// HONEST LIMITATION (Rule 12): this script cannot itself verify permission was really
// given — it can only make the decision to proceed auditable, logged, and single-use.
// That the permission was real is still, ultimately, a behavioral expectation on
// whoever runs this.
//
// Usage: node approve_test_rewrite.mjs <test-file-relative-path> "<reason quoting the user's permission>"
import { projectDirFrom, toRel, approvalsPath, auditLogPath, readJsonSafe, writeJsonAtomic, appendLine, nowIso, getConfig } from './lib_tdd_common.mjs';

const [fileArg, reasonArg] = process.argv.slice(2);
if (!fileArg || !reasonArg || !reasonArg.trim()) {
  console.error('Usage: approve_test_rewrite.sh <test-file-relative-path> "<reason quoting the user\'s permission>"');
  console.error('Both arguments are required. The reason must actually quote/paraphrase permission the user gave in this conversation for THIS file.');
  process.exit(1);
}

const projectDir = projectDirFrom({});
const rel = toRel(projectDir, fileArg);
const config = getConfig(projectDir);
const ttl = config.approvalTtlMs || 600000;

const approvals = readJsonSafe(approvalsPath(projectDir), {});
const now = Date.now();
approvals[rel] = {
  reason: reasonArg,
  issuedAt: nowIso(),
  expiresAt: now + ttl,
  used: false,
};
writeJsonAtomic(approvalsPath(projectDir), approvals);
appendLine(auditLogPath(projectDir), `${nowIso()} APPROVAL-ISSUED ${rel}: ${reasonArg}`);

console.log(`Approval token issued for "${rel}", expires in ${Math.round(ttl / 1000)}s, single-use.`);
console.log('Proceed with the rewrite now — record the reason in this session\'s handoff (Decisions Made) per the guide\'s session-end checklist.');
