// seattools.test.mjs — proof that the controls are WIRED, not merely defined.
//
// A module that is never installed protects nothing while looking finished, which is the same
// failure the guard's own test opens with. So this test reads cli.mjs and holds it to the calls
// that install the guard, install the tools, supply the environment and narrow the verifiers -
// then proves the behaviour of each piece.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COORDINATOR_REMOVALS, VERIFIER_REMOVALS, SeatTools, fillRoster, makeSeatEnv, seatShell, toolRemovalsFor } from "../src/seattools.mjs";
import { seatShellSelection, selectSeatShell, shellPlan, shellToolNames, offeredShellNames, withheldShellNames, shellWithheldReason } from "../src/shellregistry.mjs";
import { SHELL_TOOLS } from "../src/seatguard.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const root = await mkdtemp(join(tmpdir(), "durig-seattools-"));
const context = {};

try {
	console.log("\nThe tool set carries exactly ONE shell, and it is the shell this host can START (#4849 / ROADMAP 217)");
	const names = SeatTools.tools.map((tool) => tool.name).sort();
	const plan = shellPlan();
	// The expected set is host-conditional BY CONSTRUCTION, so the same assertion is true on a Windows
	// host and on this Linux box — the old assertion baked `powershell` into a literal and was therefore
	// wrong the moment the rig moved hosts. Its replacement fails on the old tree (which registered
	// `powershell` here) and passes on the new one.
	const expected = ["edit", "prepare_workspace", "read", "seat_root", "write", plan.name].sort();
	check(
		`read, write, edit, ONE shell, prepare_workspace and seat_root are bundled (${process.platform} -> ${plan.name})`,
		JSON.stringify(names) === JSON.stringify(expected),
		JSON.stringify(names),
	);
	const bundledShells = names.filter((n) => shellToolNames().includes(n));
	check(
		"exactly one shell tool is bundled, never both candidates",
		bundledShells.length === 1,
		JSON.stringify(bundledShells),
	);
	// The surface `tools/rig-portability-audit.mjs` §5 imports to decide `seat-shell-availability`, so
	// pinning it here is what stops the audit's finding from moving by accident.
	check(
		`the registered shell is what the registry selects for ${process.platform} (the audit reads this exact field)`,
		seatShell.name === plan.name,
		`registered=${seatShell.name ?? "(none)"} plan=${plan.name}`,
	);
	check(
		"no shell is bundled that this host cannot start (the 217 shape: a registered tool that ENOENTs)",
		plan.degraded === false || process.platform === "win32",
		JSON.stringify(plan.tried),
	);

	console.log("\nHost-conditional selection, asserted for hosts this box is not");
	check(
		"Linux with no PowerShell but a bash on PATH selects bash — the measured 217 host",
		shellPlan({ platform: "linux", exists: () => false, lookup: (p) => (p === "bash" ? "/usr/bin/bash" : null) }).name === "bash",
		JSON.stringify(shellPlan({ platform: "linux", exists: () => false, lookup: (p) => (p === "bash" ? "/usr/bin/bash" : null) })),
	);
	check(
		"Windows keeps the Windows shell even when bash is ALSO present (Git Bash is not an implicit dependency)",
		shellPlan({ platform: "win32", exists: () => false, lookup: (p) => (p === "bash" || p === "pwsh" ? `/x/${p}` : null) }).name === "powershell",
		JSON.stringify(shellPlan({ platform: "win32", exists: () => false, lookup: (p) => (p === "bash" || p === "pwsh" ? `/x/${p}` : null) })),
	);
	check(
		"a Windows host with neither pwsh nor powershell falls through to a bash that CAN start, rather than a dead shell",
		shellPlan({ platform: "win32", exists: () => false, lookup: (p) => (p === "bash" ? "/x/bash" : null) }).name === "bash",
		JSON.stringify(shellPlan({ platform: "win32", exists: () => false, lookup: (p) => (p === "bash" ? "/x/bash" : null) })),
	);
	check(
		"a host where NOTHING resolves still gets the platform-preferred shell, labelled degraded — never tool-less",
		(() => {
			const none = shellPlan({ platform: "linux", exists: () => false, lookup: () => null });
			return none.name === "bash" && none.degraded === true;
		})(),
		JSON.stringify(shellPlan({ platform: "linux", exists: () => false, lookup: () => null })),
	);
	check(
		"the selection this process registered agrees with the plan for this host",
		seatShell.name === seatShellSelection.name && seatShellSelection.tool.name === seatShell.name,
		`registered=${seatShell.name} selection=${seatShellSelection.name}/${seatShellSelection.tool.name}`,
	);

	// RM-306 (#5221), ruled by the operator: `powershell` is WITHHELD from the seat tool surface on
	// NON-WINDOWS hosts. It is a SURFACE rule, not prose — the operator's evidence was that `powershell`
	// appears in no rig file and in no prompt, and an absent instruction is filled in by the model. So the
	// assertions below are about what is OFFERED, and they fail on the tree where offerability was the same
	// question as startability (`pwsh` installed on Linux used to make PowerShell the SELECTED seat shell).
	console.log("\nRM-306: `powershell` is withheld from the surface on non-Windows hosts, and reported as withheld (#5221)");
	check(
		"linux is OFFERED only bash; powershell is on the withheld list, named rather than silently absent",
		JSON.stringify(offeredShellNames({ platform: "linux" })) === JSON.stringify(["bash"]) &&
			JSON.stringify(withheldShellNames({ platform: "linux" })) === JSON.stringify(["powershell"]),
		`offered=${JSON.stringify(offeredShellNames({ platform: "linux" }))} withheld=${JSON.stringify(withheldShellNames({ platform: "linux" }))}`,
	);
	check(
		"a Windows host is still OFFERED powershell (the withhold is host-conditional, not a deletion)",
		withheldShellNames({ platform: "win32" }).length === 0 && offeredShellNames({ platform: "win32" }).includes("powershell"),
		`offered=${JSON.stringify(offeredShellNames({ platform: "win32" }))} withheld=${JSON.stringify(withheldShellNames({ platform: "win32" }))}`,
	);
	// THE RED CHECK the item asks for: on a non-Windows host that HAS `pwsh` installed, the seat must not be
	// handed powershell. Availability and offerability are different questions, and this is the row that
	// keeps them apart.
	check(
		"a Linux host WITH pwsh installed and no bash still gets no powershell tool (the hole: availability used to decide the surface)",
		(() => {
			const pwshOnly = shellPlan({ platform: "linux", exists: () => false, lookup: (p) => (p === "pwsh" ? "/usr/bin/pwsh" : null) });
			const selected = selectSeatShell({ platform: "linux", exists: () => false, lookup: (p) => (p === "pwsh" ? "/usr/bin/pwsh" : null) });
			return pwshOnly.name !== "powershell" && pwshOnly.degraded === true && selected.tool.name !== "powershell";
		})(),
		JSON.stringify(shellPlan({ platform: "linux", exists: () => false, lookup: (p) => (p === "pwsh" ? "/usr/bin/pwsh" : null) })),
	);
	check(
		`the INSTALLED seat surface on this host contains NO withheld shell name (${process.platform})`,
		SeatTools.tools.map((t) => t.name).every((n) => !withheldShellNames().includes(n)),
		`surface=${JSON.stringify(SeatTools.tools.map((t) => t.name))} withheld=${JSON.stringify(withheldShellNames())}`,
	);
	check(
		"the absence is LEGIBLE in the plan: powershell is a WITHHELD row with a reason, not a missing row",
		(() => {
			const row = shellPlan({ platform: "linux", exists: () => false, lookup: () => null }).tried.find((t) => t.name === "powershell");
			return row?.offered === false && typeof row.withheldReason === "string" && row.withheldReason.length > 0 && row.canStart === false;
		})(),
		JSON.stringify(shellPlan({ platform: "linux", exists: () => false, lookup: () => null }).tried),
	);
	check(
		"the withheld reason is answerable per name+host, and is null for a shell that IS offered",
		shellWithheldReason("powershell", { platform: "linux" })?.includes("Windows") === true &&
			shellWithheldReason("powershell", { platform: "win32" }) === null &&
			shellWithheldReason("bash", { platform: "linux" }) === null,
		`linux=${shellWithheldReason("powershell", { platform: "linux" })} win32=${shellWithheldReason("powershell", { platform: "win32" })}`,
	);
	// The SECOND surface that composes tools — the interactive client's coding toolset — used to install
	// `createBashTool()` AND `createPowerShellTool()` unconditionally. Pin it to the same registry so the
	// two surfaces cannot drift back apart (the guard-set drift lesson of #4849).
	const adapterSource = await readFile(new URL("../src/tui/durable/adapter.mjs", import.meta.url), "utf8");
	// Comments may NAME the old call to explain what changed; only CODE may not install it. Strip comments
	// so the pin is about the tool set, not about the prose around it.
	const adapterCode = adapterSource
		.split("\n")
		.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
		.join("\n");
	check(
		"the client's coding toolset takes its shells from the registry, and does not install createPowerShellTool itself",
		adapterCode.includes("offeredShellCandidates(") && !adapterCode.includes("createPowerShellTool("),
		adapterCode.split("\n").filter((l) => /ShellTool|offeredShellCandidates/.test(l)).join(" | ").slice(0, 240),
	);
	check(
		"the guard STILL inspects both shell names — the withhold removes a tool from a surface, not a name from the guard (#4849's pin survives)",
		JSON.stringify([...SHELL_TOOLS].sort()) === JSON.stringify(["bash", "powershell"]),
		JSON.stringify([...SHELL_TOOLS].sort()),
	);

	console.log("\nThe guard's shell set IS the registry — two lists drift, and the drift is a hole");
	check(
		"seatguard's SHELL_TOOLS equals the shell registry (read from it, not re-listed as a literal)",
		JSON.stringify([...SHELL_TOOLS].sort()) === JSON.stringify(shellToolNames().sort()),
		`guard=${JSON.stringify([...SHELL_TOOLS].sort())} registry=${JSON.stringify(shellToolNames().sort())}`,
	);
	check(
		"the shell a seat is ACTUALLY handed is inside the guard's set (a shell the guard does not inspect is the hole)",
		SHELL_TOOLS.has(seatShell.name),
		`registered=${seatShell.name}`,
	);
	check("a verifier loses write and edit", JSON.stringify(VERIFIER_REMOVALS.map((t) => t.name).sort()) === JSON.stringify(["edit", "write"]));

	console.log("\ncli.mjs actually installs and scopes them (an uninstalled control is not a control)");
	const cli = await readFile(new URL("../cli.mjs", import.meta.url), "utf8");
	for (const [label, needle] of [
		["the guard is installed", "registry.install(SeatGuard);"],
		["the seat tools are installed", "registry.install(SeatTools);"],
		["the harness is given the confining environment", "env: makeSeatEnv(seatRoster),"],
		["the roster is filled from the store", "fillRoster(seatRoster, rosterDoc?.value?.seats);"],
		["seat tools are scoped at `up`", "scopeSeatTools(configure, tx, seatsDoc.seats);"],
	]) {
		check(label, cli.includes(needle), `cli.mjs does not contain ${JSON.stringify(needle)}`);
	}

	console.log("\nThe tool set follows each seat's DECLARED CAPABILITIES, so routing is enforced by capability (F9)");
	const removalNames = (removals) => removals.map((t) => t.name).sort();
	check(
		"an implementer keeps every working tool",
		toolRemovalsFor({ name: "impl", role: "implementation engineer", capabilities: ["implement", "code"] }).length === 0,
	);
	check(
		"a coordinator loses read, write, edit, the shell AND prepare_workspace, so it can only route",
		JSON.stringify(removalNames(toolRemovalsFor({ name: "pm", role: "program manager", capabilities: ["route", "plan"] }))) ===
			JSON.stringify(["edit", "prepare_workspace", "read", "write", seatShell.name].sort()),
	);
	check(
		"a verifier loses write and edit but keeps read, the shell AND prepare_workspace, so it can still re-run in its own tree",
		JSON.stringify(removalNames(toolRemovalsFor({ name: "qa", role: "independent verifier", capabilities: ["verify", "review"] }))) ===
			JSON.stringify(["edit", "write"]),
	);
	check(
		"a seat declaring NOTHING is treated as a coordinator - fail closed for tools, and check reports it",
		toolRemovalsFor({ name: "mystery", role: "unknown", capabilities: [] }).length === COORDINATOR_REMOVALS.length,
	);

	console.log("\nThe environment chosen per seat — and it fails CLOSED");
	const roster = new Map([
		["conv-impl", { name: "impl", role: "implementation engineer", verifier: false }],
		["conv-qa", { name: "qa", role: "verifier", verifier: true }],
	]);
	const envFor = makeSeatEnv(roster, { fallbackRoot: root });

	const authorWrite = await envFor({ conversationId: "conv-impl", cwd: root }).writeFile(join(root, "author.txt"), "x", context);
	check("an author seat can write inside its root", authorWrite.ok === true, authorWrite.ok ? "" : authorWrite.error?.message);

	const verifierWrite = await envFor({ conversationId: "conv-qa", cwd: root }).writeFile(join(root, "verifier.txt"), "x", context);
	check(
		"a verifier seat cannot write, whatever tools it was offered",
		verifierWrite.ok === false && verifierWrite.error?.code === "permission_denied",
		verifierWrite.ok ? "the write succeeded" : `code=${verifierWrite.error?.code}`,
	);

	const unknownWrite = await envFor({ conversationId: "conv-nobody", cwd: root }).writeFile(join(root, "unknown.txt"), "x", context);
	check(
		"an unknown conversation fails closed (read-only), not open",
		unknownWrite.ok === false && unknownWrite.error?.code === "permission_denied",
		unknownWrite.ok ? "the write succeeded" : `code=${unknownWrite.error?.code}`,
	);

	const outside = await envFor({ conversationId: "conv-impl", cwd: root }).readTextFile(join(tmpdir(), "not-in-root.txt"), context);
	check(
		"every seat's environment is rooted, so an escape is refused even for an author",
		outside.ok === false && outside.error?.code === "permission_denied",
		outside.ok ? "the read succeeded" : `code=${outside.error?.code}`,
	);

	console.log("\nThe roster reuses `check`'s verifier judgement rather than inventing a second one");
	const filled = fillRoster(new Map(), {
		impl: { conversationId: "c1", role: "implementation engineer" },
		qa: { conversationId: "c2", role: "independent verifier" },
		editor: { conversationId: "c3", role: "editor" },
	});
	check("an author is not marked a verifier", filled.get("c1").verifier === false);
	check("a qa seat is", filled.get("c2").verifier === true);
	check("an editor seat is (the same vocabulary `check` uses)", filled.get("c3").verifier === true);

	console.log(failures === 0 ? "\nPASS — the controls are wired" : `\nFAIL — ${failures} assertion(s) failed`);
} finally {
	await rm(root, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
