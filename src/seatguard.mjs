// seatguard.mjs — the durig-side tool-call guard.
//
// Why this exists at all: the operator accepted "full shell" believing pi's own guards covered
// seats. They do not. `arg-guard.js` and `guardrails.json` are pi-CODING-AGENT extensions
// (`pi.on('tool_call', ...)`), durig loads pi-DURABLE extensions only (src/extensions.mjs:17),
// and the harness durig opened passed no hooks at all. This is that guard, built on
// pi-durable's own hook (D38).
//
// What it is NOT: the boundary. A check on a command STRING is unsound by nature - PowerShell
// defeats any allowlist through aliases, `-EncodedCommand` and piped subcommands - so this
// narrows what is already confined, while `src/confine.mjs` is the boundary. Both, not either
// (the security position's F4).

import { ToolTask, defineExtension, hook } from "@earendil-works/pi-durable";
import { refusalFor } from "./confine.mjs";

/** Tools whose whole argument is a command string, so that string is what to inspect. */
const SHELL_TOOLS = new Set(["bash", "powershell"]);

/**
 * Refuse a call, or let it through.
 *
 * `ToolHookCall.parent` is set for a nested call - one a running tool made through
 * `executeTool()`, which is how a codemode script reaches any tool - so this covers those too,
 * which a coding-agent `tool_call` event could not.
 */
export function beforeTool(call) {
	const command = SHELL_TOOLS.has(call?.name) ? call.arguments?.command : undefined;
	if (typeof command !== "string") return undefined;
	const refusal = refusalFor(command);
	return refusal === null ? undefined : { block: refusal };
}

/**
 * Installed next to the Router, so every seat is guarded whatever tools it is later given.
 *
 * A refusal is a `block`, which pi-durable surfaces as a blocked call rather than a crash, so a
 * seat can read the reason and `defer_work` on it instead of retrying variants of the command.
 */
export const SeatGuard = defineExtension({
	name: "durig.guard",
	hooks: [hook(ToolTask, { beforeTool })],
});
