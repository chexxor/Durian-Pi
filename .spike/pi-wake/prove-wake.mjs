/**
 * Spike #209 proof driver — falsifiable in BOTH directions.
 *
 *   (a) watcher ENABLED  -> a matching durig event (a queued item for the seat)
 *       makes the Pi session receive an injected message and START A TURN.
 *   (b) watcher DISABLED -> the same durig event produces NO injected turn.
 *
 * Method: run the real global Pi headlessly in RPC mode
 *   node <pi bundle cli.js> --mode rpc --no-session -e watcher.ts
 * parse its JSONL stdout, and look for a turn started by the extension's
 * `pi.sendUserMessage(WAKE_CONTENT)`. A turn is proven by a `message_start`
 * with `message.role === "user"` whose content is the wake string, followed by
 * `turn_start` / an assistant `message_start`.
 *
 * The driver does NOT drive the durig seat. It only enqueues a queued item
 * (setup-queued-item.mjs) so `durig watch --once --json` surfaces it.
 *
 * Usage: node .spike/pi-wake/prove-wake.mjs
 * Exit 0 = both directions behaved as required.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PI_CLI =
	process.env.DURIG_SPIKE_PI_CLI ??
	"C:\\Users\\Alex\\.pi\\agent\\install\\releases\\1.1.0\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js";

const SEAT_ROOT = process.cwd();
const CLI = join(SEAT_ROOT, "cli.mjs");
const EXT = join(SEAT_ROOT, ".spike", "pi-wake", "watcher.ts");
const SETUP = join(SEAT_ROOT, ".spike", "pi-wake", "setup-queued-item.mjs");

const WAKE_CONTENT =
	"durig: queued work is waiting. Call claim_work to take the oldest item addressed to you.";

const SEAT = "impl";
const OBSERVE_MS = 30000; // time to observe a wake turn after the event is enqueued

function runPi({ db, disabled }) {
	const env = {
		...process.env,
		DURIG_DB: db,
		DURIG_SPIKE_CLI: CLI,
		DURIG_SPIKE_SEAT: SEAT,
		DURIG_SPIKE_POLL_MS: "400",
		...(disabled ? { DURIG_SPIKE_DISABLED: "1" } : {}),
	};
	const child = spawn(process.execPath, [PI_CLI, "--mode", "rpc", "--no-session", "-e", EXT], {
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const records = [];
	let buf = "";
	child.stdout.on("data", (c) => {
		buf += c.toString("utf8");
		let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			if (!line.startsWith("{")) continue;
			try {
				records.push(JSON.parse(line));
			} catch {
				/* ignore non-JSON noise */
			}
		}
	});
	const stderr = [];
	child.stderr.on("data", (c) => stderr.push(c.toString("utf8")));
	return { child, records, stderr };
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/** Did an extension-injected turn start, evidenced by the wake content in a user message? */
function wakeTurnEvidence(records) {
	const userMsg = records.find(
		(r) =>
			r.type === "message_start" &&
			r.message?.role === "user" &&
			JSON.stringify(r.message?.content ?? "").includes(WAKE_CONTENT),
	);
	const turnStart = records.some((r) => r.type === "turn_start");
	return { userMsg, turnStart };
}

function enqueue(db, subject) {
	const r = spawnSync(process.execPath, [SETUP, db, SEAT, subject], {
		env: { ...process.env, DURIG_DB: db, DURIG_PROVIDER: "faux" },
		encoding: "utf8",
		cwd: SEAT_ROOT,
	});
	return { code: r.status, stdout: r.stdout?.trim(), stderr: r.stderr?.trim() };
}

async function runDirection(side, disabled) {
	const dir = mkdtempSync(join(tmpdir(), `durig-209-${side}-`));
	const db = join(dir, "rig.sqlite");
	console.log(`\n===== DIRECTION ${side} (watcher ${disabled ? "DISABLED" : "ENABLED"}) =====`);
	console.log(`db=${db}`);
	const { child, records, stderr } = runPi({ db, disabled });

	// Let the session start and (when enabled) the watcher open the change source.
	await sleep(6000);
	console.log(`[${side}] pi session started; records so far=${records.length}`);

	// The durig event: enqueue one queued item for the watched seat.
	const enq = enqueue(db, `SPIKE209_${side.toUpperCase()}`);
	console.log(`[${side}] enqueue -> exit=${enq.code} ${enq.stdout}${enq.stderr ? " ERR:" + enq.stderr.slice(0, 200) : ""}`);

	// Observe.
	await sleep(OBSERVE_MS);
	try { child.kill(); } catch {}

	const ev = wakeTurnEvidence(records);
	const types = records.map((r) => r.type);
	const sawTurnStart = ev.turnStart;
	const sawWakeUser = Boolean(ev.userMsg);

	// Diagnostics (raw, not a summary).
	console.log(`[${side}] record types seen: ${[...new Set(types)].join(",")}`);
	console.log(`[${side}] wake user message injected: ${sawWakeUser}`);
	console.log(`[${side}] turn_start observed: ${sawTurnStart}`);
	if (ev.userMsg) {
		console.log(`[${side}] injected user message: ${JSON.stringify(ev.userMsg.message).slice(0, 200)}`);
	}
	const watcherLines = stderr.join("").split(/\r?\n/).filter((l) => l.includes("[spike-watcher]"));
	console.log(`[${side}] watcher stderr:\n  ${watcherLines.join("\n  ")}`);

	try { rmSync(dir, { recursive: true, force: true }); } catch {}

	return { sawTurnStart, sawWakeUser, watcherLines, stderrAll: stderr.join("") };
}

const a = await runDirection("a", false);
const b = await runDirection("b", true);

console.log("\n===== VERDICT =====");
const passA = a.sawWakeUser && a.sawTurnStart;
const passB = !b.sawWakeUser && b.watcherLines.some((l) => l.includes("disabled"));
console.log(`(a) watcher enabled  -> wake user msg=${a.sawWakeUser}, turn_start=${a.sawTurnStart}  => ${passA ? "PASS" : "FAIL"}`);
console.log(`(b) watcher disabled -> wake user msg=${b.sawWakeUser}  => ${passB ? "PASS" : "FAIL"}`);
process.exit(passA && passB ? 0 : 1);
