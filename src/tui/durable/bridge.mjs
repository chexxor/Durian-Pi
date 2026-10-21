// Stateful bridge from pi-durable `AgentEvent`s to pi-coding-agent
// `AgentSessionEvent`s.
//
// The durable stream is deliberately close to the coding agent's, but two
// differences need state here:
//   - `message_update` carries deltas (`changes`), while the TUI reads
//     `event.message`; the in-flight assistant message is accumulated.
//   - `tool_execution_update` carries output trims/appends, while the TUI reads
//     `event.partialResult`; each call's output text is accumulated.
// Events with no coding-agent analogue (snapshot, submission, task_failed,
// usage_changed) are recorded as ignored so a caller can assert the coverage.
import { applyMessageChanges, assistantMessageEventFor, messageOfEntry, toolResultFromDurableEvent } from "./translate.mjs";

const COMPACTION_REASONS = new Set(["manual", "threshold", "overflow"]);

export class DurableEventBridge {
	#current;
	#toolOutput = new Map();
	#ignored = [];
	#lastThinkingLevel;
	#mapEntry;
	#isCompactionMessage;
	#compactionPending = false;

	/**
	 * `mapEntry` maps a durable entry to a coding-agent session entry (for the
	 * compaction boundary); `isCompactionMessage` lets the bridge suppress the
	 * summary-bearing UserMessage durable stores on a `pi.compaction` entry, which
	 * would otherwise render as an operator message.
	 */
	constructor(options = {}) {
		this.#mapEntry = options.mapEntry;
		this.#isCompactionMessage = options.isCompactionMessage ?? (() => false);
	}

	/** Durable event types seen with no coding-agent equivalent, in arrival order. */
	get ignoredEvents() {
		return [...this.#ignored];
	}

	/**
	 * Translate one durable event batch into coding-agent events.
	 *
	 * A batch is one commit, which the durable producer already ordered, so the
	 * output preserves that order.
	 */
	translate(events) {
		const out = [];
		for (const event of events) out.push(...this.#one(event));
		return out;
	}

	#one(event) {
		switch (event.type) {
			case "run_start":
				return [{ type: "agent_start" }];
			case "run_end":
				return [
					{ type: "agent_end", messages: [], willRetry: false },
					{ type: "agent_settled", aborted: false },
				];
			case "turn_start":
				return [{ type: "turn_start" }];
			case "turn_end":
				return [{ type: "turn_end" }];
			case "message_start":
				if (this.#isCompactionMessage(event.message)) {
					this.#compactionPending = true;
					return [];
				}
				this.#current = event.message;
				return [{ type: "message_start", message: event.message }];
			case "message_update": {
				if (this.#compactionPending || this.#current === undefined) return [];
				this.#current = applyMessageChanges(this.#current, event.changes);
				const assistantMessageEvent = event.changes.at(-1);
				return [
					{
						type: "message_update",
						message: this.#current,
						assistantMessageEvent:
							assistantMessageEvent === undefined
								? { type: "message", partial: this.#current }
								: assistantMessageEventFor(assistantMessageEvent, this.#current),
					},
				];
			}
			case "message_end": {
				if (this.#compactionPending || event.entry?.kind === "pi.compaction") {
					this.#compactionPending = false;
					return this.#compactionEvent(event.entry);
				}
				const message = messageOfEntry(event.entry) ?? this.#current;
				this.#current = undefined;
				if (message === undefined) return [];
				return [{ type: "message_end", message }];
			}
			case "tool_execution_start":
				return [
					{
						type: "tool_execution_start",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						args: event.args,
						...(event.parentToolCallId === undefined ? {} : { parentToolCallId: event.parentToolCallId }),
					},
				];
			case "tool_execution_update": {
				const partialResult = this.#applyToolOutput(event);
				return [
					{
						type: "tool_execution_update",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						partialResult,
						...(event.parentToolCallId === undefined ? {} : { parentToolCallId: event.parentToolCallId }),
					},
				];
			}
			case "tool_execution_end": {
				const result = toolResultFromDurableEvent(event);
				this.#toolOutput.delete(event.toolCallId);
				return [
					{
						type: "tool_execution_end",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						result: result ?? { content: [], isError: false },
						isError: result?.isError === true,
						...(event.parentToolCallId === undefined ? {} : { parentToolCallId: event.parentToolCallId }),
					},
				];
			}
			case "auto_retry_start":
				return [
					{
						type: "auto_retry_start",
						attempt: event.attempt,
						maxAttempts: event.attempt,
						delayMs: Math.max(0, event.at - Date.now()),
						errorMessage: event.errorMessage,
					},
				];
			case "auto_retry_end":
				return [{ type: "auto_retry_end", success: true, attempt: event.attempt }];
			case "compaction_start":
				return [{ type: "compaction_start", reason: normalizeCompactionReason(event.reason) }];
			case "compaction_end":
				return [
					{
						type: "compaction_end",
						reason: normalizeCompactionReason(event.reason),
						result: undefined,
						aborted: false,
						willRetry: false,
						...(event.error === undefined ? {} : { errorMessage: event.error }),
					},
				];
			case "inbox_update":
				// The pending-items display reads the session's own queue accessors,
				// which the adapter serves from the durable inbox; this event only
				// tells the TUI to redraw.
				return [{ type: "queue_update", steering: [], followUp: [] }];
			case "agent_changed": {
				const level = event.agent?.thinkingLevel;
				if (level === undefined || level === this.#lastThinkingLevel) return [];
				this.#lastThinkingLevel = level;
				return [{ type: "thinking_level_changed", level }];
			}
			case "entry_appended":
				return this.#compactionEvent(event.entry);
			default:
				this.#ignored.push(event.type);
				return [];
		}
	}

	#compactionEvent(entry) {
		// A compaction entry is model-bearing, so durable presents it as a message;
		// the TUI renders it as a boundary only through its `entry_appended` path.
		const mapped = this.#mapEntry?.(entry);
		return mapped !== undefined && mapped.type === "compaction" ? [{ type: "entry_appended", entry: mapped }] : [];
	}

	#applyToolOutput(event) {
		const buffer = this.#toolOutput.get(event.toolCallId) ?? { output: "", details: undefined };
		if (event.output !== undefined) {
			if ("set" in event.output) buffer.output = event.output.set;
			else {
				if (event.output.trimStart) buffer.output = buffer.output.slice(event.output.trimStart);
				if (event.output.append) buffer.output += event.output.append;
			}
		}
		if (event.details !== undefined) buffer.details = event.details;
		this.#toolOutput.set(event.toolCallId, buffer);
		return { content: [{ type: "text", text: buffer.output }], details: buffer.details, isError: false };
	}
}

function normalizeCompactionReason(reason) {
	return COMPACTION_REASONS.has(reason) ? reason : "manual";
}
