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
 status flow: queued -> claimed -> done.
 * Transitions are appended (audit trail), never mutated in place.
 */
export const RigQueue = defineDoc({
	kind: "durig.queue",
	version: 1,
	scope: "session",
	initial: () => ({ nextId: 1, items: [] }),
});

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
 * Enqueue work. Called inside a transaction; returns the assigned item id.
 * `transitions` records who did what and when for the audit trail.
 */
export async function enqueueItem(tx, from, to, subject, body, optimizedVia = null) {
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
				return toolText(`ITEM #${claimed.id} | from=${claimed.from} | subject=${claimed.subject}\n${claimed.body}`);
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
					await enqueueItem(
						tx,
						me,
						item.from,
						`DONE #${item.id}: ${item.subject}`,
						args.resultSummary,
					);
					return `ok`;
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
