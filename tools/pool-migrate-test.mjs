// tools/pool-migrate-test.mjs — the pool-migration PROPOSAL instrument: every verdict class is
// non-vacuous, the arithmetic balances, and the store is untouched.
//
// WHY THIS FILE EXISTS. `tools/pool-migrate.mjs` is the instrument the operator reads before deciding
// whether the backlog can be pooled at all (measured 2026-11-13: 846 queued rows, 0 pooled, 7 carrying
// `requires`). An instrument that classifies rows is only as good as the proof that each class it names
// can actually occur — a class that never fires is a bug dressed as a category — and a tool that claims
// "read-only" must be shown not to write.
//
// FAILING-FIRST: before the tool exists there is no `--dry-run` to run, so every assertion here fails.
//
// Run: node tools/pool-migrate-test.mjs  (exit 0 = pass)
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, configure } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { enqueueItem, registerSeat, RigQueue, Router, Seats } from "../src/rig.mjs";
import { poolProposal, VERDICTS } from "../tools/pool-migrate.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "pool-migrate-"));
const db = join(dir, "fixture.sqlite");

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const sqlite = await openNodeSqliteStorage(db);
const harness = await Harness.open(sqlite, { models, registry }, ctx);

// Every class the tool names, with a row that reaches it. The roster is deliberately small so the
// capability arithmetic is checkable by eye: only impl advertises `code`.
await harness.commit(
	async (tx) => {
		for (const [name, role, caps] of [["impl", "implementation engineer", ["implement", "code"]], ["qa", "verifier", ["verify", "review"]], ["scribe", "scribe", ["implement"]]]) {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, role);
			const s = await tx.doc(Seats);
			s.seats[name].capabilities = caps;
			s.seats[name].usableWindow = 10000;
		}
		const q = await tx.doc(RigQueue);
		// enqueueItem assigns ids from queue.nextId and returns nothing, so the id is read before the call.
		const mk = async (to, subject, body, over = {}) => { const id = q.nextId; await enqueueItem(tx, "pm", to, subject, body, null, over.notice ?? false, over.tier ?? null, false, over.blockedBy ?? null, over.requires ?? null, null, over.pool ?? false); return id; };
		const doneGate = await mk("qa", "The prerequisite that finished", "gate row", { tier: "trivial" });
		const deadGate = await mk("qa", "The prerequisite that was cancelled", "gate row", { tier: "trivial" });
		// The gates are gated on while still queued: enqueueItem REFUSES a gate naming a cancelled row
		// (#6215), so the dead-gate state is created afterwards, exactly as it arose on the live store
		// before that rule existed.
		await mk("qa", "Waiting on the finished gate", "open gate", { tier: "small", blockedBy: [doneGate] }); // blocked (live)
		await mk("qa", "Waiting on a cancelled gate", "dead gate", { tier: "small", blockedBy: [deadGate] }); // blocked (dead)
		await mk(null, "An already pooled row", "provenance only", { tier: "trivial", pool: true }); // already-pooled
		await mk("qa", "DONE #7: shipped", "a notice, not work", { notice: true }); // notice
		await mk("qa", "No tier at all", "the size gate cannot measure it"); // untiered-or-oversized
		await mk("qa", "A project for a 10k window", "tier project ~ 120000 tokens", { tier: "project" }); // oversized
		await mk("impl", "Only impl can do this", "requires code, held by impl alone", { tier: "small" }); // single-owner
		await mk("scribe", "Scribe or impl could take it", "implement is shared", { tier: "small" }); // migratable
		await mk(null, "No addressee and no pool flag", "invisible to every claim path", { tier: "trivial" }); // unaddressed
		// Set AFTER the dependents are written: enqueueItem refuses a gate naming a CANCELLED row (#6215),
		// so the dead-gate state has to be created the way it arose on the live store - the gate closed later.
		q.items.find((i) => i.id === doneGate).status = "done";
		q.items.find((i) => i.id === deadGate).status = "cancelled";
	},
	ctx,
);
await harness.close(ctx);

const shaBefore = createHash("sha256").update(readFileSync(db)).digest("hex");
const filesBefore = readdirSync(dir).sort().join(",");

console.log("\nrunning the tool on the fixture store (no broker resident)");
const run1 = spawnSync("node", ["tools/pool-migrate.mjs", "--dry-run", "--db", db, "--all"], { encoding: "utf8", timeout: 60000 });
check("exit 0", run1.status === 0, run1.stderr.slice(0, 300));
const out1 = run1.stdout;
console.log(out1.split("\n").slice(0, 20).join("\n"));

const run2 = spawnSync("node", ["tools/pool-migrate.mjs", "--dry-run", "--db", db, "--limit", "1"], { encoding: "utf8", timeout: 60000 });
check("a second run also exits 0", run2.status === 0, run2.stderr.slice(0, 200));

console.log("\nevery named verdict class actually occurs");
for (const v of VERDICTS) check(`class "${v}" is non-vacuous`, out1.includes(`verdict=${v}`), out1.match(/verdict=\w+/g)?.join(","));
check("the balance line says the classes sum to the queued count", out1.includes("balance: OK"), out1.split("\n").find((l) => l.startsWith("  balance")));
check("the tool prints its own measured cost in seconds", /elapsed: \d+\.\d s/.test(out1), out1.match(/elapsed: [^\n]+/)?.[0]);
check("it names HOW it read the store (seam or read-only open)", /read via: (broker seam|no broker resident -> read-only open)/.test(out1), out1.split("\n")[1]);
const hostLine = out1.match(/host: [^\n]+/)?.[0] ?? "";
check("it states OS + distro + kernel + node, never a bare platform", /^host: \w+ \/ /.test(hostLine) && hostLine.includes("kernel ") && hostLine.includes("node v") && hostLine.split(" / ").length === 4, hostLine);
check("the distro is named, not reported as unknown", !hostLine.includes("distro unknown") && !hostLine.includes("kernel unknown"), hostLine);

console.log("\nthe store is untouched, and each row carries the proposal fields");
const shaAfter = createHash("sha256").update(readFileSync(db)).digest("hex");
check("the fixture store bytes are identical before and after the two runs", shaBefore === shaAfter, `${shaBefore.slice(0, 12)} vs ${shaAfter.slice(0, 12)}`);
// SQLite creates -wal/-shm sidecars on any open, read-only included, so "no new file" is the wrong
// test for "nothing was written": the bytes of the store are the evidence, plus a check that the tool
// creates an artifact ONLY when the operator asked for one with --json.
const storeFiles = () => readdirSync(dir).filter((f) => !f.endsWith("-wal") && !f.endsWith("-shm")).sort().join(",");
check("no new file appeared in the store directory (WAL sidecars excepted)", storeFiles() === filesBefore, storeFiles());
const jsonArtifact = join(dir, "proposal.json");
const runJson = spawnSync("node", ["tools/pool-migrate.mjs", "--dry-run", "--db", db, "--json", jsonArtifact], { encoding: "utf8", timeout: 60000 });
check("--json writes the artifact the operator asked for, and still exits 0", runJson.status === 0 && existsSync(jsonArtifact), runJson.stderr.slice(0, 200));
const artifact = existsSync(jsonArtifact) ? JSON.parse(readFileSync(jsonArtifact, "utf8")) : null;
const queuedInOutput = Number(out1.match(/queued: (\d+)/)?.[1] ?? -1);
check("the artifact carries the census, the tier table and every row's proposal fields", artifact?.proposal?.rows?.length === queuedInOutput && artifact?.census?.rows >= 1 && artifact?.proposal?.rows.every((r) => r.id !== undefined && r.verdict && Array.isArray(r.requires) && typeof r.reason === "string"), JSON.stringify({ queuedInOutput, firstRow: artifact?.proposal?.rows?.[0] }));
check("the store bytes are STILL identical after the --json run", createHash("sha256").update(readFileSync(db)).digest("hex") === shaBefore, "the json artifact changed the store");
check("--apply is refused by name (there is no write mode)", spawnSync("node", ["tools/pool-migrate.mjs", "--apply", "--db", db], { encoding: "utf8" }).status === 1);
check("running without --dry-run is refused with a usage line", spawnSync("node", ["tools/pool-migrate.mjs", "--db", db], { encoding: "utf8" }).status === 1);

// The pure classifier, so the precedence rule and the ownership-gap arithmetic are pinned without the
// process boundary. Row 1 and row 2 name artifacts the rig's ownership map assigns to impl, but the
// claimant the capability test offers is devtools - that is exactly the gap the tool is built to surface.
const proposal = poolProposal({
	items: [
		{ id: 1, status: "queued", from: "pm", to: "impl", subject: "patch src/tools/harness.mjs", tier: "small", requires: ["implement"], transitions: [] },
		{ id: 2, status: "queued", from: "pm", to: "impl", subject: "refresh docs/FEATURES.md", tier: "trivial", requires: ["implement"], transitions: [] },
		{ id: 3, status: "queued", from: "pm", to: "qa", subject: "DONE #7: shipped", notice: true, transitions: [] },
		{ id: 4, status: "queued", from: "pm", to: "impl", subject: "rewrite the whole project", tier: "project", transitions: [] },
		{ id: 5, status: "queued", from: "pm", to: "impl", subject: "waiting on a cancelled gate", tier: "small", blockedBy: [9], transitions: [] },
		{ id: 6, status: "queued", from: "pm", to: "impl", subject: "already pooled", tier: "small", pool: true, blockedBy: [9], transitions: [] },
		{ id: 7, status: "queued", from: "pm", to: "impl", subject: "only impl can do this", tier: "small", requires: ["code"], transitions: [] },
		{ id: 8, status: "queued", from: "pm", to: "qa", subject: "no tier at all", transitions: [] },
		{ id: 10, status: "queued", from: "pm", to: null, subject: "nobody is addressed and it is not pooled", tier: "trivial", transitions: [] },
		{ id: 11, status: "queued", from: "pm", to: "impl", subject: "blocked on the cancelled gate, src/tools/gate.mjs", tier: "small", requires: ["implement"], blockedBy: [9], transitions: [] },
		{ id: 9, status: "cancelled", from: "pm", to: "qa", subject: "the dead gate", transitions: [] },
	],
	seats: {
		impl: { capabilities: ["implement", "code"], usableWindow: 20000 },
		devtools: { capabilities: ["implement"], usableWindow: 10000 },
		qa: { capabilities: ["verify"], usableWindow: 5000 },
	},
	tierTokens: { trivial: 3400, small: 6100, feature: 6200, project: 120000 },
	ownership: { "src-tools-harness": ["impl"], "feature-docs": ["impl"] },
});
check("ten queued rows classify with no double counting (the cancelled gate row is not queued)", proposal.queued === 10 && proposal.balance === 10, JSON.stringify({ queued: proposal.queued, balance: proposal.balance, by: proposal.by }));
check("a shared capability set makes the row migratable, and names the other claimant", proposal.rows.find((r) => r.id === 1)?.verdict === "migratable" && proposal.rows.find((r) => r.id === 1)?.claimants?.join(",") === "devtools", JSON.stringify(proposal.rows.find((r) => r.id === 1)));
check("a notice outranks everything and an untiered row cannot be sized", proposal.rows.find((r) => r.id === 3)?.verdict === "notice" && proposal.rows.find((r) => r.id === 8)?.verdict === "untiered-or-oversized", JSON.stringify([proposal.rows.find((r) => r.id === 3)?.verdict, proposal.rows.find((r) => r.id === 8)?.verdict]));
check("a row with no addressee and no pool flag is unaddressed", proposal.rows.find((r) => r.id === 10)?.verdict === "unaddressed", JSON.stringify(proposal.rows.find((r) => r.id === 10)));
check("an oversized project row is caught against the declared window", proposal.rows.find((r) => r.id === 4)?.verdict === "untiered-or-oversized", JSON.stringify(proposal.rows.find((r) => r.id === 4)));
check("a gate naming a cancelled row is a DEAD gate, said in the reason", proposal.rows.find((r) => r.id === 5)?.reason.includes("dead gate: #9"), JSON.stringify(proposal.rows.find((r) => r.id === 5)));
check("pool provenance wins over a dead gate", proposal.rows.find((r) => r.id === 6)?.verdict === "already-pooled", JSON.stringify(proposal.rows.find((r) => r.id === 6)));
check("a set advertised by the addressee alone is single-owner, not migratable", proposal.rows.find((r) => r.id === 7)?.verdict === "single-owner", JSON.stringify(proposal.rows.find((r) => r.id === 7)));
check("the ownership gap is named, per row, with the non-owning claimant", proposal.gapRows.length === 2 && proposal.gapRows.every((r) => r.ownershipGap?.join(",") === "devtools"), JSON.stringify(proposal.gapRows.map((r) => ({ id: r.id, artifact: r.artifact, gap: r.ownershipGap }))));
check("the gap list is scoped to rows actually proposed for pooling: a blocked row with the same shape is not counted", proposal.rows.find((r) => r.id === 11)?.verdict === "blocked" && proposal.rows.find((r) => r.id === 11)?.ownershipGap?.join(",") === "devtools", JSON.stringify(proposal.rows.find((r) => r.id === 11)));
check("no seat is reported as window-less when every seat declares one", proposal.seatsWithoutWindow.length === 0 && proposal.largestWindow === 20000, JSON.stringify({ seatsWithoutWindow: proposal.seatsWithoutWindow, largestWindow: proposal.largestWindow }));
check("the gate is DISARMED when no seat declares a window, and says so", poolProposal({ items: [{ id: 1, status: "queued", to: "impl", subject: "project sized row", tier: "project", transitions: [] }], seats: { impl: { capabilities: ["implement", "code"] }, qa: { capabilities: ["implement", "code"] } }, tierTokens: { project: 120000 } }).rows[0].reason.includes("no seat declares a usable window"));

console.log(failures === 0 ? "\nPOOL-MIGRATE TOOL PASS (all classes occur, the arithmetic balances, nothing was written)" : `\nPOOL-MIGRATE TOOL FAIL — ${failures} check(s)`);
rmSync(dir, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
