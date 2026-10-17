// demo/tui-backfill.test.mjs — ROADMAP 89: opening a seat's detail view loads its
// durable transcript (paged), then follows the live tail — instead of showing only
// the newest streaming page.
//
// FAILING-FIRST: before the paged read (`readOlderEntries`) and the conversation
// window (`src/tui/conversation.mjs`), the detail view could reach no older than the
// newest `SCAN_LIMIT`-entry page, so the assertions below (a pre-page turn becomes
// reachable; the three indicator states; the anchor) cannot pass. Run against the
// pre-change tree, this file fails at import (the modules do not exist).
//
// Run: node demo/tui-backfill.test.mjs   (exit 0 = pass)

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, registerSeat } from "../src/rig.mjs";
import { SCAN_LIMIT, readSeatPages, readOlderEntries, conversationExhausted } from "../src/rigstory.mjs";
import {
	createConversationWindow,
	selectSeat,
	mergeNewest,
	oldestLoadedId,
	turnsOf,
	loadOlder,
} from "../src/tui/conversation.mjs";
import { renderTui, frameToLines } from "../src/tui/client.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// 20 operator + 20 agent turns = ~40 turns, so the newest SCAN_LIMIT=24-entry page
// is a strict prefix and older turns genuinely pre-date it.
const SUBMITS = 20;

const dir = mkdtempSync(join(tmpdir(), "durig-tui-backfill-"));
const cwd = join(dir, "seat-workspace");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

let convId;
await harness.commit(async (tx) => {
	const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
	await registerSeat(tx, "impl", conv.id, "implementation engineer");
	convId = conv.id;
}, ctx);

faux.setResponses(Array.from({ length: SUBMITS }, (_, i) => fauxAssistantMessage(fauxText(`reply ${i + 1}`))));
const conversation = await harness.conversation(convId, ctx);
for (let i = 0; i < SUBMITS; i++) {
	const run = await conversation.submit({ type: "input", content: `message ${i + 1}` }, ctx);
	await run.wait(ctx);
}

const seatRows = [{ name: "impl", conversationId: convId }];
const health = { seats: seatRows, queueItems: [], attention: [] };

/** Render the detail view for a loaded window at a pinned size. */
function render(window, { width = 80, height = 50, scroll, exhausted } = {}) {
	return frameToLines(
		renderTui({
			seats: seatRows,
			turns: turnsOf(window),
			health,
			selectedSeat: "impl",
			view: "conversation",
			width,
			height,
			scroll: scroll ?? window.scroll,
			exhausted: exhausted === undefined ? window.exhausted : exhausted,
		}),
	).join("\n");
}

/** The text parts of an entry's provider message. */
function entryTexts(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : null;
	if (!message) return [];
	if (typeof message.content === "string") return [message.content];
	return (Array.isArray(message.content) ? message.content : [])
		.filter((part) => part?.type === "text")
		.map((part) => part.text ?? "");
}

/** The first visible turn line in a rendered conversation frame (operator or agent). */
function firstTurnLine(frameText) {
	return frameText.split("\n").find((line) => /(message|reply) \d+/.test(line)) ?? null;
}

try {
	/* ── 1. The newest page is BOUNDED (not the whole transcript), newest-first. ── */
	const pages = await readSeatPages(storage, ctx, seatRows, SCAN_LIMIT);
	const page = pages.impl;
	check("newest page is bounded by SCAN_LIMIT", page.length === SCAN_LIMIT, `len=${page.length}`);
	check("newest page is newest-first", page.every((e, i) => i === 0 || e.id < page[i - 1].id));
	const pageText = page.flatMap(entryTexts);
	check("newest page contains the newest reply", pageText.some((t) => t === `reply ${SUBMITS}`));
	check("newest page does NOT reach the oldest reply (backfill is required)", !pageText.some((t) => t === "reply 1"));

	/* ── 2. Opening the detail view shows the newest page only (matches today). ── */
	const window = createConversationWindow();
	selectSeat(window, "impl");
	mergeNewest(window, page, SCAN_LIMIT);
	check("a full page leaves exhaustion UNKNOWN (never fabricated)", window.exhausted === null);
	check("oldestLoadedId is the page's oldest entry", oldestLoadedId(window) === page[page.length - 1].id);
	const opened = render(window, { height: 50 });
	check("(i) opening shows the newest page: newest reply visible", /\breply 20\b/.test(opened));
	check("(i) opening does NOT show a pre-page turn", !/\breply 1\b/.test(opened));

	/* ── 3. The three honest indicator states. ── */
	// (b) at the loaded top while older entries exist beyond the page.
	window.exhausted = await conversationExhausted(storage, convId, oldestLoadedId(window), ctx);
	check("older entries exist beyond the newest page (probe says not exhausted)", window.exhausted === false);
	const stateB = render(window, { height: 50 });
	check("(b) the load-older invite renders at the loaded top", /to load older/.test(stateB), stateB.split("\n").find((l) => /load older/.test(l)));
	check("(b) fabricates no older-turn count", !/older turn/.test(stateB));
	// (a) hidden-above count WITHIN the loaded set (a short viewport trims the window).
	const stateA = render(window, { height: 24 });
	check("(a) hidden-above count renders within the loaded set", /\d+ older turn/.test(stateA), stateA.split("\n").find((l) => /older turn/.test(l)));

	/* ── 4. Backfill: an injected ↑-at-top loads ONE older page. ── */
	const anchored = createConversationWindow();
	selectSeat(anchored, "impl");
	mergeNewest(anchored, page, SCAN_LIMIT);
	anchored.exhausted = false;
	anchored.scroll = 5;
	const firstBefore = firstTurnLine(render(anchored, { height: 24 }));
	check("a turn is visible before the backfill (anchor baseline)", firstBefore !== null, String(firstBefore));

	const { addedEntries, addedTurns } = await loadOlder(anchored, (oldest) =>
		readOlderEntries(storage, convId, oldest, SCAN_LIMIT, ctx),
	);
	check("a backfill loads the older page", addedEntries > 0, `addedEntries=${addedEntries}`);
	check("a backfill adds turns", addedTurns > 0, `addedTurns=${addedTurns}`);
	check("(ii) the backfilled window reaches a turn that PRE-DATES the first page", turnsOf(anchored).some((t) => t.text === "reply 1"));

	const firstAfter = firstTurnLine(render(anchored, { height: 24 }));
	check("(iv) anchor: a backfill leaves the first visible turn unchanged", firstAfter !== null && firstAfter === firstBefore, `before=${JSON.stringify(firstBefore)} after=${JSON.stringify(firstAfter)}`);

	/* ── 5. The page exhausts a ~40-turn seat, and (c) then renders. ── */
	check("the backfill reports exhaustion (the older page was short)", anchored.exhausted === true);
	const stateC = render(anchored, { height: 60 });
	check("(c) start of conversation renders once exhausted", /start of conversation/.test(stateC), stateC.split("\n").find((l) => /start of conversation/.test(l)));
	check("(c) the pre-page turn is reachable in the frame", /\breply 1\b/.test(stateC));

	/* ── 6. The data half directly: strictly older, and the start probe is true. ── */
	const older = await readOlderEntries(storage, convId, page[page.length - 1].id, SCAN_LIMIT, ctx);
	check("readOlderEntries returns entries strictly older than the loaded page", older.items.every((e) => e.id < page[page.length - 1].id));
	check("readOlderEntries reaches the very first reply", older.items.flatMap(entryTexts).includes("reply 1"));
	check("readOlderEntries reports exhaustion when the page is short", older.exhausted === (older.items.length < SCAN_LIMIT));
	const veryOldest = older.items.length ? older.items[older.items.length - 1].id : null;
	check("conversationExhausted is true at the transcript's start", (await conversationExhausted(storage, convId, veryOldest, ctx)) === true);
	check("conversationExhausted is false above the loaded page", (await conversationExhausted(storage, convId, page[page.length - 1].id, ctx)) === false);

	/* ── 7. Floor: the indicator's NUMBER survives a narrow row. ── */
	const narrow = render(window, { height: 24, width: 16 });
	check("the older-turn NUMBER is not truncated at a narrow width", /↑ \d+ older/.test(narrow), narrow.split("\n").find((l) => /older/.test(l)));

	console.log(failures === 0 ? "\nPASS — TUI backfill (paged transcript + three indicator states + anchor)" : `\nFAIL — ${failures} check(s) failed`);
} finally {
	await harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING: ${err?.message ?? err}`);
	}
}

process.exit(failures === 0 ? 0 : 1);
