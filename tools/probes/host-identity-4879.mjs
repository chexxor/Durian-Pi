#!/usr/bin/env node
/*
 * host-identity-4879.mjs — does a seat need a DECLARED host field, or a DERIVED one?

 ROADMAP 217's second finding is that no seat definition names its host OS or the shell its shell tool
 starts. Lead's ruling (#4864 item 3) split that half out of #4849 as THIS row: availability-based
 selection fixes the observed ENOENT without a schema change, so the question left on the table is
 whether a `hostOs`/`shell` field on a seat definition is needed at all.

 Everything here is run against the product's own functions and files — no store, no model, no
 hand-rolled re-derivation:
   * `shellPlan()` from src/shellregistry.mjs (the SAME plan that registers the tool and that
     src/seatguard.mjs uses to refuse a withheld shell),
   * `resolveSeatRoot()` / `classifyGitRoot()` from src/seatroot.mjs (263's seam),
   * `shellToolLine()` from src/shellregistry.mjs (the seat-facing sentence, cli.mjs:623),
   * the rig file the fleet is defined in.

 Run: node tools/probes/host-identity-4879.mjs [path/to/rig.selfdev.json]
 Exit 0 = the seat's host identity is derived and named everywhere it is consumed.
 Exit 1 = a consumer still decides host from a source other than the live host, or names no host at all.
*/
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shellPlan, shellToolLine, shellToolNames, offeredShellNames, withheldShellNames } from "../../../src/shellregistry.mjs";
import { resolveSeatRoot, classifyGitRoot, sameRoot } from "../../../src/seatroot.mjs";

const failures = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failures.push(msg);
};
const measure = (msg) => console.log(`  MEASURED  ${msg}`);

/* 1. THE PREMISE: what a seat definition can carry today. */
const rigPath = process.argv[2] ?? resolve(new URL("../../rig.selfdev.json", import.meta.url).pathname);
const rig = JSON.parse(readFileSync(rigPath, "utf8"));
const seats = rig.seats ?? [];
const fields = [...new Set(seats.flatMap((s) => Object.keys(s)))];
measure(`rig ${rigPath}: ${seats.length} seats, field union = ${fields.join(", ")}`);
check(
	!fields.some((f) => /host|os|shell|platform/i.test(f)),
	"no seat definition carries a host/shell field — the 217 finding is real, and today selection cannot read one",
);

/* 2. SELECTION IS DERIVED FROM THE LIVE HOST, and that is the whole fix. */
const here = shellPlan();
measure(`shellPlan() on THIS host: platform=${here.platform} name=${here.name} startedBy=${here.startedBy} degraded=${here.degraded} tried=${JSON.stringify(here.tried.map((t) => `${t.name}:${t.offered}/${t.canStart}`))}`);
check(here.name === "bash" && here.startedBy && !here.degraded, "on a POSIX host the registered shell is bash, resolved from PATH, with no declaration anywhere");
check(
	offeredShellNames().join(",") === "bash" && withheldShellNames().length === 1,
	"offerability (RM-306) is decided by the host class the process is running on, not by a per-seat field",
);

/* 3. THE COUNTERFACTUAL: what a declared host field would do to selection. */
const declaredWin = shellPlan({ platform: "win32" });
measure(`shellPlan({platform:"win32"}) — a rig that DECLARED hostOs=win32 on this box: name=${declaredWin.name} startedBy=${declaredWin.startedBy} degraded=${declaredWin.degraded}`);
check(
	declaredWin.degraded === true && declaredWin.startedBy === null,
	"a declared host value used for selection reproduces ROADMAP 217 exactly: a registered tool whose programs do not resolve, so every shell call is a spawn error. Declaration must never feed selection.",
);

/* 4. THE SEAT-FACING SURFACE: does the seat know WHICH HOST it is on, not just which tool it has? */
const line = shellToolLine();
measure(`shellToolLine() = ${line}`);
check(
	/[a-z0-9.]+\s*shell|bash|powershell/i.test(line),
	"the seat-facing line names the registered shell tool and where it resolved",
);
check(
	/win32|linux|windows|posix|WSL/i.test(line),
	"the seat-facing line NAMES THE HOST CLASS. Today it names the tool and the resolved program but not the OS, so a seat still has to infer the host — 264's acceptance ('a seat asked what host it is on answers from context') is not met. Fix: emit `plan.platform` (and a WSL flag) from the same plan the tool is registered from.",
);

/* 5. 263'S SEAM: the resolver returns a stored root it never validated. */
const phantom = resolveSeatRoot({ persistedCwd: "C:\\Users\\Alex\\Durian-Pi" });
measure(`resolveSeatRoot({persistedCwd:"C:\\Users\\Alex\\Durian-Pi"}) on a POSIX host = ${JSON.stringify(phantom)}`);
check(phantom.root === "C:\\Users\\Alex\\Durian-Pi" && phantom.source === "persisted seat cwd", "the resolver returns the persisted cwd verbatim: no existence check, no host qualification, no reason field");
const kind = classifyGitRoot(phantom.root);
measure(`classifyGitRoot(that phantom root) = ${kind} — a foreign-shaped root is classified as a git tree by walking up from a path that does not exist`);
check(false, "263's acceptance is 'refuses to silently join a foreign-shaped value, naming seat, path, shape and the OS'. Nothing in the resolver names a shape or an OS today, so the phantom root wins and the seat is told it is in a real checkout.");

/* 6. HOW MANY NORMALIZERS DECIDE 'same tree' — 263 says do not add a third. */
const brokerSrc = readFileSync(resolve(new URL("../../src/broker.mjs", import.meta.url).pathname), "utf8");
const auditSrc = readFileSync(resolve(new URL("../../tools/rig-portability-audit.mjs", import.meta.url).pathname), "utf8");
const seatrootSrc = readFileSync(resolve(new URL("../../src/seatroot.mjs", import.meta.url).pathname), "utf8");
const normalizers = [
	{ where: "src/seatroot.mjs sameRoot", code: /const norm = \(p\) => resolve\(String\(p\)\)\.replace\(\/\[\\\\\/\]\+\$\/, ""\)\.toLowerCase\(\)/.test(seatrootSrc) ? "node resolve + lowercase" : "absent" },
	{ where: "src/broker.mjs classifyWorktrees", code: /const norm = \(p\) => String\(p/.test(brokerSrc) ? "backslash fold + lowercase" : "absent" },
	{ where: "tools/rig-portability-audit.mjs hostNormalize", code: /function hostNormalize/.test(auditSrc) ? "separator fold + case fold + POSIX<->drive mapping" : "absent" },
];
measure(`normalizers in play: ${normalizers.map((n) => `${n.where} [${n.code}]`).join(" | ")}`);
measure(`sameRoot("C:\\Users\\Alex\\x", "/home/x") = ${sameRoot("C:\\Users\\Alex\\x", "/home/x")} — the resolver's normalizer folds a drive letter into ONE relative component, the classifier's folds backslashes, the audit's maps it to /c/x. Three answers to one question.`);
check(
	normalizers.filter((n) => n.code !== "absent").length === 1,
	"ONE host-qualified normalizer, owned by src/seatroot.mjs and imported by the broker and the instruments. Today there are three, and the instrument is the one that knows the drive->POSIX mapping 263 says the resolver should own.",
);

/* 7. Does the seat ENV carry a host fact? (264: "makeSeatEnv for the capability values") */
const seattoolsSrc = readFileSync(resolve(new URL("../../src/seattools.mjs", import.meta.url).pathname), "utf8");
const hostMentions = (seattoolsSrc.match(/process\.platform|platform/g) || []).length;
measure(`src/seattools.mjs mentions platform ${hostMentions} times (the shell comes in via selectSeatShell(), which reads the host itself)`);
check(hostMentions === 0 || /selectSeatShell/.test(seattoolsSrc), "the seat env gets its shell from the registry rather than from a declared value");

console.log("");
console.log(`VERDICT: ${failures.length ? `NOT SETTLED — ${failures.length} consumer(s) still decide or report host identity from a source other than the live host` : "SETTLED — host identity is derived from the live host at every consumer"}`);
for (const f of failures) console.log(`  owed: ${f}`);
console.log("Shell names the guard treats as shell calls:", shellToolNames().join(", "));
process.exit(failures.length ? 1 : 0);
