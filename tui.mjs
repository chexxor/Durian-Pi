// tui.mjs — the durable-TUI entrypoint (Phase 1 of the merge plan, D101/D102).
//
// The real Pi TUI on a durable conversation, run as a NON-DEFAULT entrypoint (`npm run tui`) on its
// OWN store. `npm run ui` (ui.mjs, the poller) is untouched and remains the documented fallback; the
// two run at once with NO shared writer because this entrypoint FAILS CLOSED when a broker — or a
// live generation — owns its store (src/storeownership.mjs; the D42 / F24 second-writer collision).
//
// THE ATTACH PATH (task-5 of the merge plan, D212 "grow the seam"). A live broker no longer just
// blocks this entrypoint: `--attach` makes it a VIEWER of the session the broker already drives
// (pi-durable `readOnly` Harness, docs/spec.md:838) instead of asking the operator to stop the
// broker in order to look at it. Without `--attach` the old refusal still fires, and it names
// `--attach`. One rule, no override: src/storeownership.mjs `tuiOpenVerdict` decides open|attach|refuse.
//
// Store: `--db <path>` or DURIAN_PI_TUI_DB (DURIG_TUI_DB is the D103 deprecated alias). The default
// is `session.sqlite` beside this file, deliberately AWAY from the rig store — never selfdev.sqlite.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDurableTuiRuntime } from "./src/tui/durable/adapter.mjs";
import { createRealHost } from "./src/tui/durable/real-host.mjs";
import { assessStoreOwnership, tuiOpenVerdict } from "./src/storeownership.mjs";
import { parseTuiArgs } from "./src/tui/durable/cliargs.mjs";

// Keep the TUI's own startup checks quiet; the provider extension still loads and registers, and
// requests still go to the configured provider.
process.env.PI_SKIP_VERSION_CHECK = "1";

const args = process.argv.slice(2);
// #4164: parsing is a module so the rules are testable without a store or a TTY, and AN UNKNOWN FLAG
// IS REJECTED RATHER THAN IGNORED — a flag that is silently discarded is a flag that lies. This
// entrypoint used to ignore `--select`, which `enter.mjs` had been passing for a whole item.
const parsed = parseTuiArgs(args);
if (parsed.help) {
	console.log(
		"tui [--db <path>] [--select <seat>] [--attach]\n" +
			"  --db      the store to open (default: session.sqlite beside this file)\n" +
			"  --select  the seat this session is opened FOR (carried, not resolved here)\n" +
			"  --attach  view a store a LIVE BROKER already drives, read-only — never a second writer (needs --db).\n" +
			"            an ATTACHED pane is a client of the multiplexer: its words route into the session's pi.inbox\n" +
			"            through the broker's spool, so N attached panes merge into one ID-ordered input stream.\n" +
			"            abort/steer/compact still refuse by name — the broker drives the run.\n" +
			"  --help    this text",
	);
	process.exit(0);
}
if (parsed.errors.length > 0) {
	for (const e of parsed.errors) console.error(`tui: ${e}`);
	process.exit(1);
}
function argValue(name) {
	return parsed[name === "--db" ? "db" : "select"] ?? null;
}

// D103 ships the new name; DURIG_TUI_DB is accepted as the deprecated alias with a warning. This is
// a single-var shim, not a general alias mechanism — the D103 loader owns the DURIG_* -> DURIAN_PI_*
// mapping (#2109).
// An ATTACH must NAME a store: there is deliberately no default store for an attach, because the
// default `session.sqlite` beside this file is a store NOTHING drives — attaching to it would be a
// lie about which session the operator is looking at. Mirrors src/tui/durable/attach.mjs
// `resolveSeatStore`, which refuses a default store for the same reason (#4006-era).
if (parsed.attach && !(argValue("--db") || process.env.DURIAN_PI_TUI_DB || process.env.DURIG_TUI_DB)) {
	console.error(
		"tui: --attach names a store; there is deliberately no default store for an attach. " +
			"Pass --db <path> (the store the broker is driving: serve --db <path>).",
	);
	process.exit(1);
}

let dbPath = argValue("--db");
if (!dbPath && process.env.DURIG_TUI_DB && !process.env.DURIAN_PI_TUI_DB) {
	console.error("tui: DURIG_TUI_DB is deprecated — use DURIAN_PI_TUI_DB");
}
dbPath ??=
	process.env.DURIAN_PI_TUI_DB ??
	process.env.DURIG_TUI_DB ??
	join(dirname(fileURLToPath(import.meta.url)), "session.sqlite");

// FAIL CLOSED, AND WITHOUT AN OVERRIDE (#4006). This entrypoint is a WRITER, so it must never open
// a store a broker owns — and never open "to check". The ONE rule now has three outcomes
// (src/storeownership.mjs `tuiOpenVerdict`): nothing owns it -> OPEN as a writer; a LIVE BROKER
// owns it and `--attach` was asked -> ATTACH as a read-only viewer; anything else -> REFUSE.
// A second writer is not made safe by a flag: the library ALLOWS a second non-readOnly open on a
// separate handle and it DOES write (measured in .spike/probe-attach2.out: store 4,096 -> 122,880 B),
// so this verdict is the only thing keeping spec.md:4371 ("`Harness` instances must never own the
// same Session concurrently") true on this rig.
//
// THE OLD `--own` FLAG IS GONE. It WARNED (`WARNING opening ... (operator override)`) and then opened
// anyway — the F24/D42 two-writer collision WITH A LOG LINE, reachable in normal use, which is
// exactly what this guard exists to make impossible. There is no override now: a second writer is
// not made safe by a flag.
//
// A PAUSED BROKER HAS NOT RELEASED THE STORE — `applyPauseOp` sets a RIG-LEVEL flag while the broker
// PROCESS stays alive and keeps its heartbeat fresh — so the operator window is STOP-AND-RESTART
// (#4004, ruled; no relinquish state): record the contract (src/tui/durable/attach.mjs
// `beginOperatorWindow`), STOP the broker, then open here.
const legacyOwn =
	args.includes("--own") || /^(1|true|yes)$/i.test(process.env.DURIAN_PI_TUI_OWN ?? process.env.DURIG_TUI_OWN ?? "");
if (legacyOwn) {
	console.error(
		"tui: `--own` / DURIAN_PI_TUI_OWN no longer exist. They opened a store a broker still owned, which is a " +
			"second writer. Stop the broker (serve --stop) and retry.",
	);
}
const ownership = assessStoreOwnership(dbPath);
const verdict = tuiOpenVerdict(dbPath, { attach: parsed.attach, ownership });
if (verdict.action === "refuse") {
	console.error(
		`tui: refusing to open ${dbPath} — ${verdict.reasons.join("; ")}. ` +
			(parsed.attach
				? "an attach needs the BROKER to be driving this store (serve --db <path>); a generation in flight is not a session to attach to."
				: `Stop the broker (serve --stop) and retry; a PAUSED broker is still the owner, so a pause alone is not a release — or pass --attach to view that session read-only.`),
	);
	process.exit(1);
}
const attached = verdict.action === "attach";
if (attached) {
	console.log(
		`ATTACHED — read-only viewer of the session the broker drives (pid ${verdict.broker.pid}). ` +
		"Reading, watching, and rendering are live; OPERATOR INPUT IS ROUTED into the session's `pi.inbox` " +
			"through the broker's spool (<db>.broker.inbox), so this pane is one client of a multiplexer and " +
			"N attached panes merge into ONE ID-ordered input stream. The acts that would DRIVE a Session " +
			"this process does not own still refuse by name: abort, abortCompaction, steer, followUp, compact, waitForIdle.",
	);
}

const storage = await (await import("@earendil-works/pi-durable/storage/sqlite/node")).openNodeSqliteStorage(dbPath, {
	// The window STOPPED the broker before this open (enter.mjs), so nothing should contend — but a
	// broker that was RESTARTED by a previous window may still be coming up, and its open and ours
	// both take the WAL/PRAGMA write path. The default 5 s busy timeout is tuned for a poller; an
	// operator-initiated open that fails here costs the whole session, so ride out a transient
	// writer for longer rather than dying with `database is locked`.
	busyTimeoutMs: 15_000,
});

const cwd = process.cwd();
const { ca, hostSession, hostSessionManager, services, model } = await createRealHost({ cwd });

const { runtime } = await createDurableTuiRuntime({
	cwd: services.cwd,
	agentDir: services.agentDir,
	storage,
	models: services.modelRuntime,
	agentModel: { provider: model.provider, modelId: model.id },
	host: { hostSession, hostSessionManager, services },
		...(attached
			? {
				readOnly: true,
				// THE ATTACH POSTURE (D339): an ATTACHED pane is a CLIENT of src/multiplex.mjs, so it
				// needs the broker's spool (the transport for its words), a name (so the merged stream
				// says which pane spoke), and a re-read clock (a VIEWER watch delivers nothing across
				// processes — measured). An owner pane pays none of this.
				spoolDb: dbPath,
				clientName: `pane-${process.pid}`,
				rereadMs: 1000,
				attachWaitMs: 20_000,
			}
			: {}),
});
console.log(`Durable session: ${dbPath}${attached ? " (ATTACHED — read-only; input routes to pi.inbox)" : ""}`);

// pi's main() initializes the theme before constructing the TUI; do the same so component styling
// matches the settings rather than library defaults.
ca.initTheme(services.settingsManager.getTheme(), true);

const mode = new ca.InteractiveMode(runtime, { tuiMode: "regular", initialThemeSetting: "dark" });
await mode.run();
