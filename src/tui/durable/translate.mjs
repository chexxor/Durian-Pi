// Pure mappings between pi-durable structures and pi-coding-agent structures.
//
// No I/O and no state live here, so every mapping is directly testable. The
// stateful event accumulator is in bridge.mjs.
//
// The two packages share pi-ai message types, but their transcript envelopes
// differ: pi-durable entries carry `model` (Message[]) and a numeric id with no
// timestamp, while coding-agent SessionEntry carries one message, a string id,
// and an ISO timestamp. The timestamp gap is bridged by the caller (see
// boot.mjs); these functions take the timestamp as an argument.

/** The first model message an entry contributes, or undefined for bookkeeping entries. */
export function messageOfEntry(entry) {
	return entry.model?.[0];
}

/** Text of a message's text content, regardless of string or parts form. */
function textOf(message) {
	if (message === undefined) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

// pi-durable wraps the summary it stores in a UserMessage; these delimit the raw summary within it.
const COMPACTION_KIND = "pi.compaction";
const SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const SUMMARY_SUFFIX = "\n</summary>";

/**
 * Whether a message is a compaction summary.
 *
 * pi-durable stores the summary as a model-bearing entry, so the event stream
 * presents it as a user message; the bridge must not render it as one.
 */
export function isCompactionSummaryMessage(message) {
	return message?.role === "user" && textOf(message).startsWith(SUMMARY_PREFIX);
}

const TRANSCRIPT_ROLES = new Set(["user", "assistant", "toolResult"]);

/**
 * Map one durable entry to a coding-agent session entry.
 *
 * A `pi.compaction` entry maps to a coding-agent `CompactionEntry` so the TUI
 * renders a compaction boundary and rebuilds the context from it. Message
 * entries map only for the three transcript roles; pi.system is an internal
 * prompt marker and pi.reset/bookkeeping kinds have no per-message rendering,
 * so those return undefined deliberately rather than rendering wrongly.
 */
export function sessionEntryFromDurable(entry, timestamp, tokensBefore = 0) {
	if (entry.kind === COMPACTION_KIND) {
		const text = textOf(messageOfEntry(entry));
		const start = text.startsWith(SUMMARY_PREFIX) ? SUMMARY_PREFIX.length : 0;
		const end = text.endsWith(SUMMARY_SUFFIX) ? text.length - SUMMARY_SUFFIX.length : text.length;
		return {
			type: "compaction",
			id: String(entry.id),
			parentId: null,
			timestamp,
			summary: sanitizeRenderable(text.slice(start, end)),
			firstKeptEntryId: entry.head === undefined ? null : String(entry.head),
			tokensBefore,
		};
	}
	const message = messageOfEntry(entry);
	if (message === undefined || !TRANSCRIPT_ROLES.has(message.role)) return undefined;
	return {
		type: "message",
		id: String(entry.id),
		parentId: null,
		timestamp,
		// #4009: the boundary where a durable entry becomes renderable data.
		message: sanitizeRenderable(message),
	};
}

import { sanitizeTerminalText } from "../../sanitize.mjs";

/**
 * THE ONE PLACE TEXT IS SANITISED ON THE DURABLE PATH (#4009).
 *
 * The landing/poller renderer applies `src/sanitize.mjs` at 20+ call sites; the DURABLE renderer
 * applied it at none, and attach (#4006) points the durable renderer at a SEAT's conversation. The
 * architecture gives us no hook inside pi's `InteractiveMode` — it owns the components — but it does
 * give us this boundary: every durable entry becomes renderable data HERE, in three functions, so
 * the rule lives in one exported helper instead of being sprinkled at call sites.
 *
 * WHY IT IS STILL NEEDED DESPITE pi: pi's own `stripAnsi` (dist/utils/ansi.js:36) covers OSC and CSI
 * only. It does NOT cover Unicode FORMAT characters — bidi overrides (U+202A-202E, U+2066-2069) or
 * zero-width/invisible ones — which is exactly the class #3962 added to the shared sanitizer. So on
 * this path ANSI is handled by pi and the format class is not; `sanitizeTerminalText` covers both,
 * and the ZWJ carve-out (emoji clusters) comes with it because it is the same shared module.
 */
export function sanitizeRenderable(value) {
	if (typeof value === "string") return sanitizeTerminalText(value);
	if (Array.isArray(value)) return value.map(sanitizeRenderable);
	if (value === null || typeof value !== "object") return value;
	const out = {};
	for (const [key, entry] of Object.entries(value)) out[key] = sanitizeRenderable(entry);
	return out;
}

/** The message a session entry wraps, without depending on the entry shape. */
export function sessionEntryMessage(entry) {
	return entry.type === "message" ? entry.message : undefined;
}

function setAtPath(root, path, delta) {
	if (path.length === 0) return typeof root === "string" ? root + delta : delta;
	let node = root;
	for (const key of path.slice(0, -1)) {
		const next = node[key];
		node = next === undefined || next === null ? (node[key] = {}) : next;
	}
	const last = path[path.length - 1];
	const current = node[last];
	node[last] = typeof current === "string" ? current + delta : delta;
	return root;
}

/**
 * Apply one batch of `MessageChange`s to an in-flight assistant message.
 *
 * pi-durable's `message_update` carries deltas, not the accumulated message;
 * coding-agent's `message_update` consumers read `event.message`. This rebuilds
 * the full message. A `message` or `block` change carries whole state and
 * overrides earlier deltas in the same batch, matching the durable producer.
 */
export function applyMessageChanges(message, changes) {
	const next = structuredClone(message);
	for (const change of changes) {
		if (change.type === "message") return sanitizeRenderable(structuredClone(change.message));
		if (change.type === "block") {
			next.content[change.contentIndex] = structuredClone(change.block);
			continue;
		}
		if (change.type === "text_start" || change.type === "thinking_start" || change.type === "toolcall_start") {
			next.content[change.contentIndex] = structuredClone(change.block);
			continue;
		}
		if (change.type === "text_delta" || change.type === "thinking_delta") {
			const block = next.content[change.contentIndex];
			if (block === undefined) continue;
			if (change.type === "text_delta" && block.type === "text") block.text += change.delta;
			else if (change.type === "thinking_delta" && block.type === "thinking") block.thinking += change.delta;
			continue;
		}
		if (change.type === "toolcall_delta") {
			const block = next.content[change.contentIndex];
			if (block === undefined || block.type !== "toolCall") continue;
			block.arguments = setAtPath(block.arguments ?? {}, change.path, change.delta);
		}
	}
	// #4009: the boundary where in-flight deltas become renderable data. Sanitising the ACCUMULATED
	// message (rather than each delta) means a sequence split across two deltas is still caught.
	return sanitizeRenderable(next);
}

/** The pi-ai assistant message event a coding-agent consumer expects alongside `message_update`. */
export function assistantMessageEventFor(change, message) {
	if (change.type === "text_start" || change.type === "text_delta") {
		return { type: change.type, contentIndex: change.contentIndex, delta: change.delta, partial: message };
	}
	if (change.type === "thinking_start" || change.type === "thinking_delta") {
		return { type: change.type, contentIndex: change.contentIndex, delta: change.delta, partial: message };
	}
	return { type: "message", partial: message };
}

/**
 * Rebuild a tool result in the shape coding-agent's tool-result event uses.
 * Durable reports the result as the committed ToolResultEntry; nested calls
 * carry a structured result instead.
 */
export function toolResultFromDurableEvent(event) {
	const message = event.entry === undefined ? undefined : messageOfEntry(event.entry);
	if (message !== undefined && message.role === "toolResult") {
		return { content: message.content, isError: message.isError === true, details: message.details };
	}
	const nested = event.result;
	if (nested !== undefined) {
		return { content: nested.content ?? [], isError: nested.isError === true, details: nested.details };
	}
	return undefined;
}
