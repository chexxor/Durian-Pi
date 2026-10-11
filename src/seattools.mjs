// seattools.mjs — the tools a seat is given, and the environment those calls are confined by.
//
// Both live here because they have to agree: installing a file tool without the environment
// leaves `api.env` undefined, so every call fails in `requireEnv(api)`; installing the
// environment without the tools confines nothing. They are one unit in the same way the security
// position's conditions are.

import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { defineExtension } from "@earendil-works/pi-durable";
import {
	createEditTool,
	createPowerShellTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { seatsAreVerifier } from "./checkup.mjs";
import { authorEnv, verifierEnv } from "./confine.mjs";

// `bash` is deliberately absent. On native Windows `bash` means Git Bash - an undeclared
// dependency that may simply not be installed - and WSL is unsupported on this host by policy,
// so the seat shell is PowerShell, which `createPowerShellTool` resolves as `pwsh`, then
// `powershell`.
export const seatTools = {
	read: createReadTool(),
	write: createWriteTool(),
	edit: createEditTool(),
	shell: createPowerShellTool(),
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
export const COORDINATOR_REMOVALS = [seatTools.read, seatTools.write, seatTools.edit, seatTools.shell];

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
 * Build the `HarnessOptions.env` function.
 *
 * `roster` is a live Map consulted per call, not a snapshot: the seat list is read through the
 * harness this function is an argument to, so it cannot be known at the moment it is passed.
 */
export function makeSeatEnv(roster, { fallbackRoot = process.cwd() } = {}) {
	return (target) => {
		const root = target.cwd ?? fallbackRoot;
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
