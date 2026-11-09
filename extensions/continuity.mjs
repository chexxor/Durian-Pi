// extensions/continuity.mjs — the continuation-note extension (D240, milestone D226 / ROADMAP 331).
//
// THE PROBLEM IT CLOSES, measured before it was written (docs/reviews/architecture-context-continuity-2026-11-09.md):
// a seat that cannot finish its item inside one context window depends on pi-durable's compaction, and the
// summariser is the fragile part of that path — 430 of 2,333 compaction attempts failed, 218 of them with
// "Summarization hit the token limit; the summary is incomplete", and 209 were refused by the rig's own run cap
// before a request was even sent. Each of those is a model call made against a window that is already full.
//
// THE MECHANISM, in the order the seat meets it:
//   1. `write_note` keeps a per-conversation note in the durable store (the source of truth, D130/R2: store for
//      seat-written state) and mirrors it to a file under `DURIG_NOTES_DIR` so a gate, another seat, or a human
//      can read it without opening the store.
//   2. `read_note` is the recovery verb: after any boundary that drops the transcript from context, the seat
//      re-reads its own note instead of guessing from memory.
//   3. `beforeCompact` supplies the summary BODY itself, so pi-durable's summariser request is never built
//      (`dist/harness/compaction.js:82-88` -> `place()` at `:374`). No model call, no cap refusal, no truncation.
//   4. `continue_from_note` is the seat's own fresh-context verb: it returns the note as a tool `control.handoff`
//      (`dist/harness/generation.js:547-557`), which draws a reset boundary whose first user message is the note
//      — un-fenced, unlike a compaction summary, which is always wrapped (`compaction.js:12-13, :374`).
//
// WHY A STORE DOC AND NOT A FILE IN THE WORKTREE. `.durig/` is gitignored and a seat's tree is a per-item
// worktree that the sweeper removes (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`); a note that
// dies with the worktree is not a continuity mechanism, and a gate cannot read it. The doc shape is the one
// ROADMAP 177 already ruled for typed state: conversation-scoped, `history: "rewindable"`, `fork: "asOf"` —
// the same shape as pi-durable's `AgentDoc`, so a fork starts from the note its fork entry saw.
//
// WHY THE SECTION IS STATIC. ROADMAP 175: pi-durable rebuilds the prompt from sections before every request and
// provider caching is prefix-exact, so a section whose text changes per request is a full-prefix cache miss on
// every request. The mutable content arrives at boundaries (compaction, handoff, an explicit `read_note`), never
// in the standing prompt. This section names the tools; it does not carry the note.
//
// TRUST. Like every extension here, this is code the operator chose to run: it is loaded only through the
// explicit `DURIG_EXTENSIONS` list (`src/extensions.mjs` has no auto-discovery, on purpose).
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CompactionTask, GenerationTask, defineDoc, defineExtension, defineTool, hook, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { loadConfig } from "../src/config.mjs";
import { RigQueue, Seats } from "../src/rig.mjs";

/** One seat's continuation note. Conversation-scoped so a seat's note is its own and a fork inherits it. */
export const ContinuityNotes = defineDoc({
	kind: "durig.notes",
	version: 1,
	scope: "conversation",
	history: "rewindable",
	fork: "asOf",
	initial: () => ({
		itemId: null,
		seat: null,
		goal: null,
		verified: [],
		hypotheses: [],
		constraints: [],
		done: [],
		next: null,
		blockers: [],
		worktree: null,
		filesTouched: [],
		updatedAt: null,
	}),
});

/**
 * Where the mirror files live: `DURIG_NOTES_DIR` (environment or the config file, the same resolution as every
 * other setting), else `<rig root>/.durig/notes`. Memoised per process; the config file is read once.
 */
let notesDirCache = null;
export async function notesDir({ env = process.env } = {}) {
	if (notesDirCache) return notesDirCache;
	const { config } = await loadConfig({ env, readFile, defaults: {} });
	const raw = config.DURIG_NOTES_DIR;
	notesDirCache = raw && String(raw).trim() !== "" ? resolve(String(raw)) : resolve(join(process.cwd(), ".durig", "notes"));
	return notesDirCache;
}

/** The mirror file name for a note: the item it belongs to, else the seat, else the conversation. */
export function noteFileName(note, conversationId) {
	if (note?.itemId) return `item-${note.itemId}.md`;
	if (note?.seat) return `seat-${String(note.seat).replace(/[^A-Za-z0-9_-]/g, "_")}.md`;
	return `conversation-${conversationId}.md`;
}

/**
 * A fresh context is one the seat cannot rebuild from what is in front of it. After a boundary the visible
 * projection is a handful of messages (the `pi.compaction` summary, or the wake instruction) before the
 * transcript builds up again. Beyond this many visible messages the seat still has its own context, so the note
 * is not injected: the note is a boundary mechanism, not a per-request tax.
 */
const FRESH_VISIBLE_MESSAGES = 2;
const NOTE_MARKER = "CONTINUITY NOTE";

/** The text of a message, including the sections a system message carries separately. */
function messageTextOf(message) {
	if (!message) return "";
	if (message.role === "system") {
		const parts = [typeof message.content === "string" ? message.content : ""];
		for (const text of Object.values(message.sections ?? {})) if (typeof text === "string") parts.push(text);
		return parts.filter(Boolean).join("\n\n");
	}
	const parts = Array.isArray(message.content) ? message.content : [message.content];
	return parts.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join(" ");
}

/** Bound a value so one pasted tool result cannot make the note the thing that blows the window. */
function clip(value, max = 600) {
	const text = String(value ?? "").trim();
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Render the note as the text a fresh context reads. Ordered the way the surveyed handoff formats order it
 * (goal -> what is true -> what is believed -> what binds -> what is done -> what next), with evidence attached
 * to every verified claim, because a note is a claim, not a fact, unless it says where it came from.
 */
export function renderNote(note) {
	if (!note) return "";
	const empty = !note.goal && !note.itemId && !note.next && !(note.verified?.length) && !(note.done?.length);
	if (empty) return "";
	const lines = [];
	lines.push(
		`CONTINUITY NOTE${note.itemId ? ` for item #${note.itemId}` : ""}` +
			`${note.seat ? ` (seat: ${note.seat})` : ""}` +
			`${note.updatedAt ? ` — last written ${note.updatedAt}` : ""}`,
	);
	if (note.goal) lines.push(`Goal: ${clip(note.goal, 1200)}`);
	if (note.worktree) lines.push(`Worktree: ${note.worktree}`);
	if (note.filesTouched?.length) lines.push(`Files touched: ${note.filesTouched.map((f) => clip(f, 120)).join(", ")}`);
	if (note.verified?.length) {
		lines.push("Verified (evidence-backed):");
		for (const v of note.verified) lines.push(`  - ${clip(v.claim)}${v.evidence ? ` [evidence: ${clip(v.evidence, 200)}]` : ""}`);
	}
	if (note.hypotheses?.length) {
		lines.push("Hypotheses (believed, not proven — test before acting on them):");
		for (const h of note.hypotheses) lines.push(`  - ${clip(h)}`);
	}
	if (note.constraints?.length) {
		lines.push("Constraints that bind this item:");
		for (const c of note.constraints) lines.push(`  - ${clip(c)}`);
	}
	if (note.done?.length) {
		lines.push("Done:");
		for (const d of note.done) lines.push(`  - ${clip(d.what)}${d.evidence ? ` [${clip(d.evidence, 200)}]` : ""}`);
	}
	if (nextLine(note)) lines.push(nextLine(note));
	if (note.blockers?.length) {
		lines.push("Blockers:");
		for (const b of note.blockers) lines.push(`  - ${clip(b.what)}${b.owner ? ` (owner: ${clip(b.owner, 120)})` : ""}`);
	}
	return lines.join("\n");
}

function nextLine(note) {
	if (!note.next) return "";
	return typeof note.next === "object"
		? `Next: ${clip(note.next.action)}${note.next.where ? ` — ${clip(note.next.where, 200)}` : ""}`
		: `Next: ${clip(note.next, 1200)}`;
}

/**
 * A deterministic digest of the turns a compaction is about to cut, used when there is no note to stand in for
 * them. Bounded on purpose (this is a summary, not a copy): the durable transcript is never touched, so
 * anything cut here is still readable in the store — which is why ROADMAP 176 (recall over the immutable
 * transcript) is the companion this extension assumes rather than replaces.
 */
export function digestCutMessages(messages, budget = 4000) {
	const turns = [];
	let used = 0;
	for (const message of [...messages].reverse()) {
		const parts = Array.isArray(message.content) ? message.content : [message.content];
		const snippets = parts
			.map((part) => {
				if (part?.type === "toolCall" || part?.type === "tool_call") {
					return `call ${part.name ?? part.toolName ?? "?"} ${clip(JSON.stringify(part.arguments ?? part.args ?? {}), 160)}`;
				}
				const text = typeof part === "string" ? part : part?.text ?? "";
				return clip(text, 200);
			})
			.filter(Boolean);
		const line = `[${message.role}] ${snippets.join(" | ")}`.trim();
		if (!line || used + line.length > budget) continue;
		used += line.length;
		turns.unshift(line);
	}
	const total = messages.length;
	if (turns.length === 0) return `The cut prefix (${total} turns) produced no readable text; the durable transcript still holds it.`;
	const omitted = total - turns.length;
	return `Deterministic digest of ${turns.length} earlier turn(s)${omitted > 0 ? ` (${omitted} omitted for size; the full transcript is still in the durable store)` : ""}:\n${turns.map((t) => `  ${t}`).join("\n")}`;
}

/**
 * If the seat never wrote a note, seed one from what the queue says it is holding, so the first compaction still
 * carries a goal instead of a blind digest. Read-only with respect to the queue: this never changes an item.
 */
async function seededGoal(tx, conversationId) {
	const seats = await tx.doc(Seats);
	const seatName = Object.keys(seats.seats ?? {}).find((name) => seats.seats[name].conversationId === conversationId) ?? null;
	const queue = await tx.doc(RigQueue);
	const mine = (queue.items ?? []).filter((item) => item.to === seatName && (item.status === "claimed" || item.status === "queued"));
	if (mine.length === 0) return { seat: seatName, itemId: null, goal: null };
	const item = mine[mine.length - 1];
	return { seat: seatName, itemId: item.id, goal: item.subject ?? null };
}

/** The seat's own name, for the note header and the mirror file name. */
async function seatNameOf(tx, conversationId) {
	const seats = await tx.doc(Seats);
	return Object.keys(seats.seats ?? {}).find((name) => seats.seats[name].conversationId === conversationId) ?? null;
}

/** Write the mirror file. Never throws: the store doc is the source of truth, the file is for gates and humans. */
async function mirrorNote(note, conversationId) {
	const text = renderNote(note);
	if (!text) return null;
	try {
		const dir = await notesDir();
		const file = join(dir, noteFileName(note, conversationId));
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, `${text}\n`, "utf8");
		return file;
	} catch (err) {
		return `FAILED (${err?.message ?? err}) - the note is still in the durable store`;
	}
}

async function readNotePlain(api, context) {
	return api.commit(async (tx) => {
		const note = await tx.doc(ContinuityNotes, api.conversationId);
		// Copy out as plain JSON: a document proxy read after the commit settles throws
		// "Cannot use a settled overlay" (the trap `mySeatReadability` in src/seattools.mjs documents).
		return JSON.parse(JSON.stringify(note ?? null));
	}, context);
}

export const continuityExtension = defineExtension({
	name: "durig-continuity",

	sections: [
		// Static text only (ROADMAP 175): the note itself never rides in the standing prompt.
		section(
			"durig-continuity",
			() =>
				"Keep a continuation note for the item you are working on: write_note records the goal, what you " +
				"have verified (with the evidence), what you only believe, what binds you, what is committed, and "
				+ "the single next action. If your context starts fresh - after a compaction or a reset - call " +
				"read_note before acting, and use continue_from_note when you need to finish the item in a new " +
				"context on purpose.",
			{ tag: false },
		),
	],

	tools: [
		defineTool({
			name: "read_note",
			description:
				"Read your continuation note. Call this when your context is fresh (after a compaction or a reset) " +
				"or whenever you are unsure what you already established. The mirror file path is included so you " +
				"can also open it with the read tool.",
			// `parameters` is REQUIRED, not optional: pi-ai's `toToolDeclaration` (utils/transcript.js:107-112) does
			// `JSON.parse(JSON.stringify(tool.parameters))`, so a tool with no declared parameters faults the whole
			// run with `"undefined" is not valid JSON` before the tool ever executes.
			parameters: Type.Object({}),
			execute: async (_args, api, context) => {
				const note = await readNotePlain(api, context);
				const text = renderNote(note);
				const dir = await notesDir();
				const content = text
					? `${text}\n(mirror: ${join(dir, noteFileName(note, api.conversationId))})`
					: `NO CONTINUITY NOTE YET for this conversation.\nWrite one with write_note: goal, verified [{claim, evidence}], hypotheses, constraints, done [{what, evidence}], next, blockers [{what, owner}], worktree, filesTouched.\nMirror directory: ${dir}`;
				return { content: [{ type: "text", text: content }], output: [{ type: "text", text: content }] };
			},
		}),

		defineTool({
			name: "write_note",
			description:
				"Update your continuation note for the item you are working on. Every field is optional and each " +
				"field you pass REPLACES that field; omit a field to leave it as it was. Put evidence in `verified` " +
				"(a path, a row id, a command you ran) - a claim without evidence belongs in `hypotheses`. Write " +
				"it BEFORE you reach the boundary: a compaction uses this note as its summary instead of asking a " +
				"model to summarise the transcript.",
			parameters: Type.Object({
				itemId: Type.Optional(Type.Number({ description: "the queue item this note belongs to" })),
				goal: Type.Optional(Type.String({ description: "the item's objective, copied, not paraphrased" })),
				verified: Type.Optional(
					Type.Array(
						Type.Object({
							claim: Type.String(),
							evidence: Type.Optional(Type.String({ description: "path, row id, command output - what shows it is true" })),
						}),
						{ description: "facts you have established, each with its evidence" },
					),
				),
				hypotheses: Type.Optional(Type.Array(Type.String(), { description: "believed but not proven" })),
				constraints: Type.Optional(Type.Array(Type.String(), { description: "rulings and gates that bind this item" })),
				done: Type.Optional(
					Type.Array(
						Type.Object({
							what: Type.String(),
							evidence: Type.Optional(Type.String({ description: "sha, branch, test name" })),
						}),
						{ description: "what is committed" },
					),
				),
				next: Type.Optional(
					Type.Union([
						Type.String({ description: "the single next action" }),
						Type.Object({ action: Type.String(), where: Type.Optional(Type.String()) }),
					]),
				),
				blockers: Type.Optional(
					Type.Array(
						Type.Object({
							what: Type.String(),
							owner: Type.Optional(Type.String({ description: "who must unblock it - often the operator" })),
						}),
						{ description: "what cannot proceed, and who owns it" },
					),
				),
				worktree: Type.Optional(Type.String({ description: "the worktree you are standing in" })),
				filesTouched: Type.Optional(Type.Array(Type.String(), { description: "files this item has changed" })),
			}),
			// Writing the note is idempotent (fields are replaced, not appended), so a replay is harmless.
			execute: async (args, api, context) => {
				const written = await api.commit(async (tx) => {
					const note = await tx.doc(ContinuityNotes, api.conversationId);
					if (note.seat === null) note.seat = await seatNameOf(tx, api.conversationId);
					if (args.itemId !== undefined) note.itemId = args.itemId;
					if (args.goal !== undefined) note.goal = args.goal;
					if (args.verified !== undefined) note.verified = args.verified;
					if (args.hypotheses !== undefined) note.hypotheses = args.hypotheses;
					if (args.constraints !== undefined) note.constraints = args.constraints;
					if (args.done !== undefined) note.done = args.done;
					if (args.next !== undefined) note.next = args.next;
					if (args.blockers !== undefined) note.blockers = args.blockers;
					if (args.worktree !== undefined) note.worktree = args.worktree;
					if (args.filesTouched !== undefined) note.filesTouched = args.filesTouched;
					if (args.itemId === undefined && note.itemId === null) {
						const seed = await seededGoal(tx, api.conversationId);
						if (seed.itemId !== null) note.itemId = seed.itemId;
					}
					note.updatedAt = new Date().toISOString();
					return JSON.parse(JSON.stringify(note));
				}, context);

				// The store note is the source of truth; the mirror is a convenience for humans and gates. A failed
				// mirror must not lose the note, so it is reported, not thrown.
				const mirror = (await mirrorNote(written, api.conversationId)) ?? "could not be written";
				const text = `NOTE WRITTEN for ${written.itemId ? `item #${written.itemId}` : "this conversation"}\n${renderNote(written)}\n(mirror: ${mirror})`;
				return { content: [{ type: "text", text }], output: [{ type: "text", text }] };
			},
		}),

		defineTool({
			name: "continue_from_note",
			description:
				"End this run and continue the same item in a FRESH context seeded with your continuation note. " +
				"Use it when the work cannot fit in one window and you would rather restart clean than be " +
				"compacted. The prior turns leave the model context; the durable transcript keeps them.",
			// A replay would draw a second boundary, so it must not be replayed automatically.
			replay: "unsafe",
			parameters: Type.Object({}),
			execute: async (_args, api, context) => {
				const note = await readNotePlain(api, context);
				const text = renderNote(note);
				if (!text) {
					const seed = await api.commit(async (tx) => {
						const seedNote = await seededGoal(tx, api.conversationId);
						return JSON.parse(JSON.stringify(seedNote));
					}, context);
					const seeded = renderNote(seed);
					return {
						content: [{ type: "text", text: `NO CONTINUITY NOTE: nothing to hand off. Write one with write_note first (goal, verified, next). Seed from the queue: ${seeded || "no claimed or queued item for this seat."}` }],
						output: [{ type: "text", text: `NO CONTINUITY NOTE: nothing to hand off. Write one with write_note first.` }],
					};
				}
				// Mirror at the boundary too, so a gate or a human can read the note being handed off without opening
				// the store (queue row #5935: mirror at wake/compaction/reset, not only on write).
				await mirrorNote(note, api.conversationId);
				return {
					content: [{ type: "text", text: "Handing off to a fresh context seeded with this note." }],
					output: [{ type: "text", text: "Handing off to a fresh context seeded with this note." }],
					control: { handoff: text },
				};
			},
		}),
	],

	hooks: [
		// The heart of it: pi-durable asks the extensions for a decision BEFORE building the summariser request
		// (dist/harness/compaction.js:82-88). Returning {summary} commits it at :374 and the request is never
		// constructed - no cap check, no 429, no truncated summary. We never return {decline: true}: ROADMAP 176
		// forbids a competing summariser, and declining just returns the seat to the same wall later.
		hook(CompactionTask, {
			beforeCompact: async (compaction, runtime, context) => {
				// `runtime.commit`'s callback return value becomes the TASK STATE (scheduler.js `commit`:
				// `if (next !== undefined) await this.#commitState(tx, invocation, current, next)`), so returning a
				// rendered string here makes the store write fail with "Provided value cannot be bound to SQLite
				// parameter 4". Capture the note in a local and return undefined.
				let rendered = "";
				let noteForMirror = null;
				await runtime.commit(async (tx) => {
					const note = await tx.doc(ContinuityNotes, runtime.conversationId);
					const plain = note === null || note === undefined ? null : JSON.parse(JSON.stringify(note));
					rendered = renderNote(plain);
					if (rendered) {
						noteForMirror = plain;
					} else {
						const seed = await seededGoal(tx, runtime.conversationId);
						noteForMirror = seed;
						rendered = renderNote(seed);
					}
					return undefined;
				}, context);
				await mirrorNote(noteForMirror, runtime.conversationId);
				const digest = digestCutMessages(compaction.messages ?? []);
				const summary = [
					rendered || "No continuity note was written for this conversation before the boundary.",
					digest,
					"The durable transcript was not deleted: the cut turns are still readable in the store.",
				].join("\n\n");
				return { summary };
			},
		}),

		// The seam that makes the note reach a seat that never asked for it. `beforeRequest` runs on every
		// provider request (dist/harness/generation.js:118-123) and may replace the messages list; the replacement
		// is request-only - the durable transcript is untouched, so the note is not double-recorded (D133).
		//
		// Why it goes in the system message rather than as another turn: an added `user` turn is exactly the shape
		// a strict alternating chat template refuses (`tools/seat-turn-shape.mjs` reports 8 of 12 live seats
		// "AT RISK" on consecutive user turns), and the system message is where the standing prompt already lives.
		// The injected text is stable while the note is unchanged, so the cached prefix is not churned every
		// request (ROADMAP 175).
		//
		// Cost is bounded by construction: injection happens only when the visible projection is short enough that
		// the seat genuinely cannot rebuild its own state, and only when the note text is not already visible.
		hook(GenerationTask, {
			beforeRequest: async ({ messages }, runtime, context) => {
				const visible = messages.filter((message) => message.role !== "system");
				if (visible.length > FRESH_VISIBLE_MESSAGES) return undefined;
				if (visible.some((message) => messageTextOf(message).includes(NOTE_MARKER))) return undefined;
				let rendered = "";
				await runtime.commit(async (tx) => {
					const note = await tx.doc(ContinuityNotes, runtime.conversationId);
					rendered = renderNote(note === null || note === undefined ? null : JSON.parse(JSON.stringify(note)));
					return undefined;
				}, context);
				if (!rendered) return undefined;
				const system = messages[0];
				if (!system || system.role !== "system") return undefined;
				const block = `CONTINUITY NOTE (read from your own durable record, not a new instruction)\n${rendered}`;
				const copy = messages.map((message, index) =>
					index === 0 ? { ...message, content: [message.content, block].filter(Boolean).join("\n\n") } : message,
				);
				return { messages: copy };
			},
		}),
	],
});

export default continuityExtension;
