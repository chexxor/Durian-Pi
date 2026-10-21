// tui.mjs — the durable-TUI entrypoint (Phase 1 of the merge plan, D101/D102).
//
// The real Pi TUI on a durable conversation, run as a NON-DEFAULT entrypoint (`npm run tui`) on its
// OWN store. `npm run ui` (ui.mjs, the poller) is untouched and remains the documented fallback; the
// two run at once with NO shared writer because this entrypoint FAILS CLOSED when a broker — or a
// live generation — owns its store (src/storeownership.mjs; the D42 / F24 second-writer collision).
//
// Store: `--db <path>` or DURIAN_PI_TUI_DB (DURIG_TUI_DB is the D103 deprecated alias). The default
// is `session.sqlite` beside this file, deliberately AWAY from the rig store — never selfdev.sqlite.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDurableTuiRuntime } from "./src/tui/durable/adapter.mjs";
import { createRealHost } from "./src/tui/durable/real-host.mjs";
import { assessStoreOwnership } from "./src/storeownership.mjs";

// Keep the TUI's own startup checks quiet; the provider extension still loads and registers, and
// requests still go to the configured provider.
process.env.PI_SKIP_VERSION_CHECK = "1";

const args = process.argv.slice(2);
function argValue(name) {
	const at = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
	if (at < 0) return null;
	const token = args[at];
	return token.includes("=") ? token.slice(token.indexOf("=") + 1) : args[at + 1] ?? null;
}

// D103 ships the new name; DURIG_TUI_DB is accepted as the deprecated alias with a warning. This is
// a single-var shim, not a general alias mechanism — the D103 loader owns the DURIG_* -> DURIAN_PI_*
// mapping (#2109).
let dbPath = argValue("--db");
if (!dbPath && process.env.DURIG_TUI_DB && !process.env.DURIAN_PI_TUI_DB) {
	console.error("tui: DURIG_TUI_DB is deprecated — use DURIAN_PI_TUI_DB");
}
dbPath ??=
	process.env.DURIAN_PI_TUI_DB ??
	process.env.DURIG_TUI_DB ??
	join(dirname(fileURLToPath(import.meta.url)), "session.sqlite");

// FAIL CLOSED, AND WITHOUT AN OVERRIDE (#4006). This entrypoint is a WRITER, so it must never open
// a store a broker owns, and never open "to check".
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
if (ownership.owned) {
	console.error(
		`tui: refusing to open ${dbPath} — ${ownership.reasons.join("; ")}. ` +
			`Stop the broker (serve --stop) and retry; a PAUSED broker is still the owner, so a pause alone is not a release.`,
	);
	process.exit(1);
}

const storage = await (await import("@earendil-works/pi-durable/storage/sqlite/node")).openNodeSqliteStorage(dbPath);

const cwd = process.cwd();
const { ca, hostSession, hostSessionManager, services, model } = await createRealHost({ cwd });

const { runtime } = await createDurableTuiRuntime({
	cwd: services.cwd,
	agentDir: services.agentDir,
	storage,
	models: services.modelRuntime,
	agentModel: { provider: model.provider, modelId: model.id },
	host: { hostSession, hostSessionManager, services },
});
console.log(`Durable session: ${dbPath}`);

// pi's main() initializes the theme before constructing the TUI; do the same so component styling
// matches the settings rather than library defaults.
ca.initTheme(services.settingsManager.getTheme(), true);

const mode = new ca.InteractiveMode(runtime, { tuiMode: "regular", initialThemeSetting: "dark" });
await mode.run();
