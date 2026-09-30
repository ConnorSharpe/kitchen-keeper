// Shared helpers for the TDD enforcement hook kit (AI Development Agent Efficiency
// Guide, Rev 12, Rules 10-12). Not a hook itself — imported by the tdd_*.mjs scripts
// that the tdd_*.sh wrappers exec into.
//
// Implemented in Node (not pure POSIX sh, as the guide's file list implies) because
// this environment has no `jq`, and JSON parsing / glob matching in raw bash is fragile
// enough to undermine the "airtight" claim Rule 12 makes about this layer. Node is a
// hard dependency of this repo already (npm project), so this adds no new tooling
// requirement.

import fs from 'node:fs';
import path from 'node:path';

export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function parseHookInput() {
  const raw = await readStdin();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Hook scripts run via Git Bash on Windows (documented hook execution contract), so
// a `cwd` value could plausibly arrive in POSIX drive form ('/c/Users/...') even
// though Node's fs/path on Windows expect native form ('C:/Users/...'). Normalize
// defensively — found by testing against a real POSIX-style path, not by inspection.
export function normalizeCwd(cwd) {
  if (process.platform === 'win32' && cwd) {
    const m = /^\/([a-zA-Z])\/(.*)$/.exec(cwd);
    if (m) return `${m[1].toUpperCase()}:/${m[2]}`;
  }
  return cwd;
}

export function projectDirFrom(input) {
  return normalizeCwd(input.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function toRel(projectDir, absOrRelPath) {
  if (!absOrRelPath) return '';
  const abs = path.isAbsolute(absOrRelPath) ? absOrRelPath : path.resolve(projectDir, absOrRelPath);
  const rel = path.relative(projectDir, abs);
  return rel.split(path.sep).join('/');
}

// Minimal glob support: '**' (zero-or-more path segments), '*' (within one segment),
// '?' (single char). Enough for the patterns tdd-config.json actually uses; not a
// general-purpose glob library.
//
// Single-pass scan, deliberately — an earlier sequential-replace version inserted
// regex syntax (e.g. '(?:.*/)?' for '**/') and then mangled it in a later replace
// pass meant for literal '*'/'?' in the original glob. Caught by testing against
// this repo's actual patterns before trusting it (see TDD Enforcement Setup's own
// "every script was run against a scratch repo" principle).
export function globToRegExp(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
    } else if (c === '*') {
      re += '[^/]*';
      i += 1;
    } else if (c === '?') {
      re += '.';
      i += 1;
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

export function matchesAny(relPath, patterns) {
  if (!relPath || !patterns) return false;
  return patterns.some((p) => globToRegExp(p).test(relPath));
}

const DEFAULT_CONFIG = {
  testFilePatterns: ['tests/**/*.test.ts'],
  testCommand: 'npm test',
  singleFileTestCommand: 'npx vitest run "{file}"',
  approvalTtlMs: 600000,
  stopGateTimeoutMs: 120000,
  cosmeticUiPatterns: [],
  alwaysExemptPatterns: [],
  sensitivePathPatterns: [],
};

export function getConfig(projectDir) {
  const configPath = path.join(projectDir, '.claude', 'tdd-config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function containsLogicKeywords(text) {
  if (!text) return false;
  return /\b(if|else|for|while|switch|catch|function|class)\b|=>|\?\s*[^:]+\s*:/.test(text);
}

// --- state directory ---

export function stateDir(projectDir) {
  const dir = path.join(projectDir, '.claude', 'tdd-state');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function gatePath(projectDir) {
  return path.join(stateDir(projectDir), 'gate.json');
}
export function approvalsPath(projectDir) {
  return path.join(stateDir(projectDir), 'approvals.json');
}
export function consumedLogPath(projectDir) {
  return path.join(stateDir(projectDir), 'consumed-approvals.log');
}
export function auditLogPath(projectDir) {
  return path.join(stateDir(projectDir), 'audit.log');
}
export function lastRunPath(projectDir) {
  return path.join(stateDir(projectDir), 'last-run.json');
}
export function dirtyPath(projectDir) {
  return path.join(stateDir(projectDir), 'dirty');
}

export function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(filePath, obj) {
  const tmp = filePath + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

export function appendLine(filePath, line) {
  fs.appendFileSync(filePath, line + '\n');
}

export function nowIso() {
  return new Date().toISOString();
}

export function touchDirty(projectDir) {
  fs.writeFileSync(dirtyPath(projectDir), nowIso());
}

export function clearDirty(projectDir) {
  try {
    fs.unlinkSync(dirtyPath(projectDir));
  } catch {
    // already clear
  }
}

export function isDirty(projectDir) {
  return fs.existsSync(dirtyPath(projectDir));
}

export function defaultGate() {
  return { phase: 'no_case', currentCase: null, testFile: null, declaredAt: null, history: [] };
}

export function readGate(projectDir) {
  return readJsonSafe(gatePath(projectDir), defaultGate());
}

export function writeGate(projectDir, gate) {
  // Bound history so this file never becomes an unbounded log (guide's own
  // Size Discipline principle applied to hook state, not just handoff docs).
  if (Array.isArray(gate.history) && gate.history.length > 50) {
    gate.history = gate.history.slice(-50);
  }
  writeJsonAtomic(gatePath(projectDir), gate);
}

// --- hook output helpers ---

export function allow() {
  process.exit(0);
}

export function denyPreToolUse(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

export function stopBlock(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        decision: 'block',
        reason,
      },
    })
  );
  process.exit(0);
}

export function stopAllow() {
  process.exit(0);
}

export function tailLines(text, n) {
  const lines = (text || '').split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

// Strip ANSI escape sequences (color codes, cursor moves) before running any regex
// heuristic over captured test-runner output. Found necessary during TASK-018: real
// vitest terminal output like "\x1b[31m2 failed\x1b[39m" defeats a naive
// /\b\d+\s+failed\b/ check, because the SGR reset code immediately before the digit
// ends in a word character ('m'), so no \b boundary exists there and the match
// silently fails — confirmed by inspecting a real captured tool_response, not by
// inspection alone.
export function stripAnsi(text) {
  return (text || '').replace(/\x1b\[[0-9;]*m/g, '');
}
