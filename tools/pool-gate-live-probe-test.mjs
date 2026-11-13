// tools/pool-gate-live-probe-test.mjs — the live-store gate probe has to be runnable, honest about what it refuses,
// and provably read-only on the store it copies.
//
// WHY THIS FILE EXISTS. `tools/pool-gate-live-probe.mjs` is the artifact that answers "does the 70 % gate refuse a
// project-tier pool row for THIS rig's seats, with the split instruction" without asking a seat to mint anything.
// An instrument with no reader drifts silently: it could stop minting the row, stop finding the refusal, or start
// writing to the source store, and nothing would fail. This drives it against a fixture store with a KNOWN roster
// and asserts the three things a reader needs: exit 0, the refusal string for each seat's OWN window, and the
// source file's bytes unchanged.
//
// FAILING-FIRST: before the probe exists there is no file to spawn, so this test fails at the spawn.
//
// Run: node tools/pool-gate-live-probe-test.mjs   (exit 0 = pass)
// Cost: measured 2026-11-13 on Linux / Fedora Linux 45 / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — ~2.5 s
// (fixture store + one probe run; no live store, no network).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { registerSeat, Router, Seats } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "pool-gate-probe-fixture-"));
const db = join(dir, "fixture.sqlite");

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
}

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = await openNodeSqliteStorage(db);
const harness = await Harness.open(storage, { models, registry }, ctx);

// The roster the probe will measure: the same shape as the live one (a wide seat and a verifier-class seat).
await harness.commit(async (tx) => {
	for (const [name, caps, window] of [
		["pm", ["route", "plan"], 164320],
		["impl", ["implement", "code"], 164320],
		["auditor", ["verify"], 12288],
	]) {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, name, c.id, name);
		const s = await tx.doc(Seats);
		s.seats[name].capabilities = caps;
		s.seats[name].usableWindow = window;
	}
	(await tx.doc(Seats)).tierTokens = { trivial: 3400, small: 6100, feature: 6200, project: 120000 };
}, ctx);
await harness.close?.(ctx);

const shaBefore = createHash("sha256").update(readFileSync(db)).digest("hex");
const run = spawnSync("node", ["tools/pool-gate-live-probe.mjs", "--db", db], { encoding: "utf8", timeout: 300_000 });
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;

console.log("\n=== the probe runs against a store and refuses the project row for each seat's own window ===");
check("the probe exits 0", run.status === 0, out.slice(-600));
check("it copies the store rather than opening it for the probe's writes", /MB copied/.test(out), out.slice(0, 300));
check(
	"the refusal names the wide seat's own window",
	out.includes("too-big:project(120000 tokens > 70% of the 164320-token usable window)"),
	out.slice(-800),
);
check(
	"and the verifier seat's window, in the same run",
	out.includes("too-big:project(120000 tokens > 70% of the 12288-token usable window)"),
	out.slice(-800),
);
check("the refusal carries the split instruction naming the row", /complete_work\(itemId: \d+, closedAs: "split", children: \[\.\.\.\]\)/.test(out), out.slice(-800));
check("it reports the row unclaimable by every seat in the fixture", /unclaimable by every one of the 3 seats|unclaimableByAnyone/.test(out) || /ok {3}the census reports the row unclaimable/.test(out), out.slice(-800));
check("it prints its own elapsed seconds", /elapsed: [\d.]+ s/.test(out), out.slice(-300));

console.log("\n=== and it does not write to the store it was pointed at ===");
const shaAfter = createHash("sha256").update(readFileSync(db)).digest("hex");
check("the fixture store is byte-identical after the probe", shaBefore === shaAfter, `${shaBefore} vs ${shaAfter}`);
check("the probe says so itself", /ok {3}THE LIVE STORE'S MAIN FILE IS BYTE-IDENTICAL/.test(out), out.slice(-800));

console.log("\n=== a roster the gate cannot measure is REFUSED, not reported as refused-for-everyone ===");
const bad = join(dir, "no-window.sqlite");
const s2 = await openNodeSqliteStorage(bad);
const h2 = await Harness.open(s2, { models, registry }, ctx);
await h2.commit(async (tx) => {
	const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, "impl", c.id, "impl");
	const s = await tx.doc(Seats);
	s.seats.impl.capabilities = ["implement"];
	(await tx.doc(Seats)).tierTokens = { project: 120000 };
}, ctx);
await h2.close?.(ctx);
const run2 = spawnSync("node", ["tools/pool-gate-live-probe.mjs", "--db", bad], { encoding: "utf8", timeout: 300_000 });
check("a seat with no declared window makes the probe exit 2 with the reason", run2.status === 2 && /declare no usable window/.test(`${run2.stdout}${run2.stderr}`), `${run2.status}: ${`${run2.stdout}${run2.stderr}`.slice(-400)}`);

console.log(failures === 0 ? "\nPOOL GATE LIVE PROBE TEST PASS (refusals per seat, split instruction, source untouched, unmeasurable roster refused)" : `\nPOOL GATE LIVE PROBE TEST FAIL — ${failures} check(s)`);
rmSync(dir, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
