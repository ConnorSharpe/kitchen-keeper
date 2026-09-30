#!/usr/bin/env bash
# Tool-agnostic backstop for Rule 11 (Test Locking). Fires on every `git commit`
# regardless of which tool made the change — a human editing directly, a different
# AI tool, or a Claude Code session with the hooks in .claude/hooks/tdd disabled.
#
# HONEST LIMITATION (Rule 12): narrower than the PreToolUse hooks. It only catches
# modified/removed lines in an already-tracked test file that have no matching
# consumed-approval record — it does not gate Red-before-Green ordering at all, and a
# determined bypass could edit .claude/tdd-state/consumed-approvals.log too (which
# would itself be visible, auditable evidence in git history of the state file).
#
# Install: mkdir -p githooks && cp githooks/pre-commit-tdd-guard.sh githooks/pre-commit \
#   && chmod +x githooks/pre-commit && git config core.hooksPath githooks
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
CONFIG_PATH="$REPO_ROOT/.claude/tdd-config.json"
CONSUMED_LOG="$REPO_ROOT/.claude/tdd-state/consumed-approvals.log"

if [ ! -f "$CONFIG_PATH" ]; then
  # Enforcement kit not installed in this checkout — nothing to guard.
  exit 0
fi

# Delegate the actual pattern-matching + JSON-log check to node (available: this is
# an npm project already), since bash has no reliable glob/JSON story here.
node --input-type=module -e '
import fs from "node:fs";
import { execSync } from "node:child_process";

const repoRoot = process.argv[1];
const configPath = process.argv[2];
const consumedLogPath = process.argv[3];

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const testFilePatterns = config.testFilePatterns || [];

function globToRegExp(glob) {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (c === "*") {
      re += "[^/]*";
      i += 1;
    } else if (c === "?") {
      re += ".";
      i += 1;
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp("^" + re + "$");
}
function matchesAny(relPath, patterns) {
  return patterns.some((p) => globToRegExp(p).test(relPath));
}

const statusOutput = execSync("git diff --cached --name-status", { cwd: repoRoot, encoding: "utf8" });
const lines = statusOutput.split("\n").filter(Boolean);

let consumed = [];
if (fs.existsSync(consumedLogPath)) {
  consumed = fs
    .readFileSync(consumedLogPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const violations = [];
for (const line of lines) {
  const parts = line.split("\t");
  const status = parts[0];
  const relPath = parts[parts.length - 1];
  if (!matchesAny(relPath, testFilePatterns)) continue;
  if (status === "A") continue; // new test file — never locked before it exists (Rule 11 rule 4)
  if (status !== "M" && status !== "D" && !status.startsWith("R")) continue;

  const hasApproval = consumed.some((c) => c.path === relPath);
  if (!hasApproval) violations.push(relPath);
}

if (violations.length > 0) {
  console.error("");
  console.error("BLOCKED by githooks/pre-commit-tdd-guard.sh (Rule 11, Test Locking):");
  for (const v of violations) {
    console.error(`  - ${v} was modified/removed with no recorded approval token.`);
  }
  console.error("");
  console.error("If the user explicitly named this file and granted permission to rewrite it, run:");
  console.error("  bash .claude/hooks/tdd/approve_test_rewrite.sh \"<path>\" \"<reason>\"");
  console.error("then re-stage and re-run the edit through Claude Code (or re-run this check) so the");
  console.error("approval gets consumed and logged before committing.");
  console.error("");
  process.exit(1);
}
process.exit(0);
' "$REPO_ROOT" "$CONFIG_PATH" "$CONSUMED_LOG"
