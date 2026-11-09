// tools/shell-availability.mjs — the ONE verdict for "can a seat shell START on this host", and it is
// asked of the product's registry, never read out of vendored text (#4977).
//
// WHY THIS EXISTS (measured on `main` at 57fa451b, Linux box `label-withheld-per-D205`, node v24.22.1):
// `tools/broker-serve.mjs` section 7 printed `BLOCK seat-shell-availability: the seat shell tool is
// registered as "bash" and spawns [pwsh, powershell], NONE of which exists on linux`. That sentence
// contradicts itself, and it has been false since ROADMAP 217 landed: the registered tool IS `bash`,
// `src/shellregistry.mjs` reports `degraded:false` for this host, and the block still fired. The cause
// was the METHOD: the section grepped `vendor/pi-main/packages/durable/src/tools/bash.ts` for
// `programs ?? [...]` and took the first match — which is `createPowerShellTool`'s DEFAULT (bash.ts:169),
// one factory's fallback, not the registered tool's program list — then PATH-probed those programs and
// blocked the broker start on the result. Two conventions were broken at once: a cheap signal may accept
// but never DECIDE, and an instrument may READ vendor/pi-main but must not GATE on its text, because
// that text moves under the upstream pin and a pin bump can flip a host verdict with no host change.
//
// So the verdict is one function, exported, and its only source of host fact is `shellPlan()` from
// `src/shellregistry.mjs` — the same registry `src/seattools.mjs` registers from and `src/seatguard.mjs`
// reads its shell names from. A grep cannot flip this verdict; only a change in what the registry reports
// can, and that change is what the preflight is supposed to be measuring.
//
// WHAT IS PRESERVED VERBATIM: the D169 coordinator carve-out. When nothing can start, the block is
// admissible to downgrade for ONE bounded start whose entire predicted first-pass wake set is a
// coordinator (no shell, no write, no edit — `toolRemovalsFor` is the product's own predicate, computed
// by the CALLER and passed in, so this module stays free of the tool set). The caller decides
// "does this seat keep the shell tool"; this module only formats the ruling and refuses it when any
// wake-set seat keeps the shell.
//
// Pure: no spawn, no network, no store. The PATH scan inside `shellPlan` is `existsSync` over PATH
// entries, and `host` is injectable, so the CONTROL case — a host where the shell genuinely cannot
// start — is assertable without uninstalling a shell.

import { shellPlan } from "../src/shellregistry.mjs";

/** One line: what the registry reported for every candidate, so the verdict shows its work.
 *
 * #5221 (RM-306): a WITHHELD candidate prints as withheld, with its reason — never as "cannot start".
 * The two states read alike in the old line and mean opposite things: "cannot start" is a host fact the
 * operator can fix by installing a program, "withheld" is a rig rule no installation should undo. An
 * operator told to "make one of the programs above resolvable" for a withheld tool is being pushed toward
 * re-opening the hole this row closes. */
export function describeRegistry(plan) {
	return plan.tried
		.map((t) =>
			t.offered === false
				? `${t.name} [spawns ${t.programs.join(", ")}]: WITHHELD on ${plan.platform}${t.withheldReason ? ` — ${t.withheldReason}` : ""}`
				: `${t.name} [spawns ${t.programs.join(", ")}]: ${t.canStart ? `CAN start${t.startedBy ? ` (${t.startedBy})` : ""}` : "cannot start"}${t.preferred ? " [preferred on this host]" : ""}`,
		)
		.join(" | ");
}

/**
 * The finding for the shell half of a broker preflight.
 *
 * @param plan       the registry's verdict, defaulting to THIS host (`shellPlan()`).
 * @param rigPath    the rig file the seat instruction lives in (operator-owned half of ROADMAP 217).
 * @param wakeSet    seats a start would wake, as `{ name, known, keepsShell }` — `known` false means the
 *                   name is not in the rig file at all, which is NOT evidence it can skip a shell.
 * @param ackCoordinatorWake / maxDurationS  the operator's bounded ruling, recorded not invented.
 * @returns `{ id, severity, detail, fix }` — `severity` is `note` or `block`.
 */
export function seatShellVerdict({ plan = shellPlan(), rigPath = "the rig file", wakeSet = [], ackCoordinatorWake = false, maxDurationS = null } = {}) {
	const registry = describeRegistry(plan);
	const programs = plan.programs.join(", ");

	// The registry started the tool it registered. That is the whole question, so nothing else here may
	// raise a shell finding.
	if (!plan.degraded) {
		return {
			id: "seat-shell-availability",
			severity: "note",
			detail: `the seat shell tool "${plan.name}" CAN start on ${plan.platform} — ${plan.startedBy ?? "the registry reports it startable here"} (registry: ${registry}). No BLOCK: a woken seat can run "node demo/<name>.test.mjs" and "git"`,
			fix: `the remaining half of ROADMAP 217 is operator-owned text: confirm the seat INSTRUCTION in ${rigPath} names "${plan.name}" (docs/runbooks/hygiene-and-dead-model-pointers.md)`,
		};
	}

	const unknown = wakeSet.filter((w) => !w.known).map((w) => `${w.name}(absent from ${rigPath})`);
	const needsShell = [...wakeSet.filter((w) => w.known && w.keepsShell).map((w) => w.name), ...unknown];

	if (wakeSet.length && !needsShell.length && ackCoordinatorWake) {
		return {
			id: "seat-shell-availability-acked",
			severity: "note",
			detail: `seat-shell-availability DOWNGRADED for this start: the shell that cannot start on ${plan.platform} (${programs}) guards NOTHING in the first-pass wake set (${wakeSet.map((w) => w.name).join(", ")}) — the product's own toolRemovalsFor reports each as a coordinator: no shell, no write, no edit, no read, so this wake runs no command and lands no artifact. Bounded to ${maxDurationS ?? "?"}s. FIRST PASS ONLY: routing can wake a file-capable seat, for which 217 is real and its persisted root is foreign (221) — watch one pass, then --stop and re-run --status.`,
			fix: `the rest of ROADMAP 217 is still owed: the operator-owned instruction text in ${rigPath}, and the host fact above (no candidate in src/shellregistry.mjs can start here). demo/seattools.test.mjs pins the host-conditional selection.`,
		};
	}

	return {
		id: "seat-shell-availability",
		severity: "block",
		detail: `NO shell can start on ${plan.platform}: the registered seat shell tool is "${plan.name}" and it spawns [${programs}], none of which resolves here (registry: ${registry}) — every seat shell call is a guaranteed spawn error, so a woken seat can edit but cannot run the demo suite (the constitution's oracle) or run git, and its completions are self-declared${wakeSet.length && !needsShell.length ? ` | a coordinator-scoped exception IS measurable for this wake set: ${wakeSet.map((w) => w.name).join(", ")}` : ""}${needsShell.length ? ` | NOT admissible: these wake-set seats keep the shell tool: ${needsShell.join(", ")}` : ""}`,
		fix: `src/shellregistry.mjs already registers the host-preferred shell, so this is a HOST fact, not a registration bug: make one of the programs above resolvable on this box (or run the broker where one is), then re-run --status.${plan.tried.some((t) => t.offered === false) ? ` Candidates marked WITHHELD above are not offered on ${plan.platform} by policy (RM-306) and are NOT a fix — do not install them to satisfy this check.` : ""} Still owed by 217: the operator-owned instruction text in ${rigPath}. For one bounded coordinator-scoped wake the operator may ack it: --ack-coordinator-wake with --max-duration <s>.`,
	};
}
