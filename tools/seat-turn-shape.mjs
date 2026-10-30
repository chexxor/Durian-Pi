// tools/seat-turn-shape.mjs — what conversation shape will the NEXT provider call for this seat actually carry?
//
// WHY (delegate-landed 2026-10-30; D174, premise for #4886). A verifier leg was dead for four sessions and every
// session hunted its CONTEXT WINDOW, because the last visible error mentioned context. The real refusal was
// structural and arrived in ~30 ms with zero tokens. Nothing measured the shape, so the diagnosis cost ~30 minutes
// of wall clock per session while being a two-second read of the store. This is that two-second read. It earned
// its keep the day it landed: it cleared a turn that then failed, which is how the predicate below got replaced
// with the template's actual rule rather than a plausible one.
//
// WHAT IT READS, and why that is the product's own answer rather than a second interpretation: `replayView` from
// src/compacteval.mjs — durian-pi's existing mirror of pi-durable's replay (its header says it mirrors
// `leadWithSystem`; `isHeadMarker`/`resolveHeadEntryId` implement the `pi.reset` / `pi.compaction` head markers
// that TRUNCATE what a turn sees). Entries come from `storage.scanEntries`, the same primitive `cli.mjs log` uses
// (cli.mjs:2333). The message list printed here is the list the next turn is built from, not a guess about it.
//
// THE PREDICATE IS THE PROVIDER TEMPLATE'S OWN, not a heuristic. The check LM Studio generated for the served
// model is literal — `.lmstudio/.internal/temp/lmstudio-chat-template-*/chat-template.jinja`, block
// "Checks for alternating user/assistant messages.", `raise_exception` at line 48:
//
//   {%- if message.role == 'user' or (message.role == 'assistant' and message.tool_calls | length == 0) %}
//       {%- if (message['role'] == 'user') != (ns.index % 2 == 0) %} {{- raise_exception(...) }}
//       {%- set ns.index = ns.index + 1 %}
//
// so the sequence that must alternate is every `user` PLUS every `assistant` carrying NO tool calls. A
// tool-calling assistant and a tool result are SKIPPED: an assistant turn that ended in tool calls does not
// satisfy the alternation for the next user turn, so two user messages become adjacent in the counted projection.
// The first counted message must be `user` (index 0). `system` sits outside that loop. `hasToolCalls` reads both
// the durable/pi message shape (`content[].type === "toolCall"`) and the provider shape (`tool_calls`), because
// the store keeps the former and the template sees the latter.
//
// A FINDING IS STILL NOT A VERDICT. This predicate is exact for this template family; other providers differ. A
// tolerant provider — this rig's local model — accepts these shapes and its seats look healthy, which is exactly
// how the residue went unnoticed for four sessions. Read a finding as: a strict alternating template refuses this
// turn before any context window is reached.
//
// WHY THE `send` PRE-FLIGHT IS THE POINT: sending to a seat whose next turn is inadmissible costs a full model
// round trip, returns `model_error` with no reply, AND appends another user entry — so the poison grows
// monotonically (one seat measured at 184 user turns, 193 errored assistant turns, and 1 assistant turn carrying
// any text; the same seat picked up 4 more errored turns in one more attempt, at a window that was ample).
//
// READ-ONLY: it opens the store through `src/readclient.mjs` (`openNodeSqliteStorage`, closed in a `finally`) and
// writes nothing — no entries, no tasks, no files. It never opens a harness, so it cannot resume scheduling or
// start driving work (docs/DECISIONS.md D11). It repairs nothing: writing a handoff is `reset <seat> <handoff>`,
// and minting a row is `pm`'s verb.
//
// Usage: node tools/seat-turn-shape.mjs [--db <path>] [--seat <name>] [--explain <name>] [--json] [--quiet]
//        [--strict] [--max-entries N]
//   --db defaults to $DURIG_DB, else ./selfdev.sqlite. --strict exits 1 on any finding, for a gate or suite.
//   --explain prints the counted projection for one seat.
// Exit: 0, unless the store cannot be opened, or --strict and findings exist.

import { pathToFileURL } from "node:url";

import { readLocal } from "../src/readclient.mjs";
import { readSeatList } from "../src/readapi.mjs";
import { replayView, entryMessages, resolveHeadEntryId } from "../src/compacteval.mjs";

/** Tool calls in either shape: the store keeps `content[].type === "toolCall"`, the template sees `tool_calls`. */
export function hasToolCalls(message) {
	if (Array.isArray(message?.tool_calls) && message.tool_calls.length) return true;
	if (Array.isArray(message?.toolCalls) && message.toolCalls.length) return true;
	return (message?.content ?? []).some((p) => p?.type === "toolCall" || p?.type === "tool_call");
}

/**
 * The projection the strict template enforces alternation over: every `user`, plus every `assistant` carrying NO
 * tool calls. Tool-calling assistants and tool results are skipped, so an assistant turn that ended in tool calls
 * leaves the next user turn unpaired.
 */
export function countedSequence(rows) {
	return (rows ?? []).filter(
		(m) => m?.role === "user" || (m?.role === "assistant" && !hasToolCalls(m)),
	);
}

/** Parity breaks in the counted projection: even indices must be `user`, odd indices `assistant`. */
export function alternation(rows) {
	const seq = countedSequence(rows);
	const hits = [];
	seq.forEach((m, i) => {
		const expected = i % 2 === 0 ? "user" : "assistant";
		if (m.role !== expected) hits.push({ at: i, saw: m.role, expected });
	});
	return { seq, hits };
}

/** One seat's shape from its replay window: parity breaks, empty assistants, and whether the next send is safe. */
export function assessWindow(rows, { windowComplete = true } = {}) {
	const counted = countedSequence(rows);
	const { hits } = alternation(rows);
	const assistants = (rows ?? []).filter((m) => m?.role === "assistant");
	const emptyAssistant = assistants.filter(
		(m) => !(m.content ?? []).length && !hasToolCalls(m),
	).length;
	const stopReasons = {};
	for (const m of assistants) {
		const r = m.stopReason ?? m.rawStopReason ?? null;
		stopReasons[r] = (stopReasons[r] ?? 0) + 1;
	}
	return {
		windowMessages: (rows ?? []).length,
		roles: (rows ?? []).map((m) => m.role),
		countedRoles: counted.map((m) => m.role),
		violations: hits.length,
		violationAt: hits.slice(0, 6),
		emptyAssistant,
		stopReasons,
		lastCounted: counted.at(-1)?.role ?? null,
		// `send` appends one user message. The template's counted projection must then land that user on an even
		// index, i.e. the projection must currently end on `assistant` (or be empty).
		nextSendAdmissible: counted.at(-1)?.role !== "user" && counted.length % 2 === 0,
		windowComplete,
	};
}

/** Residue counts over a scanned page; `lowerBound` when the scan was capped before covering everything. */
export function assessResidue(entries, { lowerBound = false } = {}) {
	return {
		scanned: entries.length,
		lowerBound,
		userTurns: entries.filter((e) => e?.kind === "pi.user").length,
		erroredAssistantTurns: entries.filter((e) =>
			entryMessages(e).some((m) => m.stopReason === "error"),
		).length,
	};
}

/** Was the replay window fully covered by the scan? A head marker inside the scanned range proves it was. */
export function windowIsComplete(raw, marker) {
	if (!raw.length) return true;
	if (!marker) return false;
	const start = resolveHeadEntryId(marker);
	return typeof start === "number" ? raw[0].id <= start : true;
}

async function seatShape(storage, seat, maxEntries) {
	const CTX = {
		actor: "instrument",
		reason: "seat-turn-shape: read the replay window a turn is built from",
	};
	const page = await storage.scanEntries(
		{ conversationId: seat.conversationId, order: "descending" },
		maxEntries,
		undefined,
		CTX,
	);
	const raw = (page.items ?? []).slice().reverse(); // replayView wants eval (oldest-first) order
	const view = replayView(raw);
	const capped = raw.length >= maxEntries;
	return {
		seat: seat.name,
		conversationId: seat.conversationId,
		entriesScanned: raw.length,
		marker: view.marker
			? { kind: view.marker.kind, id: view.marker.id, head: view.marker.head }
			: null,
		...assessWindow(view.messages ?? [], { windowComplete: windowIsComplete(raw, view.marker) }),
		residue: assessResidue(raw, { lowerBound: capped }),
	};
}

export async function readSeatShapes(db, { seat = null, maxEntries = 6000 } = {}) {
	return readLocal(db, async (storage) => {
		const seats = await readSeatList(storage);
		const picked = seat ? seats.filter((s) => s.name === seat) : seats;
		if (!picked.length) throw new Error(`no seat named ${seat}`);
		const shapes = [];
		for (const s of picked) shapes.push(await seatShape(storage, s, maxEntries));
		return shapes;
	});
}

export function findingsIn(shapes) {
	return shapes.filter(
		(s) => s.violations > 0 || s.emptyAssistant > 0 || !s.nextSendAdmissible || !s.windowComplete,
	);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	const argv = process.argv.slice(2);
	const flag = (n) => argv.includes(n);
	const opt = (n, dflt) => {
		const i = argv.indexOf(n);
		return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")
			? argv[i + 1]
			: dflt;
	};
	const DB = opt("--db", process.env.DURIG_DB || "./selfdev.sqlite");
	const ONLY = opt("--seat", null);
	const EXPLAIN = opt("--explain", null);
	const MAX = Number(opt("--max-entries", 6000));
	const t0 = Date.now();
	let out;
	try {
		out = await readSeatShapes(DB, { seat: ONLY, maxEntries: MAX });
	} catch (err) {
		console.error(`seat-turn-shape: cannot read ${DB}: ${err?.message ?? err}`);
		process.exit(1);
	}
	const findings = findingsIn(out);
	if (flag("--json")) {
		console.log(
			JSON.stringify(
				{ ok: true, instrument: "seat-turn-shape", db: DB, seats: out, findings: findings.length },
				null,
				2,
			),
		);
	} else if (flag("--quiet")) {
		console.log(
			`SEAT TURN SHAPE  ${out.length} seats; counted-projection parity breaks: ${out.filter((s) => s.violations > 0).length}; next send at risk: ${out.filter((s) => !s.nextSendAdmissible).length}; findings ${findings.length}`,
		);
	} else {
		console.log(
			"SEAT TURN SHAPE  (the replay window the NEXT provider call is built from — src/compacteval.mjs replayView over storage.scanEntries; read-only)",
		);
		for (const s of out) {
			console.log(
				`\nseat ${s.seat}  conv ${s.conversationId}  scanned ${s.entriesScanned}  head marker ${s.marker ? `${s.marker.kind}@${s.marker.id}` : "NONE (whole transcript is in the window)"}`,
			);
			console.log(
				`  window ${s.windowMessages} messages: ${s.roles.slice(0, 14).join(",")}${s.roles.length > 14 ? ",…" : ""}${s.windowComplete ? "" : "  [WINDOW MAY EXTEND FURTHER BACK — scan capped]"}`,
			);
			console.log(
				`  counted projection (${s.countedRoles.length}): ${s.countedRoles.join(",") || "(empty)"}`,
			);
			console.log(
				`  alternation: ${s.violations} parity break(s)${s.violations ? ` — first ${JSON.stringify(s.violationAt[0])}` : ""}`,
			);
			console.log(
				`  assistant turns: ${
					Object.keys(s.stopReasons).length
						? Object.entries(s.stopReasons)
								.map(([k, v]) => `${k}=${v}`)
								.join(" ")
						: "none"
				}; empty-content assistants with no tool calls: ${s.emptyAssistant}`,
			);
			console.log(
				`  scanned transcript: ${s.residue.lowerBound ? ">= " : ""}${s.residue.userTurns} user turn(s), ${s.residue.lowerBound ? ">= " : ""}${s.residue.erroredAssistantTurns} errored assistant turn(s) — a head marker HIDES these from the window, it does not remove them`,
			);
			console.log(
				`  next send: ${s.nextSendAdmissible ? `ADMISSIBLE (counted projection ends on ${s.lastCounted ?? "nothing"}, length ${s.countedRoles.length})` : "AT RISK — a strict alternating template refuses another user turn here, before any window is reached"}`,
			);
			if (EXPLAIN === s.seat)
				console.log(`  explain: counted projection ${JSON.stringify(s.countedRoles)}`);
		}
		console.log(
			`\nVERDICT: ${findings.length} finding(s) across ${out.length} seats; ${out.filter((s) => s.violations > 0).length} carry a counted-projection parity break${findings.length ? " — FINDING, not verdict: a tolerant provider accepts these, a strict alternating template refuses them (D174)" : ""}`,
		);
		console.log(
			`cost ${((Date.now() - t0) / 1000).toFixed(1)}s, ${out.reduce((n, s) => n + s.entriesScanned, 0)} entries read, 0 writes`,
		);
	}
	process.exit(flag("--strict") && findings.length ? 1 : 0);
}
