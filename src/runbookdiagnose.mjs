// ROADMAP 85 — make the `Diagnose` half of every runbook EXECUTABLE in CI.
//
// A runbook's `## Diagnose (read-only)` block is the half a person runs before they
// touch anything. It is also the half that rots silently: a verb renamed, a path moved,
// a quote left unbalanced, a flag the CLI no longer answers. Nothing ran it. Items
// 81/82 made `check` read the FRONT-MATTER only; this module is the other half — the
// commands themselves.
//
// PURE (the 81a/82 input surface): no filesystem, no subprocess. It takes plain values
// (a runbook body, a command's result) and returns plain findings. The caller —
// `demo/runbook-diagnose.test.mjs` — reads the files, builds the hermetic fixture,
// runs `bash -n` and spawns the commands.
//
// What CI asserts, and what it honestly cannot:
//   HARD  - the section exists, carries a fenced shell block, and every block parses;
//           every command the fixture can support exits 0; a `--json` command prints JSON.
//   GAP   - a command that names a host shell the box does not have, a live process, a
//           network endpoint, a `<placeholder>` the runbook has not filled, or a ref/path
//           this tree does not contain. A gap is NOT a pass: it is printed with its
//           reason, and the set of gap REASONS is pinned so a new runbook cannot slip
//           past unexecuted with a reason the harness has never seen.

/** `## Diagnose` or `## Diagnose (read-only)` — the heading the skeleton mandates. */
export const DIAGNOSE_HEADING = /^## Diagnose\b[^\n]*$/m;

/**
 * The `cli.mjs` verbs that answer with a read-only path — the ones a Diagnose block may
 * run against a fixture store without a broker and without writing anything. A verb that
 * opens a writing Harness (`send`, `compact`, `reset`, `serve`, `run`) belongs in `Do`,
 * not in `Diagnose`.
 */
export const READ_ONLY_CLI_VERBS = new Set([
  "status",
  "queue",
  "show",
  "log",
  "watch",
  "events",
  "metrics",
  "check",
  "config",
  "ps",
  "format",
  "worktree",
]);

/** Verbs that are read-only ONLY in a specific form: `format --check` gates, it does not
 *  write; `worktree audit` reports, `worktree <path>` isolates (a write). */
export const CLI_VERB_REQUIRED_FLAG = { format: "--check", worktree: "audit" };

/** `git` subcommands that read. `git worktree` reads only with `list`. */
export const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "branch",
  "show",
  "diff",
  "grep",
  "rev-list",
  "rev-parse",
  "merge-base",
  "cherry",
  "ls-tree",
  "cat-file",
  "ls-files",
  "for-each-ref",
  "count-objects",
  "remote",
  "blame",
  "worktree",
]);

/** Plain read-only shell tools the harness is willing to run. */
export const READ_ONLY_SHELL_TOOLS = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "egrep", "sort", "uniq", "awk", "sed",
  "comm", "echo", "test", "stat", "find", "du", "ps", "pgrep", "date", "pwd", "env",
  "which", "command", "tr", "basename", "dirname", "realpath", "file", "tree",
  "printf", "true", "false", "cut", "seq", "tac", "nl", "paste", "readlink",
]);

/**
 * The section's text, or null when the runbook has no `## Diagnose` section. Stops at the
 * next `## ` heading so prose after the block is not swallowed.
 */
export function extractDiagnoseSection(body) {
  const text = String(body ?? "");
  const start = text.match(DIAGNOSE_HEADING);
  if (!start) return null;
  const rest = text.slice(start.index + start[0].length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The fenced blocks inside a section: [{lang, code}]. */
export function diagnoseFences(section) {
  return [...String(section ?? "").matchAll(/```([a-zA-Z]*)\n([\s\S]*?)```/g)].map((m) => ({
    lang: m[1].trim(),
    code: m[2],
  }));
}

/** The non-empty, non-comment lines of one fenced block. */
export function fenceCommandLines(code) {
  return String(code ?? "")
    .split("\n")
    .map((raw) => raw.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** Every candidate command line of every block in a section. */
export function diagnoseCommandLines(section) {
  const lines = [];
  for (const fence of diagnoseFences(section)) lines.push(...fenceCommandLines(fence.code));
  return lines;
}

/**
 * The shape of a runbook's Diagnose half. Two kinds of finding, deliberately separate:
 *   defect   - a block exists and is wrong (empty, or fenced as a language that is not a
 *              shell). CI fails on these.
 *   coverage - there is nothing here to execute (no section, no fenced block). Reported,
 *              pinned by name in the caller, so the set cannot grow silently.
 * Pure: takes {file, body}. Returns [{kind, problem}].
 */
export function runbookDiagnoseFindings(runbook) {
  const body = String(runbook?.body ?? "");
  const findings = [];
  const section = extractDiagnoseSection(body);
  if (section === null) {
    findings.push({ kind: "coverage", problem: "no `## Diagnose` section" });
    return findings;
  }
  const fences = diagnoseFences(section);
  if (fences.length === 0) {
    findings.push({ kind: "coverage", problem: "`## Diagnose` section has no fenced command block" });
    return findings;
  }
  for (const fence of fences) {
    // `powershell` is a real shell on the box these runbooks serve; the harness simply
    // cannot execute it here, which classifyDiagnoseLine reports as a gap.
    if (fence.lang && !/^(bash|sh|console|text|powershell|ps1|pwsh)$/i.test(fence.lang)) {
      findings.push({ kind: "defect", problem: `Diagnose block is fenced as \`${fence.lang}\`, not as a shell block` });
    }
    if (fenceCommandLines(fence.code).length === 0) {
      findings.push({ kind: "defect", problem: "Diagnose block is empty — nothing to run" });
    }
  }
  return findings;
}

/** Split a command line into segments on the shell's control operators. Quoted text is
 *  removed first so a `;` inside a string does not fake a segment boundary. */
function segments(line) {
  return String(line ?? "")
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .split(/[;|]|&&/)
    .map((seg) => seg.trim())
    .filter(Boolean);
}



/**
 * A runbook writes `<pid>`, `<branch>`, `<repo>` — prose that is not a command. To execute
 * it, the harness fills the placeholder from the fixture. A placeholder with no fixture
 * value stays a gap; nothing is invented silently.
 */
const PLACEHOLDER_RULES = [
  [/\bbranch\b|\bref\b|\bhead\b/i, "branch"],
  [/\bsha\b|\bcommit\b/i, "sha"],
  [/\bseat\b/i, "seat"],
  [/\bpid\b|\bprocess\b/i, "pid"],
  [/\bworktree\b|\bwt\b/i, "worktree"],
  [/\brepo\b|\broot\b|\btree\b/i, "repo"],
  [/\bfile\b|\bpath\b|\bdir\b|\bdoc\b/i, "path"],
  [/\bid\b|\bitem\b/i, "id"],
  [/\bport\b/i, "port"],
  [/\bpattern\b|\bphrase\b|\btext\b|\bstring\b|\bname\b/i, "example"],
];

/**
 * Fill every `<placeholder>` from the fixture values. Returns {line, unfilled: []}.
 * @param {string} line @param {Record<string,string>} values fixture values keyed by
 *   the rule names above.
 */
export function fillPlaceholders(line, values) {
  let out = String(line ?? "");
  const unfilled = [];
  for (const match of [...out.matchAll(/<([^<>]+)>/g)]) {
    const inner = match[1].trim();
    let key = null;
    for (const [pattern, name] of PLACEHOLDER_RULES) if (pattern.test(inner)) { key = name; break; }
    if (key && values[key] !== undefined) out = out.replace(match[0], values[key]);
    else unfilled.push(inner);
  }
  return { line: out, unfilled };
}

/** Refs a runbook names that the fixture can create (item branches). */
export function collectItemRefs(section) {
  return [...new Set([...String(section ?? "").matchAll(/\b(?:[a-z]+-)?item-\d+\b/g)].map((m) => m[0]))];
}

/** Is a line part of a multi-line shell construct rather than a standalone command? */
export function isControlFlowLine(line) {
  const t = String(line ?? "").trim();
  return /^(for|while|if|case)\b/.test(t) || /^\s*(do|done|then|else|fi|esac)\b/.test(t) || t.endsWith("\\") || /^[)|}]/.test(t) || t.startsWith("|");
}

/**
 * A whole fenced block that contains a multi-line construct: can the harness run it as one
 * unit? Every verb in it must be in the read-only allowlist (control keywords excepted),
 * and every line must be free of unfilled placeholders. Multi-line constructs cannot be
 * checked line by line — they only parse as a unit.
 */
export function classifyDiagnoseBlock(code, fixture = {}) {
  const lines = fenceCommandLines(code);
  if (lines.length === 0) return { runnable: false, reason: "empty block", kind: "skip" };
  for (const line of lines) {
    if (line.includes("<") || line.includes("*")) return { runnable: false, reason: "an unfilled `<placeholder>` or a glob", kind: "gap" };
    if (isControlFlowLine(line)) continue;
    const cls = classifyDiagnoseLine(line, fixture);
    if (!cls.runnable) return { runnable: false, reason: cls.reason, kind: cls.kind };
  }
  return { runnable: true, reason: "read-only block, all verbs allowlisted", kind: "run" };
}

/** `git` subcommands whose non-flag arguments are refs worth verifying. */
export const GIT_REF_SUBCOMMANDS = new Set([
  "merge-base", "cherry", "rev-list", "rev-parse", "show", "ls-tree", "cat-file", "blame", "diff", "log",
]);

/** Words that are neither a file path nor a ref: subcommand nouns and option values. */
const NON_OPERAND_WORDS = new Set(["list", "audit", "porcelain", "short", "tree", "stat", "unreachable"]);

/**
 * The operands a command names, per segment: a token containing `.` or `/` is a PATH that
 * must exist in the fixture; a bare word after a ref-taking git subcommand is a REF that
 * must exist. Quoted text, flags, and subcommand nouns are not operands.
 */
function operandCheck(segment, fixture) {
  const code = segment.replace(/"[^"]*"|'[^']*'/g, " ").replace(/#.*$/, "").trim();
  const words = code.split(/\s+/).filter(Boolean);
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift(); // env prefix
  const verb = words[0];
  const rest = verb === "git" ? words.slice(2) : words.slice(1);
  for (const token of rest) {
    if (token.startsWith("-") || token === "--" || token === "." || NON_OPERAND_WORDS.has(token)) continue;
    if (token.includes(">") || token.includes("<")) continue; // redirections are not operands
    const path = token.includes(":") ? token.split(":").pop() : token;
    if (path.startsWith("refs/")) {
      if (fixture.refExists && !fixture.refExists(token)) {
        return { runnable: false, reason: `\`${token}\` is not a ref in the fixture`, kind: "gap" };
      }
      continue;
    }
    if (path.includes("/") || path.includes(".")) {
      if (!fixture.exists || !fixture.exists(path.startsWith("/") ? path : path)) {
        return { runnable: false, reason: `\`${path}\` is not present in the fixture`, kind: "gap" };
      }
      continue;
    }
    const gitSub = verb === "git" ? words[1] : null;
    if (verb === "git" && GIT_REF_SUBCOMMANDS.has(gitSub) && !/^[A-Za-z0-9_./-]+$/.test(token)) continue;
    if (verb === "git" && GIT_REF_SUBCOMMANDS.has(gitSub)) {
      if (!fixture.refExists || !fixture.refExists(token)) {
        return { runnable: false, reason: `\`${token}\` is not a ref in the fixture`, kind: "gap" };
      }
    }
  }
  return null;
}

/**
 * Can the harness run this line hermetically? Returns {runnable, reason, kind}.
 * `fixture` supplies {exists(path), refExists(ref)}. A line is runnable when every
 * segment starts with a read-only verb and every operand it names is present in the
 * fixture. Anything else is a NAMED gap, never a silent pass.
 */
export function classifyDiagnoseLine(line, fixture = {}) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return { runnable: false, reason: "empty line", kind: "skip" };
  if (trimmed.startsWith("#")) return { runnable: false, reason: "comment", kind: "skip" };
  if (/\\$/.test(trimmed)) return { runnable: false, reason: "continues onto the next line", kind: "skip" };
  if (/^(for|while|if|case|do|done|then|else|fi|esac|eval)\b/.test(trimmed)) {
    return { runnable: false, reason: "multi-line shell control flow", kind: "skip" };
  }
  if (/^[)\}]|^\|/.test(trimmed)) return { runnable: false, reason: "a fragment of a multi-line command", kind: "skip" };
  if (trimmed.includes("<")) return { runnable: false, reason: "an unfilled `<placeholder>`", kind: "gap" };
  if (trimmed.includes("*")) return { runnable: false, reason: "a glob the fixture cannot guarantee", kind: "gap" };
  if (/(powershell|Get-CimInstance|Get-NetTCPConnection|taskkill|Select-String|cmd \/c)/i.test(trimmed)) {
    return { runnable: false, reason: "host-specific shell command", kind: "gap" };
  }
  if (/curl|http:\/\//i.test(trimmed)) return { runnable: false, reason: "needs a live network endpoint", kind: "gap" };
  if (/\bkill\b|\bpkill\b/i.test(trimmed)) return { runnable: false, reason: "a process write, not a read", kind: "gap" };

  for (const seg of segments(trimmed)) {
    const words = seg.split(/\s+/);
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift(); // env prefix
    const verb = words[0];
    if (!verb) return { runnable: false, reason: "empty segment", kind: "skip" };
    if (verb === "node") {
      const target = words[1];
      if (target === "--version") continue;
      if (target === "cli.mjs" || target === "./cli.mjs") {
        const sub = words[2];
        if (!READ_ONLY_CLI_VERBS.has(sub)) {
          return { runnable: false, reason: `\`cli.mjs ${sub ?? "?"}\` is not a read-only verb`, kind: "gap" };
        }
        const needed = CLI_VERB_REQUIRED_FLAG[sub];
        if (needed && !seg.includes(needed)) {
          return { runnable: false, reason: `\`cli.mjs ${sub}\` writes unless it carries \`${needed}\``, kind: "gap" };
        }
        continue;
      }
      if (/^[A-Za-z0-9_/.-]+\.(mjs|js)$/.test(target)) {
        if (!fixture.exists || !fixture.exists(target)) {
          return { runnable: false, reason: `\`${target}\` is not in the tree`, kind: "gap" };
        }
        continue; // a repo tool script: read-only by contract, run against the fixture store
      }
      if (/^demo\//.test(target)) {
        return { runnable: false, reason: "re-runs a suite test — the suite already runs it", kind: "gap" };
      }
      return { runnable: false, reason: "runs inline code, not a script in the tree", kind: "gap" };
    }
    if (verb === "git") {
      let i = 1;
      while (i + 1 < words.length && (/^-C$/.test(words[i]) || /^-[ci]$/.test(words[i]) || /^--git-dir$/.test(words[i]))) i += 2;
      const sub = words[i];
      if (!READ_ONLY_GIT_SUBCOMMANDS.has(sub)) {
        return { runnable: false, reason: `\`git ${sub ?? "?"}\` is not a read-only subcommand`, kind: "gap" };
      }
      if (sub === "worktree" && words[2] !== "list") {
        return { runnable: false, reason: "`git worktree` is read-only only with `list`", kind: "gap" };
      }
      continue;
    }
    if (READ_ONLY_SHELL_TOOLS.has(verb)) {
      if (fixture.hasTool && !fixture.hasTool(verb)) {
        return { runnable: false, reason: `\`${verb}\` is not available on this box`, kind: "gap" };
      }
      continue;
    }
    return { runnable: false, reason: `\`${verb}\` is not in the harness's read-only allowlist`, kind: "gap" };
  }

  for (const seg of segments(trimmed)) {
    const problem = operandCheck(seg, fixture);
    if (problem) return problem;
  }
  return { runnable: true, reason: "read-only verb, every operand present", kind: "run" };
}

/** Does a command that claims to print JSON actually print JSON? */
export function stdoutIsJson(stdout) {
  const s = String(stdout ?? "").trim();
  if (!s) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    const i = s.search(/[{[]/);
    if (i === -1) return false;
    try {
      JSON.parse(s.slice(i));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * What a probe's exit code MEANS. A command can fail because it is broken (the rot CI
 * exists to catch) or because the fixture cannot contain the live state it reads. Those
 * are different, and lumping them together either makes CI red on valid runbooks or hides
 * real rot. Returns {kind: "pass" | "gap" | "defect", reason}.
 */
export function classifyProbeFailure(result) {
  const { exitCode, stdout = "", stderr = "" } = result ?? {};
  const out = `${stdout}${stderr}`;
  if (exitCode === 0) return { kind: "pass", reason: "exit 0" };
  if (exitCode === 127) return { kind: "defect", reason: "the command does not exist on this box" };
  if (/syntax error|unexpected token|unexpected EOF|unexpected newline/i.test(stderr)) {
    return { kind: "defect", reason: "the line is not valid shell" };
  }
  if (/is not a git command|usage:|"usage"|no such command|unknown command/i.test(out)) {
    return { kind: "defect", reason: "the tool does not answer this verb" };
  }
  return { kind: "verdict", reason: `ran, exit ${exitCode}` };
}

/**
 * Findings from a command that ran. A defect is a failure; a gap is reported, not passed.
 * Pure over {line, exitCode, stdout, stderr}.
 */
export function diagnoseResultFindings(result) {
  const problems = [];
  const verdict = classifyProbeFailure(result);
  if (verdict.kind === "defect") problems.push(`${verdict.reason}: ${result?.line}`);
  if (verdict.kind === "pass" && String(result?.line ?? "").includes("--json") && !String(result?.line ?? "").includes("|")) {
    if (!stdoutIsJson(result.stdout)) problems.push(`--json output is not parseable: ${result.line}`);
  }
  return problems;
}

/**
 * The verbs `cli.mjs` answers, read off its OWN usage text — derived, never hand-listed,
 * so a renamed verb cannot stay trusted in a runbook.
 */
export function cliUsageVerbs(usageText) {
  return new Set([...String(usageText ?? "").matchAll(/node cli\.mjs ([a-z][a-z-]*)/g)].map((m) => m[1]));
}

/** A Diagnose line that names a `cli.mjs` verb the CLI does not answer. */
export function unknownCliVerbProblem(line, usageVerbs) {
  const m = String(line ?? "").match(/\bnode\s+(?:\.\/)?cli\.mjs\s+([a-z][a-z-]*)/);
  if (!m) return null;
  const verb = m[1];
  if (usageVerbs.has(verb)) return null;
  return `\`cli.mjs ${verb}\` is not a verb the CLI answers (renamed or vanished): ${line}`;
}
