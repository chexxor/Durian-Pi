#!/usr/bin/env node
// tools/pool-gate-live-probe.mjs — N19 "The Pool": the 70 % size gate, refusing a `project`-tier pool row for the
// seats on THIS rig, from a byte-copy of the LIVE store.
//
// WHY THIS EXISTS (the gap it closes). `demo/pool-gate-live-roster.test.mjs` proves the gate against the live
// ROSTER but on an empty fixture store, and the live rig could not show the gate firing at all: only the `project`
// tier (120000) exceeds 70 % of any window here (Math.floor(0.7*164320) = 115023; 8601 for the auditor), the wake
// selector SKIPS an oversized row instead of attempting it, and `size-refused` is written only on a NAMED claim
// (D275 addendum (c)). `pm` and `lead` were asked six times to mint the one row that would make it observable live
// and did not; a delegate may not pool a row. So this probe runs the SHIPPED verbs against a COPY of the live
// store: the queue document, the roster, the tier table and every row are the live ones, the only invented object is
// the one project row, and the source store is proven byte-identical before and after.
//
// WHAT IT DOES NOT CLAIM: that a live seat was refused during a real working turn. The row is minted by the probe;
// what is live is the store, the roster and the shipped claim path. State it that way in any report.
//
// COST: one file copy (the store is ~800 MB on this rig) + one pi-durable open + two faux seat turns.
// Measured 2026-11-13 on Linux / Fedora Linux 45 / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1: see the `elapsed:`
// line it prints (it reports its own seconds, including the copy).
//
// READ-ONLY ON THE SOURCE BY CONSTRUCTION: the source is copied, never opened for writing; sha256 is compared before
// and after both files, and a mismatch exits 1.
//
// Usage:
//   node tools/pool-gate-live-probe.mjs [--db ./selfdev.sqlite] [--keep]
// Exit: 0 the gate refused every seat exactly as the code says; 1 the source changed or an assertion failed;
//       2 no store / unreadable roster.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { poolCensus } from "../src/readapi.mjs";
import { RigQueue, Router, Seats, sizeVerdict } from "../src/rig.mjs";

const args = process.argv.slice(2);
const dbArg = args.indexOf("--db");
const db = resolve(dbArg >= 0 ? args[dbArg + 1] : "./selfdev.sqlite");
const keep = args.includes("--keep");
const start = Date.now();

if (!existsSync(db)) {
	console.error(`pool-gate-live-probe: no store at ${db} (this probe needs the LIVE store to copy; use demo/pool-gate-live-roster.test.mjs for the hermetic roster proof)`);
	process.exit(2);
}
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const sidecars = ["-wal", "-shm"].filter((s) => existsSync(db + s));
const before = Object.fromEntries([["", db], ...sidecars.map((s) => [s, db + s])].map(([k, p]) => [k || "db", sha(p)]));

const dir = mkdtempSync(join(tmpdir(), "pool-gate-live-"));
const copy = join(dir, "copy.sqlite");
copyFileSync(db, copy);
for (const s of sidecars) copyFileSync(db + s, copy + s);
const copyBytes = statSync(copy).size;

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = await openNodeSqliteStorage(copy);
const harness = await Harness.open(storage, { models, registry }, ctx);

// The live roster, from the copy. Refuse to proceed on a roster the gate cannot measure: a probe that reports
// "refused" for seats with no window would be reporting a different thing than the one it claims.
const seats0 = await harness.snapshot(Seats, undefined, ctx);
const live = seats0?.seats ?? {};
const tierTokens = seats0?.tierTokens ?? null;
const names = Object.keys(live);
const withoutWindow = names.filter((n) => !Number.isFinite(live[n]?.usableWindow) || live[n].usableWindow <= 0);
if (names.length === 0 || !tierTokens) {
	console.error("pool-gate-live-probe: the store carries no seats or no tierTokens; run `node cli.mjs up <rig> --refresh` first");
	process.exit(2);
}
if (withoutWindow.length) {
	console.error(`pool-gate-live-probe: ${withoutWindow.length} seat(s) declare no usable window (${withoutWindow.join(", ")}); the gate is disarmed for them and a "refused" claim would be false`);
	process.exit(2);
}

// FRESH CONVERSATIONS, LIVE ROSTER ENTRIES. A seat's live conversation holds thousands of entries; replaying it
// into a faux model would be minutes of noise and would prove nothing about the claim path. Only `conversationId`
// is repointed (for the two seats this probe drives); capability sets, windows and the tier table stay the store's.
const driven = ["pm", "impl", "auditor"].filter((n) => live[n]);
if (!driven.includes("pm") || !driven.includes("impl")) {
	console.error(`pool-gate-live-probe: the roster has no pm/impl seat (has: ${names.join(", ")})`);
	process.exit(2);
}
await harness.commit(async (tx) => {
	const doc = await tx.doc(Seats);
	for (const name of driven) {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: `You are the ${name} seat.` });
		doc.seats[name].conversationId = c.id;
	}
}, ctx);

const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const queueOf = async () => (await harness.snapshot(RigQueue, undefined, ctx))?.items ?? [];
async function transcript(name) {
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const pg = await c.entries({}, 80, undefined, ctx);
	return pg.items.map((e) => JSON.stringify(e)).join("\n");
}
async function call(name, toolName, toolArgs) {
	faux.appendResponses([fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("done"))]);
	const c = await harness.conversation(roster[name].conversationId, ctx);
	return (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
}
const refusalOf = (text) => {
	const at = text.indexOf("CLAIM_REFUSED");
	if (at < 0) return null;
	const quoted = text.slice(at).replace(/\\n/g, "\n").replace(/\\"/g, '"');
	const end = quoted.indexOf("not a queue problem.");
	return end > 0 ? quoted.slice(0, end + "not a queue problem.".length) : quoted.slice(0, 700);
};

console.log("pool-gate-live-probe — the 70 % size gate, on a COPY of the live store");
console.log(`store: ${db} (${(copyBytes / 1024 / 1024).toFixed(1)} MB copied, sidecars: ${sidecars.join(",") || "none"})`);
console.log(`roster: ${names.length} seats, every one declaring a window; tier table ${JSON.stringify(tierTokens)}`);

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(ok ? `  ok   ${label}` : `  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	if (!ok) failures += 1;
};

await call("pm", "send_work", {
	pool: true,
	tier: "project",
	subject: "POOL PROBE (project tier): the size gate must refuse this",
	body: "Deliberately oversized; minted by the probe to make the 70 % gate observable on the live roster. Nobody should work it.",
});
const probe = (await queueOf()).find((it) => String(it.subject ?? "").includes("POOL PROBE (project tier)"));
check("the row is OPEN in the pool with the project tier", probe?.pool === true && probe?.to === null && probe?.tier === "project", JSON.stringify({ id: probe?.id, to: probe?.to, tier: probe?.tier }));

// Taken AFTER the mint and BEFORE any claim: what must not move is the CLAIMED count.
const censusBefore = poolCensus(await queueOf(), names.map((n) => ({ name: n, usableWindow: roster[n].usableWindow })), tierTokens);

for (const seat of driven.filter((n) => n !== "pm")) {
	await call(seat, "claim_work", { itemId: probe.id });
	const quoted = refusalOf(await transcript(seat));
	const want = sizeVerdict(probe, { tierTokens, usableWindow: roster[seat].usableWindow }).reason;
	console.log(`  CLAIM_REFUSED (${seat}, live window ${roster[seat].usableWindow}, row #${probe.id}):\n    ${quoted ?? "(no refusal found)"}`);
	check(`${seat}'s refusal carries the shipped reason for ITS window (${want})`, quoted?.includes(want) === true, quoted ?? "none");
	check(`${seat}'s refusal carries the split instruction naming row #${probe.id}`, quoted?.includes(`complete_work(itemId: ${probe.id}, closedAs: "split", children: [...])`) === true, quoted ?? "none");
}

const after = (await queueOf()).find((it) => it.id === probe.id);
const refusals = after?.transitions?.filter((t) => t.event === "size-refused") ?? [];
check("the row is still queued and still OPEN (a refusal is not a claim)", after?.status === "queued" && after?.to === null, JSON.stringify({ status: after?.status, to: after?.to }));
check(`one size-refused transition per seat that named it (${refusals.length})`, refusals.length === driven.length - 1 && refusals.every((t) => t.reason?.startsWith("too-big:project(")), JSON.stringify(refusals.map((t) => `${t.by}:${t.reason}`)));

const census = poolCensus(await queueOf(), names.map((n) => ({ name: n, usableWindow: roster[n].usableWindow })), tierTokens);
const big = census.tooBig.find((t) => t.id === probe.id);
check(`the census reports the row unclaimable by every one of the ${names.length} seats`, big?.tooBigFor?.length === names.length && big?.unclaimableByAnyone === true, JSON.stringify(big));
// The store already holds the rig's own claimed pool rows (#7667, #7669), so the invariant is not "zero claims":
// it is that a REFUSED claim leaves the census exactly as it was (the probe row counts as open before and after).
check(
	`a refused claim leaves the census unchanged (${censusBefore.rows} pooled, ${censusBefore.open} open, ${censusBefore.claimed} claimed before the claims)`,
	census.rows === censusBefore.rows && census.open === censusBefore.open && census.claimed === censusBefore.claimed,
	JSON.stringify({ before: censusBefore, after: { rows: census.rows, open: census.open, claimed: census.claimed } }),
);

await harness.close?.(ctx);
if (!keep) rmSync(dir, { recursive: true, force: true });

// THE SOURCE IS ONLY READ, and the proof has to be honest about who else writes: a resident broker commits into the
// store, so `-wal`/`-shm` MOVE under any observer and their hash is not evidence about this tool. The main database
// file is the checkable one (a copied-then-opened store would grow it), and the tool's only source access is
// `readFileSync`/`copyFileSync` — it opens the COPY with pi-durable, never the source.
const afterMain = sha(db);
check("THE LIVE STORE'S MAIN FILE IS BYTE-IDENTICAL before and after (the probe only reads it)", before.db === afterMain, JSON.stringify({ before: before.db, after: afterMain }));
console.log(`  note: -wal/-shm are the LIVE broker's (it is a writer); their hashes are not evidence about this tool (${sidecars.map((s) => `${s} ${before[s] === (existsSync(db + s) ? sha(db + s) : null) ? "unchanged" : "moved"}`).join(", ") || "none present"})`);
console.log(`  elapsed: ${((Date.now() - start) / 1000).toFixed(1)} s${keep ? ` (copy kept at ${copy})` : ""}`);
console.log(failures === 0 ? "\nPOOL GATE LIVE PROBE PASS (project refused for the live seats' own windows, source untouched)" : `\nPOOL GATE LIVE PROBE FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
