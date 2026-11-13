// demo/genlock-lander-liveness.test.mjs — #5020: the landing serialiser's live-holder probe and
// the lease layer must use ONE liveness rule, and the demo proves they do by making a lease move
// in one place and watching BOTH surfaces move with it.
//
// WHY THIS SHAPE. "The lander honours the genlock" is a claim about a data path. Before this row,
// scripts/land.mjs carried its OWN copy of the rule — `typeof holder.pid === "number" &&
// pidAlive(holder.pid)` — while src/genlock.mjs next to it used the shared `ownerState` rule
// (#6182: a record that names no usable owner is NOT evidence anyone is gone). Those rules differ
// on one input: a lease whose owner cannot be resolved. genlock would not steal it (the cap holds);
// the lander counted it as free and printed `liveHolders: 0` beside a lease the rig is honouring.
// Equal counts on a clean fixture prove nothing, because both rules agree there; the discriminating
// case is the unresolvable owner, so the demo pins all four states and then MUTATES one slot.
//
// THE OTHER HALF OF THE ACCEPTANCE is measured, not asserted: a seat driven by the deprecated
// `cli.mjs send` path — the non-broker path this row says is unleased — is run against a scratch
// store and the lease is sampled while the generation is in flight.
//
// Run: node demo/genlock-lander-liveness.test.mjs  (exit 0 = pass)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { acquireAllSlotsSync, liveGenerationHolders } from "../src/genlockreserve.mjs";
import { readGenerationSlots, withGenerationSlot } from "../src/genlock.mjs";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const dir = mkdtempSync(join(tmpdir(), "durig-genlock-liveness-"));
const db = join(dir, "rig.sqlite");
const slots = (n) => join(dir, `rig.sqlite.genlock.${n}`);
function safeParse(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

/** A pid the OS confirms is gone: run a child to completion and wait for ESRCH. */
async function confirmedDeadPid() {
	const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
	await new Promise((res) => child.on("exit", res));
	const pid = child.pid;
	for (let i = 0; i < 200; i += 1) {
		try {
			process.kill(pid, 0);
		} catch (err) {
			if (err?.code === "ESRCH") return pid;
		}
		await new Promise((res) => setTimeout(res, 10));
	}
	return null; // could not confirm; the demo fails loudly rather than pretending
}

try {
	console.log("\n=== four leases, one rule ===");
	const dead = await confirmedDeadPid();
	check("a confirmed-dead pid was obtained for the dead arm", dead !== null, String(dead));

	writeFileSync(slots(0), JSON.stringify({ pid: process.pid, seat: "live", since: new Date().toISOString() }));
	writeFileSync(slots(1), JSON.stringify({ pid: dead, seat: "gone", since: new Date().toISOString() }));
	writeFileSync(slots(2), JSON.stringify({ seat: "ownerless", since: new Date().toISOString() })); // #6182: unknown != dead
	writeFileSync(slots(3), '{"pid":'); // torn write: not a record at all
	writeFileSync(join(dir, "rig.sqlite.genlock.priority"), JSON.stringify({ pid: process.pid, seat: "lander", priority: true }));

	// SURFACE A: the probe scripts/land.mjs now calls.
	const lander = () => liveGenerationHolders(db).map((h) => Number(h.path.split(".").pop()));
	// SURFACE B: the lease layer's own view of the same files.
	const lease = () => readGenerationSlots(db, 4).map((s) => ({ slot: s.slotIndex, stale: s.stale }));

	const a = lander();
	const b = lease();
	check("the lander counts the live owner and the ownerless lease, not the dead one", JSON.stringify(a.sort()) === "[0,2]", JSON.stringify(a));
	check("the lander does not count its own priority reservation as a holder", !a.includes(4) && a.length === 2, JSON.stringify(a));
	check(
		"the lease layer agrees slot by slot: 0 live, 1 stale, 2 NOT stale, 3 stale",
		b.find((s) => s.slot === 0)?.stale === false && b.find((s) => s.slot === 1)?.stale === true && b.find((s) => s.slot === 2)?.stale === false && b.find((s) => s.slot === 3)?.stale === true,
		JSON.stringify(b),
	);
	check(
		"the two surfaces name the SAME live slots (the divergence this row is about)",
		JSON.stringify(a.sort()) === JSON.stringify(b.filter((s) => !s.stale).map((s) => s.slot).sort()),
		`lander ${JSON.stringify(a)} vs lease ${JSON.stringify(b)}`,
	);
	check("the ownerless lease carries its STATE, so a report can say why it blocks", liveGenerationHolders(db).some((h) => h.state === "unknown" && h.seat === "ownerless"), JSON.stringify(liveGenerationHolders(db)));

	// NEGATIVE CONTROL: reproduce the rule scripts/land.mjs used before this row (a numeric,
	// signalable pid) and show it DISAGREES with the shared rule on exactly one slot - the one whose
	// owner the record cannot name. Without this, the demo would only be comparing two functions that
	// agree everywhere, which is the quiet-fixture equality that proves nothing.
	const oldLanderRule = (rec) => rec && typeof rec.pid === "number" && (() => { try { process.kill(rec.pid, 0); return true; } catch (err) { return err?.code !== "ESRCH"; } })();
	const oldCount = [0, 1, 2, 3].filter((i) => oldLanderRule(safeParse(slots(i))));
	check("the old lander rule counts the ownerless lease as FREE while the lease layer calls it LIVE", oldCount.includes(2) === false && b.find((s) => s.slot === 2)?.stale === false, `old rule: ${JSON.stringify(oldCount)}, lease layer: ${JSON.stringify(b)}`);

	console.log("\n=== MUTATION: move one lease's owner, both surfaces move together ===");
	writeFileSync(slots(2), JSON.stringify({ pid: dead, seat: "ownerless", since: new Date().toISOString() }));
	const a2 = lander();
	const b2 = lease();
	check("the lander drops it", !a2.includes(2), JSON.stringify(a2));
	check("the lease layer drops it in the same breath", b2.find((s) => s.slot === 2)?.stale === true, JSON.stringify(b2));
	check("and they still agree", JSON.stringify(a2.sort()) === JSON.stringify(b2.filter((s) => !s.stale).map((s) => s.slot).sort()), `${JSON.stringify(a2)} vs ${JSON.stringify(b2)}`);

	writeFileSync(slots(1), JSON.stringify({ pid: process.pid, seat: "resurrected", since: new Date().toISOString() }));
	const a3 = lander();
	const b3 = lease();
	check("a live pid on the dead slot moves BOTH surfaces back", a3.includes(1) && b3.find((s) => s.slot === 1)?.stale === false, `${JSON.stringify(a3)} vs ${JSON.stringify(b3)}`);

	console.log("\n=== a count is not a guard: the lander's claim must actually be blocked ===");
	// Fresh store so the claim loop sees only the lease under test.
	const waitDb = join(dir, "wait.sqlite");
	const claim = { pid: 999_999, seat: "lander" };
	const held = withGenerationSlot({ dbPath: waitDb, slots: 1, seat: "generation-in-flight" }, () => new Promise((r) => setTimeout(r, 2500)));
	await new Promise((r) => setTimeout(r, 400)); // the holder has claimed slot 0
	let outcome;
	try {
		acquireAllSlotsSync(waitDb, 1, claim, { waitMs: 1200, pollMs: 100 });
		outcome = "CLAIMED the slot a live generation holds";
	} catch (err) {
		outcome = String(err?.message ?? err);
	}
	check("the lander cannot take a slot the lease layer calls live", /timed out/.test(outcome), outcome);
	await held;
	let reclaimed;
	try {
		reclaimed = acquireAllSlotsSync(waitDb, 1, { pid: 999_998, seat: "lander" }, { waitMs: 2000, pollMs: 100 });
		check("once the generation releases, the same claim succeeds", reclaimed.length === 1, JSON.stringify(reclaimed));
	} catch (err) {
		check("once the generation releases, the same claim succeeds", false, String(err?.message ?? err));
	}

	console.log("\n=== the non-broker (cli.mjs send) path measured end to end ===");
	const rigDir = join(dir, "rig");
	mkdirSync(rigDir, { recursive: true });
	const sendDb = join(rigDir, "sendrig.sqlite");
	writeFileSync(join(rigDir, "rig.json"), JSON.stringify({ seats: [{ name: "impl", role: "implementation engineer" }] }));
	const run = (args) =>
		new Promise((res) => {
			const p = spawn(process.execPath, [CLI, ...args], { cwd: rigDir, env: { ...process.env, DURIG_DB: sendDb, DURIG_PROVIDER: "faux", DURIG_MAX_CONCURRENT_SEATS: "1" } });
			let out = "";
			p.stdout.on("data", (c) => (out += c));
			p.stderr.on("data", (c) => (out += c));
			p.on("exit", (code) => res({ code, out }));
		});
	const up = await run(["up", "rig.json"]);
	check("the scratch rig came up", up.code === 0, up.out.slice(0, 300));

	const send = spawn(
	 process.execPath,
	 [CLI, "send", "impl", "hello rig"],
	 { cwd: rigDir, env: { ...process.env, DURIG_DB: sendDb, DURIG_PROVIDER: "faux", DURIG_MAX_CONCURRENT_SEATS: "1", DURIG_FAUX_DELAY_MS: "4000" } },
	);
	let seen = null;
	for (let i = 0; i < 14; i += 1) {
		const holders = liveGenerationHolders(sendDb);
		if (holders.length > 0) {
		seen = holders[0];
		break;
	}
	await new Promise((r) => setTimeout(r, 400));
	}
	check("a generation driven by `cli.mjs send` holds a genlock lease while it runs", seen !== null, "no slot file appeared within ~5.6s");
	check("the lease names the seat driving it", seen?.seat === "impl", JSON.stringify(seen));
	check("the lander's probe is the function that sees it (same call the guard uses)", liveGenerationHolders(sendDb).length > 0, JSON.stringify(liveGenerationHolders(sendDb)));
	await new Promise((r) => send.on("exit", r));
	const after = liveGenerationHolders(sendDb);
	check("the lease is released when the generation ends", after.length === 0, JSON.stringify(after));

	console.log(
		failures === 0
			? "\nGENLOCK LIVENESS PASS (one rule shared by the lander and the lease layer; the send path measured end to end)"
			: `\nGENLOCK LIVENESS FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
