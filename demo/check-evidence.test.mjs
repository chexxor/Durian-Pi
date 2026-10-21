// demo/check-evidence.test.mjs — prove ROADMAP 48: verification must RE-EXECUTE
// evidence, not accept a claim (item #715; qa consult ruling #854).
//
// The mechanism has two halves and both are asserted here:
//   - `complete_work` gains an OPTIONAL structured `evidence` field
//     ({command, exitCode, artifact?}) recorded on the item beside the narrative
//     `resultSummary` — a claim is not evidence (W2);
//   - ONE `check` rule, `verification-without-evidence`, fails a completed
//     `VERIFY #N` item that carries no evidence and passes one that re-ran the
//     artifact.
// The CLI half is driven through the REAL `check` verb on a real store, so the
// wiring (cli.mjs reading the queue and passing it to auditRig) is exercised, not
// re-implemented.
//
// Run: node demo/check-evidence.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import {
	Constitution,
	Edges,
	RigQueue,
	Router,
	Seats,
	compilePersona,
	enqueueItem,
	registerSeat,
} from "../src/rig.mjs";
import { auditRig, hasArtifact, hasEvidence, isVerificationItem, namesCheckSubject } from "../src/checkup.mjs";

const ctx = BACKGROUND_CONTEXT;
const here = dirname(fileURLToPath(import.meta.url));
const durigDir = join(here, "..");

const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) if (k.startsWith("DURIG_")) delete cleanEnv[k];

const SPEC = {
	version: 2,
	seats: [
		{ name: "author", role: "implementation engineer", capabilities: ["implement", "code"], model: "faux/m1" },
		{ name: "qa", role: "independent verifier", capabilities: ["verify"], model: "faux/m2" },
	],
	edges: [
		{ from: "author", maySendTo: ["qa"] },
		{ from: "qa", maySendTo: ["author"] },
	],
	constitutionInline: "# constitution\nbe good\n",
};
const BASE = {
	rig: "rig.json",
	spec: SPEC,
	specConstitution: SPEC.constitutionInline,
	stored: { reason: "read", text: SPEC.constitutionInline },
	storedSeats: ["author", "qa"],
	modelsBySeat: { author: "faux/m1", qa: "faux/m2" },
};
const hasFinding = (result, id) => (result.findings ?? []).some((f) => f.id === id);
const ruleStatus = (result, id) => (result.checks ?? []).find((c) => c.id === id)?.status;

/* ─── 1. the marker + evidence helpers ───────────────────────────────────── */
console.log("\nhelpers — the ONE definition of a verification item and of evidence");
assert.equal(isVerificationItem({ subject: "VERIFY #806: runbooks" }), true, "VERIFY #N is a verification item");
assert.equal(isVerificationItem({ subject: "DONE #839: VERIFY #806: x" }), true, "a re-verification counts too");
assert.equal(isVerificationItem({ subject: "implement the widget" }), false, "ordinary work is not a verification item");
assert.equal(hasEvidence({ evidence: { command: "node x.test.mjs", exitCode: 0 } }), true);
assert.equal(hasEvidence({ evidence: { command: "  ", exitCode: 0 } }), false, "a blank command is a claim, not evidence");
assert.equal(hasEvidence({ evidence: { command: "node x", exitCode: "0" } }), false, "a non-numeric exit code is not evidence");
assert.equal(hasEvidence({}), false, "no evidence field at all");
console.log("  ok   isVerificationItem / hasEvidence");

/* ─── 2. the rule: an ack-only verifier item FAILS, an evidenced one PASSES ─ */
console.log("\nauditRig — verification-without-evidence");
const ackOnly = auditRig({ ...BASE, queueItems: [{ id: 7, to: "qa", subject: "VERIFY #1: fix", status: "done", resultSummary: "looks good" }] });
assert.equal(hasFinding(ackOnly, "verification-without-evidence"), true, "a done VERIFY item with no evidence is a finding");
assert.equal(ruleStatus(ackOnly, "verification-without-evidence"), "fail", "the rule fails for it");

const evidenced = auditRig({
	...BASE,
	queueItems: [{ id: 7, to: "qa", subject: "VERIFY #1: fix", status: "done", resultSummary: "ran it", evidence: { command: "node demo/x.test.mjs", exitCode: 0, artifact: "abc123" } }],
});
assert.equal(hasFinding(evidenced, "verification-without-evidence"), false, "an evidenced completion passes");
assert.equal(ruleStatus(evidenced, "verification-without-evidence"), "pass");

// #2547 (lead ruling A): a command + exit code with NO artifact is not ADDRESSABLE — the same
// command against another revision is a different check — so it is a finding too. FAILING-FIRST:
// before #2547 the rule only required `hasEvidence`, so this case passed silently.
const noArtifact = auditRig({
	...BASE,
	queueItems: [{ id: 7, to: "qa", subject: "VERIFY #1: fix", status: "done", resultSummary: "ran it", evidence: { command: "node demo/x.test.mjs", exitCode: 0 } }],
});
assert.equal(hasFinding(noArtifact, "verification-without-evidence"), true, "evidence with no artifact is a finding (#2547)");
assert.equal(ruleStatus(noArtifact, "verification-without-evidence"), "fail");

const blankArtifact = auditRig({
	...BASE,
	queueItems: [{ id: 7, to: "qa", subject: "VERIFY #1: fix", status: "done", resultSummary: "ran it", evidence: { command: "node demo/x.test.mjs", exitCode: 0, artifact: "   " } }],
});
assert.equal(hasFinding(blankArtifact, "verification-without-evidence"), true, "a BLANK artifact is a finding (#2547)");
assert.equal(ruleStatus(blankArtifact, "verification-without-evidence"), "fail");

assert.equal(hasArtifact({ evidence: { command: "c", exitCode: 0, artifact: "abc" } }), true, "hasArtifact: a non-blank artifact");
assert.equal(hasArtifact({ evidence: { command: "c", exitCode: 0, artifact: "  " } }), false, "hasArtifact: a blank artifact");
assert.equal(hasArtifact({ evidence: { command: "c", exitCode: 0 } }), false, "hasArtifact: absent");
assert.equal(hasArtifact({}), false, "hasArtifact: no evidence field at all");

// #4153: hasArtifact accepts any non-blank string; namesCheckSubject is the SHARPENING to "a named
// subject" - a git tree (sha/ref/main) OR a non-git store/queue/scratch where a tree is genuinely N/A.
assert.equal(namesCheckSubject("fb65ea9"), true, "a sha names the tree");
assert.equal(namesCheckSubject("7b43566 (ancestor of HEAD 1b46411)"), true, "a sha inside prose still names a tree");
assert.equal(namesCheckSubject("devtools-item-4147"), true, "a branch/ref-like token names the tree");
assert.equal(namesCheckSubject("main"), true, "main names the tree");
assert.equal(namesCheckSubject("origin/main"), true, "a remote ref names the tree");
assert.equal(namesCheckSubject("selfdev.sqlite@read"), true, "a non-git check names the STORE");
assert.equal(namesCheckSubject("queue store, read-only (no commit)"), true, "a queue check names the store");
assert.equal(namesCheckSubject("2148"), false, "a bare token names NOTHING");
assert.equal(namesCheckSubject(""), false, "blank names nothing");
assert.equal(namesCheckSubject("the fix"), false, "prose names nothing checkable");
console.log("  ok   namesCheckSubject: a tree or a store; a bare token is neither");

const nonVerifier = auditRig({ ...BASE, queueItems: [{ id: 8, to: "author", subject: "implement the widget", status: "done", resultSummary: "done" }] });
assert.equal(hasFinding(nonVerifier, "verification-without-evidence"), false, "an ordinary done item is not inspected");

const unread = auditRig({ ...BASE, queueItems: null });
assert.equal(ruleStatus(unread, "verification-without-evidence"), "skipped", "an unread queue is SKIPPED, never passed");
assert.equal(hasFinding(unread, "verification-without-evidence"), false, "and reports no finding it cannot ground");
console.log("  ok   ack-only FAILS, evidenced PASSES, non-verifier ignored, unread queue skipped");

/* ─── 2b. evidence-tree: the artifact must NAME what the check ran against ─── */
console.log("\nauditRig — evidence-tree (#4153)");
const ev = (artifact) => ({
	id: 9,
	to: "author",
	subject: "implement the widget",
	status: "done",
	resultSummary: "done",
	evidence: { command: "node demo/x.test.mjs", exitCode: 0, artifact },
});
// THE DECISIVE CASE: a non-blank artifact that names nothing. hasArtifact accepts it; this rule does not.
const bare = auditRig({ ...BASE, queueItems: [ev("2148")] });
assert.equal(hasFinding(bare, "evidence-tree"), true, "an artifact that names no tree and no store is a finding");
assert.equal(ruleStatus(bare, "evidence-tree"), "fail", "the rule fails for it");

for (const [label, artifact] of [
	["a sha", "fb65ea9"],
	["a branch/ref", "devtools-item-4147"],
	["main", "main"],
	["a store (non-git)", "selfdev.sqlite@read"],
	["a queue check (non-git)", "queue store, read-only (no commit)"],
]) {
	const r = auditRig({ ...BASE, queueItems: [ev(artifact)] });
	assert.equal(hasFinding(r, "evidence-tree"), false, `${label} names what was checked`);
	assert.equal(ruleStatus(r, "evidence-tree"), "pass", `${label} passes the rule`);
}

// SCOPED so it never duplicates verification-without-evidence: a MISSING artifact is that rule's job.
const missingArt = auditRig({
	...BASE,
	queueItems: [{ id: 9, to: "qa", subject: "VERIFY #1: fix", status: "done", evidence: { command: "node x.test.mjs", exitCode: 0 } }],
});
assert.equal(hasFinding(missingArt, "evidence-tree"), false, "a MISSING artifact is left to verification-without-evidence");
assert.equal(hasFinding(missingArt, "verification-without-evidence"), true, "...which still fires for it");

// A non-terminal item has no completion to inspect.
const notDone = auditRig({ ...BASE, queueItems: [{ ...ev("2148"), status: "queued" }] });
assert.equal(hasFinding(notDone, "evidence-tree"), false, "a non-terminal item is not inspected");

// An item with NO evidence at all is not this rule's business either.
const noEvidence = auditRig({ ...BASE, queueItems: [{ id: 9, to: "author", subject: "implement the widget", status: "done", resultSummary: "done" }] });
assert.equal(hasFinding(noEvidence, "evidence-tree"), false, "no evidence field at all is not this rule's finding");

const unreadEt = auditRig({ ...BASE, queueItems: null });
assert.equal(ruleStatus(unreadEt, "evidence-tree"), "skipped", "an unread queue is SKIPPED, never passed");
assert.equal(hasFinding(unreadEt, "evidence-tree"), false, "and reports no finding it cannot ground");
console.log("  ok   a bare token FAILS; sha/branch/main/store PASS; scoped away from the other rule; unread skipped");

/* ─── 3. complete_work records the evidence (real harness, real tool) ─────── */
console.log("\ncomplete_work — evidence is recorded on the item");
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
};

try {
	await harness.commit(async (tx) => {
		const mk = async (name, role) => {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
			await registerSeat(tx, name, c.id, role);
		};
		await mk("pm", "program manager");
		await mk("qa", "independent verifier");
		const ed = await tx.doc(Edges);
		ed.edges = [{ from: "pm", maySendTo: ["qa"] }, { from: "qa", maySendTo: ["pm"] }];
		await enqueueItem(tx, "pm", "qa", "VERIFY #1: author's fix", "body one"); // id 1
		await enqueueItem(tx, "pm", "qa", "VERIFY #2: author's fix", "body two"); // id 2
	}, ctx);

	const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	const queueState = async () => (await harness.documentState(RigQueue, undefined, ctx)).value;
	const item = async (id) => (await queueState()).items.find((it) => it.id === id);
	const transcript = async (name) => {
		const c = await harness.conversation(roster[name].conversationId, ctx);
		return (await c.entries({}, 200, undefined, ctx)).items.map((e) => JSON.stringify(e)).join("\n");
	};
	let firstTurn = true;
	const call = async (name, toolName, toolArgs) => {
		const batch = [
			fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("ok")),
		];
		if (firstTurn) { faux.setResponses(batch); firstTurn = false; } else faux.appendResponses(batch);
		const c = await harness.conversation(roster[name].conversationId, ctx);
		await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	};

	await call("qa", "claim_work", {});
	await call("qa", "complete_work", { itemId: 1, resultSummary: "re-ran the suite", evidence: { command: "node demo/seatguard.test.mjs", exitCode: 0, artifact: "ae2798c" } });
	const done1 = await item(1);
	check("item 1 is done", done1.status === "done");
	check("its evidence is recorded", hasEvidence(done1), JSON.stringify(done1.evidence));
	check("the command is preserved verbatim", done1.evidence?.command === "node demo/seatguard.test.mjs");
	check("the exit code is preserved", done1.evidence?.exitCode === 0);
	check("the artifact rev is preserved", done1.evidence?.artifact === "ae2798c");

	await call("qa", "claim_work", {});
	// A blank command is refused BEFORE any state change: the item stays claimed.
	await call("qa", "complete_work", { itemId: 2, resultSummary: "ack", evidence: { command: "   ", exitCode: 0 } });
	check("a blank evidence.command is refused", (await item(2)).status === "claimed", JSON.stringify(await item(2)));
	check("and the refusal is visible in the transcript", /evidence\.command` must name the command/.test(await transcript("qa")));

	await call("qa", "complete_work", { itemId: 2, resultSummary: "ack, no evidence" });
	const done2 = await item(2);
	check("item 2 completes without evidence (still legal)", done2.status === "done");
	check("and carries no evidence field", done2.evidence === undefined);
} finally {
	await harness.close(ctx);
}

/* ─── 4. end to end: `check` reports the ack-only verifier item ───────────── */
console.log("\ncli check — the rule is wired into the real verb");
const dir = mkdtempSync(join(tmpdir(), "durig-check-evidence-"));
try {
	const dbPath = join(dir, "rig.sqlite");
	const rigPath = join(dir, "rig.json");
	writeFileSync(rigPath, JSON.stringify(SPEC, null, 2));

	const storage = await openNodeSqliteStorage(dbPath);
	const h2 = await Harness.open(storage, { models, registry }, ctx);
	try {
		await h2.commit(async (tx) => {
			const mk = async (name, role) => {
				const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
				await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
				await registerSeat(tx, name, c.id, role);
			};
			await mk("author", "implementation engineer");
			await mk("qa", "independent verifier");
			const cDoc = await tx.doc(Constitution);
			cDoc.text = SPEC.constitutionInline;
			const q = await tx.doc(RigQueue);
			q.items.push({
				id: q.nextId++, from: "pm", to: "qa",
				subject: "VERIFY #1: author's fix", body: "body",
				status: "done", resultSummary: "looks good",
				transitions: [{ at: new Date().toISOString(), event: "done", by: "qa" }],
			});
		}, ctx);
	} finally {
		await h2.close(ctx);
		await storage.close(ctx);
	}

	const r = spawnSync(process.execPath, [join(durigDir, "cli.mjs"), "check", rigPath], {
		cwd: dir,
		env: { ...cleanEnv, DURIG_PROVIDER: "faux", DURIG_MODEL: "m1", DURIG_DB: dbPath },
		encoding: "utf8",
	});
	let json = null;
	try { json = JSON.parse(r.stdout); } catch { /* crash text kept below */ }
	check("check exits 0 (the rule is fix-now, the rig still runs)", r.status === 0, `status=${r.status} ${r.stderr.slice(0, 200)}`);
	check("check reports the ack-only verification item", (json?.findings ?? []).some((f) => f.id === "verification-without-evidence"), r.stdout.slice(0, 400));
	check("the finding names the item", /#1/.test((json?.findings ?? []).find((f) => f.id === "verification-without-evidence")?.subject ?? ""));
} finally {
	try { rmSync(dir, { recursive: true, force: true }); } catch (err) { console.error(`CLEANUP WARNING: ${err?.message ?? err}`); }
}

console.log(failures === 0 ? "\nCHECK-EVIDENCE TEST PASS" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
