/**
 * readonlytool.mjs — the ONE way a coordinator (a seat with no working capability) may run code.
 *
 * WHY THIS EXISTS (#7278 thread; operator decision 2026-11-12T18:5xZ). `COORDINATOR_REMOVALS`
 * (src/seattools.mjs) strips `read`/`write`/`edit`/`shell`/`prepareWorkspace` from a coordinator, and the
 * reason is documented and real: *"pm investigated the repository instead of routing the request. Removing
 * the tools restores what prose could not."* But removing them removed MEASUREMENT too, and the measured
 * cost is on the record: pm's own continuity note says *"every measurement quoted here is relayed by
 * another seat or the delegate"*. On 2026-11-12 the delegate sent the same 10-bin landing plan to pm
 * twice as prose, pm could not run `tools/landing-batch-plan.mjs` to check it, and two queue rows
 * (#7136 "priority leases are inert", #7237 "main is red") stayed alive for hours because nobody who
 * could route could measure them.
 *
 * The fix is NOT a shell and NOT a working capability:
 *   - a shell is a write, and a working capability would make `seatIsCoordinator(pm)` false, which
 *     silently strips the coordinator-only `release` authority (#6097/#6112). Trading a routing power
 *     for a tool is a bad trade.
 *   - a measured entrypoint is not. So this module is an ALLOWLIST of named, read-only commands: no
 *     shell string is ever assembled from free text, no pipeline, no redirection, no `node -e`.
 *
 * THREE PROPERTIES, each of which is a refusal:
 *   1. the command comes from a TABLE, chosen by name — an unknown name is refused and lists the names;
 *   2. every argument token must match `SAFE_TOKEN` (letters, digits, `_.:@/=-`), so `;`, `$`, backticks,
 *      `|`, quotes and whitespace cannot reach a shell at all;
 *   3. `git` is limited to READ-ONLY subcommands, and the write class (`commit`, `merge`, `rebase`,
 *      `push`, `checkout`, `reset`, `clean`, `branch -D`, …) is refused BY NAME.
 *
 * AND THE BOUND THAT MATTERS FOR A TURN: a coordinator reading the live store inside its own turn can
 * hang — measured **155.3 min of broker time against a 75 min per-turn bound** (#5640), and the
 * clock-in digest's own `status` read timing out twice at 120 s (#5644). So the runner is bounded, and a
 * timeout returns `BLOCKED` (a diagnosis a router can act on) instead of eating the turn.
 *
 * Pure until `runReadonlyCommand` calls `env.exec`, so the table and every refusal are testable with no
 * store, no broker and no model.
 */

/** A token that cannot escape into a shell: no whitespace, quotes, `$`, backtick, `;`, `|`, `&`, `(`, `)`, `<`, `>`. */
export const SAFE_TOKEN = /^[A-Za-z0-9_.:@/=+-]{1,120}$/;

/** The default bound for one call, in seconds. Deliberately short: this is a measurement, not a build. */
export const READONLY_TIMEOUT_S = 25;

/** Read-only git subcommands. Everything else is refused, so `git` cannot become a write path. */
export const GIT_READONLY_SUBCOMMANDS = Object.freeze([
  "log",
  "status",
  "diff",
  "branch",
  "show",
  "rev-parse",
  "merge-base",
  "describe",
  "ls-files",
  "worktree",
  "cat-file",
  "shortlog",
  "blame",
]);

/**
 * The allowlist. `argv` is the fixed prefix; `args` from the caller are appended AFTER validation.
 * Only measurement entrypoints, and only ones that answer a question a ROUTER has: what is landable,
 * what is stranded, what does the queue look like, is this area green, what does git say.
 */
export const READONLY_COMMANDS = Object.freeze({
  "landing-plan": { argv: ["node", "tools/landing-batch-plan.mjs"], why: "the landing bins and their merge order" },
  "drain-audit": { argv: ["node", "tools/queue-drain-audit.mjs"], why: "which held/deferred rows are already on main, and the stranded-gate census" },
  "branch-census": { argv: ["node", "tools/branch-census.mjs"], why: "refs/worktrees and the prune verdict per ref" },
  "queue": { argv: ["node", "cli.mjs", "queue"], why: "the queue (add --json --no-body for volume)" },
  status: { argv: ["node", "cli.mjs", "status"], why: "per-seat health, attention notices, the active directive" },
  fleet: { argv: ["node", "tools/fleet-health.mjs"], why: "generations completed/failed/in-flight per conversation" },
  stranded: { argv: ["node", "tools/stranded-inbox.mjs"], why: "whether reads are stranded and how stale the pass clock is" },
  test: { argv: ["node", "scripts/test.mjs"], why: "run ONE area (--area <name>) — the fast loop, never --all" },
  git: { argv: ["git"], why: "read-only git: log/status/diff/branch/show/rev-parse/merge-base/worktree" },
});

/** Refused BY NAME, so a caller learns the boundary instead of guessing at it. */
export const REFUSED_SUBSTRINGS = Object.freeze(["-e", "--eval", "land.mjs", "land.js", "push", "install", "exec"]);

/** The refusal for an unknown command, listing what IS allowed. */
export function unknownCommandText(name) {
  const known = Object.keys(READONLY_COMMANDS).join(", ");
  return `refused: "${name}" is not an allowlisted measurement. Known: ${known}. This tool runs NAMED read-only entrypoints; it is not a shell (no pipelines, no redirection, no \`node -e\`, no writes).`;
}

/**
 * Build the argv for one call, or refuse with a reason.
 *
 * @param {string} name one of READONLY_COMMANDS
 * @param {string[]} args caller tokens, each validated
 * @returns {{ok: true, argv: string[]} | {ok: false, refusal: string}}
 */
export function buildReadonlyCommand(name, args = []) {
  const entry = READONLY_COMMANDS[name];
  if (!entry) return { ok: false, refusal: unknownCommandText(name) };
  const tokens = Array.isArray(args) ? args.map((a) => String(a)) : [];
  for (const token of tokens) {
    if (!SAFE_TOKEN.test(token)) {
      return {
        ok: false,
        refusal: `refused: argument ${JSON.stringify(token)} contains a character outside [A-Za-z0-9_.:@/=+-]. This is an allowlist, not a shell: no quoting, no globbing, no substitution, no pipelines.`,
      };
    }
  }
  if (name === "git") {
    const sub = tokens[0];
    if (!sub) return { ok: false, refusal: `refused: name a read-only git subcommand (${GIT_READONLY_SUBCOMMANDS.join(", ")})` };
    if (!GIT_READONLY_SUBCOMMANDS.includes(sub)) {
      return {
        ok: false,
        refusal: `refused: "git ${sub}" is not read-only here. Allowed: ${GIT_READONLY_SUBCOMMANDS.join(", ")}. A coordinator measures the repo; it does not change it.`,
      };
    }
  }
  for (const token of tokens) {
    const hit = REFUSED_SUBSTRINGS.find((bad) => token === bad || token.includes(bad));
    if (hit) {
      return { ok: false, refusal: `refused: token ${JSON.stringify(token)} names "${hit}", which is not a measurement (landing is a GATED seat job, and this tool never edits, installs or evaluates code)` };
    }
  }
  if (name === "test" && !tokens.includes("--area")) {
    return { ok: false, refusal: "refused: `test` runs ONE AREA — pass --area <name>. A coordinator does not run the whole suite: 120 s of a turn buys a router nothing." };
  }
  return { ok: true, argv: [...entry.argv, ...tokens] };
}

/** Which root the call runs in: the seat's own, exactly like every other seat tool (never a shell guess). */
export function readonlyCwd(api) {
  const env = api?.env;
  if (!env || typeof env !== "object") return null;
  return typeof env.cwd === "string" && env.cwd !== "" ? env.cwd : null;
}

/**
 * Run one allowlisted measurement through the seat's OWN confined environment.
 *
 * The result is always TEXT (never a throw): a refusal, a BLOCKED timeout, or the command's output with
 * its exit code. A tool that throws inside a turn costs the turn; a tool that reports costs a line.
 */
export async function runReadonlyCommand(api, context, name, args = [], { timeoutS = READONLY_TIMEOUT_S } = {}) {
  const built = buildReadonlyCommand(name, args);
  if (!built.ok) return `RUN_READONLY ${built.refusal}`;
  const env = api?.env;
  if (!env || typeof env.exec !== "function") {
    return "RUN_READONLY BLOCKED: this seat has no execution environment (api.env is absent), so no measurement can run. Report this; do not guess a number.";
  }
  const command = built.argv.join(" ");
  let out = "";
  try {
    const res = await env.exec(
      command,
      {
        cwd: typeof env.cwd === "string" && env.cwd !== "" ? env.cwd : process.cwd(),
        env: {},
        inheritEnv: true,
        timeout: timeoutS,
        onOutput: (text) => {
          // Keep the TAIL bounded: a measurement's useful end is where the counts are.
          out += text;
          if (out.length > 40_000) out = out.slice(-20_000);
        },
      },
      context,
    );
    if (!res?.ok) {
      const code = res?.error?.code ?? "error";
      if (code === "timeout") {
        return (
          `RUN_READONLY BLOCKED: \`${command}\` did not answer within ${timeoutS} s. ` +
          "A bounded non-answer is a measurement too: the store read is contended or the broker is wedged " +
          "(docs/runbooks/broker-down-or-stalled.md). Do NOT retry in this turn and do NOT state a number."
        );
      }
      return `RUN_READONLY ERROR (${code}): ${String(res?.error?.message ?? res?.error ?? "unknown")}`;
    }
    const exitCode = res.value?.exitCode ?? 0;
    const body = out.trim() === "" ? "(no output)" : out.trim();
    return `RUN_READONLY ${name} exit=${exitCode} cmd=\`${command}\`\n${body}`;
  } catch (err) {
    return `RUN_READONLY ERROR: ${err && err.stack ? err.stack : String(err)}`;
  }
}
