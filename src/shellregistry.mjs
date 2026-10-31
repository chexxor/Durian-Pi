// shellregistry.mjs — WHICH shell a seat's shell tool is, chosen from ONE registry on the host this
// process runs on (ROADMAP 217 / #4849).
//
// WHY ONE MODULE — two surfaces needed one fact and each kept its own copy.
// `src/seattools.mjs` registered exactly ONE seat shell, hardcoded to `createPowerShellTool()`, while
// `src/seatguard.mjs` kept its own literal set of shell-tool NAMES for the one decision that matters
// to it: which tool calls carry a command string worth inspecting. On the Windows host those two
// copies happened to agree, so the duplication was invisible. On the Linux host this rig moved to it
// broke twice in the same direction, measured 2026-10-30 by `tools/rig-portability-audit.mjs` (finding
// `seat-shell-availability`, ROADMAP 217) and `tools/channel-preflight.mjs` §7: the registered tool's
// programs (`pwsh`, then `powershell`) do not exist here, so EVERY seat shell call was
// `spawn … ENOENT` — no git, no demo suite, no oracle — while `bash`, which DOES exist, could not be
// reached because no durian-pi module registered it. The guard's own set already contained the name
// `bash`: the guard whitelisted a tool that was not a tool.
//
// So the registry lives here and BOTH surfaces read it: `seatTools.shell` from the selection,
// `SHELL_TOOLS` from `shellToolNames()`. A shell added to the registry with no matching literal in the
// guard would be a shell the guard never inspects — the drift direction that is a HOLE, not a cosmetic
// mismatch, and what `demo/seattools.test.mjs` now pins.
//
// THE TWO QUESTIONS ARE KEPT APART, and that separation is the fix:
//   * `canStart(host)` — can this shell's program actually be launched here;
//   * `preferredOn(host)` — which shell should this host get when more than one can start.
// The 217 failure was a PREFERENCE (PowerShell, right for Windows) applied on a host where it could
// not START, with the only startable candidate left unregistered.
//
// Both facts come from the pinned pi, read at `node_modules/@earendil-works/pi-durable/`:
//   * `dist/tools/bash.js` `createPowerShellTool` starts the program DIRECTLY with argv, trying `pwsh`
//     then `powershell`, and `runCommand` re-throws the LAST `spawn_error`. Nothing else rescues it, so
//     it is usable exactly when one of those two resolves.
//   * `createBashTool` hands the command STRING to `env.exec`, which `dist/env/node.js` `getShellConfig`
//     resolves as `/bin/bash`, else `bash` on PATH, else `sh -c` (on win32 it first searches Git Bash).
//     On POSIX that chain cannot come back empty — which is why the 22 ENOENT results were a
//     REGISTRATION failure on this host, not a host limitation.
//
// WHAT IS DELIBERATELY NOT HERE (lead's rejected edge, #4864 item 3, routed as #4879): NO STORE-SCHEMA
// CHANGE. No `hostOs` field on a seat definition, no per-seat `shell` field, no per-seat override —
// those change what 263/264 read and belong to the schema row. Selection reads the host this process
// runs on. A seat's only current signal of which shell it holds stays the tool NAME plus the tool
// DESCRIPTION (`Execute a bash command…` vs `Execute a PowerShell command…`); the instruction-text half
// of 217 is the rig-file row, not this one.
//
// AND THE GUARD KEEPS INSPECTING BOTH NAMES, on purpose. One tool is INSTALLED per process, but the guard's
// set is the set of names a durian-pi shell tool CAN have: keyed on the single selected name, any other
// shell name reaching `beforeTool` — a nested codemode call, a future seat on a different host, and
// today `demo/seatguard.test.mjs`, which drives BOTH names on one host — would be a call whose command
// string is never checked.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createBashTool, createPowerShellTool } from "@earendil-works/pi-durable/tools";

/**
 * Is this program startable here? A PATH SCAN, never a spawn.
 *
 * This module is imported by the CLI, the broker, the seat harness, `tools/rig-portability-audit.mjs`
 * and every demo that touches the tool set, and the selection runs AT MODULE LOAD; a subprocess at
 * import time is a side effect no caller asked for. pi's own probe (`findBashOnPath` → `which`/`where`)
 * runs when it is ALREADY about to exec, which is not this moment.
 *
 * Deliberately NARROWER than pi's search on win32: it does not try `%ProgramFiles%\Git\bin\bash.exe`.
 * That costs nothing, because on win32 `bash` is reached only when the Windows shell itself cannot
 * start, and pi's `getShellConfig` still resolves Git Bash at exec time if a seat does ask a `bash`
 * call. Stated rather than hidden, since it is an asymmetry the next reader will hit.
 */
export function programOnPath(program, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
	const suffixes = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
	for (const dir of String(env.PATH ?? "").split(delimiter)) {
		if (dir === "") continue;
		for (const suffix of suffixes) {
			const candidate = join(dir, `${program}${suffix}`);
			if (exists(candidate)) return candidate;
		}
	}
	return null;
}

/** Every shell durian-pi CAN put in front of a seat: its name, its factory, and the two host rules. */
export const SHELL_CANDIDATES = [
	{
		name: "powershell",
		create: () => createPowerShellTool(),
		// Native-Windows `bash` means an undeclared Git Bash dependency, so on a Windows host the seat
		// shell IS PowerShell — the original ruling, kept here as a rule FOR WINDOWS rather than as a
		// constant for every host.
		preferredOn: (host) => host.platform === "win32",
		canStart: (host) => ["pwsh", "powershell"].some((program) => host.programOnPath(program) !== null),
		why: "pi starts `pwsh` then `powershell` as argv and re-throws the last spawn error, so one must resolve on PATH",
	},
	{
		name: "bash",
		create: () => createBashTool(),
		preferredOn: (host) => host.platform !== "win32",
		canStart: (host) =>
			host.programOnPath("bash") !== null ||
			(host.platform !== "win32" && host.exists("/bin/bash")) ||
			// pi's `getShellConfig` falls back to `sh -c` for a STRING command, so on POSIX a `bash` tool
			// call still runs with no bash anywhere. Recorded because it is what makes "no shell at all"
			// unreachable on POSIX rather than merely unlikely — and it is pi's behaviour, not ours.
			(host.platform !== "win32" && host.programOnPath("sh") !== null),
		why: "the command goes to env.exec as a string, which pi resolves as /bin/bash, else bash on PATH, else sh -c",
	},
];

/** Every name a durian-pi shell tool can have — what the guard must treat as a shell call. */
export function shellToolNames() {
	return SHELL_CANDIDATES.map((candidate) => candidate.name);
}

/**
 * The plan for ONE host, as data: what each candidate reported and which one to register.
 *
 * Pure and injected, so the host-conditional rule can be asserted for `win32`, for this Linux box, and
 * for a host where nothing resolves, without owning three machines. `lookup` is the only seam a caller
 * needs in practice; `exists` is injectable because `canStart` asks about `/bin/bash` directly.
 */
export function shellPlan({ platform = process.platform, env = process.env, exists = existsSync, lookup = programOnPath } = {}) {
	const host = { platform, env, exists, programOnPath: (program) => lookup(program, { env, platform, exists }) };
	// Preference first, availability second — availability never overrides preference when both hold.
	const ranked = [...SHELL_CANDIDATES].sort((a, b) => Number(b.preferredOn(host)) - Number(a.preferredOn(host)));
	const tried = ranked.map((candidate) => ({
		name: candidate.name,
		preferred: candidate.preferredOn(host),
		canStart: candidate.canStart(host),
		why: candidate.why,
	}));
	const chosen = ranked.find((candidate) => candidate.canStart(host));
	return {
		// NEVER undefined, deliberately: on a host where NOTHING can start the seat still gets the
		// platform-preferred shell, so its failure is a named spawn error from a registered tool rather
		// than a seat with no shell tool and no verb to reason about. Degrade to UNKNOWN, not to EMPTY.
		name: (chosen ?? ranked[0]).name,
		degraded: chosen === undefined,
		tried,
	};
}

/** The tool and name THIS host selects. One selection per process: the host does not change under a
 * running broker, and every consumer (CLI, broker, audit, preflight) reads the same object. */
export function selectSeatShell(host = {}) {
	const plan = shellPlan(host);
	const candidate = SHELL_CANDIDATES.find((c) => c.name === plan.name);
	return { ...plan, tool: candidate.create() };
}

export const seatShellSelection = selectSeatShell();
