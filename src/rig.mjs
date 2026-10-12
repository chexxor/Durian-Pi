// durig — minimal rig layer on pi-durable.
//
// Design notes:
// - Seats are pi-durable conversations; the seat NAME and role live in a
//   session-scoped registry document so any client can resolve name->id.
// - The cross-seat work queue is a session-scoped singleton document changed
//   in the same atomic commits as the transcripts that produce work, so a
//   queue item can never disagree with the conversation state that made it.
// - Mailbox semantics: every seat's tools see only items addressed to it;
//   completing an item enqueues a DONE notice back to the sender, so both
//   directions flow through one durable queue.
import { defineDoc, defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Seat roster: name -> conversation id + role text. Session singleton. */
export const Seats = defineDoc({
	kind: "durig.seats",
	version: 1,
	scope: "session",
	initial: () => ({ seats: {} }), // name -> {conversationId, role, goal, capabilities}
});

/** Organizational links: from -> allowed recipients. Absent/empty = open. */
export const Edges = defineDoc({
	kind: "durig.edges",
	version: 1,
	scope: "session",
	initial: () => ({ edges: [] }), // [{from, maySendTo:[names]}]
});

/** Constitution file text, injected into every seat's system prompt. */
export const Constitution = defineDoc({
	kind: "durig.constitution",
	version: 1,
	scope: "session",
	initial: () => ({ text: "" }),
});

/**
 * Gate for send_work: organizational edges (who may send to whom) and
 * capability requirements (A2A-style advertised tags). Throws with a
 * model-readable reason so the sending seat can self-correct.
 */
export async function assertSendAllowed(tx, from, to, requires) {
	const targetId = await seatId(tx, to);
	const edges = await tx.doc(Edges);
	if (edges.edges.length > 0) {
		const link = edges.edges.find((e) => e.from === from);
		if (!link || !link.maySendTo.includes(to)) {
			throw new Error(
				link
					? `org edge forbids ${from} -> ${to}; allowed: ${link.maySendTo.join(", ")}`
					: `no org edge grants ${from} any send target`,
			);
		}
	}
	if (requires) {
		const seats = await tx.doc(Seats);
		const caps = seats.seats[to]?.capabilities ?? [];
		if (!caps.includes(requires)) {
			throw new Error(
				`seat ${to} lacks required capability "${requires}" (has: ${caps.join(", ") || "none"})`,
			);
		}
	}
	return targetId;
}

/**
 * Cross-seat work queue.
 *
 * Status flow: queued -> claimed -> done, plus claimed <-> deferred: a seat that
 * cannot proceed without an answer parks the item it holds (`defer_work`) and
 * takes it back once the answer arrives (`resume_work`). Deferring is not a third
 * terminal state on purpose - an item parked forever with no way back would be
 * worse than the prose it replaces.
 *
 * Transitions are appended (audit trail), never mutated in place.
 */
export const RigQueue = defineDoc({
	kind: "durig.queue",
	version: 1,
	scope: "session",
	initial: () => ({ nextId: 1, items: [] }),
});

/**
 * The `deferredTo` value meaning "parked on a question for the human operator".
 *
 * Deliberately not a seat: the operator's channel is `status`/`watch` attention,
 * not the queue, so nothing is enqueued for this. Naming it explicitly is what
 * lets the attention layer say a seat is waiting on a person rather than
 * laundering the question back into seat-to-seat traffic.
 */
export const DEFERRED_TO_HUMAN = "human";

/** Resolve a seat name to its conversation id; throws on unknown seat. */
export async function seatId(tx, name) {
	const seats = await tx.doc(Seats);
	const seat = seats.seats[name];
	if (!seat) throw new Error(`unknown seat: ${name}`);
	return seat.conversationId;
}

/** Register a seat inside an existing transaction (caller owns the commit). */
export async function registerSeat(tx, name, conversationId, role) {
	const seats = await tx.doc(Seats);
	if (seats.seats[name]) throw new Error(`seat already registered: ${name}`);
	seats.seats[name] = { conversationId, role };
}

/**
 * Is this queue item a DONE acknowledgement rather than work? Completing a
 * notice must not enqueue another notice, or every ack spawns an ack and the
 * chain (#3 "DONE #1" -> #5 "DONE #3: DONE #1" -> #9 ...) grows without bound,
 * burning a seat turn per hop (ROADMAP 39). The structural `notice` flag is the
 * real mechanism, set at enqueue time; the subject shape is only a LEGACY
 * fallback for DONE items already in a store that predates the flag, which
 * would otherwise keep looping. Matching exactly the shape complete_work
 * enqueues ("DONE #<id>: <subject>") keeps the fallback from catching real work.
 */
export function isDoneNotice(item) {
	return item?.notice === true || /^DONE #\d+: /.test(String(item?.subject ?? ""));
}

/**
 * Enqueue work. Called inside a transaction; returns the assigned item id.
 * `transitions` records who did what and when for the audit trail.
 *
 * `notice` marks a protocol acknowledgement (a DONE notice) rather than work, so
 * completing it can be recognised structurally instead of by its subject.
 */
export async function enqueueItem(
	tx,
	from,
	to,
	subject,
	body,
	optimizedVia = null,
	notice = false,
) {
	const queue = await tx.doc(RigQueue);
	const id = queue.nextId++;
	queue.items.push({
		id,
		from,
		to,
		subject,
		body,
		// Provenance: non-null means the body was machine-optimized before
		// enqueue; names the model that did it. Null = human-written.
		optimizedVia,
		// A protocol notice (a DONE ack), not work: completing it enqueues nothing.
		notice,
		status: "queued",
		transitions: [{ at: new Date().toISOString(), event: "queued", by: from }],
	});
	return id;
}

// Tool results cross the content->output rename in @earendil-works/pi-durable:
// the 1.1.0 release reads `content`, current main reads `output`. Returning
// both keeps durig correct on the published release AND on pinned main, and
// each version ignores the field it does not know.
function toolText(text) {
	const content = [{ type: "text", text }];
	return { content, output: content };
}

// Thin-context return contract (agent-fleet borrow, ROADMAP RANK 1; source of
// truth: vendor/eval/agent-fleet @ 7c34dde, docs/ARCHITECTURE.md "Research
// helpers write findings to disk; the hub resumes specialists with paths, not
// raw dumps"; durig shape per docs/COMPETITORS.md "durig seats already write to
// disk, but our tool results still return bodies; the lesson is the return
// contract"). CONTRACT (verbatim): for claim_work (and any toolText result over
// the threshold), the tool returns a PATH; the full body is written to
// cwd/.durig/<itemId>.md and read back via existing read tools. Results under
// the threshold are unchanged (inline, byte-identical). Additive opt-in seam at
// toolText: small bodies stay inline; only the large claim body is deferred to
// disk. Deterministic per-item path so the demo can assert it and the body is
// idempotently re-readable (re-claim rewrites the same file).
export const TOOL_RESULT_INLINE_LIMIT = 2000;

/**
 * Write an over-threshold tool result body to the seat's disk workspace and
 * return A PATH, per the thin-context return contract. Under the threshold (or
 * when there is no usable seat workspace) the original text is returned
 * unchanged, so small/short results stay byte-identical and the coordinator's
 * context stays thin only for the large dump. The coordinator reads the body
 * back with its EXISTING read tools (confined to its cwd); no auto-read.
 * @param {{cwd?: string}|undefined} env the executing conversation's ExecutionEnv
 * @param {string} text the full tool-result text
 * @param {number|string} itemId the queue item id (deterministic file name)
 * @returns {string} a path (over threshold) or the original text (under)
 */
export function thinResultText(env, text, itemId) {
	if (typeof text !== "string" || text.length <= TOOL_RESULT_INLINE_LIMIT) return text;
	const cwd = env?.cwd;
	if (!cwd) return text; // no workspace to defer to: keep the inline contract
	const file = join(cwd, ".durig", `${itemId}.md`);
	mkdirSync(join(cwd, ".durig"), { recursive: true });
	writeFileSync(file, text, "utf8");
	// A bounded PREVIEW travels with the path: a coordinator seat (pm) has NO read
	// tool (COORDINATOR_REMOVALS), so a path alone made the item unreadable to it -
	// found live on #100, where pm deferred rather than guess. The preview keeps the
	// result bounded (thin-context's goal) while every seat can still act; a seat
	// with a read tool opens the file for the full body.
	const preview = text.slice(0, TOOL_RESULT_INLINE_LIMIT);
	return `${preview}\n\n[item #${itemId}: truncated at ${TOOL_RESULT_INLINE_LIMIT} chars; full text at ${file} - read it with your read tool if you have one.]`;
}

const Router = defineExtension({
	name: "durig.router",
	sections: [
		// Team constitution reaches every seat's system prompt here; the doc
		// is session-scoped so one edit re-arms all seats on next request.
		section("durig-constitution", async (input, context) => {
			const c = await input.read.snapshot(
				Constitution,
				input.conversationId,
				context,
			);
			return c?.text || undefined;
		}),
	],
	tools: [
		defineTool({
			name: "send_work",
			description:
				"Send a work item to another seat. The seat claims it from its queue.",
			parameters: Type.Object({
				to: Type.String({ description: "recipient seat name" }),
				subject: Type.String(),
				body: Type.String(),
				requires: Type.Optional(Type.String({
					description: "capability the recipient must advertise",
				})),
				optimize: Type.Optional(Type.Boolean({
					description: "Rewrite body through the instruction optimizer before enqueueing (costs one model call).",
				})),
			}),
			replay: "safe", // pure durable-state write; rerun after crash is idempotent-safe at doc level
			execute: async (args, api, context) => {
				try {
					const me = await mySeatName(api, context);
					let body = args.body;
					let optimizedVia = null;
					if (args.optimize) {
						// The optimizer rides the SAME model stack as the seats,
						// so its cost and latency are honest and it inherits the
						// generation-slot cap automatically.
						const { optimizeInstruction } = await import("./optimizer.mjs");
						// The seat's own configured model does the optimizing, so
						// cost/latency are honest and the slot cap is inherited.
						const modelRef = (await api.agent(context))?.model;
						if (!modelRef) throw new Error("no model configured for this seat; cannot optimize");
						const result = await optimizeInstruction(
							api.models,
							modelRef,
							args.body,
							{ kind: "work_request" },
						);
						body = result.optimized;
						if (!result.rejected) {
							optimizedVia = `${modelRef.provider}/${modelRef.modelId}`;
						}
					}
					const id = await api.commit(async (tx) => {
						await assertSendAllowed(tx, me, args.to, args.requires);
						return enqueueItem(tx, me, args.to, args.subject, body, optimizedVia);
					}, context);
					return toolText(`queued item #${id} for ${args.to}${optimizedVia ? ` (body optimized via ${optimizedVia})` : ""}`);
				} catch (err) {
					return toolText(`SEND_WORK_ERROR: ${err && err.stack ? err.stack : String(err)}`);
				}
			},
		}),
		defineTool({
			name: "claim_work",
			description:
				"Claim the oldest queued work item addressed to you. Returns its subject and body.",
			parameters: Type.Object({}),
			replay: "safe",
			execute: async (_args, api, context) => {
				const me = await mySeatName(api, context);
				const claimed = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find(
						(it) => it.to === me && it.status === "queued",
					);
					if (!item) return null;
					item.status = "claimed";
					item.transitions.push({
						at: new Date().toISOString(),
						event: "claimed",
						by: me,
					});
					// Snapshot plain values before returning: the commit
					// releases its overlay after settlement, and a proxy that
					// escapes the callback throws "Cannot use a settled
					// overlay" the moment its properties are read.
					return {
						id: item.id,
						from: item.from,
						subject: item.subject,
						body: item.body,
					};
				}, context);
				if (!claimed) {
					return toolText("NO_QUEUED_WORK");
				}
				const claimText = `ITEM #${claimed.id} | from=${claimed.from} | subject=${claimed.subject}\n${claimed.body}`;
				// Thin-context return contract: an over-threshold body goes to disk and
				// the tool returns a PATH, not the dump (see thinResultText / RANK-1).
				return toolText(await thinResultText(api.env, claimText, claimed.id));
			},
		}),
		defineTool({
			name: "complete_work",
			description:
				"Mark one of your claimed items done with a result. Sends a DONE notice back to the sender.",
			parameters: Type.Object({
				itemId: Type.Number(),
				resultSummary: Type.String(),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					if (item.to !== me || item.status !== "claimed") {
						return `item #${args.itemId} is not claimed by you (status=${item.status})`;
					}
					item.status = "done";
					item.resultSummary = args.resultSummary;
					item.transitions.push({
						at: new Date().toISOString(),
						event: "done",
						by: me,
					});
					// A DONE notice is an acknowledgement, not work: only real work gets
					// a DONE notice back, or the chain never ends (ROADMAP 39).
					// `isDoneNotice` also covers flag-less DONE items already in the
					// store that predate the structural flag.
					if (!isDoneNotice(item)) {
						await enqueueItem(
							tx,
							me,
							item.from,
							`DONE #${item.id}: ${item.subject}`,
							args.resultSummary,
							null,
							true,
						);
					}
					return `ok`;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "defer_work",
			description:
				"Stop and ask instead of guessing, or instead of silently stopping. Parks one of your claimed items on a question. Omit `to` to defer to the human operator, who sees it in `status`; pass `to` to also ask another seat. The item stays yours - call resume_work once you have the answer.",
			parameters: Type.Object({
				itemId: Type.Number(),
				question: Type.String({
					description: "the specific question that blocks the item",
				}),
				to: Type.Optional(Type.String({
					description:
						"seat to ask as well as deferring; omit to defer to the human operator",
				})),
			}),
			replay: "safe",
			execute: async (args, api, context) => {
				try {
					const me = await mySeatName(api, context);
					const out = await api.commit(async (tx) => {
						const queue = await tx.doc(RigQueue);
						const item = queue.items.find((it) => it.id === args.itemId);
						if (!item) return `unknown item #${args.itemId}`;
						if (item.to !== me)
							return `item #${args.itemId} is addressed to ${item.to}, not you`;
						if (item.status !== "claimed")
							return `item #${args.itemId} is not claimed by you (status=${item.status})`;
						// Asking a seat IS a send, so the org-edge and capability gates apply
						// to it exactly as they do to send_work. Checked BEFORE any state
						// changes, so a forbidden question cannot leave the item half-parked.
						if (args.to) await assertSendAllowed(tx, me, args.to);
						item.status = "deferred";
						item.question = args.question;
						item.deferredTo = args.to ?? DEFERRED_TO_HUMAN;
						item.transitions.push({
							at: new Date().toISOString(),
							event: "deferred",
							by: me,
							to: item.deferredTo,
						});
						if (args.to) {
							await enqueueItem(
								tx,
								me,
								args.to,
								`QUESTION #${item.id}: ${item.subject}`,
								args.question,
							);
						}
						return args.to
							? `item #${item.id} deferred to ${args.to}; that seat has the question. Resume your own item with resume_work(${item.id}) once it answers.`
							: `item #${item.id} deferred to the human operator, who sees it on the status line. Resume it with resume_work(${item.id}) once you have the answer.`;
					}, context);
					return toolText(out);
				} catch (err) {
					return toolText(`DEFER_WORK_ERROR: ${err && err.stack ? err.stack : String(err)}`);
				}
			},
		}),
		defineTool({
			name: "resume_work",
			description:
				"Take back one of your deferred items once the answer has arrived, so complete_work can finish it.",
			parameters: Type.Object({ itemId: Type.Number() }),
			replay: "safe",
			execute: async (args, api, context) => {
				const me = await mySeatName(api, context);
				const out = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					const item = queue.items.find((it) => it.id === args.itemId);
					if (!item) return `unknown item #${args.itemId}`;
					if (item.to !== me)
						return `item #${args.itemId} is addressed to ${item.to}, not you`;
					if (item.status !== "deferred")
						return `item #${args.itemId} is not deferred (status=${item.status})`;
					item.status = "claimed";
					item.transitions.push({
						at: new Date().toISOString(),
						event: "resumed",
						by: me,
					});
					return `item #${item.id} resumed; finish it with complete_work or revise it and defer again.`;
				}, context);
				return toolText(out);
			},
		}),
		defineTool({
			name: "peek_queue",
			description:
				"List every queue item (any status). Use for oversight and debugging.",
			parameters: Type.Object({}),
			replay: "safe",
			execute: async (_args, api, context) => {
				const lines = await api.commit(async (tx) => {
					const queue = await tx.doc(RigQueue);
					return queue.items.map((it) =>
						`#${it.id} ${it.status} from=${it.from} to=${it.to} subj=${it.subject}`,
					);
				}, context);
				return toolText(lines.length ? lines.join("\n") : "(empty)");
			},
}),
],
});

/** Resolve which seat THIS conversation is, from the registry doc. */
async function mySeatName(api, context) {
	return api.commit(async (tx) => {
		const seats = await tx.doc(Seats);
		for (const [name, seat] of Object.entries(seats.seats)) {
			if (seat.conversationId === api.conversationId) return name;
		}
		throw new Error("this conversation is not a registered seat");
	}, context);
}

/** System-prompt section telling a seat about its role and its queue duties. */
export function seatSections(roleText) {
	return [
section("durig-role", () =>
`You are the "${roleText}" seat of a rig.\n` +
`Your duties arrive through claim_work; report results with complete_work.\n` +
`Delegate with send_work when a task belongs to another seat.`,
{ tag: false }),
];
}

/**
 * Compile structured persona fields into one instructions string.
 * Mirrors CrewAI's role/goal/backstory triad and MetaGPT's constraints;
 * an explicit `instructions` field is appended verbatim when present.
 */
export function compilePersona(seat) {
	const parts = [];
	if (seat.role) parts.push(`You are the ${seat.role}.`);
	if (seat.goal) parts.push(`Your goal: ${seat.goal}`);
	if (seat.backstory) parts.push(`Background: ${seat.backstory}`);
	for (const c of seat.constraints ?? []) parts.push(`Constraint: ${c}`);
	if (seat.capabilities?.length) {
		parts.push(`Advertised capabilities: ${seat.capabilities.join(", ")}`);
	}
	if (seat.instructions) parts.push(seat.instructions);
	return parts.join("\n");
}

export { Router };
