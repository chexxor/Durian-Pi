// tools/mux-surface-owner.mjs — the OWNER PLANE: the ONE place this plugin may start a process.
//
// WHY THIS FILE EXISTS (and why it is the only one). The core (`tools/mux-surface-core.mjs`) decides verbs,
// selectors, panes, ownership, acts and NAMESPACES, and it names NO backend. A driver (`tools/mux-driver-<backend>.mjs`)
// spells ONE backend's argv as DATA and starts nothing. Everything that could actually move a pane therefore has
// exactly one door: this file. `grep -rl child_process` over the plugin names THIS file and no other, so
// "the core and the extension hold zero `child_process`" is a fact a gate can check, not a claim in a comment.
//
// WHAT IT IS ALLOWED TO RUN, and why each case is the case it is:
//
//   1. A PROBE — `<driver>.probe` (e.g. `tmux -V`, `screen --version`). This answers contract (7): a backend is
//      REGISTERED (a driver file exists) but may be NOT-RUN (no binary here). Registered != runnable, and a pin
//      that prints "green" for a backend whose binary never ran is the lie this seam refuses.
//   2. A CENSUS — the driver's own `list` argv. This is READ-ONLY enumeration of which sessions exist, and it
//      exists for one reason: so the namespace decision can report the user's own session as PRESENT, NOT
//      TOUCHED instead of pretending there are no other sessions. A census that silently returns zero rows
//      because the binary misbehaved is the fail-open's class; unparsed lines are returned, not swallowed.
//   3. A PLAN — the driver argv for an actual ask, and ONLY when the caller passes `run: true`, which is the
//      plugin's `--run`. Without it the plugin PRINTS the argv and runs nothing: an ask that ran nothing and
//      said nothing is indistinguishable from one that did nothing.
//   4. THE OWNER — `DURIG_DB=<store> node cli.mjs serve`, DETACHED, and its `--stop`. This is the rig's EXISTING
//      resident detached broker (the same command `tools/broker-serve.mjs` spawns, the same state file
//      `src/broker.mjs` `brokerStatePath` names). THE STORE IS NAMED BY ENV, NOT BY A FLAG: `cli.mjs` HAS NO
//      `--db` (MEASURED 2026-11-21 — an invented `--db` is SILENTLY IGNORED and the verb acts on the CONFIGURED
//      store, `cli.mjs:174` `resolve(CFG.DURIG_DB ?? "./rig.sqlite")`; `tui.mjs` DOES have a real `--db`). So every
//      owner call here carries `{ ...process.env, DURIG_DB: store, DURIAN_PI_DB: store }`. Starting it DETACHED is
//      what the contract's detach semantics need — the session lives in THIS process, not in the multiplexer's
//      window, so closing the pane/terminal never ends it. The plugin does not invent a lifecycle: a multiplexer session
//      is a VIEWPORT, and the session it displays is owned by that one resident process. That is what makes
//      "closing the pane never ends the session" true rather than aspirational — the multiplexer's own detach
//      semantics keep a session that holds no client, and the broker is not a client of it.
//
// WHAT IT NEVER DOES: it never picks a backend (the core does, from the drivers' `rank`), never chooses a
// session (the core's `muxNamespace` does), never spells a backend word, and never drives a seat. A pane's acts
// are the broker's spool ops (`muxActRequest` in the core); nothing here sends bytes into a pane, because that
// would be a SECOND WRITER into a seat, which is what corrupted this store twice (docs/runbooks/README.md).
//
// Cost (D213), measured Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1:
// `node --check` 0.02 s; one probe of a PRESENT binary (`screen --version`) 0.015 s; one absent-binary probe
// answers `NOT-RUN` in ~0.001 s without spawning; a two-instance screen census 0.05 s. Nothing here takes a
// model, a key, or the network. The seam's out-of-process cost is stated per call in `muxRunArgv`'s `ms`.
//
// Timeouts: EVERY spawn carries a bound (default 10 000 ms, ceiling `timeoutMs`). A multiplexer that hangs on
// stdin would otherwise hang the session; hitting the bound is reported as `timedOut:true` with the number,
// never as an empty success.
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, dirname as dirUp, basename } from "node:path";
import { brokerStatePath } from "../src/broker.mjs";
import { assessStoreOwnership, brokerAlive } from "../src/storeownership.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CLI = join(ROOT, "cli.mjs");
const HERE = dirUp(new URL(import.meta.url).pathname);

// Is a bare command name on PATH? Checked WITHOUT spawning, so an absent binary never pays a spawn and never
// reports a spawn error as "ran and failed".
// PATH separators: `:` on a POSIX host, `;` on a native Windows host (D131 — both are operating platforms for
// this rig). Matching BOTH is what makes an absent binary answer NOT-RUN without spawning; matching only one
// makes a PRESENT binary read as absent on the other host, which is the false gap this seam must not print.
const seps = /[:;]/;
const onPath = (name) => !!name && (process.env.PATH ?? "").split(seps).some((d) => d && existsSync(join(d, name)));

export const MUX_STORE_ENV = "DURIG_DB";
export const MUX_STORE_ENV_ALIAS = "DURIAN_PI_DB";

/**
 * THE BOUND EVERY CALL CARRIES. `guess then round up`, never below it: the number here is a measurement, and
 * a call that hits it is recorded as a measurement rather than retried with a bigger number.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export function muxRunArgv(argv, { cwd = null, timeoutMs = DEFAULT_TIMEOUT_MS, env = null } = {}) {
  if (!Array.isArray(argv) || !argv.length) return { ran: false, reason: "no argv", ms: 0 };
  const started = Date.now();
  // PATH is the only way a bare backend name resolves; passing the real env through is what makes a version
  // probe answer for the binary the user actually has.
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    ...(env ? { env } : {}),
  });
  const ms = Date.now() - started;
  // THE RANK OF THIS RESULT OBJECT'S FIELD NAMES, measured on node v24.22.1 (Linux / Fedora Linux 45):
  // `spawnSync` answers with keys `[status, signal, output, pid, stdout, stderr]` — there is NO `exitCode` key
  // there, and NO `timedOut` key either. Reading `exitCode` yields `undefined`, which is how a PRESENT binary
  // answered `rc undefined` and a probe answered `NOT-RUN (ran, rc undefined)` — the false gap this seam exists
  // to refuse. Read `status` first and fall back to `exitCode` for hosts that spell it the other way; never let
  // an undefined rc reach a caller.
  const rc = r.status ?? r.exitCode ?? null;
  const errCode = r.error?.code ?? r.code ?? null;
  const timedOut = errCode === "ETIMEDOUT" || Boolean(r.timedOut) || Boolean(r.isTimedOut) || Boolean(r.timeoutCode);
  if (errCode === "ENOENT")
    return { ran: false, reason: "binary absent (ENOENT)", ms, argv, missing: argv[0] };
  if (timedOut)
    // A bound hit is a MEASUREMENT, not a failure to retry with a bigger number: the command may have been
    // half-run, so the caller must see that partial output is not a complete answer.
    return { ran: true, rc: null, timedOut: true, signal: r.signal ?? null, ms, argv, boundMs: timeoutMs, reason: `hit the ${timeoutMs} ms bound (rc not decided; signal ${r.signal ?? "none"})`, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  if (r.error && errCode !== "ENOENT") {
    // A real spawn failure (EACCES, EAGAIN) is a refusal, not an empty success.
    return { ran: false, reason: `spawn failed: ${errCode}`, ms, argv, rc, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
  return {
    ran: true,
    rc,
    timedOut: false,
    signal: r.signal ?? null,
    ms,
    argv,
    cwd: cwd ?? process.cwd(),
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

// A driver's probe/version/census argv, run in this plane only. Returns the PRESENCE verdict and the version
// line, and NEVER invents one when the binary is absent: `NOT-RUN` is the answer (contract (7)).
export async function muxProbeBackends(drivers, { cwd = null, timeoutMs = 2_000, os = null } = {}) {
  // WHICH OS the census answers for is a fact handed in (default: this box). A pin INJECTS it so a Windows
  // route — `psmux` for the tmux vocabulary, the `.exe` route for zellij, a REFUSED row for GNU screen — is a
  // RUN on the box that cannot boot Windows, which is the D213 fast loop for a platform that is not here.
  const want0 = os ?? process.platform;
  const list = drivers?.values ? [...drivers.values()] : Array.isArray(drivers) ? drivers : [];
  const out = [];
  for (const rec of list) {
    // the driver table hands out REGISTRY RECORDS ({backend, driver, path}); a raw driver also works. The plane
    // unwraps so the caller never has to know the registry's shape.
    const d = rec?.driver ?? rec;
    const probe = d?.probe ?? d?.version ?? null;
    if (!probe) {
      out.push({ backend: rec?.backend ?? d?.backend ?? "(unnamed)", present: false, reason: "driver names no probe argv", versionLine: null, ms: 0, rank: d?.rank ?? null });
      continue;
    }
    // THE PLATFORM TABLE, read HERE because this plane is the one that resolves a binary. A driver may name a
    // DIFFERENT binary for the OS the census runs on (a Windows host's tmux vocabulary really lives in `psmux`),
    // or REFUSE the OS entirely (`binary: null`, `status: "refused"`), in which case probing `probe[0]` on the
    // wrong OS reads a real binary as absent — the false gap this seam was built to refuse. Probing the driver's
    // own `probe[0]` on the OS it was written for is unchanged, so no existing answer moves.
    const row = d?.platform?.[want0] ?? null;
    if (row && row.status === "refused") {
      out.push({
        backend: d.backend,
        present: false,
        reason: `platform-refused on \`${want0}\` — ${row.note ?? row.route ?? "the driver named no reason"}`,
        versionLine: null,
        ms: 0,
        rank: d?.rank ?? null,
        platformStatus: "refused",
        platformBinary: row.binary ?? null,
        route: row.route ?? null,
        os: want0,
      });
      continue;
    }
    const want = row?.binary ?? probe[0];
    const argv = want === probe[0] ? probe : [want, ...probe.slice(1)];
    const routeNote = want === probe[0] ? "" : " (this OS route names " + want + ", not the driver's own " + probe[0] + ")";
    if (!onPath(String(argv[0]))) {
      out.push({
        backend: d.backend,
        present: false,
        // The verbatim NOT-RUN string is kept for the OS's own probe (a pin compares it EXACTLY); when this
        // platform's route differs, the route is printed BESIDE it so a reader knows WHICH name was looked for.
        reason: "binary NOT on PATH => NOT-RUN" + routeNote,
        versionLine: null,
        ms: 0,
        rank: d?.rank ?? null,
        platformStatus: row?.status ?? null,
        platformBinary: want,
        route: row?.route ?? null,
        os: want0,
      });
      continue;
    }
    const r = muxRunArgv(argv, { cwd, timeoutMs });
    out.push({
      backend: d.backend,
      present: r.ran && r.rc === 0,
      // A BOUND HIT IS NOT "ran, rc null": that reads as a binary that answered and got an error code, which
      // invites a retry with a bigger number. The bound is a MEASUREMENT, so the plane carries it (measured
      // 2026-11-21: a shim that sleeps 30 s used to answer `ran, rc null` at a 250 ms bound).
      reason: r.ran ? (r.timedOut ? r.reason : (r.rc === 0 ? "ran" : `ran, rc ${r.rc}`)) : r.reason,
      ...(r.ran && r.timedOut ? { timedOut: true, boundMs: r.boundMs } : {}),
      versionLine: r.ran ? String(r.stdout ?? "").trim().split("\n")[0] || null : null,
      ms: r.ms,
      rank: d?.rank ?? null,
      // the OS-specific route, printed so a Windows census says WHICH binary it looked for and where that route
      // was advertised (advertised-elsewhere != observed).
      platformStatus: row?.status ?? null,
      platformBinary: want,
      route: row?.route ?? null,
      os: want0,
    });
  }
  return out;
}

/**
 * THE SESSION CENSUS, run as the driver spells it, fed to the core's `present`.
 *
 * This is what makes the NAMESPACE decision measurable rather than asserted: the core needs to know that a
 * session OTHER than the plugin's own exists right now, so it can report that session PRESENT, NOT TOUCHED.
 * The driver's `list` argv is index-ordered (index 0 = sessions, index 1+ = this session's panes); the parse
 * is the driver's own `census`, so the owner plane never learns a backend's output format.
 *
 * A census that could not be parsed reports `unparsed` — an empty row list is NOT evidence of an empty truth.
 */
export async function muxListSessions(driver, { cwd = null, timeoutMs = DEFAULT_TIMEOUT_MS, session = null, tag = null, namespace = "plugin" } = {}) {
  const list = driver?.commands?.list ?? null;
  if (!list) return { ran: false, reason: "driver names no list argv", sessions: [], panes: [], unparsed: [], notes: [] };
  const rows = [];
  const notes = [];
  for (let index = 0; index < 2; index += 1) {
    const made = list({ sessionName: session, tag, namespace, pane: null, store: null, backend: driver?.backend, verb: "list", index, total: 2 });
    if (!made) break; // one command covers every pane: later indices repeat nothing
    if (!made.argv) {
      if (made.note) notes.push(made.note);
      continue;
    }
    const r = muxRunArgv(made.argv, { cwd: made.cwd ?? cwd ?? undefined, timeoutMs });
    if (!r.ran) {
      notes.push(`census NOT-RUN: ${made.argv.join(" ")} => ${r.reason}`);
      continue;
    }
    const parsed = driver?.census ? driver.census(r.stdout) : { sessions: [], unparsed: [String(r.stdout ?? "").trim()].filter(Boolean) };
    if (parsed.unparsed?.length) notes.push(`census unparsed (${parsed.unparsed.length} line(s) kept as evidence): ${parsed.unparsed.join(" | ")}`);
    for (const s of parsed.sessions ?? []) {
      if (s?.name) rows.push(s);
      // A PANE row may be keyed by either half of the backend's own vocabulary (`pane_id` on tmux, `pane_index`
      // on GNU Screen — MEASURED 2026-11-21: `screen -Q -x -S <label> -X info` printed `(1,1)/(80,24)+1000
      // +(+)flow UTF-8 0(impl)` and this driver's census returns `{pane_index,title,rest}` for it). Collecting
      // only `pane_id` silently DROPPED a `pane_index` row, so the plane answered a real window with 0 panes
      // and no note — indistinguishable from a session that has none, the fail-open's class. Fixed IN PLACE.
      else if (s?.pane_id || s?.pane_index) rows.push(s);
    }
    if (r.rc !== 0) notes.push(`census rc ${r.rc}`);
  }
  // the row keeps the fields the driver reported (`tag`, `pid`, `state`, …) so the core's namespace matcher can
  // see a row's OWN name half and a plane can re-address a session by the census-learned label. The plane strips
  // NOTHING, because it does not know a backend's output format.
  const sessions = rows.filter((s) => s?.name).map((s) => ({ ...s, name: s.name, panes: s.panes ?? null }));
  const panes = rows.filter((s) => s?.pane_id || s?.pane_index).map((s) => ({ id: s?.pane_id ?? s?.pane_index, command: s?.command ?? null, title: s?.title ?? null, rest: s?.rest ?? null }));
  return { ran: true, sessions, panes, unparsed: notes, notes };
}

// Convenience for a real plane: the sessions that exist RIGHT NOW for the ACTIVE backend, as the shape
// `muxNamespace` wants (`present`). Empty means "the plane could not ask", which the core reports as
// "no foreign session present" only when a census actually ran — see `ran`.
export async function muxSessions({ drivers = null, backend = null, cwd = null, session = null, tag = null, namespace = "plugin" } = {}) {
  const d = drivers?.get?.(backend)?.driver ?? (backend ? [...(drivers?.values?.() ?? [])].find((x) => x.backend === backend) : null);
  if (!d) return { present: [], ran: false, reason: "no driver for this backend" };
  const c = await muxListSessions(d, { cwd, session, tag, namespace });
  return { present: c.sessions, ran: c.ran, reason: c.reason ?? null, notes: c.notes, panes: c.panes };
}

/**
 * RUN AN ASK'S argv — and ONLY under `run: true`.
 *
 * `muxSurfaceInvoke` prints argv by default; this is the door that actually runs them, and it is deliberately
 * not reachable from the core. The order is the plan's order (first pane creates the session, later panes add
 * windows), and a step that fails stops the run: half a pane set is not a state a reader can describe.
 *
 * A command may carry its OWN `env` (the store is named by env — `cli.mjs` has no `--db`, MEASURED 2026-11-21).
 * The plane merges that env OVER `process.env` rather than replacing it, so PATH and HOME still resolve; a
 * command with no env runs in the plane's own env, which is what makes an absent binary answer NOT-RUN.
 */
export async function muxRunPlan(plan, { run = false, cwd = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!run) return { ran: false, reason: "the ask did not pass --run, so nothing ran; the argv below is PRINTED ONLY", argv: [], steps: [] };
  const steps = [];
  for (const c of plan?.commands ?? []) {
    if (!c?.argv?.length) continue;
    const r = await muxRunArgv(c.argv, { cwd: c.cwd ?? cwd ?? undefined, timeoutMs, env: c.env ? { ...process.env, ...c.env } : null });
    steps.push({ pane: c.pane, action: c.action, argv: c.argv, ran: r.ran, rc: r.ran ? r.rc : null, ms: r.ms, ...(r.ran ? { stdout: String(r.stdout ?? "").trim(), stderr: String(r.stderr ?? "").trim() } : { reason: r.reason }), ...(r.ran && r.timedOut ? { timedOut: true } : {}) });
    if (!r.ran || r.rc !== 0) return { ran: true, ok: false, reason: `step ${c.action} pane ${c.pane}: ${r.ran ? `rc ${r.rc}` : r.reason}`, steps };
  }
  return { ran: true, ok: steps.every((s) => s.ran && s.rc === 0), steps };
}

/**
 * THE RIG'S OWN RESIDENT DETACHED OWNER — started, and stopped, exactly as the rig already starts it.
 *
 * The plugin does not grow a lifecycle here: `cli.mjs serve` IS the owner (one store writer, single-writer
 * rule; `src/storeownership.mjs` `tuiOpenVerdict` is what refuses a second harness owning the same session).
 * Starting it DETACHED is what the contract's detach semantics need — the session lives in THIS process, not
 * in the multiplexer's window, so closing the pane/terminal never ends it.
 *
 * This refuses rather than double-starts: if a broker is already resident, the answer is "already owned", with
 * the pid and the state file named, because a second owner would be a second writer into the store.
 */
export async function muxStartOwner(store, { maxDurationSec = null, logDir = null, dryRun = false, now = Date.now() } = {}) {
  if (!store) return { ok: false, reason: "no store named", command: null };
  // THE STORE IS NAMED BY ENV (see the file header: `cli.mjs` has no `--db`). `command` is the argv; `env` is the
  // naming; `text` is the ONE string a reader may copy. Refusing to name the store is a refusal, not a run on
  // whatever store the shell happens to be configured for — that is the hazard the measured defect created.
  const command = [process.execPath, CLI, "serve", ...(maxDurationSec ? ["--max-duration", String(maxDurationSec)] : [])];
  const env = { ...process.env, [MUX_STORE_ENV]: store, [MUX_STORE_ENV_ALIAS]: store };
  const text = `${MUX_STORE_ENV}=${store} ${["node", CLI, "serve", ...(maxDurationSec ? ["--max-duration", String(maxDurationSec)] : [])].join(" ")}`;
  const statePath = brokerStatePath(store);
  const existing = (() => {
    try {
      const a = assessStoreOwnership(store, { now });
      return a;
    } catch {
      return null;
    }
  })();
  const alive = existing?.broker?.alive ? true : (() => {
    try {
      return brokerAlive(JSON.parse(readFileSync(statePath, "utf8")), { now });
    } catch {
      return false;
    }
  })();
  if (alive)
    return { ok: false, code: "owner-already-resident", reason: `a broker already owns this store (pid ${existing?.broker?.pid ?? "(see state file)"}), so nothing was started; a second owner would be a second writer into the same store.`, command, env, text, statePath };
  if (dryRun) return { ok: true, dryRun: true, command, env, text, statePath, reason: "DRY RUN — nothing was started" };
  const dir = logDir ?? join(dirUp(store) || ".", ".spike");
  mkdirSync(dir, { recursive: true });
  const out = openSync(join(dir, `mux-owner-${basename(store)}.out`), "a");
  const err = openSync(join(dir, `mux-owner-${basename(store)}.err`), "a");
  const child = spawn(command[0], command.slice(1), { cwd: ROOT, detached: true, env, stdio: ["ignore", out, err] });
  return { ok: true, pid: child.pid, command, env, text, statePath, logs: { out: join(dir, `mux-owner-${basename(store)}.out`), err: join(dir, `mux-owner-${basename(store)}.err`) } };
}

export function muxStopOwner(store, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!store) return { ok: false, reason: "no store named", command: null };
  // THE STORE IS NAMED BY ENV: `serve --db <store> --stop` is SILENTLY IGNORED by `cli.mjs` (MEASURED 2026-11-21,
  // it answered with the CONFIGURED store) — a hazard, because that is the RIG'S LIVE store. Name the store here.
  const command = [process.execPath, CLI, "serve", "--stop"];
  const env = { ...process.env, [MUX_STORE_ENV]: store, [MUX_STORE_ENV_ALIAS]: store };
  const r = muxRunArgv(command, { cwd: ROOT, timeoutMs, env });
  return { ok: r.ran && r.rc === 0, command, env, text: `${MUX_STORE_ENV}=${store} ${command.join(" ")}`, ...(r.ran ? { rc: r.rc, ms: r.ms, stdout: String(r.stdout ?? "").trim(), stderr: String(r.stderr ?? "").trim() } : { reason: r.reason }) };
}

// THE LAST LINE — a marker, not code. Nothing below this comment is executable, and nothing here reads a
// credential: the only file this plane reads is the broker's own state file, named by `brokerStatePath`.
