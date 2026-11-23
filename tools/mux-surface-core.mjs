// tools/mux-surface-core.mjs — the ONE backend-agnostic multiplexer core: argv -> (verb | refusal BY NAME) -> decide -> strings.
//
// WHY ONE CORE AND MANY DRIVERS (the goal's contract (1): "SEAM NOT PORT", on the extension plane, D212).
// A terminal multiplexer is a PRESENTATION layer over this rig. The rig's session lives in ONE store and ONE
// resident detached process (docs/DECISIONS.md D22, amended 2026-11-20 by D339 — see that file); a multiplexer
// window is a VIEWPORT onto that session, not another owner. So the thing that decides verbs, selectors, state
// and refusals must not know WHICH viewport tool the user chose, or the whole product becomes a port per
// multiplexer. This file is that thing: it imports NO backend binary name anywhere — not in a string, not in a
// path, not in a comment — and the driver table is DISCOVERED by scanning the sibling files named `mux-driver-*.mjs`
// and keyed by each driver's OWN `backend` field. A backend swap is therefore a registration in that table, not a
// rewrite: to add a backend you add one file that returns `{backend, sessionName, commands, preset, capabilities}`.
// The keybind PRESETS live in the driver files too, because a key style IS a backend word — the core composes
// whatever presets the registered drivers declare, so it never has to spell one.
//
// WHAT THE CORE NEVER DOES, and why each half matters:
//   - no store, no Harness: the caller hands it the read seams (`readData` routing, as `tools/queue-surface-core.mjs`
//     does) and, for the attach posture, an `attach` seam. A second writer is what corrupted this store twice
//     (docs/runbooks/README.md), so `Harness.open` count here is ZERO and the attach posture is `readOnly`.
//   - no process: a driver returns ARGV AS DATA. Running it is one explicit ask (`--run`) taken by the plane that
//     owns the process primitive; the core's `child_process` count is ZERO, so a decision can never be "applied"
//     by something the reader cannot name.
//   - no act of its own: an act on a seat is ROUTED to the broker's own spool through the EXISTING `SPOOL_OPS`
//     vocabulary (imported, never restated). An op the broker does not carry is REFUSED BY NAME.
//   - no ownership rule of its own: the attach-or-create decision is `tuiOpenVerdict`/`assessStoreOwnership`
//     imported verbatim from `src/storeownership.mjs` — the ONE rule `tui.mjs` already uses (pi-durable
//     spec.md:4371 "Harness instances must never own the same Session concurrently").
//
// WHAT STAYS PER-PLANE (D19): the core returns STRINGS plus one machine document; a CLI writes them and sets an
// exit code, a session hands them to its own UI. That is the same split `src/queue-command.mjs` documents.
//
// Cost (D213): pure composition over the rig's own reads — no model, no key, no network, no process started here.
// The loop for a change here is `node demo/mux-surface.test.mjs` (see its PASS line for wall seconds). Measured
// Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1.
import { existsSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { queueCommandArgv, QUEUE_USAGE, queueRefusalText } from "../src/queue-command.mjs";
import { QUEUE_STATUSES, filterQueueItems, readSeatList, readQueueItems, queueCounts } from "../src/readapi.mjs";
import { readData } from "../src/readclient.mjs";
import { Seats } from "../src/rig.mjs";
import { assessStoreOwnership, tuiOpenVerdict } from "../src/storeownership.mjs";
// only the spool VOCABULARY and the spool's own authorization rule are imported; this core writes nothing.
import { SPOOL_OPS, authorizeSpoolRequest, CONTROL_PLANE_OPS, CROSS_SEAT_OPS, QUEUE_CONTROL_OPS, SESSION_CONTROL_OPS } from "../src/broker.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export const MUX_COMMAND_NAME = "mux";
export const MUX_SURFACE_DESCRIPTION =
  "Make a terminal multiplexer the presentation layer over this rig: /mux list (an attributed session+pane census), /mux open (attach the session this store already has, or create one detached on an explicit --create), /mux attach (a read-only pane), /mux act (read/submit/steer/stop/reset/compact a seat THROUGH the broker's spool ops), /mux detach|kill|capture|halt, /mux keys (the keybind presets).";

// THE VERB VOCABULARY — one table, and the ONLY one. `cli.mjs` and `.pi/extensions/mux-surface.js` are two
// registrations of this core (D334's "ONE core, TWO registrations"), so a verb list per registration is the
// accepted-and-ignored class (#5071) the moment the two grow apart.
export const MUX_VERBS = {
  // the census: session name, pane count, which seat each pane holds, and the exact backend command per action.
  list: { usage: "list [--to <seat> ... | --all]", pane: true, act: false },
  // one pane per selected seat: ATTACHES what the store already has, else CREATES one detached on --create.
  open: { usage: "open <seat ...> | open --all | open --status <state> [--create] [--run]", pane: true, act: true },
  // the attach posture: a read-only pane onto the session the resident owner drives.
  attach: { usage: "attach <seat ...> | attach --all [--run]", pane: true, act: false },
  // close panes. The SESSION is the broker-owned one, so this never ends it: the multiplexer's own detach
  // semantics keep a session that no pane holds.
  detach: { usage: "detach [--pane <name> ...] | detach --all", pane: true, act: false },
  // ONE pane, never the session — `halt` is the session's verb.
  kill: { usage: "kill --pane <name> ... | kill <seat ...>", pane: true, act: false },
  // a pane's text (the backend's own capture command, run only on --run).
  capture: { usage: "capture --pane <name> ... | capture <seat ...>", pane: true, act: false },
  // stop the rig's EXISTING resident detached owner (its own serve --stop semantics), never a new lifecycle.
  halt: { usage: "halt [--run]", pane: false, act: true },
  // an act on one pane's seat, routed to the broker's spool op.
  act: { usage: "act <seat> --op <spool-op> [--text \"sentence\"]", pane: true, act: true },
  // `send` is a VERB, not a keystroke. Every driver preset names `mux.send`, so a preset key that answers
  // "not a mux verb" is a dead key wearing a product name (the completion auditor's objection 3). It is NOT a
  // new door: it is the ONE spool leg above, pinned here to --op message. The decision lives IN THE CORE and
  // not in a driver because a key style IS a backend word — a driver that routed its own preset key would
  // spell a backend vocabulary in the place that must stay backend-agnostic.
  send: { usage: "send <seat ...> --text \"sentence\" (an alias for act --op message)", pane: true, act: true },
  // the keybind vocabulary and the presets this core can actually honour.
  keys: { usage: "keys [--preset <style>]", pane: false, act: false },
};
export const MUX_VERB_NAMES = Object.keys(MUX_VERBS);

// TWO NAMESPACES (contracts (9) ISOLATION and (10) OVERRIDE). A user's own multiplexer session may hold a dozen
// other harnesses; the panes THIS plugin generates are a DIFFERENT namespace. Namespace A = panes the USER made
// explicitly (their own session) — the plugin never enumerates, panes, captures, detaches or kills one by default.
// Namespace B = panes made INDIRECTLY because the user is using this rig — the plugin's OWN named session, derived
// HERE from the store/workspace (`durian-<workspace>`), created detached from inside the user's pane, so a rig
// running in one pane of the user's session never clutters it. WHICH session the plugin may touch is decided IN
// THIS FILE, not in a driver: a driver only spells the resolved tag in its own session/socket vocabulary. The
// override is an explicit ASK (a flag and a persistent knob), never reachable from the default state, and LOUD.
export const MUX_NAMESPACE_ENV = "DURIAN_PI_MUX_NAMESPACE";
export const MUX_NAMESPACE_SESSION_ENV = "DURIAN_PI_MUX_SESSION";
export const MUX_NAMESPACE_DEFAULT = "plugin";
export const MUX_NAMESPACE_NAMES = ["plugin", "user"];
export const MUX_NAMESPACE_TAG_PREFIX = "durian-";

// THE SELECTOR GRAMMAR is the queue surface's ONE grammar (D336/D334): the tokenizer is `queueCommandArgv`,
// the `--id`/`--status`/`--to` names and the `--status` VALUE set are imported from the rig's own vocabularies,
// and the actual selection is the rig's own `filterQueueItems`. Restating any of it here is a second vocabulary
// that drifts. The mux-only flags below add the viewport's own asks (pane, preset, backend, and the two explicit
// permission flags `--create`/`--run`) — they do not re-declare a queue vocabulary.
export const MUX_FLAGS = {
  "--id": { kind: "value", usage: "[--id <id> ...]", valueName: "id" },
  "--status": { kind: "value", usage: "[--status <state> ...]", valueName: "state", values: QUEUE_STATUSES },
  "--to": { kind: "value", usage: "[--to <seat> ...]", valueName: "seat" },
  "--all": { kind: "flag", usage: "[--all]" },
  "--pane": { kind: "value", usage: "[--pane <name> ...]", valueName: "pane" },
  "--preset": { kind: "value", usage: "[--preset <style> ...]", valueName: "style" },
  "--backend": { kind: "value", usage: "[--backend <name>]", valueName: "backend" },
  // the namespace ASK. Without it the default is the plugin's OWN session; the user's session is only entered on
  // an explicit ask, and every census/refusal then prints which namespace it is in.
  "--namespace": { kind: "value", usage: "[--namespace <plugin|user>]", valueName: "namespace", values: MUX_NAMESPACE_NAMES },
  "--into": { kind: "value", usage: "[--into <session>]", valueName: "session" },
  // a teardown of EVERY session the multiplexer manages is a named request, so it can be REFUSED BY NAME: it would
  // end the sessions the USER started too. The core refuses it; a driver names the session-scoped alternative.
  "--every-session": { kind: "flag", usage: "[--every-session] (EVERY session the multiplexer manages — REFUSED BY NAME)" },
  "--op": { kind: "value", usage: "[--op <spool-op>]", valueName: "op", values: SPOOL_OPS },
  "--text": { kind: "value", usage: "[--text <sentence>]", valueName: "text" },
  // the two ASKS. Without them the core PRINTS the exact command and runs nothing: printing an argv it will not
  // run is honest only if the reader can see that it is not run.
  "--create": { kind: "flag", usage: "[--create]" },
  "--run": { kind: "flag", usage: "[--run]" },
  "--dry-run": { kind: "flag", usage: "[--dry-run]" },
  "--json": { kind: "flag", usage: "[--json]" },
};
export const MUX_FLAG_NAMES = Object.keys(MUX_FLAGS);
// THE USAGE LINE MUST BE RUNNABLE (the honesty fix measured 2026-11-22: the line this REPLACED printed
// `node cli.mjs mux …`, and `grep -n mux cli.mjs` answers NOTHING — there is NO `cli.mjs mux` verb, so every
// refusal printed a command that cannot be run, which is the fiction class this seam refuses). The runnable
// registration of THIS core is the in-session command the extension installs
// (`pi.registerCommand(MUX_COMMAND_NAME, …)` in tools/mux-surface-extension.js), so the usage line is typed in
// a pi session, not at a shell. The core still names no backend here, so the line stays backend-word-free.
export const MUX_USAGE = `/mux ${MUX_VERB_NAMES.map((v) => MUX_VERBS[v].usage).join(" | ")}`;
export const MUX_BACKEND_ENV = "DURIAN_PI_MUX_BACKEND";
export const MUX_PRESET_ENV = "DURIAN_PI_MUX_PRESET";

// THE STORE IS NAMED BY ENV, NEVER BY AN INVENTED FLAG. MEASURED 2026-11-21 (Linux / Fedora Linux 45 (Forty
// Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1): `cli.mjs` HAS NO `--db` flag — `grep -n '"--db"'
// cli.mjs` answers nothing, and `cli.mjs serve --db <other store> --stop` answered with the CONFIGURED store's
// path, i.e. the invented flag is silently IGNORED and the verb acts on the wrong store. The CLI resolves
// `resolve(CFG.DURIG_DB ?? "./rig.sqlite")` and `src/config.mjs` `CONFIG_KEYS` starts at `"DURIG_DB"`. `DURIAN_PI_DB`
// is the half-applied rename (ROADMAP 191, D103) and does NOT reach cli.mjs. So a seam command is `argv` + an
// `env`, and every printed command is ONE copyable string (`DURIG_DB=<store> node cli.mjs serve`). Naming the
// store by a flag the CLI does not have is the fiction this seam refuses; a doc that prints `cli.mjs serve --db
// <store>` as the OWNER command is false (`tui.mjs --db` IS a real flag — the two planes differ).
export const MUX_STORE_ENV = "DURIG_DB";
export const MUX_STORE_ENV_ALIAS = "DURIAN_PI_DB";

// Print a command WITH the env that names its store, so the printed line is the command that acts on that store.
export function muxEnvPrefix(env = null) {
  if (!env) return "";
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
}

export function muxRefusalText(why) {
  const known = MUX_FLAG_NAMES.join(", ");
  return `mux: ${why}\n  known flags: ${known}\n  usage: ${MUX_USAGE}\n`;
}

// THE COMPLETION BOX is drawn from THIS table, never from a second list that can go stale.
export function muxSurfaceCompletion(prefix = "") {
  if (!prefix.startsWith("-")) {
    const hit = MUX_VERB_NAMES.filter((v) => v.startsWith(prefix));
    return hit.length ? hit.map((v) => ({ value: v, detail: MUX_VERBS[v].usage })) : null;
  }
  const hit = MUX_FLAG_NAMES.filter((n) => n.startsWith(prefix));
  return hit.length ? hit.map((v) => ({ value: v, detail: MUX_FLAGS[v].kind === "value" ? `<${MUX_FLAGS[v].valueName}>` : "" })) : null;
}

// THE DRIVER TABLE: discovered, keyed by each driver's OWN `backend` field, so the core never names a backend.
// A driver is ONE file that returns `{backend, version, sessionName, commands, capabilities, preset, docs}`.
export async function muxSurfaceDrivers({ dir = join(ROOT, "tools"), env = process.env } = {}) {
  const pattern = /^mux-driver-[a-z][a-z0-9-]*\.mjs$/;
  const found = existsSync(dir) ? readdirSync(dir).filter((n) => pattern.test(n)).sort() : [];
  const drivers = new Map();
  const loadErrors = [];
  for (const name of found) {
    const path = join(dir, name);
    try {
      // the import hop is a hypothesis, not an assumption (it is pinned): an absolute specifier resolves under
      // node, and under pi's jiti loader through the same path.
      const mod = await import(path);
      const d = mod?.MUX_DRIVER ?? mod?.default?.MUX_DRIVER;
      if (!d || !d.backend) {
        loadErrors.push({ path, error: "no MUX_DRIVER export with a `backend` field" });
        continue;
      }
      drivers.set(d.backend, { backend: d.backend, driver: d, path });
    } catch (err) {
      loadErrors.push({ path, error: String(err?.message ?? err) });
    }
  }
  const requested = env[MUX_BACKEND_ENV] ?? null;
  // THE DEFAULT BACKEND is a REGISTRATION fact, not a name in this file: a driver declares its own `rank` (its
  // shipping order), so "which backend answers when nothing was asked" moves by editing a driver, never by
  // spelling a backend here. Alphabetical discovery order is NOT a shipping decision, so it is not the default.
  const rank = (name) => {
    const r = drivers.get(name)?.driver?.rank;
    return Number.isFinite(r) ? Number(r) : 0;
  };
  const ranked = [...drivers.keys()].sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  const active = requested && drivers.has(requested) ? requested : (ranked[0] ?? null);
  return {
    drivers,
    names: [...drivers.keys()],
    ranked,
    styles: [...drivers.values()].map((r) => r.driver?.preset?.style).filter(Boolean),
    active,
    requested,
    loadErrors,
    census: {
      files: found.length,
      registered: [...drivers.keys()],
      // A backend whose binary is not on this host is registered and NOT-RUN; that distinction is the whole
      // honesty rule of contract (7) and the driver's own `probe` argv answers it.
      probed: [...drivers.values()].map((r) => ({ backend: r.backend, path: r.path })),
    },
  };
}

// THE ARGV: the queue surface's ONE tokenizer, then a verb, then the selector flags. A bare word after the verb
// is seat sugar for `--to` (the contract writes `/mux open <seat...>`), and it is validated against the roster.
export function muxSurfaceParse(argv, { styles = [], backends = [] } = {}) {
  const state = { verbs: [], ids: [], statuses: [], to: [], panes: [], presets: [], all: false, create: false, run: false, dryRun: false, json: false, op: null, text: null, backend: null, namespace: null, into: null, everySession: false };
  if (!argv.length) return { ok: false, refusal: muxRefusalText("no verb. Verbs: " + MUX_VERB_NAMES.join(", ") + "."), state, exitCode: 1 };
  const [verb, ...rest] = argv;
  if (!MUX_VERBS[verb])
    return { ok: false, refusal: muxRefusalText(`\`${verb}\` is not a mux verb. known verbs: ${MUX_VERB_NAMES.join(", ")}.`), state, exitCode: 1 };
  state.verb = verb;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!String(token).startsWith("--")) {
      state.to.push(String(token));
      continue;
    }
    const spec = MUX_FLAGS[token];
    if (!spec)
      return { ok: false, refusal: muxRefusalText(`\`${token}\` is not a mux flag. known flags: ${MUX_FLAG_NAMES.join(", ")}. Nothing was read or changed.`), state, exitCode: 1 };
    if (spec.kind === "flag") {
      if (token === "--all") state.all = true;
      else if (token === "--create") state.create = true;
      else if (token === "--run") state.run = true;
      else if (token === "--dry-run") state.dryRun = true;
      else if (token === "--json") state.json = true;
      else if (token === "--every-session") state.everySession = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || String(value).startsWith("--"))
      return { ok: false, refusal: muxRefusalText(`${token} needs a value (${spec.valueName}).`), state, exitCode: 1 };
    i += 1;
    if (spec.values && !spec.values.includes(value)) {
      // a value OUTSIDE the rig's own closed vocabulary is the same defect as an unknown flag: a typo that
      // answers "no panes" is a mistake rendered as an empty success (#5016's rule, #5071's class).
      return {
        ok: false,
        refusal: muxRefusalText(`${token} ${value} is not in the vocabulary. known values: ${spec.values.join(", ")}.`),
        state,
        exitCode: 1,
      };
    }
    if (token === "--id") state.ids.push(value);
    if (token === "--status") state.statuses.push(value);
    if (token === "--to") state.to.push(value);
    if (token === "--pane") state.panes.push(value);
    if (token === "--preset") state.presets.push(value);
    if (token === "--backend") state.backend = value;
    if (token === "--op") state.op = value;
    if (token === "--text") state.text = value;
    if (token === "--namespace") state.namespace = value;
    if (token === "--into") state.into = value;
  }
  // `send` is the alias above: it names the MESSAGE spool op and nothing else. A contradicting --op is not
  // silently re-routed and not silently ignored — it is refused BY NAME with the spelling that does what the
  // reader meant, because a `send --op stop` that behaved as a message would be a wrong-door success.
  if (state.verb === "send") {
    if (state.op && state.op !== "message")
      return { ok: false, code: "send-op-conflict", refusal: muxRefusalText(`send names the message spool op; --op ${state.op} contradicts it. Use \`act <seat> --op ${state.op}\`. Nothing was written.`), state, exitCode: 1 };
    state.op = "message";
  }
  // the preset and the backend are the DRIVER's names, validated against the registry's own keys.
  for (const style of state.presets)
    if (!styles.includes(style))
      return { ok: false, refusal: muxRefusalText(`--preset ${style} is not registered. known styles: ${styles.join(", ") || "(none loaded)"}.`), state, exitCode: 1 };
  if (state.backend && !backends.includes(state.backend))
    return { ok: false, refusal: muxRefusalText(`--backend ${state.backend} is not registered. known backends: ${backends.join(", ") || "(none loaded)"}.`), state, exitCode: 1 };
  return { ok: true, state, exitCode: 0 };
}

// THE SEATS A REQUEST SELECTS — the queue surface's ONE selection over the rig's OWN rows (`filterQueueItems`),
// then the seats those rows name. `--all` is the roster. An unknown seat is refused BY NAME with the roster
// printed, and NO partial census is emitted: a half-selected census is the fail-open's class (ROADMAP 228).
export function muxSeatSelect(state, { seats = [], rows = [] } = {}) {
  // A SESSION-LEVEL verb (it names no pane: `halt`, `keys`) must NOT be forced into a selector ask — refusing
  // `halt` with "needs a selector" is a door that hides the teardown refusal the reader is looking for.
  if (state.verb && !MUX_VERBS[state.verb]?.pane) return { ok: true, panes: [], how: "session-level verb (names no pane)" };
  const roster = seats.map((s) => s.name);
  const asked = [...state.to];
  const unknownSeat = asked.filter((n) => !roster.includes(n));
  if (unknownSeat.length)
    return { ok: false, refusal: `mux: no such seat: ${unknownSeat.join(", ")}. known seats: ${roster.join(", ") || "(no seats in this store)"}. No pane census was printed.`, panes: [] };
  const selected = [];
  if (state.all || (!asked.length && !state.ids.length && !state.statuses.length && !state.panes.length)) {
    if (state.all || state.verb === "list") return { ok: true, panes: roster.map((name) => ({ seat: name, conversationId: seats.find((s) => s.name === name)?.conversationId ?? null, why: "--all (the roster)" })), how: "--all (the roster)" };
    return { ok: false, refusal: muxRefusalText(`${state.verb} needs a selector: pass --all, --to <seat>, --id <row>, --status <state> or --pane <name>.`), panes: [] };
  }
  // `--pane <name>` alone selects PANES, not seats: a kill/capture aimed at a named pane has no seat filter, and
  // pretending otherwise (an empty selection that still prints a census) is the fail-open's class.
  if (state.panes.length && !asked.length && !state.ids.length && !state.statuses.length && !state.all) {
    const panes = state.panes.map((name) => ({ seat: null, conversationId: null, paneName: name, why: "--pane (named)" }));
    return { ok: true, panes, how: "--pane (named panes, no seat filter)" };
  }
  const rowsHit = filterQueueItems(rows, { ids: state.ids.length ? state.ids : null, statuses: state.statuses.length ? state.statuses : null, to: asked.length ? asked : null });
  const seatsHit = [...new Set(rowsHit.map((it) => it.to))].filter((name) => roster.includes(name));
  for (const name of asked) selected.push({ seat: name, why: "--to (named)" });
  for (const name of seatsHit) if (!selected.some((p) => p.seat === name)) selected.push({ seat: name, why: `queue rows (${state.statuses.length ? "--status" : state.ids.length ? "--id" : "--to"})` });
  const panes = selected.map((p) => ({ seat: p.seat, conversationId: seats.find((s) => s.name === p.seat)?.conversationId ?? null, why: p.why }));
  return { ok: true, panes, how: `${rowsHit.length} row(s) selected by the queue's own filter -> ${panes.length} seat(s)`, census: queueCounts(rows) };
}

// THE OWNERSHIP LEG (the goal's contract (3)): the rule is `tuiOpenVerdict`, imported, never restated.
// owned -> the pane ATTACHES. nothing owns it + the user ASKED (`--create`) -> the rig's EXISTING detached owner
// is the thing to start. nothing owns it + nothing asked -> REFUSE BY NAME and print the command that would.
export function muxOwnershipPlan(store, { create = false, attach = false } = {}) {
  const ownership = assessStoreOwnership(store);
  const verdict = tuiOpenVerdict(store, { attach: attach || ownership.owned, ownership });
  // THE OWNER COMMAND AS THREE PARTS: the argv, the env that NAMES THE STORE, and the ONE string a reader may
  // copy. See the `MUX_STORE_ENV` note above: `cli.mjs serve --db <store>` is NOT a command that acts on that
  // store, so `start` alone would be fiction and a printed command would be a lie. `startEnv` is what the
  // owner plane merges over `process.env`; `startText` is what every refusal/note prints.
  const start = ["node", "cli.mjs", "serve"];
  const startEnv = { [MUX_STORE_ENV]: store, [MUX_STORE_ENV_ALIAS]: store };
  const startText = `${muxEnvPrefix(startEnv)} ${start.join(" ")}`;
  if (verdict.action === "attach")
    return { ok: true, action: "attach", broker: verdict.broker, ownership, reasons: verdict.reasons, start, startEnv, startText, posture: "readOnly" };
  if (verdict.action === "open") {
    if (!create)
      return {
        ok: false,
        code: "no-owner-and-none-asked",
        refusal: `mux: nothing owns ${store}, and starting one was not asked. Nothing was started, read or changed. To make the pane own a detached broker session: ${startText} (or pass --create).`,
        ownership,
        reasons: ownership.reasons,
        start,
        startEnv,
        startText,
      };
    return { ok: true, action: "create", broker: null, ownership, reasons: [`nothing owns ${store}: the rig's EXISTING detached owner (${startText}) is what to start, and it is reported with the pid it created`], start, startEnv, startText, posture: "detached-owner" };
  }
  return {
    ok: false,
    code: "no-session-to-attach",
    // MEASURED 2026-11-21: the rig's own sentence for this leg prints `serve --db <path>`, but `cli.mjs` HAS NO
    // `--db` and silently ignores an invented one (it acts on the CONFIGURED store, `cli.mjs:174`), so that hint is
    // a line that would act on the WRONG store. This plugin prints the env-named form and says why the other one is
    // not offered: a refusal whose copyable line is fiction is the class this seam refuses.
    refusal: `${verdict.reasons.join(" ")} Nothing was started, read or changed. The command that WOULD own this store is ${startText} (the store is named by ENV: cli.mjs has no --db flag, so an invented --db is silently ignored and acts on the CONFIGURED store), or pass --create to ask for it.`,
    ownership,
    reasons: verdict.reasons,
    start,
    startEnv,
    startText,
  };
}

// THE TAG is core-side on purpose: the plugin's namespace is a NAME THIS file derives from the store/workspace, so
// a backend swap cannot move the rig's panes into the user's session by accident.
export function muxSlug(text = "") {
  const s = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "default";
}

export function muxWorkspaceTag(store = null, cwd = null) {
  const src = store ?? cwd;
  if (!src) return MUX_NAMESPACE_TAG_PREFIX + "default";
  const named = store ? basename(dirname(src)) : basename(src);
  return MUX_NAMESPACE_TAG_PREFIX + muxSlug(named).slice(0, 40);
}

// THE PANE COMMAND IS ONE DECISION, MADE HERE, AND NEVER RESTATED BY A DRIVER (contracts (3) OWNERSHIP + (4)
// INTERACTION). Every driver's `open`/`attach` puts the SAME command in its own window vocabulary, and that
// command is the PLUGIN's OWN pane client — `tools/mux-pane-client.mjs`, an ATTACHED CLIENT of one seat: a
// readOnly `multiplexAttach` RE-READ leg that reads that seat's `pi.live`/`pi.inbox` and routes one act to the
// broker's spool. It is never a keystroke and never a second writer.
//
// WHY NOT the rig's own full TUI as the pane command — MEASURED, and this is the reason the seam needed its own
// client at all: `node tui.mjs --db <store> --attach --select <seat>` run inside a window prints the attach
// banner and then exits rc 1 about 1 s later, throwing `ReadOnlySession: Read-only Harness: a commit with writes
// refused` from the vendor's upkeep job (`vendor/pi-main/packages/durable/dist/session/session.js:823`, reached
// from `#maintain`, which arms the hold-store/document-sweep timers). A readOnly Harness that runs upkeep WRITES,
// and a readOnly Harness may not. A multiplexer then DESTROYS the window whose command exited (measured on BOTH
// multiplexers this host can run — see each driver's own note: an empty capture is a DEAD window, not a capture
// failure), so the census shows the pane gone and the backend's own capture answers 0 chars. That is a fact about
// the vendor's TUI — the BASE — and D212 forbids patching it, so the seam grows its OWN pane client on the plane
// it already owns.
//
// WHY `process.execPath` AND ABSOLUTE PATHS AND NO `--frames`: this box runs node from an nvm path (`node -v`
// v24.22.1 at /home/chexxor/.nvm/…/bin/node), and a window starts in a bare `-c <ws>` environment, so a hardcoded
// `node` resolves through the WINDOW's own PATH — a different interpreter at best, a missing one at worst. And
// the client defaults to `--frames 0` = FOREVER precisely because of the destroy rule above: the multiplexer owns
// the window's life, so the client keeps it alive. `existsSync` is a belt: a pane command that names a file which
// is not there is not a command, and a driver that emits it produces a dead window and an empty capture — the
// fail-open class this seam refuses.
export function muxPaneArgv(store = null, seat = null, name = null) {
  const client = join(ROOT, "tools", "mux-pane-client.mjs");
  if (!store || !seat || !existsSync(client)) return null; // not a command: no store, no seat, or no client
  return [process.execPath, client, "--db", store, "--select", seat, "--pane", String(name || seat)];
}
export const MUX_PANE_CLIENT_PATH = join(ROOT, "tools", "mux-pane-client.mjs");

// WHICH SESSION the plugin may touch (contract (9)). The default is the plugin's OWN derived session; a foreign
// session is REPORTED present-but-not-touched, and any verb aimed at it is refused BY NAME with the namespace
// printed. The override (contract (10)) is the `--into`/`--namespace` ASK plus the two persistent knobs.
export function muxNamespace({ store = null, cwd = null, state = {}, env = {}, backend = null, drivers = new Map(), present = [] } = {}) {
  const tag = muxWorkspaceTag(store, cwd);
  const envd = env[MUX_NAMESPACE_ENV] ?? null;
  if (envd && !MUX_NAMESPACE_NAMES.includes(envd))
    return { ok: false, code: "namespace-not-declared", refusal: `mux: ${MUX_NAMESPACE_ENV}=${envd} is not a namespace. known namespaces: ${MUX_NAMESPACE_NAMES.join(", ")}. Nothing was read, paneled, captured or killed.` };
  const d0 = drivers.get(backend)?.driver;
  const own = d0?.sessionName ? d0.sessionName({ cwd, store, tag, namespace: MUX_NAMESPACE_DEFAULT }) : tag;
  const into = state.into ?? env[MUX_NAMESPACE_SESSION_ENV] ?? null;
  if (state.namespace && envd && state.namespace !== envd && !state.into)
    return { ok: false, code: "namespace-conflict", refusal: `mux: --namespace ${state.namespace} contradicts ${MUX_NAMESPACE_ENV}=${envd}. Say one thing; nothing was read or changed.` };
  const namespace = state.namespace ?? (state.into ? "user" : (envd ?? (into ? "user" : MUX_NAMESPACE_DEFAULT)));
  if (state.everySession)
    return { ok: false, code: "teardown-every-session", refusal: `mux: \`--every-session\` is REFUSED BY NAME. A teardown of EVERY session the multiplexer manages also ends the sessions the USER started, which is exactly the loss this namespace model exists to prevent. What the plugin CAN name is a session-scoped teardown of its OWN session (the exact argv is printed by the active driver in the census, for \`${tag}\`). Nothing was killed.` };
  // THE ISOLATION REFUSAL (contract (9)): in the DEFAULT namespace a request that NAMES a session the plugin does
  // not own is refused BY NAME with the namespace printed — it is not silently adopted, and it is not enumerated.
  if (namespace === MUX_NAMESPACE_DEFAULT && into && into !== own)
    return { ok: false, code: "namespace-foreign-asked", refusal: `mux: \`--into <session>\` names \`${into}\`, which the plugin does not own, and the namespace is \`plugin\` (the default). Refused BY NAME: the plugin will not pane into, capture or kill a session it does not own — that is the user's namespace. To opt in loudly: pass --namespace user together with --into <session> (or set ${MUX_NAMESPACE_ENV}=user and ${MUX_NAMESPACE_SESSION_ENV}=<session> for the persistent form). Nothing was read, paneled, captured or killed.` };
  const sessionName = namespace === MUX_NAMESPACE_DEFAULT ? own : (d0?.sessionName ? d0.sessionName({ cwd, store, tag: into, namespace }) : into);
  if (namespace === "user" && !into)
    return { ok: false, code: "user-namespace-unspecified", refusal: `mux: the USER namespace was asked for but no session was named. Name it: --into <session> or ${MUX_NAMESPACE_SESSION_ENV}=<session>. Nothing was read or changed.` };
  const TEARDOWN = new Set(["kill", "halt"]);
  // THE TEARDOWN RULE IS NAMESPACE-AGNOSTIC ON PURPOSE (decided 2026-11-21, pinned by demo/mux-namespace.test.mjs
  // section 3 and 4). A session-level teardown that does not name a session carrying the plugin's tag is the SAME
  // loss `teardown-every-session` refuses above: it ends sessions the USER started, which may hold other harnesses.
  // The namespace OVERRIDE does not unlock it — `--into <session>`/`--namespace user`/the persistent knobs PLACE
  // the plugin's panes in the user's session (the goal's contract (10)); they do not hand the plugin the right to
  // END a session it does not own. A plane that cannot name a session carrying the tag can therefore kill nothing,
  // which is why the refusal refuses rather than leaving a session running unnamed.
  if (state.verb && TEARDOWN.has(state.verb) && !String(sessionName).includes(tag))
    return { ok: false, code: "teardown-foreign", refusal: `mux: a teardown (\`${state.verb}\`) may only name a session that carries the plugin's tag \`${tag}\`; the resolved session is \`${sessionName}\` in namespace \`${namespace}\`. Refused BY NAME: nothing was killed and no session was left running. The namespace override — \`--into <session> --namespace user\`, or ${MUX_NAMESPACE_ENV}=user / ${MUX_NAMESPACE_SESSION_ENV}=\u2026 — PLACES the plugin's panes in the user's session; it does not grant the plugin the right to END a session the user started, and ending that is the same loss this namespace model exists to prevent. End it in the user's own multiplexer. What the plugin can name is a session-scoped teardown of a session that carries \`${tag}\`.` };
  // WHICH census rows are THIS session's is a core decision, and a census row is not always a bare name: some
  // backends report a socket/instance label that carries a per-host prefix (this seam stays backend-word-free,
  // so the rule is about the row's own `tag` half, not about any backend's separator). A row that matches the
  // resolved session is NOT foreign; every other row is reported PRESENT, NOT TOUCHED.
  const sameAs = (s, name) => {
    if (!s || !name) return false;
    const n = String(name);
    if (s.tag != null && String(s.tag) === n) return true; // the row carries its own name half
    if (s.name != null && String(s.name) === n) return true;
    if (s.name != null && !n.includes(".") && String(s.name).split(".").pop() === n) return true; // prefix-labelled socket row
    return false;
  };
  const rowMatch = present.find((s) => sameAs(s, sessionName));
  const foreign = present.filter((s) => !sameAs(s, sessionName)).map((s) => ({ name: s.name, panes: s.panes ?? null, touched: false }));
  const note = namespace === MUX_NAMESPACE_DEFAULT
    ? `namespace: plugin (the plugin's OWN session \`${sessionName}\`) — the user's own sessions are NOT touched`
    : `namespace: user — NAMESPACE OVERRIDE, the plugin is driving the USER's session \`${sessionName}\`; its own session \`${own}\` was NOT used. Panes will sit in the session the user is watching.`;
  return { ok: true, namespace, tag, own, sessionName, censusTarget: rowMatch?.name ?? null, foreign, note, via: state.into ? "--into" : state.namespace ? "--namespace" : envd ? MUX_NAMESPACE_ENV : into ? MUX_NAMESPACE_SESSION_ENV : "default (plugin)" };
}

// THE ACT LEG (the goal's contract (4)): an op the broker does not carry is REFUSED BY NAME before anything
// is written, and an op it does carry goes to the broker's spool with the PANE's seat/conversation filled in.
export function muxActRequest(pane, { op = null, text = null, requestId = null } = {}) {
  if (!op) return { ok: false, refusal: muxRefusalText("act needs --op <spool-op>. known ops: " + SPOOL_OPS.join(", ") + ".") };
  if (!SPOOL_OPS.includes(op))
    return { ok: false, code: "op-not-carried", refusal: muxRefusalText(`--op ${op} is not one the broker carries. known ops: ${SPOOL_OPS.join(", ")}. Nothing was written.`) };
  const request = { op, from: pane.paneName, ...(text ? { content: text } : {}) };
  // SEAT-ROUTED means the spool request must name the pane's seat — the set is BUILT FROM THE BROKER'S OWN
  // SETS (imported above), so a future spool op inherits the door instead of this file restating a list.
  const seatRouted = new Set([...CROSS_SEAT_OPS, ...CONTROL_PLANE_OPS, ...QUEUE_CONTROL_OPS, ...SESSION_CONTROL_OPS, "message"]);
  if (seatRouted.has(op)) {
    if (!pane.seat) return { ok: false, refusal: muxRefusalText(`${op} names a seat; this pane holds none. Nothing was written.`) };
    request.to = pane.seat;
  }
  if (op === "input") {
    if (!pane.conversationId) return { ok: false, refusal: muxRefusalText("`input` needs the pane's conversation token; this pane has none. Nothing was written.") };
    request.conversation = pane.conversationId;
  }
  // THE SPOOL'S OWN AUTHORITY, imported and applied, never restated: `authorizeSpoolRequest` answers
  // `{allowed, code, detail?}`, and a pane acts as the identity it can name — its OWN seat. So a pane may
  // steer/read its own seat (`self-target`, `content-op`) and is REFUSED BY NAME for an op the spool gates to
  // the operator or the delegate (`not-operator`, `not-operator-plane`). This plugin does not launder identity.
  const authorized = authorizeSpoolRequest(request, { op });
  if (authorized?.allowed !== true)
    return { ok: false, code: authorized?.code ?? "spool-refused", refusal: `mux: the spool refused \`${op}\` BY NAME (${authorized?.code ?? "refused"}${authorized?.detail ? ` — ${authorized.detail}` : ""}). Nothing was written.` };
  return { ok: true, request, authorized, admitted: authorized?.code ?? null };
}

// A DRIVER'S CAPABILITY IS DECLARED, NOT ASSUMED. A backend that has no word for an action refuses BY NAME
// rather than silently forwarding the multiplexer's own key (the goal's contract (5), keybinds-refusals).
export function muxCapability(backend, verb, { drivers = new Map() } = {}) {
  const d = drivers.get(backend)?.driver;
  if (!d) return { ok: false, code: "backend-not-registered", refusal: `mux: no driver registered for backend \`${backend}\`. registered: ${[...drivers.keys()].join(", ") || "(none)"}.` };
  const caps = d.capabilities instanceof Set ? d.capabilities : new Set(d.capabilities ?? []);
  if (!caps.has(verb))
    return {
      ok: false,
      code: "capability-not-declared",
      refusal: `mux: the ${backend} driver does not declare \`${verb}\` (declared: ${[...caps].sort().join(", ") || "(none)"}). This plugin will NOT forward the multiplexer's own key for it — the action has no name to run, so it is refused.`,
    };
  return { ok: true, caps };
}

// THE PLATFORM VERDICT (D131: Linux and Windows are BOTH operating platforms for this rig, so a backend that
// resolves on one may name a DIFFERENT binary — or no presentation layer at all — on the other). WHICH binary to
// look for, and whether an OS has one at all, is a DRIVER fact: this function READS `driver.platform[os]` and
// names NO backend and NO OS, so the backend-word census of this file stays 0 and the WORDS of an OS-specific
// refusal live in the driver that declares them. The DECISION lives here: a row whose `status` is `refused`
// makes the whole ask a REFUSAL BY NAME that emits ZERO commands, because a command planned for a platform the
// driver refused is a command aimed at a binary that is not there — the fail-open class this seam refuses.
// `os` is a fact handed in by the caller: the owner plane passes `process.platform`, and a pin INJECTS it, which
// is what makes a Windows verdict a HERMETIC run on a Linux box (D213: the fast loop for a platform this box
// cannot run isolates the platform behind a seam and states its cost, rather than sleeping on a host that does not exist).
export function muxPlatformVerdict(backend, os = null, { drivers = new Map() } = {}) {
  const want = os ?? process.platform;
  const record = drivers.get(backend);
  if (!record)
    return { ok: false, code: "backend-not-registered", argvAllowed: false, binary: null, status: null, route: null, note: null, row: null, refusal: `mux: no driver registered for backend \`${backend ?? "(none active)"}\`. registered: ${[...drivers.keys()].join(", ") || "(none)"}. No command was named and nothing was run.` };
  const table = record.driver?.platform ?? null;
  if (!table)
    return { ok: true, code: "platform-table-not-declared", argvAllowed: true, binary: null, status: null, route: null, note: `this driver declares no platform table, so the seam probes the driver's own probe argv on \`${want}\` — declared, not assumed.`, row: null };
  const row = table[want];
  if (!row)
    return { ok: true, code: "platform-row-not-declared", argvAllowed: true, binary: null, status: null, route: null, note: `the driver declares no verdict for platform \`${want}\` (declared: ${Object.keys(table).join(", ")}), so the seam neither refuses that platform nor invents a binary for it.`, row: null };
  const status = row.status ?? "status-not-declared";
  if (status === "refused") {
    const words = row.note ?? row.route ?? "the driver named no reason for the refusal";
    return {
      ok: false,
      code: "platform-refused",
      argvAllowed: false,
      binary: row.binary ?? null,
      status,
      route: row.route ?? null,
      note: words,
      refusal: `mux: this ask is REFUSED on platform \`${want}\` for the \`${backend}\` backend BY NAME — the driver's own verdict is \`refused\` (${words}) No argv is planned, nothing was run, and this plugin substitutes NO route the driver did not declare (native host OS only, docs/DECISIONS.md D131).`,
      row,
    };
  }
  return { ok: true, code: status, argvAllowed: true, binary: row.binary ?? null, status, route: row.route ?? null, note: row.note ?? "", row };
}

// THE PLAN: for one verb and one selection, every command the backend would run, as DATA, attributed to the
// action and to the pane it belongs to. The core RUNS NONE OF THEM (its `child_process` count is 0).
// `sessionTag` is the CENSUS-LEARNED label for the resolved session — some backends address a session only by
// a label they learned from a census (a `<pid>.<name>` socket name), never from the bare name the core derived.
// Carrying it is a CORE decision (which row of the census IS this session), spelled by the driver; the core never
// parses it, so it stays backend-word-free.
export function muxPlan(verb, state, { session = null, sessionTag = null, tag = null, namespace = null, panes = [], drivers = new Map(), backend = null, store = null } = {}) {
  const record = drivers.get(backend);
  if (!record) return { ok: false, code: "backend-not-registered", refusal: `mux: no driver registered for backend \`${backend ?? "(none active)"}\`. registered: ${[...drivers.keys()].join(", ") || "(none)"}. No command was named and nothing was run.`, commands: [], panes: [] };
  const d = record.driver;
  const capability = muxCapability(backend, verb, { drivers });
  // `list` and `keys` answer from the registry; `act` is BACKEND-FREE — it is the broker's spool op, not a
  // multiplexer command, so a backend that cannot name it still acts. A driver MAY name a command for it,
  // but the core never needs one, and it never runs one.
  const BACKEND_FREE = new Set(["list", "keys", "act", "send"]);
  if (!capability.ok && !BACKEND_FREE.has(verb)) return { ...capability, commands: [], panes };
  // A PLATFORM THE DRIVER REFUSED emits ZERO commands for every verb that needs a multiplexer command.
  // The DECISION is the core's (which asks die on which platform, and which asks survive at all) and the WORDS
  // are the driver's, so neither the core's backend-word census nor a driver's argv table changes. The verbs
  // listed below are EXEMPT on purpose: `act`/`send` are the broker's spool ops and `keys` renders a preset,
  // so none of them needs anything from the multiplexer — refusing them would claim the RIG's own session cannot
  // be acted on, which is a different fact from "this OS has no presentation layer". `state.os` is injectable
  // (the plane passes `process.platform`; a pin injects `"windows"`), which is what makes the refusal testable
  // on a host that cannot boot Windows.
  const NO_ARGV_VERBS = new Set(["act", "keys", "send"]);
  const aimOs = state?.os ?? null;
  const platformVerdict = muxPlatformVerdict(backend, aimOs, { drivers });
  if (!platformVerdict.ok && !NO_ARGV_VERBS.has(verb))
    return { ok: false, code: "platform-refused", refusal: platformVerdict.refusal, commands: [], gaps: [], panes, backend, platform: { os: aimOs ?? process.platform, verdict: platformVerdict } };
  const commands = [];
  const sessionName = session ?? (d.sessionName ? d.sessionName({ cwd: null, store: null, tag, namespace }) : tag);
  // A driver may answer "this backend CANNOT NAME this ask" with a note and NO argv — a backend whose session
  // names may not contain `.` or `:` cannot address a name the user gave that does, and a backend that assigns
  // its own pane ids cannot invent one it has not learned from a census. The note belongs in the record either
  // way, and when NO pane could be named the whole ask becomes a REFUSAL BY NAME rather than a silent
  // zero-command success: an ask that ran nothing and said nothing is indistinguishable from an ask that did
  // nothing, which is the fail-open class this seam refuses.
  const gaps = [];
  for (let i = 0; i < panes.length; i += 1) {
    const pane = panes[i];
    // the pane's INDEX and TOTAL are what tells a driver whether this pane opens the session's first window
    // or adds another; `store` is what every driver needs to build the pane's rig-attach command.
    //
    // THE PANE COMMAND IS THIS CORE'S DECISION AND IS HANDED TO THE DRIVER AS DATA (`paneArgv`). A driver that
    // IMPORTED the decision from its sibling instead would be unloadable outside the directory the core sits in
    // — and an unloadable driver is a half-loaded registration (see the registry pin's temp registry, where a
    // driver copied without its sibling landed in loadErrors). So the seam passes the decision, not a dependency.
    const plan = { sessionName, sessionTag, tag, namespace, pane, store, backend, verb, index: i, total: panes.length, paneArgv: muxPaneArgv(store, pane?.seat, pane?.paneName) };
    const made = d.commands?.[verb]?.(plan);
    if (!made) continue;
    if (!made.argv) {
      if (made.note) gaps.push({ action: verb, pane: pane.seat ?? pane.paneName ?? "-", note: made.note });
      continue;
    }
    // A command may carry its OWN env (see `muxOwnershipPlan`'s `startEnv` and a driver's `halt`: the store is
    // named by env, never by a flag the CLI does not have). The plan carries it as DATA to the owner plane.
    commands.push({ action: verb, pane: pane.seat ?? pane.paneName, argv: made.argv, ...(made.cwd ? { cwd: made.cwd } : {}), ...(made.env ? { env: made.env } : {}), ...(made.note ? { note: made.note } : {}) });
  }
  if (!panes.length) {
    const made = d.commands?.[verb]?.({ sessionName, sessionTag, tag, namespace, pane: null, store, backend, verb, index: 0, total: 0, paneArgv: null }); // a session-level verb names no pane, so it gets no pane command
    if (made?.argv) commands.push({ action: verb, pane: "-", argv: made.argv, ...(made.cwd ? { cwd: made.cwd } : {}), ...(made.env ? { env: made.env } : {}), ...(made.note ? { note: made.note } : {}) });
    else if (made?.note) gaps.push({ action: verb, pane: "-", note: made.note });
  }
  if (!commands.length && gaps.length)
    return { ok: false, code: "backend-cannot-name-ask", refusal: [...new Set(gaps.map((g) => `mux: ${g.action} \u2014 ${g.note}`))].join("\n"), commands: [], gaps, panes, backend, sessionName, namespace, tag };
  return { ok: true, commands, gaps, panes, backend, sessionName, namespace, tag };
}

// THE TEXT FORM of a decision — the same fields the machine document carries, attributed. A view that does not
// say which session, how many panes, and which seat each pane holds is the record-a-later-reader-trusts class.
export function muxCensusText({ sessionName = null, sessionLabel = null, backend = null, namespace = null, foreign = [], panes = [], plan = {}, census = null, notes = [], ran = false } = {}) {
  const head = [
    `mux census — namespace ${namespace ?? MUX_NAMESPACE_DEFAULT} — session ${sessionName ?? "(none named)"}${sessionLabel ? ` (census label ${sessionLabel})` : ""} on backend ${backend ?? "(none)"}`,
    `panes: ${panes.length}  (which seat each pane holds is named below; the SESSION is the broker-owned one, not the multiplexer's)`,
  ];
  if (census) head.push(`queue rows selected: ${census}`);
  const rows = panes.map((p) => {
    const cmds = plan.commands.filter((c) => c.pane === (p.seat ?? p.paneName)).map((c) => `      ${c.action} -> ${c.env ? muxEnvPrefix(c.env) + " " : ""}${c.argv.join(" ")}`);
    return [
      `  pane ${p.paneName ?? p.seat}  holds seat ${p.seat ?? "-"}  conversation ${p.conversationId ?? "-"}  leg ${p.leg ?? "-"}  selected ${p.why ?? "-"}`,
      ...cmds,
    ].join("\n");
  });
  const actions = plan.commands.filter((c) => c.pane === "-").map((c) => `  ${c.action} -> ${c.env ? muxEnvPrefix(c.env) + " " : ""}${c.argv.join(" ")}`);
  // A named gap is printed, not swallowed: "0 commands and no explanation" reads as success to the next reader.
  const gapLines = (plan.gaps ?? []).map((g) => `  gap ${g.action} pane ${g.pane} \u2014 NO argv emitted (${g.note})`);
  const seen = foreign.length
    ? foreign.map((f) => `  foreign session ${f.name} — ${f.panes ?? "?"} pane(s) PRESENT, NOT TOUCHED (not enumerated, not captured, not killed)`)
    : ["  foreign sessions: none present"];
  const tail = [`backend commands: ${plan.commands.length} named${ran ? " — RUN" : " — PRINTED ONLY (nothing was run; --run is the ask)"}`, ...seen, ...gapLines, ...notes];
  return [...head, ...rows, ...actions, ...tail].join("\n");
}

// THE PLANE'S SEAMS: which store, and the reads the rig already owns (the SAME `readData` routing
// `tools/queue-surface-core.mjs` uses, so a session reads exactly what `cli.mjs status` would read).
export async function muxSurfaceSeams({ db = null, env = process.env, cwd = process.cwd(), local = false, attach = null, run = null, sessions = null, owner = null, drivers = null } = {}) {
  const store = db ?? env.DURIAN_PI_DB ?? env.DURIG_DB ?? null;
  const read = (view, params, fn) => readData(store, view, params, fn, { local });
  return {
    db: store,
    readSeats: async () => {
      if (!store) return [];
      const doc = await read("document", { kind: Seats.definition.kind, scope: { kind: "session" } }, (storage) => readSeatList(storage));
      return Array.isArray(doc) ? doc : [];
    },
    readRows: async () => {
      if (!store) return [];
      const rows = await read("queue", {}, (storage) => readQueueItems(storage));
      return Array.isArray(rows) ? rows : [];
    },
    ownership: (store2 = store) => (store2 ? muxOwnershipPlan(store2, {}) : null),
    drivers: async () => drivers ?? await muxSurfaceDrivers({ env }),
    attach,
    run,
    owner,
    cwd,
    // which multiplexer sessions exist right now, as DATA. A plane that cannot ask (no binary, no --run) returns
    // []; a foreign session that CAN be asked about is reported present-but-not-touched, never enumerated into.
    sessions: async () => sessions ?? [],
  };
}

// THE ONE CALL: session text -> argv -> parse -> decide -> strings. `seams` is the pin's in-memory plane; a real
// session builds it from the store. A read the rig refuses is REPORTED by name, never a zero-row success.
export async function muxSurfaceInvoke(text = "", { env = process.env, cwd = process.cwd(), db = null, seams = null, store = null } = {}) {
  const tokenized = queueCommandArgv(text);
  if (!tokenized.ok) return { show: [{ level: "error", body: queueRefusalText(tokenized.refusal) }], ok: false, exitCode: 1, state: {} };
  // a plane may hand the registry as an OBJECT or as an async getter (the shape `muxSurfaceSeams` returns); resolve
  // either, and fall back to discovering it. Reading an async getter as if it were the registry silently produced
  // an EMPTY driver table and a backend-not-registered refusal — the fail-open's class, so it is normalized here.
  const given = seams?.drivers ?? null;
  const loaded = (typeof given === "function" ? await given() : given) ?? await muxSurfaceDrivers({ env });
  const drivers = loaded?.drivers ?? new Map();
  const parsed = muxSurfaceParse(tokenized.argv, { styles: loaded?.styles ?? [], backends: loaded?.names ?? [] });
  if (!parsed.ok) return { show: [{ level: "error", body: parsed.refusal }], ok: false, exitCode: parsed.exitCode, state: parsed.state };
  const state = parsed.state;
  const backend = state.backend ?? loaded?.active ?? null;
  const use = seams ?? await muxSurfaceSeams({ db, env, cwd, drivers: loaded });
  const storePath = store ?? use.db;
  const notes = [];
  if (loaded?.loadErrors?.length)
    notes.push(`mux: a driver file loaded wrong: ${loaded.loadErrors.map((e) => `${e.path} (${e.error})`).join("; ")} — registered backends: ${loaded.names.join(", ")}`);
  const seats = await use.readSeats();
  const rows = await use.readRows();
  const present = use.sessions ? await use.sessions() : [];
  const ownership = storePath ? muxOwnershipPlan(storePath, { create: state.create, attach: state.verb === "attach" }) : null;
  // WHICH session the plugin may touch is decided BEFORE any pane is selected and before any command is named:
  // an ask aimed at a session the plugin does not own must be refused by name WITHOUT emitting a partial census,
  // and `halt`/`--every-session` must reach the teardown refusal rather than a selector ask (measured in the pin).
  const ns = muxNamespace({ store: storePath, cwd: use.cwd, state, env, backend, drivers, present });
  if (!ns.ok)
    return { show: [{ level: "error", body: ns.refusal }], ok: false, exitCode: 1, state, ownership, panes: [], namespace: ns };
  if (state.verb === "keys")
    return { show: [{ level: "info", body: muxKeysText(loaded, state) }, { level: "info", body: `namespace: ${ns.namespace} (session ${ns.sessionName}) via ${ns.via}` }], ok: true, exitCode: 0, state, ownership, panes: [], namespace: ns, db: storePath };
  notes.push(ns.note);
  const selection = muxSeatSelect(state, { seats, rows });
  if (!selection.ok) return { show: [{ level: "error", body: selection.refusal }], ok: false, exitCode: 1, state, ownership, namespace: ns, selection };
  const panes = selection.panes.map((p) => ({ paneName: p.paneName ?? p.seat, ...p }));
  // a census that does not say WHICH session owns the store is the record-a-later-reader-trusts class: the
  // start command and the posture belong to the success path too, not only to the refusal.
  if (ownership?.start)
    notes.push(`owner: ${ownership.startText ?? ownership.start.join(" ")} \u2014 posture ${ownership.posture ?? "(not stated)"}`);
  if (ownership && !ownership.ok && (state.verb === "open" || state.verb === "attach" || state.verb === "halt"))
    return { show: [{ level: "error", body: ownership.refusal }], ok: false, exitCode: 1, state, ownership, panes, namespace: ns };
  const plan = muxPlan(state.verb, state, { session: ns.sessionName, sessionTag: ns.censusTarget, tag: ns.tag, namespace: ns.namespace, panes, drivers, backend, store: storePath });
  if (!plan.ok) return { show: [{ level: "error", body: plan.refusal }], ok: false, exitCode: 1, state, ownership, panes, namespace: ns, plan };
  // THE ACT LEG. One spool request per pane, built BEFORE anything runs, so an op the broker does not carry
  // is refused BY NAME with nothing written. The request is PRINTED even when nothing ran — an act that
  // printed nothing is indistinguishable from an act that did nothing.
  const acts = (state.verb === "act" || state.verb === "send") ? panes.map((pane) => ({ pane, act: muxActRequest(pane, { op: state.op, text: state.text }) })) : [];
  const refusedActs = acts.filter((a) => !a.act.ok);
  if (refusedActs.length)
    return { show: [{ level: "error", body: refusedActs.map((a) => a.act.refusal).join("\n") }], ok: false, exitCode: 1, state, ownership, panes, acts };
  const ran = Boolean(state.run);
  const lines = [];
  for (const a of acts) {
    notes.push(`act \u2014 pane ${a.pane.paneName} seat ${a.pane.seat ?? "-"} spool op ${a.act.request.op} request ${JSON.stringify(a.act.request)}`);
    if (state.run && use.run) {
      const delivered = await use.run(a.act.request);
      notes.push(`act RESULT \u2014 pane ${a.pane.paneName}: ${JSON.stringify(delivered)}`);
      a.delivered = delivered;
    }
  }
  lines.push({ level: "info", body: muxCensusText({ sessionName: plan.sessionName, sessionLabel: ns.censusTarget, backend, namespace: ns.namespace, foreign: ns.foreign, panes, plan, census: selection.census ? JSON.stringify(selection.census) : null, notes, ran }) });
  if (ownership?.reasons?.length) lines.push({ level: "info", body: `ownership — ${ownership.reasons.join("; ")}` });
  return { show: lines, ok: true, exitCode: 0, state, plan, panes, ownership, selection, namespace: ns, db: storePath, census: selection.census };
}

// THE KEY TEXT: the active preset, every other registered preset, and what this plugin CANNOT do. The keys
// themselves come from the drivers, so this sentence names no backend.
// The HINT SEAM (criterion 5) takes a THIRD argument: pi's own `KeybindingHints`, which reach an extension
// through ONE route only — the render context (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:73-77` declares `keyText(keybinding)` and `keyHint(keybinding, description)`, and `EntryRenderOptions extends KeybindingHints` at :1208 is what `registerEntryRenderer` (:1299) hands a renderer). `ExtensionContext`/``ExtensionCommandContext` carry NO hints, so a command handler that is not a renderer CANNOT ask pi for a key; `/mux-keys` therefore appends an entry (`appendEntry`, types.d.ts:1317) and pi renders it. Which fns answered is printed below, never assumed.
export function muxKeysText(loaded, state = {}, host = {}) {
  const styles = loaded?.styles ?? [];
  const active = loaded?.active;
  const presets = [...(loaded?.drivers ?? new Map()).values()].map((r) => r.driver?.preset).filter(Boolean);
  const askedStyles = state.presets ?? [];
  const chosen = askedStyles.length ? presets.filter((p) => askedStyles.includes(p.style)) : presets;
  const activePreset = presets.find((p) => p.style === (loaded?.drivers?.get(active)?.driver?.preset?.style ?? ""));
  const key = (p) => Object.entries(p.keys).map(([action, k]) => `  ${action} -> ${k}`).join("\n");
  return [
    `mux keybind vocabulary — the actions this plugin can perform, and the presets the registered drivers declare.`,
    `active preset: ${activePreset?.style ?? "(none)"} (switch with --preset <style>; a preset is registered by a driver, the core does not name one)`,
    ...chosen.map((p) => `preset ${p.style}:\n${key(p)}`),
    `namespace: the plugin's OWN session is the default (a name derived from the store/workspace, e.g. ${MUX_NAMESPACE_TAG_PREFIX}<workspace>); opt in to the user's session with --into <session> or --namespace user, or persistently with ${MUX_NAMESPACE_ENV}=user / ${MUX_NAMESPACE_SESSION_ENV}=<session>. Every census prints the namespace it acted in.`,
    `what pi can rebind, and what it cannot: pi's keybinding ids are a CLOSED vocabulary (vendor/pi-main/packages/tui/src/keybindings.ts:61 exports \`Keybinding = keyof Keybindings\`, and the manager's rebuild() skips an id outside its definitions, so keyText of an unknown id is \"\") \u2014 a mux action is NOT one of those ids, so keybindings.json cannot move a mux key. A user rebinds pi's OWN ids; the plugin's keys are fixed while its preset is chosen. pi's own ids ARE rendered with pi's own fns, in the lines below.`,
    `an action no preset carries, or a verb the active driver does not declare, is REFUSED BY NAME \u2014 the multiplexer's own key is never forwarded.`,
    styles.length ? `registered styles: ${styles.join(", ")}` : "no preset registered (no driver loaded)",
    ...muxKeyHintLines(host),
    ...muxKeyCollisionLines(loaded, host),
  ].join("\n");
}

// pi's RESERVED extension-conflict list, copied VERBATIM from vendor/pi-main/packages/coding-agent/src/core/
// extensions/runner.ts:98-117 (measured 2026-11-21). demo/mux-keybinds.test.mjs re-reads that source and FAILS
// if the two lists drift, which is what makes this copy a rule and not a memory.
export const MUX_RESERVED_PI_IDS = [
  "app.interrupt", "app.clear", "app.exit", "app.suspend", "app.thinking.cycle", "app.model.cycleForward",
  "app.model.cycleBackward", "app.model.select", "app.tools.expand", "app.thinking.toggle", "app.editor.external",
  "app.message.copy", "app.message.followUp", "tui.input.submit", "tui.select.confirm", "tui.select.cancel",
  "tui.input.copy", "tui.editor.deleteToLineEnd",
];
// pi ids whose keys sit next to a mux action, each with the description its hint carries. The KEYS are asked
// from pi, never written here: the only honest answer about a key is pi's own keyText/keyHint of that id.
export const MUX_PI_HINT_IDS = {
  "app.message.followUp": "to queue a follow-up on the seat this pane shows",
  "tui.input.submit": "to submit the prompt a pane is typing into",
  "app.tools.expand": "to expand what the census folded away",
  "app.editor.external": "to open the external editor (a pane never edits a session)",
};

// ONE shape for asking pi for a key: {called: true|"threw"|false, text, reason}. Never throws, because a
// renderer whose hint fns throw must still print the table it was given — a hint that dies silently is the
// drift this seam exists to catch.
export function muxKeyText(id, host = {}) {
  const f = host?.keyText;
  if (typeof f !== "function") return { called: false, text: null, reason: "no host keyText handed in" };
  try { return { called: true, text: String(f(id) ?? ""), reason: null }; }
  catch (err) { return { called: "threw", text: null, reason: String(err?.message ?? err) }; }
}

export function muxKeyHint(id, description, host = {}) {
  const f = host?.keyHint;
  if (typeof f !== "function") return { called: false, text: null, reason: "no host keyHint handed in" };
  try { return { called: true, text: String(f(id, description) ?? ""), reason: null }; }
  catch (err) { return { called: "threw", text: null, reason: String(err?.message ?? err) }; }
}

// pi's resolved key for every RESERVED id — the input to the collision rule below. An id pi does not know
// formats as "" (measured: keyText("mux.detach") -> ""), which is a fact about the CLOSED vocabulary, not a
// parse failure.
export function muxKeyResolve(host = {}, { reserved = MUX_RESERVED_PI_IDS } = {}) {
  const out = {};
  for (const id of reserved) out[id] = muxKeyText(id, host);
  return out;
}

// THE COLLISION RULE (the trap that costs time): a preset key equal to a RESERVED pi shortcut is not rebound
// and not shadowed \u2014 pi SKIPS the plugin's shortcut, printing "Extension shortcut '<key>' from <path> conflicts
// with built-in shortcut. Skipping." (vendor/pi-main/packages/coding-agent/src/core/extensions/runner.ts:697
// and :699). So the plugin must NAME the collision rather than discover it by a dead key.
export function muxKeyCollision(presetKeys, resolved) {
  const hits = [];
  for (const p of presetKeys) {
    const combo = String(p.combo).toLowerCase();
    for (const [id, r] of Object.entries(resolved)) {
      if (r?.called !== true || !r.text) continue;
      const piKeys = String(r.text).toLowerCase().split("/");
      if (piKeys.includes(combo)) hits.push({ style: p.style, action: p.action, combo: p.combo, piId: id });
    }
  }
  return hits;
}

// The rendered hint lines: pi's own fns answering for pi's own ids, or the named reason they did not answer.
export function muxKeyHintLines(host = {}, { ids = MUX_PI_HINT_IDS } = {}) {
  const rows = Object.entries(ids).map(([id, description]) => {
    const hint = muxKeyHint(id, description, host);
    if (hint.called === true) return `  pi id ${id} \u2014 ${hint.text}  (rendered by pi's keyHint)`;
    const text = muxKeyText(id, host);
    if (text.called === true) return `  pi id ${id} \u2014 keyHint did not answer (${hint.reason}); keyText says "${text.text}"`;
    return `  pi id ${id} \u2014 NO host KeybindingHints handed in, so pi was never asked for this key`;
  });
  const gap = muxKeyText("mux.list", host);
  rows.push(`  the plugin's own actions are NOT pi ids: ${gap.called === true ? `keyText("mux.list") answered "${gap.text}"` : `keyText("mux.list") was not asked`} \u2014 pi registers a plugin's keys as LITERAL shortcuts, so a mux key is fixed while its preset is chosen.`);
  return [rows.join("\n")];
}

// The collision verdict for the ACTIVE and every other registered preset, or the named reason it could not
// be computed. "no collision" is only evidence when pi actually answered for the RESERVED ids.
export function muxKeyCollisionLines(loaded, host = {}) {
  const presets = [...(loaded?.drivers ?? new Map()).values()].map((r) => r.driver?.preset).filter(Boolean);
  const presetKeys = presets.flatMap((p) => Object.entries(p.keys ?? {}).map(([action, combo]) => ({ style: p.style, action, combo })));
  const resolved = muxKeyResolve(host, { reserved: MUX_RESERVED_PI_IDS });
  const asked = Object.values(resolved).filter((r) => r.called === true).length;
  if (!asked)
    return [`collision check NOT RUN \u2014 no host keyText handed in, so pi's reserved keys were never read (0 of ${MUX_RESERVED_PI_IDS.length} ids asked)`];
  const hits = muxKeyCollision(presetKeys, resolved);
  if (!hits.length)
    return [`no preset key collides with a RESERVED pi shortcut (pi answered for ${asked} of ${MUX_RESERVED_PI_IDS.length} reserved ids; ${presetKeys.length} preset keys checked)`];
  return [
    `COLLISION \u2014 pi would SKIP these plugin shortcuts and print "conflicts with built-in shortcut. Skipping.": ${hits.map((h) => `${h.style} preset ${h.action} (${h.combo}) == ${h.piId}`).join("; ")}. A preset that needs such a key is a naming defect in that driver's preset, fixed there.`,
  ];
}

// THE ENTRY RENDERER BODY, registered by the extension through pi.registerEntryRenderer. `options` IS pi's
// EntryRenderOptions (keyHint/keyText/expanded); `Text` is pi-tui's component class, imported on the pi plane
// only. With no Text (a headless pin) it returns the same body as a plain marker so the pin can still read
// what the renderer would print.
export function muxKeysRender(entry, options, theme = null, { Text = null } = {}) {
  const host = { keyText: options?.keyText, keyHint: options?.keyHint };
  const body = muxKeysText(entry?.data?.loaded, entry?.data?.state ?? {}, host);
  if (typeof Text !== "function") return { component: "none (no pi-tui Text on this plane)", body };
  return new Text(body, 0, 0);
}
