// demo/landing-preflight-dirt.test.mjs — the pre-flight dirt rule (#5347)
//
// WHAT IS BEING PROVEN, and how: that the landing pre-flight refuses on the dirt it could
// actually clobber and proceeds on dirt it cannot. Two halves, deliberately different kinds of
// evidence:
//   (a) the CLASSIFIER, on synthetic status lines - the rule itself, in isolation;
//   (b) GIT ITSELF, on throwaway fixture repos - the claim that "a fast-forward is broken only by a
//       path it writes" is measured from git's behaviour, not asserted, and the classifier is then
//       checked against what git really did.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { classifyTreeDirt } from "../src/landinggate.mjs";

let fails = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`PASS ${label}`);
	else { fails++; console.log(`FAIL ${label} - ${detail}`); };
};

// ── (a) the classifier ──
// The exact shape that made landing unpassable in a live rig (impl #5250): the rig's own spend
// audit log plus another seat's in-flight edit, neither of which the landing touches.
const liveRig = classifyTreeDirt(
	["M docs/ROADMAP.md", "?? install.sh", "?? selfdev.sqlite.spend.jsonl"],
	["scripts/sync-pi.mjs", "demo/syncpi.test.mjs"],
);
check("rig-generated artefact + untouched in-flight edit does NOT block the landing", liveRig.ok, JSON.stringify(liveRig.refuse));
check("and both are still REPORTED, not silently dropped", liveRig.proceed.length === 3, `reported ${liveRig.proceed.length}`);
check("the reported reason says why each is safe", liveRig.proceed.every((d) => d.why.includes("not written by this landing")), JSON.stringify(liveRig.proceed.map((d) => d.why)));

const trackedHit = classifyTreeDirt(["M scripts/sync-pi.mjs"], ["scripts/sync-pi.mjs"]);
check("a tracked edit ON a path the landing writes REFUSES", !trackedHit.ok && trackedHit.refuse[0].path === "scripts/sync-pi.mjs", JSON.stringify(trackedHit));

const untrackedHit = classifyTreeDirt(["?? demo/syncpi.test.mjs"], ["scripts/sync-pi.mjs", "demo/syncpi.test.mjs"]);
check("an untracked file the branch ADDS REFUSES (git would overwrite it)", !untrackedHit.ok, JSON.stringify(untrackedHit));

check("mixed dirt refuses only on the intersecting path", (() => {
	const r = classifyTreeDirt(["M docs/ROADMAP.md", "M scripts/sync-pi.mjs", "?? a.log"], ["scripts/sync-pi.mjs"]);
	return r.refuse.length === 1 && r.refuse[0].path === "scripts/sync-pi.mjs" && r.proceed.length === 2;
})(), "intersection is not all-or-nothing");

check("a rename line is read as its destination", (() => {
	const r = classifyTreeDirt(["R  docs/OLD.md -> docs/NEW.md"], ["docs/NEW.md"]);
	return !r.ok && r.refuse[0].path === "docs/NEW.md";
})(), "rename destination missing");

check("clean tree, no paths: passes", classifyTreeDirt([], []).ok, "clean tree must not refuse");

// ── (b) git's own behaviour, on fixture repos ──
function fixture(name, { untrackedPath, untrackedContent, branchAddPath }) {
	const dir = mkdtempSync(join(process.cwd(), `.lpd-fixture-${name}-`));
	const g = (argv) => spawnSync("git", argv, { cwd: dir, encoding: "utf8", timeout: 20000 });
	g(["init", "-q", "-b", "main"]);
	g(["config", "user.email", "fixture@example.com"]);
	g(["config", "user.name", "fixture"]);
	writeFileSync(join(dir, "base.txt"), "base\n");
	g(["add", "base.txt"]);
	g(["commit", "-q", "-m", "base"]);
	g(["checkout", "-q", "-b", "br"]);
	writeFileSync(join(dir, branchAddPath), "added by the branch\n");
	g(["add", branchAddPath]);
	g(["commit", "-q", "-m", "branch adds a file"]);
	g(["checkout", "-q", "main"]);
	writeFileSync(join(dir, untrackedPath), untrackedContent);
	const ff = g(["merge", "--ff-only", "br"]);
	return { dir, ffExit: ff.status, ffOut: ff.stdout + ff.stderr };
}

const unrelated = fixture("unrelated", { untrackedPath: "selfdev.sqlite.spend.jsonl", untrackedContent: { spend: 1 } + "\n", branchAddPath: "new.mjs" });
const colliding = fixture("colliding", { untrackedPath: "new.mjs", untrackedContent: "someone else's file\n", branchAddPath: "new.mjs" });
try {
	check("git fast-forwards PAST an untracked rig artefact it does not write", unrelated.ffExit === 0, `git exit ${unrelated.ffExit}: ${unrelated.ffOut.slice(0, 160)}`);
	check("git REFUSES the same fast-forward when the untracked file is one it writes", colliding.ffExit !== 0, `git exit ${colliding.ffExit}: ${colliding.ffOut.slice(0, 160)}`);
	check("git's refusal is the overwrite message, not a cleanliness rule", /would be overwritten by merge/.test(colliding.ffOut), colliding.ffOut.slice(0, 200));

	// the classifier must agree with what git actually did, on git's own status output
	const statusOf = (dir) => spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout.split("\n").map((l) => l.trimEnd()).filter(Boolean);
	const verdictUnrelated = classifyTreeDirt(statusOf(unrelated.dir), ["new.mjs"]);
	const verdictColliding = classifyTreeDirt(statusOf(colliding.dir), ["new.mjs"]);
	check("classifier agrees with git: unrelated artefact proceeds", verdictUnrelated.ok === (unrelated.ffExit === 0), `classifier ok=${verdictUnrelated.ok}, git exit ${unrelated.ffExit}`);
	check("classifier agrees with git: colliding untracked file refuses", verdictColliding.ok === (colliding.ffExit === 0), `classifier ok=${verdictColliding.ok}, git exit ${colliding.ffExit}`);
} finally {
	rmSync(unrelated.dir, { recursive: true, force: true });
	rmSync(colliding.dir, { recursive: true, force: true });
}

console.log(fails ? `LANDING-PREFLIGHT-DIRT: ${fails} FAIL(S)` : "LANDING-PREFLIGHT-DIRT: all checks pass");
process.exit(fails ? 1 : 0);
