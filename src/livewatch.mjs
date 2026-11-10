// src/livewatch.mjs — the in-flight seam, rebuilt for pi-durable 1.5.1.
//
// WHY THIS EXISTS. `watchEvents(harness, conversationId, context)` (dist/harness/events.d.ts at the
// previous pin) was pi-durable's agent event stream: a snapshot plus one serialized batch per commit
// carrying `run_start` / `turn_start` / `message_update` (streamed deltas) / `turn_end` / `run_end`.
// It is GONE at v1.5.1 (measured: `node .spike/pin-update/symbol-probe2.mjs` reports
// `pi-durable does not provide an export named 'watchEvents'`; `grep -rn 'message_update|run_start'
// vendor/pi-main/packages/durable/src` returns nothing). What 1.5.1 keeps is the live document itself:
// `pi.live` (`LiveDoc`), whose `generation.message` is the "committed throttled partial of the
// in-flight response" (vendor/pi-main/packages/durable/src/harness/live.ts:163-170). So the in-flight
// signal is now the live document's changes, and this module translates those changes back into the
// event shapes src/inflight.mjs, src/guard.mjs and src/tui/durable/bridge.mjs already speak.
//
// WHAT IS APPROXIMATE, SAID OUT LOUD:
//   - Deltas arrive at pi.live's commit cadence, not per token. With `settings.progress.persistWithinMs`
//     at its 1,000 ms default the TUI's streaming is coarser than it was. The cadence is a seat
//     decision (ROADMAP 355), not something this module invents.
//   - `turn_start`/`turn_end` are derived from the generation attempt, not from a turn record; a
//     multi-turn run may see one `turn_start` per attempt rather than per turn.
//   - Nothing here writes. It is a read-attach, exactly like the stream it replaces.
import { LiveDoc } from "@earendil-works/pi-durable";

/** Concatenated visible text of the in-flight partial (thinking excluded: the guard judges prose). */
function partialText(live) {
	const content = live?.generation?.message?.content;
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const block of content) {
		if (block?.type === "text" && typeof block.text === "string") text += block.text;
	}
	return text;
}

/**
 * Attach to one conversation's live state. Returns the same handle shape the old stream had:
 * `start(handler)` (handler receives the event batch), `stop()`.
 */
export async function watchLive(harness, conversationId, context) {
	const handle = await harness.watchDoc(LiveDoc, conversationId, context);
	const handlers = [];
	let prev = { running: false, attempt: 0, retryAt: null, compactionIds: new Set(), text: "" };

	handle.start(async (call) => {
		if (call?.kind !== "value") return;
		const live = call.value ?? {};
		const events = [];

	 const running = live.run !== undefined;
		const attempt = Number(live.generation?.attempt ?? 0);
		const text = partialText(live);
	 const retryAt = live.generation?.retry?.at ?? null;
		const compactions = Array.isArray(live.compactions) ? live.compactions : [];

		if (running && !prev.running) events.push({ type: "run_start" });
		if (running && attempt > prev.attempt) {
			events.push({ type: "turn_start" });
			// The in-flight partial may not exist yet on the first attempt frame. The placeholder must be a
			// real assistant MESSAGE (`role`, not `type`): InteractiveMode's message_start handler keys on
			// `role`, so a shapeless placeholder swallows the whole streamed answer.
			events.push({
				type: "message_start",
				message: live.generation?.message ?? {
					role: "assistant",
					content: [],
					provider: live.generation?.model?.provider ?? "unknown",
					model: live.generation?.model?.modelId ?? "unknown",
					stopReason: "stop",
				},
			});
		}
		if (text.length > prev.text.length) {
			events.push({
				type: "message_update",
				changes: [{ type: "text_delta", contentIndex: 0, delta: text.slice(prev.text.length) }],
			});
		}
		if (retryAt !== prev.retryAt) {
			if (retryAt !== null) events.push({ type: "auto_retry_start", attempt, at: retryAt, error: live.generation?.retry?.error });
			else if (prev.retryAt !== null) events.push({ type: "auto_retry_end", attempt });
		}
		const nowIds = new Set(compactions.map((c, i) => String(c?.id ?? i)));
		for (const id of nowIds) if (!prev.compactionIds.has(id)) events.push({ type: "compaction_start", id });
		for (const id of prev.compactionIds) if (!nowIds.has(id)) events.push({ type: "compaction_end", id });
		if (!running && prev.running) events.push({ type: "run_end", failure: live.runFailure ?? null });

		prev = { running, attempt, retryAt, compactionIds: nowIds, text };
		if (events.length) for (const handler of handlers) handler(events);
	});

	return {
		start: (handler) => handlers.push(handler),
		stop: async () => {
			try {
				await handle.stop();
			} catch {
			 // a closing Session may refuse the stop; the watch is already detached
			}
		},
	};
}
