// The structural view of a rig, as plain values. D21 splits the interactive
// frontend question into data first and screen later: a caller needs "what is
// the transcript" and "who connects to whom" before it can decide whether a TUI
// or a browser sits on top. Keeping those derivations here rather than inside
// the renderer is what lets `log`, `watch`, `status` and a future client share
// one answer instead of each growing its own.
//
// Nothing here touches storage or the harness: entries and queue items are
// already plain records, so these are pure functions over them and can be
// tested without a database. Rendering stays in src/chatview.mjs and
// src/watchview.mjs; this module never formats on-screen text.

import { extractEntryText } from "./rigstory.mjs";

// The system entry carries durig's own constitution and prompt scaffolding.
// It is a turn's plumbing, not something the seat said, so it is excluded from
// the view model rather than filtered by each renderer.
const NOT_CONVERSATION = new Set(["pi.system"]);

function stampOf(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : null;
	const ts = message?.timestamp;
	return Number.isFinite(ts) ? ts : null;
}

// Tool calls live inside the assistant message that requested them, so the call
// name and arguments are only reachable from there; the result arrives later as
// its own entry, correlated by toolCallId.
export function extractToolCalls(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : null;
	if (!Array.isArray(message?.content)) return [];
	return message.content
		.filter((part) => part?.type === "toolCall")
		.map((part) => ({ id: part.id ?? part.toolCallId ?? null, name: part.name ?? "tool", args: part.arguments }));
}

// The model's reasoning is stored as thinking blocks beside the text it
// produced. It is the seat's travelogue, never its speech. A safety filter can
// empty the body while keeping the block (`redacted`), in which case the
// block's existence is itself the fact to report - "no thinking" and "thinking
// withheld" are different facts to an operator reading a transcript.
export function extractThinking(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : null;
	if (!Array.isArray(message?.content)) return null;
	const parts = message.content.filter((part) => part?.type === "thinking");
	if (!parts.length) return null;
	const text = parts
		.map((part) => part.thinking ?? "")
		.join("")
		.trim();
	const redacted = parts.some((part) => part.redacted === true);
	return text || redacted ? { text, redacted } : null;
}

// The unit of the view model is a TURN, not an entry: one operator message, one
// agent message, or one tool call together with its output. A call and its
// result are one act of work, so they share one timestamp. Reordering thinking
// after the act it explains would read as justification written afterwards, so
// the turn order follows the content order the model produced.
export function buildTurns(entries) {
	const ordered = (entries ?? []).filter((e) => e && !NOT_CONVERSATION.has(e.kind));
	const resultsById = new Map();
	for (const entry of ordered) {
		if (entry.kind !== "pi.tool-result") continue;
		const id = entry.model?.[0]?.toolCallId;
		if (id) resultsById.set(id, entry);
	}

	const consumed = new Set();
	const turns = [];
	for (const entry of ordered) {
		if (entry.kind === "pi.user") {
			turns.push({ kind: "operator", ts: stampOf(entry), entries: [entry] });
			continue;
		}
		if (entry.kind === "pi.assistant") {
			const thinking = extractThinking(entry);
			if (thinking) {
				turns.push({ kind: "thinking", ts: stampOf(entry), text: thinking.text, redacted: thinking.redacted });
			}
			const parsed = extractEntryText(entry);
			if (parsed?.text.trim()) turns.push({ kind: "agent", ts: stampOf(entry), entries: [entry], text: parsed.text.trim() });
			for (const call of extractToolCalls(entry)) {
				const result = call.id ? resultsById.get(call.id) : undefined;
				if (result) consumed.add(result);
				turns.push({ kind: "tools", ts: stampOf(entry), call, result });
			}
			continue;
		}
		// A tail window can start after the call that produced a result, so an
		// unconsumed result still has to be shown rather than silently dropped.
		if (entry.kind === "pi.tool-result" && !consumed.has(entry)) {
			turns.push({ kind: "tools", ts: stampOf(entry), call: null, result: entry });
		}
	}
	return turns;
}

// The lines a collapsed turn hides: everything after the one-line preview.
// Only thinking and tool results collapse, because only they arrive as blocks
// of machine output whose length is unrelated to how much a reader needs. An
// agent or operator message is prose and is never hidden behind a count.
export function turnRemainder(turn) {
	if (turn?.kind === "thinking") {
		if (turn.redacted && !turn.text) return [];
		return turn.text.split("\n").slice(1);
	}
	if (turn?.kind === "tools") {
		const output = (extractEntryText(turn.result)?.text ?? "").replace(/\s+$/, "");
		return output.split("\n").slice(1);
	}
	return [];
}

// Collapse state as a value, so the renderer does not decide it inline and a
// future client can ask the same question ("is this turn folded, and how much
// is behind the fold?") without re-deriving the preview rule. `hiddenLines` is
// the number the folded row reports; `full` means nothing is folded.
export function turnCollapse(turn, { full = false } = {}) {
	const lines = turnRemainder(turn);
	return { collapsed: !full && lines.length > 0, hiddenLines: full ? 0 : lines.length, lines };
}

function addEdge(map, peer, item) {
	const id = Number(item.id);
	const prev = map[peer];
	if (!prev) {
		map[peer] = { count: 1, latestId: item.id ?? null, latestSubject: item.subject ?? "" };
		return;
	}
	prev.count += 1;
	// Queue ids are monotonic, so the newest interaction is a comparison on id
	// rather than on a timestamp the item may not carry. A non-numeric id cannot
	// claim to be newest, so it only ever replaces an also-unknown one.
	const prevId = Number(prev.latestId);
	if (Number.isFinite(id) && (!Number.isFinite(prevId) || id > prevId)) {
		prev.latestId = item.id;
		prev.latestSubject = item.subject ?? "";
	}
}

/**
 * The peer half of the view model: which seat sent to / received from which,
 * built from the queue's from/to. Direction is kept because durig's org edges
 * are directional - a seat may send where another may not - so collapsing the
 * two into one undirected edge would throw away the permission the graph exists
 * to show. Self-items (a seat addressing itself) are skipped: they are not a
 * navigation target.
 *
 * `edges` is the flat list a graph renderer wants; `seats` is the per-seat
 * adjacency a switcher wants.
 */
export function peerGraph(items = []) {
	const seats = {};
	const edges = [];
	const ensure = (name) => {
		if (!seats[name]) seats[name] = { sent: {}, received: {} };
		return seats[name];
	};
	for (const item of items) {
		const from = item?.from;
		const to = item?.to;
		if (!from || !to || from === to) continue;
		addEdge(ensure(from).sent, to, item);
		addEdge(ensure(to).received, from, item);
		edges.push({ from, to, id: item.id ?? null, subject: item.subject ?? "", status: item.status ?? null });
	}
	return { seats, edges };
}

/**
 * The seats a given seat has exchanged work with, newest interaction first.
 * This is the list a "switch to the agent you were just talking to" control is
 * built from, so it merges both directions and reports which one each peer is.
 */
export function peerTargets(graph, seatName) {
	const seat = graph?.seats?.[seatName];
	if (!seat) return [];
	const names = new Set([...Object.keys(seat.sent), ...Object.keys(seat.received)]);
	return [...names]
		.map((name) => {
			const sent = seat.sent[name] ?? null;
			const received = seat.received[name] ?? null;
			const latestId = Math.max(
				Number.isFinite(Number(sent?.latestId)) ? Number(sent.latestId) : -1,
				Number.isFinite(Number(received?.latestId)) ? Number(received.latestId) : -1,
			);
			return {
				name,
				sentCount: sent?.count ?? 0,
				receivedCount: received?.count ?? 0,
				sentTo: Boolean(sent),
				receivedFrom: Boolean(received),
				latestId: latestId >= 0 ? latestId : null,
				latestSubject: (Number(sent?.latestId) === latestId ? sent?.latestSubject : received?.latestSubject) ?? "",
			};
		})
		.sort((a, b) => (b.latestId ?? -1) - (a.latestId ?? -1) || a.name.localeCompare(b.name));
}

/**
 * The in-flight assistant partial, as a value. It is deliberately NOT a turn:
 * it has no entry id and no committed timestamp, the platform deletes it when the
 * run settles (`pi.live.generation` is removed at run end), and it may be
 * rewritten between polls. Feeding it into `buildTurns` would let transient text
 * masquerade as history, so the two views are kept apart and a caller must render
 * the partial through its own distinctly-labelled path.
 *
 * Returns null when nothing is generating, so a caller can treat null as "no
 * streaming now" without inspecting the live document’s shape.
 */
export function partialView(live) {
	const message = live?.generation?.message;
	if (!message) return null;
	const content = Array.isArray(message.content) ? message.content : [];
	const join = (type, field) =>
		content
			.filter((part) => part?.type === type)
			.map((part) => part[field] ?? "")
			.join("");
	const text = join("text", "text");
	const thinking = join("thinking", "thinking");
	// Only running slots are progress; a done slot has already become an entry.
	const tools = (live?.tools ?? [])
		.filter((slot) => slot?.status === "running")
		.map((slot) => ({ name: slot.name ?? "tool", callId: slot.callId ?? null }));
	return {
		attempt: live?.generation?.attempt ?? null,
		text,
		thinking,
		tools,
		hasContent: Boolean(text.trim() || thinking.trim() || tools.length),
	};
}
