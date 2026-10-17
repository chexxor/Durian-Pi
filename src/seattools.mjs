// seattools.mjs — the tools a seat is given, and the environment those calls are confined by.
//
// Both live here because they have to agree: installing a file tool without the environment
// leaves `api.env` undefined, so every call fails in `requireEnv(api)`; installing the
// environment without the tools confines nothing. They are one unit in the same way the security
// position's conditions are.

import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { AgentDoc, configure, defineExtension, defineTool } from "@earendil-works/pi-durable";
import {
	createEditTool,
	createPowerShellTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { Type } from "@earendil-works/pi-ai";
import { seatsAreVerifier } from "./verifierrole.mjs";
import { authorEnv, verifierEnv } from "./confine.mjs";
import { RigQueue, Seats } from "./rig.mjs";
import { describeSeatRoot, resolveSeatRoot } from "./seatroot.mjs";
import { prepareSeatWorkspace } from "./worktree.mjs";

/** A tool result carrying only text (the shape `defineTool` accepts). */
function result(text) {
	const content = [{ type: "text", text }];
	return { content, output: content };
}

/**
 * `prepare_workspace` — the seat's OWN workspace switch (replaces the broker's
 * process-global `DURIG_SEAT_ROOT`, which pointed every seat woken in a pass at
 * one worktree). Called after `claim_work`, it creates the item's isolated git
 * worktree and persists THIS conversation's cwd to it through `configure`, so
 * `makeSeatEnv` resolves each seat to its own tree. Idempotent: an existing
 * worktree is reused, so a resume never nests one worktree inside another (#506).
 */
const prepareWorkspace = defineTool({
	name: "prepare_workspace",
	description:
		"Prepare the isolated git worktree for an item you have claimed, and point your file/shell tools at it. Call this AFTER claim_work and BEFORE any filesystem work. Returns the worktree path.",
	parameters: Type.Object({
		itemId: Type.Optional(
			Type.Number({
				description:
					"the claimed item to prepare the worktree for; defaults to your most recently claimed item",
			}),
		),
	}),
	// Creates a directory + git worktree and re-points the seat's persisted cwd. A
	// rerun is idempotent (an existing worktree is reused, so no second npm
	// install), but a blind replay of an interrupted call still repeats filesystem
	// work, so it must not be replayed automatically.
	replay: "unsafe",
	execute: async (args, api, context) => {
		try {
			const me = await api.commit(async (tx) => {
				const seats = await tx.doc(Seats);
				for (const [name, seat] of Object.entries(seats.seats)) {
					if (seat.conversationId === api.conversationId) return name;
				}
				return null;
			}, context);
			if (!me) return result("PREPARE_WORKSPACE_ERROR: this conversation is not a registered seat");
			const claimed = await api.commit(async (tx) => {
				const queue = await tx.doc(RigQueue);
				// Plain ids only: a document proxy that escapes the callback throws
				// "Cannot use a settled overlay" once the commit settles.
				return queue.items
					.filter((it) => it.to === me && it.status === "claimed")
					.map((it) => it.id);
			}, context);
			const itemId =
				args.itemId !== undefined
					? claimed.includes(args.itemId)
						? args.itemId
						: null
					: claimed.length > 0
						? Math.max(...claimed)
						: null;
			if (itemId === null) {
				return result(
					`PREPARE_WORKSPACE_ERROR: no claimed item${
						args.itemId === undefined ? "" : ` #${args.itemId}`
					} is yours; call claim_work first, then prepare_workspace`,
				);
			}
			// The tree the broker/CLI runs from. The worktree goes beside it at
			// item-<id>; `prepareSeatWorkspace` reproduces the source's repo-relative
			// path, so a durig subdirectory keeps its cwd.
			const source = process.cwd();
			let workspace;
			try {
				workspace = await prepareSeatWorkspace({ source, worktreeRoot: source, itemId, seatName: me });
			} catch (err) {
				return result(
					`PREPARE_WORKSPACE_ERROR: cannot create a worktree from ${source} (is it a git repository?): ${err?.message ?? err}`,
				);
			}
			// Persisted on this conversation's own agent, so the switch is per-seat and
			// survives a restart — never a process-global root that bleeds across seats.
			await api.commit(async (tx) => {
				await configure(tx, api.conversationId, { cwd: workspace.cwd });
			}, context);
			return result(
				`WORKSPACE READY (${workspace.created ? "created" : "reused"}): ${workspace.cwd}\n` +
					`Your file and shell tools now resolve inside this item's worktree. ` +
					`Work and commit there; do not touch the shared tree.` +
					(workspace.branch ? ` The worktree is on branch ${workspace.branch}; commit your item's files there.` : "") +
					(workspace.carried.length > 0
						? `\nCarried the shared tree's visible changes: ${workspace.carried.join(", ")}`
						: ""),
			);
		} catch (err) {
			return result(`PREPARE_WORKSPACE_ERROR: ${err && err.stack ? err.stack : String(err)}`);
		}
	},
});

/**
 * `seat_root` — name the tree this seat is ACTUALLY in (DOGFOOD F21 / #253).
 *
 * F21's failure was a verifier calling its ISOLATED item worktree "the live tree": a seat could
 * not tell which tree it was in, so its judgement about the live tree was wrong. This is the
 * read-only surface that fixes it — it reports the seat's RESOLVED root (the same chain
 * `makeSeatEnv` and `seatguard` use), says whether that root is the main checkout or a linked
 * worktree, and flags a `DURIG_SEAT_ROOT` disagreement loudly.
 *
 * Read-only, and deliberately NOT in `COORDINATOR_REMOVALS`, so every seat — including a
 * coordinator with no file tools — can always name its own root.
 */
const seatRoot = defineTool({
	name: "seat_root",
	description:
		"Report the seat's ACTUAL resolved root — the tree this seat's file and shell tools operate in — so an isolated item worktree is never mistaken for the live tree. Read-only; available to every seat.",
	parameters: Type.Object({}),
	execute: async (_args, api, context) => {
		try {
			const persistedCwd = await api.commit(async (tx) => {
				const agent = await tx.doc(AgentDoc, api.conversationId);
				return agent?.cwd;
			}, context);
			return result(describeSeatRoot({ persistedCwd }));
		} catch (err) {
			return result(`SEAT_ROOT_ERROR: ${err && err.stack ? err.stack : String(err)}`);
		}
	},
});

// `bash` is deliberately absent. On native Windows `bash` means Git Bash - an undeclared
// dependency that may simply not be installed - and WSL is unsupported on this host by policy,
// so the seat shell is PowerShell, which `createPowerShellTool` resolves as `pwsh`, then
// `powershell`.
export const seatTools = {
	read: createReadTool(),
	write: createWriteTool(),
	edit: createEditTool(),
	shell: createPowerShellTool(),
	prepareWorkspace,
	seatRoot,
};

export const SeatTools = defineExtension({
	name: "durig.seat-tools",
	tools: Object.values(seatTools),
});

/**
 * What a verifier seat loses, so "structurally cannot fix instead of verify" starts true.
 *
 * This is the SECOND layer, not the guarantee: a shell writes whatever the OS user can write
 * however few tools it is offered (the position's F3), so the read-only environment below is
 * what actually holds.
 */
export const VERIFIER_REMOVALS = [seatTools.write, seatTools.edit];

/**
 * A seat that neither produces nor checks an artifact keeps no working tools at all.
 *
 * This is what F9 needed. "Never do implementation work yourself; route it" was enforced by pm
 * having no file tools - not by the sentence - and giving every seat the same tools removed that
 * enforcement without replacing it, so pm investigated the repository instead of routing the
 * request. Removing the tools restores what prose could not.
 */
export const COORDINATOR_REMOVALS = [seatTools.read, seatTools.write, seatTools.edit, seatTools.shell, seatTools.prepareWorkspace];

/** Capabilities that mean a seat produces or checks something, so it needs the working tools. */
const WORKING_CAPABILITIES = ["implement", "code", "verify", "review"];

/**
 * What a seat loses, decided by its own declared capabilities rather than by its name.
 *
 * A seat that declares NO capabilities loses everything, deliberately: the alternative is to hand
 * an unknown role the full working set, which is the F9 failure. A rig whose seats declare nothing
 * therefore gets coordinators, and `check` reports `seat-without-capabilities` so that can never
 * happen silently.
 */
export function toolRemovalsFor(seat) {
	const capabilities = (seat?.capabilities ?? []).map((c) => String(c).toLowerCase());
	const works = capabilities.some((c) => WORKING_CAPABILITIES.includes(c));
	if (!works) return COORDINATOR_REMOVALS;
	return seatsAreVerifier({ name: seat?.name, role: seat?.role }) ? VERIFIER_REMOVALS : [];
}

/**
 * Does this seat keep the read tool? A coordinator (no working capability) loses it
 * (`COORDINATOR_REMOVALS`), so an over-threshold tool result must arrive INLINE or the item is
 * unreadable to it (lead #144 B, reconciled with #124 b: a seat that can dereference gets the
 * structured head + path; a seat that cannot gets the body).
 */
export function seatHasReadTool(seat) {
	return !toolRemovalsFor(seat).includes(seatTools.read);
}

/**
 * Build the `HarnessOptions.env` function.
 *
 * `roster` is a live Map consulted per call, not a snapshot: the seat list is read through the
 * harness this function is an argument to, so it cannot be known at the moment it is passed.
 */
export function makeSeatEnv(roster, { fallbackRoot = process.cwd() } = {}) {
	return (target) => {
		// The seat's OWN persisted cwd wins: `prepare_workspace` sets it to the item's
		// worktree via `configure`, so a seat that prepared a workspace is confined to
		// its own tree regardless of any other seat. `DURIG_SEAT_ROOT` is only a
		// fallback for a seat that has not prepared one (a rig pointing every seat at
		// one shared checkout), never a global override of a prepared root.
		const root = resolveSeatRoot({ persistedCwd: target.cwd, fallbackRoot }).root;
		const base = new NodeExecutionEnv({ cwd: root });
		const seat = roster.get(target.conversationId);
		// Fail CLOSED: a conversation that is not a known seat - the roster not read yet, or a
		// conversation that is no seat at all - gets the read-only environment, never an
		// unconfined one.
		return seat && !seat.verifier ? authorEnv(base, root) : verifierEnv(base, root);
	};
}

/** Fill the roster from the store's seat list, reusing `check`'s verifier judgement. */
export function fillRoster(roster, seats) {
	for (const [name, seat] of Object.entries(seats ?? {})) {
		roster.set(seat.conversationId, {
			name,
			role: seat.role,
			verifier: seatsAreVerifier({ name, role: seat.role }),
		});
	}
	return roster;
}

/**
 * Give every seat its narrowed tool set.
 *
 * Applied at `up` rather than at install time because one tool set is installed for every seat and
 * scoping is a per-conversation decision, and applied after the seat loop so it covers the create
 * and the refresh paths alike. Requires the `configure` import to be the same function durig
 * already uses, so this cannot write an agent state by a second route.
 */
export async function scopeSeatTools(configureFn, tx, seats) {
	for (const [name, seat] of Object.entries(seats ?? {})) {
		const remove = toolRemovalsFor({ name, role: seat.role, capabilities: seat.capabilities });
		if (remove.length === 0) continue;
		await configureFn(tx, seat.conversationId, { tools: { remove } });
	}
}
