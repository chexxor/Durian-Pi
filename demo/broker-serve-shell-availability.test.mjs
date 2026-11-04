// broker-serve-shell-availability.test.mjs — the shell half of a broker preflight follows the REGISTRY,
// never a grep of vendored text (#4977).
//
// WHY THIS EXISTS. `tools/broker-serve.mjs --status` printed, on this Linux box at main 43e26dcc:
//   BLOCK seat-shell-availability: the seat shell tool is registered as "bash" and spawns
//   [pwsh, powershell], NONE of which exists on linux
// The sentence contradicts itself: it names the registered tool (`bash`, correct) and then attributes to it
// the program list of a DIFFERENT factory — `createPowerShellTool`'s default `programs ?? ["pwsh",
// "powershell"]` at `vendor/pi-main/packages/durable/src/tools/bash.ts:169` — which the section reached by
// regex, then PATH-probed, then blocked the broker start on. Since ROADMAP 217 landed the registry
// (`src/shellregistry.mjs`) reports `name: "bash", degraded: false` here, so the block has been confidently
// wrong, and it gated the operator's resident-broker decision.
//
// WHAT WOULD MAKE A FIX VACUOUS: deleting the block. So both directions are asserted, and asserted against
// INJECTED hosts — the CONTROL ("a genuinely missing shell still BLOCKS") does not depend on this box having
// no shell, and cannot be faked by the host this suite runs on.
//
// The second half of the assertion is the METHOD, not just the outcome: the verdict must be a function of
// what the registry reports. Asserted here by (a) the printed program list equaling the registry's
// `candidate.programs`, and (b) `tools/broker-serve.mjs` containing no vendored read and no shell-literal
// fallback at all — a grep cannot flip this verdict because there is no grep left to flip.
//
// Run: node demo/broker-serve-shell-availability.test.mjs  (exit 0 = pass)

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHELL_CANDIDATES, shellPlan } from "../src/shellregistry.mjs";
import { describeRegistry, seatShellVerdict } from "../tools/shell-availability.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// Hosts this box is not. `lookup` is the only seam the registry needs; `/bin/bash` is asked of `exists`.
const linuxWithBash = { platform: "linux", exists: () => false, lookup: (p) => (p === "bash" ? "/usr/bin/bash" : null) };
const posixWithNothing = { platform: "linux", exists: () => false, lookup: () => null };
const win32WithNothing = { platform: "win32", exists: () => false, lookup: () => null };
const win32WithPwsh = { platform: "win32", exists: () => false, lookup: (p) => (p === "pwsh" ? "C:\\pwsh.exe" : null) };

console.log("\nThe verdict on THIS host is what the registry reports, not what a vendored file says (#4977)");
const herePlan = shellPlan();
const hereVerdict = seatShellVerdict({ rigPath: "rig.selfdev.json" });
check(
	`the registry reports a startable shell on this box (${herePlan.platform} -> ${herePlan.name}, degraded=${herePlan.degraded})`,
	herePlan.degraded === false,
	JSON.stringify(herePlan.tried),
);
check(
	"the preflight verdict for this host is therefore NOT a block",
	hereVerdict.severity !== "block" && hereVerdict.id === "seat-shell-availability",
	JSON.stringify(hereVerdict),
);
check(
	`the verdict names the shell the registry registered ("${herePlan.name}") and the host it measured (${herePlan.platform})`,
	hereVerdict.detail.includes(`"${herePlan.name}"`) && hereVerdict.detail.includes(herePlan.platform),
	hereVerdict.detail,
);
check(
	"a linux reading never attributes a Windows program list to the registered tool (the false line was: registered as \"bash\" and spawns [pwsh, powershell])",
	!hereVerdict.detail.includes("spawns [pwsh, powershell]") && !hereVerdict.detail.includes("NONE of which exists"),
	hereVerdict.detail,
);

console.log("\nInjected hosts: the verdict follows the registry, in BOTH directions");
const linuxVerdict = seatShellVerdict({ plan: shellPlan(linuxWithBash), rigPath: "rig.selfdev.json" });
check(
	"a linux host with bash on PATH gets a NOTE, not the block (the measured 217 host, re-measured false)",
	linuxVerdict.severity === "note",
	JSON.stringify(linuxVerdict),
);
check(
	"the linux verdict prints the registry's OWN program lists per candidate, never a fallback list",
	linuxVerdict.detail.includes("bash [spawns bash]: CAN start (/usr/bin/bash)") &&
		linuxVerdict.detail.includes("powershell [spawns pwsh, powershell]: cannot start") &&
		!linuxVerdict.detail.includes("spawns [pwsh, powershell]"),
	linuxVerdict.detail,
);
const controlPosix = seatShellVerdict({ plan: shellPlan(posixWithNothing), rigPath: "rig.selfdev.json" });
check(
	"CONTROL — a POSIX host where bash, /bin/bash and sh all fail still BLOCKS (the fix did not delete the block)",
	shellPlan(posixWithNothing).degraded === true && controlPosix.severity === "block",
	JSON.stringify(controlPosix),
);
const controlWin = seatShellVerdict({ plan: shellPlan(win32WithNothing), rigPath: "rig.selfdev.json" });
check(
	"CONTROL — a Windows host with neither pwsh nor powershell BLOCKS, naming both programs and the host",
	controlWin.severity === "block" && controlWin.detail.includes("pwsh") && controlWin.detail.includes("powershell") && controlWin.detail.includes("win32"),
	JSON.stringify(controlWin),
);
check(
	"the block's remedy names a HOST fix, not 217's already-landed registration half (217's registration half shipped in src/shellregistry.mjs)",
	!controlWin.fix.includes("host-conditional shell tool in src/seattools.mjs"),
	controlWin.fix,
);
const winOk = seatShellVerdict({ plan: shellPlan(win32WithPwsh), rigPath: "rig.selfdev.json" });
check(
	"the same host family passes when the registry CAN start its shell (the block is not a Windows constant)",
	winOk.severity === "note" && winOk.detail.includes("win32"),
	JSON.stringify(winOk),
);

console.log("\nThe verdict is a function of the registry, so vendored text cannot move it");
check(
	"every registry candidate carries its program list as data (what an instrument prints, instead of grepping for it)",
	SHELL_CANDIDATES.every((c) => Array.isArray(c.programs) && c.programs.length > 0 && c.name),
	JSON.stringify(SHELL_CANDIDATES.map((c) => [c.name, c.programs])),
);
check(
	"shellPlan reports the host it measured and the resolution it found, per candidate",
	shellPlan(linuxWithBash).platform === "linux" &&
		shellPlan(linuxWithBash).tried.every((t) => Array.isArray(t.programs) && "startedBy" in t) &&
		shellPlan(linuxWithBash).startedBy === "/usr/bin/bash",
	JSON.stringify(shellPlan(linuxWithBash)),
);
check(
	"describeRegistry shows its work: every candidate, its programs, and whether it can start",
	["bash", "powershell", "pwsh"].every((s) => describeRegistry(shellPlan(win32WithNothing)).includes(s)),
	describeRegistry(shellPlan(win32WithNothing)),
);
const brokerSrc = readFileSync(join(HERE, "..", "tools", "broker-serve.mjs"), "utf8");
// Comments may NAME the vendored path to explain the defect; executable code may not reach it. Stripping
// full-line comments is enough here and keeps the assertion about what the instrument DOES.
const codeOnly = (src) =>
	src
		.split(/\r?\n/)
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n");
const vendorGrepTokens = ["vendor/pi-main", "programs ??", "pwsh", "powershell"];
check(
	"tools/broker-serve.mjs asks the shared verdict (one place decides shell availability)",
	brokerSrc.includes("seatShellVerdict") && brokerSrc.includes("./shell-availability.mjs"),
	"the section must import tools/shell-availability.mjs",
);
check(
	"and its CODE gates nothing on vendored text: no vendor/pi-main read, no `programs ??` grep, no shell-program literal outside comments",
	!vendorGrepTokens.some((token) => codeOnly(brokerSrc).includes(token)),
	vendorGrepTokens.filter((token) => codeOnly(brokerSrc).includes(token)).join(", ") || "clean",
);
// The pair that makes the check above non-vacuous: the SAME predicate applied to the instrument's PRE-FIX copy
// must FAIL it. Without the pair the assertion above could be satisfied by an empty file.
//
// #4995 is about HOW this control was pinned. It used to ask git for `main`'s copy — and a control pinned to a
// MOVING REF is unsatisfiable on its own landing day: while main still carried the defect the control was
// green, and the moment #4977 landed (e2f85719) main's copy started PASSING the check, so the control went
// permanently red and guarded nothing. The pinned artifact is now a frozen fixture (the house pattern: see
// demo/fixtures/driver-prefix-110.mjs): immutable, readable in a detached landing scratch, and never dependent
// on which ref the checkout happens to be on.
const FIXTURE = join(HERE, "fixtures", "broker-serve-shell-pre-4977.txt");
const preFixSrc = readFileSync(FIXTURE, "utf8");
const fixtureLines = preFixSrc.split(/\r?\n/);
const fixtureCodeLines = codeOnly(preFixSrc).split(/\r?\n/).filter((l) => l.trim()).length;
check(
	"the control has substance: the frozen pre-fix section is 15+ executable lines, not an empty stand-in",
	fixtureCodeLines >= 15,
	`code lines=${fixtureCodeLines}, bytes=${Buffer.byteLength(preFixSrc, "utf8")}`,
);
check(
	"the check is NOT vacuous — the pinned PRE-FIX section (67aa0096, before #4977 landed) FAILS it",
	vendorGrepTokens.some((token) => codeOnly(preFixSrc).includes(token)),
	`the pinned copy has: ${vendorGrepTokens.filter((token) => codeOnly(preFixSrc).includes(token)).join(", ") || "none"}`,
);

// Per-token discrimination: each token is caught ON ITS OWN, so the guard cannot be quieted by moving one
// literal into a comment. A control keyed to the CONJUNCTION of the tokens would pass on a partial regression.
const reintroduction = {
	"vendor/pi-main": '\tconst durable = join(REPO, "vendor/pi-main/packages/durable/src/tools/bash.ts");',
	"programs ??": '\tconst at = src.indexOf("options?.programs ?? [");',
	pwsh: '\tlet programs = ["pwsh", "powershell"];',
	powershell: '\tlet programs = ["pwsh", "powershell"];',
};
for (const [token, line] of Object.entries(reintroduction)) {
	check(
		`a single reintroduced line carrying \`${token}\` in executable code is enough to fail the check`,
		vendorGrepTokens.some((t) => codeOnly(line).includes(t)),
		line.trim(),
	);
}

// FIDELITY PAIR: the fixture must be the text it claims to be — a control the demo can silently re-edit is not
// a control. When the pinned object is readable in this tree, the fixture body must appear in it VERBATIM. When
// it is not (a grafted/shallow tree; a starter clone carries no history), this one assertion says SKIP loudly.
// The anti-vacuity control above NEVER skips, so the demo cannot go green by losing the control.
const HIST_REF = "67aa0096"; // the commit #4977 was cut from; its copy of the instrument still carried the defect
const bodyAt = fixtureLines.findIndex((l) => !l.trim().startsWith("//"));
const fixtureBody = fixtureLines.slice(bodyAt).join("\n");
const hist = spawnSync("git", ["show", `${HIST_REF}:tools/broker-serve.mjs`], {
	cwd: join(HERE, ".."),
	encoding: "utf8",
	maxBuffer: 1 << 26,
});
if (hist.status !== 0) {
	console.log(
		`  SKIP  fixture fidelity vs ${HIST_REF}:tools/broker-serve.mjs — that object is not readable in this tree (${String(hist.stderr ?? "").trim().slice(0, 80)})`,
	);
} else {
	check(
		`the frozen fixture is VERBATIM inside ${HIST_REF}:tools/broker-serve.mjs`,
		hist.stdout.includes(fixtureBody),
		`fixture body=${Buffer.byteLength(fixtureBody, "utf8")} B from line ${bodyAt + 1} of the fixture`,
	);
}

// The class, not just the instance: pin the rule that killed the control, so the next reach for a moving ref
// turns a demo red instead of turning main red after the landing.
const demoSrc = readFileSync(join(HERE, "broker-serve-shell-availability.test.mjs"), "utf8");
check(
	"no control in this demo is pinned to a MOVING ref (`main:`/`HEAD:` in a git show) — #4995's class",
	!/(show[^)]*\b(main|HEAD):)/.test(demoSrc),
	"the anti-vacuity control reads the fixture; the history lookup uses the pinned sha",
);
check(
	"the fixture carries its provenance sha, so the control can be regenerated rather than re-invented",
	/67aa0096/.test(preFixSrc) && /git show 67aa0096:tools\/broker-serve\.mjs/.test(preFixSrc),
	"header names the sha and the regenerate command",
);

console.log("\nThe D169 coordinator carve-out survives the rewrite (proven in both directions)");
const coordinator = { name: "pm", known: true, keepsShell: false };
const acked = seatShellVerdict({
	plan: shellPlan(win32WithNothing),
	rigPath: "rig.selfdev.json",
	wakeSet: [coordinator],
	ackCoordinatorWake: true,
	maxDurationS: 600,
});
check(
	"a wake set that is ALL coordinators, acked and bounded, downgrades the block to a recorded note",
	acked.severity === "note" && acked.id === "seat-shell-availability-acked" && acked.detail.includes("600s"),
	JSON.stringify(acked),
);
const refused = seatShellVerdict({
	plan: shellPlan(win32WithNothing),
	rigPath: "rig.selfdev.json",
	wakeSet: [coordinator, { name: "impl", known: true, keepsShell: true }],
	ackCoordinatorWake: true,
	maxDurationS: 600,
});
check(
	"ONE wake-set seat that keeps the shell tool makes the exception inadmissible — still a BLOCK, and it says why",
	refused.severity === "block" && refused.detail.includes("NOT admissible") && refused.detail.includes("impl"),
	refused.detail,
);
const unacked = seatShellVerdict({ plan: shellPlan(win32WithNothing), rigPath: "rig.selfdev.json", wakeSet: [coordinator], ackCoordinatorWake: false });
check(
	"without the operator's ack the carve-out is not applied (the instrument records a ruling, it never invents one)",
	unacked.severity === "block" && unacked.detail.includes("IS measurable"),
	unacked.detail,
);
const ghostSeat = seatShellVerdict({
	plan: shellPlan(win32WithNothing),
	rigPath: "rig.selfdev.json",
	wakeSet: [{ name: "ghost", known: false, keepsShell: true }],
	ackCoordinatorWake: true,
	maxDurationS: 600,
});
check(
	"a wake-set name absent from the rig file is NOT counted as a coordinator (unknown stays load-bearing)",
	ghostSeat.severity === "block" && ghostSeat.detail.includes("ghost(absent from rig.selfdev.json)"),
	ghostSeat.detail,
);

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
