// demo/seatroot-name.test.mjs — #253 / DOGFOOD F21: a seat can NAME its actual root.
//
// F21's incident: a VERIFIER called its ISOLATED item worktree "the live tree", because a seat had
// no way to tell which tree it was in. This proves the surface that fixes it:
//   (a) `seat_root` exists and EVERY seat keeps it (it is not in the coordinator or verifier
//       removals), so even a no-file-tool coordinator can name its root;
//   (b) `classifyGitRoot` distinguishes a linked worktree (`.git` is a FILE) from the main checkout
//       (`.git` is a DIRECTORY) and a non-git tree;
//   (c) a seat whose root is an isolated worktree is TOLD so, loudly, through the real tool path —
//       the result names the path, the source of the resolution and "linked-worktree ... NOT the
//       live tree";
//   (d) a `DURIAN_PI_SEAT_ROOT` that disagrees with the seat's resolved root is surfaced loudly.
// Run: node demo/seatroot-name.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Router, Seats, registerSeat } from "../src/rig.mjs";
import { classifyGitRoot, describeSeatRoot } from "../src/seatroot.mjs";
import { COORDINATOR_REMOVALS, VERIFIER_REMOVALS, SeatTools, fillRoster, makeSeatEnv } from "../src/seattools.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
registry.install(SeatTools);

const dir = mkdtempSync(join(tmpdir(), "durig-seatroot-name-"));
// An ISOLATED tree: `.git` is a FILE (a linked worktree's gitdir pointer).
const isolatedRoot = join(dir, "isolated-tree");
mkdirSync(isolatedRoot, { recursive: true });
writeFileSync(join(isolatedRoot, ".git"), "gitdir: ../main-tree/.git/worktrees/isolated\n");
// The main checkout: `.git` is a DIRECTORY.
const mainRoot = join(dir, "main-tree");
mkdirSync(join(mainRoot, ".git"), { recursive: true });
// A non-git tree.
const plainRoot = join(dir, "plain-tree");
mkdirSync(plainRoot, { recursive: true });

let harness;
try {
	// (a) the tool exists and EVERY seat keeps it.
	const names = SeatTools.tools.map((t) => t.name).sort();
	assert.ok(names.includes("seat_root"), `SeatTools bundles seat_root; got ${names.join(", ")}`);
	assert.ok(!COORDINATOR_REMOVALS.map((t) => t.name).includes("seat_root"), "a coordinator keeps seat_root");
	assert.ok(!VERIFIER_REMOVALS.map((t) => t.name).includes("seat_root"), "a verifier keeps seat_root");

	// (b) the classifier: the nearest `.git` decides main vs isolated.
	assert.equal(classifyGitRoot(isolatedRoot), "linked-worktree", "a `.git` FILE is a linked worktree");
	assert.equal(classifyGitRoot(mainRoot), "main-worktree", "a `.git` DIRECTORY is the main checkout");
	assert.equal(classifyGitRoot(plainRoot), "not-a-git-tree", "no `.git` up the tree is not a git tree");

	// (d) the mismatch is loud, without a harness.
	const mismatchReport = describeSeatRoot({ persistedCwd: isolatedRoot, env: { DURIG_SEAT_ROOT: mainRoot } });
	assert.ok(mismatchReport.includes("MISMATCH"), "a DURIG_SEAT_ROOT disagreement is named");
	assert.ok(mismatchReport.includes(isolatedRoot), "the mismatch names the seat's resolved root");
	assert.ok(mismatchReport.includes(mainRoot), "the mismatch names DURIG_SEAT_ROOT");

	// (c) a seat is TOLD its root, through the real tool path.
	const roster = new Map();
	const storage = new MemoryStorage();
	harness = await Harness.open(storage, { models, registry, env: makeSeatEnv(roster) }, ctx);
	let conversationId;
	await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd: isolatedRoot });
		await registerSeat(tx, "verifier", conv.id, "independent verifier");
		conversationId = conv.id;
	}, ctx);
	fillRoster(roster, (await harness.documentState(Seats, undefined, ctx)).value.seats);

	const conv = await harness.conversation(conversationId, ctx);
	const before = await conv.submit({ type: "input", content: "where am i" }, ctx);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("seat_root", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("named")),
	]);
	await before.wait(ctx);
	const page = await conv.entries({}, 50, undefined, ctx);
	const toolResult = page.items.find(
		(e) => e.kind === "pi.tool-result" && String(e.model?.[0]?.toolName) === "seat_root",
	);
	const text = toolResult?.model?.[0]?.content?.[0]?.text ?? "";
	assert.ok(text.includes("SEAT ROOT:"), `the seat is told its root; got: ${text.slice(0, 160)}`);
	assert.ok(text.includes("isolated-tree"), "the result names the resolved root path");
	assert.ok(text.includes("source: persisted seat cwd"), "the result names where the root came from");
	assert.ok(text.includes("linked-worktree"), "the result names the tree KIND");
	assert.ok(/NOT the live tree/.test(text), "and says loudly that this is not the live tree");

	console.log(
		"SEATROOT-NAME TEST PASS (seat_root names the resolved root, its source and tree kind; an isolated worktree is flagged NOT the live tree; a DURIG_SEAT_ROOT disagreement is surfaced; every seat keeps the tool)",
	);
} finally {
	if (harness) await harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
