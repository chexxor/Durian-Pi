// demo/self-merge-seat.test.mjs — the seat's OWN landing verb, run end to end.
//
// WHY THIS EXISTS. extensions/self-merge.mjs gives an authoring seat two verbs, `landing_health` and
// `land_my_item`, and one check rule, `ready-ref-stale`. demo/self-merge-plan.test.mjs pins the PLAN
// (pure function, no git): which branches a seat may be handed and which are refused. This demo runs the
// REAL verb against a REAL git repository and the rig's REAL chokepoint, `scripts/land.mjs`, with no
// model and no store — the seat conversation is stubbed only for the two reads the tool makes of the
// queue (`Seats` and `RigQueue`). That is the part a plan test cannot prove: that calling the verb from
// inside an item worktree lands the branch in the SHARED root (the #4247 failure mode), that main
// advances only when the gate is green, and that the check rule's `run()` returns a finding for a ref
// that is ready and overdue — the negative fixture for the rule that makes `cli.mjs check` exit 1.
//
// Run: node demo/self-merge-seat.test.mjs   (measured 2026-11-14, Linux, Fedora Linux 45 (Forty Five),
// kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0 — 6.1 s; git + node only, no store, no model)
//
// What it proves, in order:
//   1. a seat running `land_my_item` from inside ITS OWN worktree advances main in the shared root
//   2. the same verb REFUSES a branch naming an item the seat does not hold — "self"-merge is checked
//   3. `landing_health` reads the backlog from the seat's cwd and never claims more than git supports
//   4. the check rule fires on a stale ready ref (the negative fixture), names the fix, and a push
//      appears nowhere in the remedy
//   5. the standing-prompt section is static text that names both verbs and says "never pushes"
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditRig } from "../src/checkup.mjs";
import { Seats, RigQueue } from "../src/rig.mjs";
import { selfMergeExtension } from "../extensions/self-merge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (cwd, args) => {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
	return (r.stdout ?? "").trim();
};
const commit = (cwd, msg, date) =>
	spawnSync("git", ["-c", "user.email=seat@example.invalid", "-c", "user.name=seat", "commit", "-q", "-m", msg], {
		cwd,
		env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
		stdio: ["ignore", "pipe", "pipe"],
	});
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const tmp = mkdtempSync(join(tmpdir(), "durig-self-merge-seat-"));
const repo = join(tmp, "shared");
let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
};

try {
	/* ── the fixture: a shared root with a suite small enough to run in under a second ── */
	mkdirSync(repo, { recursive: true });
	git(repo, ["init", "-q", "-b", "main"]);
	git(repo, ["config", "user.email", "seat@example.invalid"]);
	git(repo, ["config", "user.name", "seat"]);
	writeFileSync(join(repo, ".gitignore"), "*.sqlite*\n*.sqlite.broker.*\n/.land-scratch-*/\n.durig/\n/item-*/\n");
	// The seat's verb shells out to scripts/land.mjs relative to its cwd, so the fixture needs the real
	// helper. A one-line shim execs the rig's OWN scripts/land.mjs (absolute path, via DURIG_REAL_LAND):
	// the chokepoint exercised is the fleet's, not a stub, and the fixture stays small.
	mkdirSync(join(repo, "scripts"), { recursive: true });
		writeFileSync(join(repo, "scripts/land.mjs"), `#!/usr/bin/env node\nimport { spawnSync } from "node:child_process";\nconst r = spawnSync(process.execPath, [process.env.DURIG_REAL_LAND, ...process.argv.slice(2)], { cwd: process.cwd(), encoding: "utf8" });\nprocess.stdout.write(r.stdout ?? "");\nprocess.stderr.write(r.stderr ?? "");\nprocess.exit(r.status ?? 1);\n`);
	mkdirSync(join(repo, "demo"), { recursive: true });
	writeFileSync(join(repo, "demo", "ok.test.mjs"), "// covers src/widget.mjs\nconsole.log('ok');\nprocess.exit(0);\n");
	writeFileSync(join(repo, "demo", "slow.test.mjs"), "console.log('ok too');\nprocess.exit(0);\n");
	writeFileSync(join(repo, "demo", "test-areas.json"), JSON.stringify({ areas: { fixture: ["demo/ok.test.mjs", "demo/slow.test.mjs"] } }) + "\n");
	// --changed-suite is the DEFAULT gate the seat verb uses, so the fixture carries the real selector
	// and its module: the derived gate is the rig's own code, not a stub.
	mkdirSync(join(repo, "tools"), { recursive: true });
	mkdirSync(join(repo, "src"), { recursive: true });
	writeFileSync(join(repo, "tools/what-to-test.mjs"), readFileSync(join(ROOT, "tools", "what-to-test.mjs"), "utf8"));
	writeFileSync(join(repo, "src/testareas.mjs"), readFileSync(join(ROOT, "src", "testareas.mjs"), "utf8"));
	writeFileSync(join(repo, "a.txt"), "base\n");
	git(repo, ["add", "."]);
	git(repo, ["commit", "-q", "-m", "base"]);

	/* The seat's own branch, with its own worktree — the state a seat is actually in. */
	git(repo, ["worktree", "add", "-q", "-b", "item-102", join(repo, "item-102")]);
	git(repo, ["worktree", "list", "--porcelain"]); // registration, so the stray check does not fire
	writeFileSync(join(repo, "item-102", "feature.txt"), "the seat's work\n");
	mkdirSync(join(repo, "item-102", "src"), { recursive: true });
	writeFileSync(join(repo, "item-102", "src", "widget.mjs"), "export const widget = 1;\n");
	git(join(repo, "item-102"), ["add", "."]);
	commit(join(repo, "item-102"), "item-102: the seat's own change", hoursAgo(1));

	/* A driver that calls the extension's tool exactly as the harness would, with cwd = the worktree. */
	const driver = join(repo, "seat-driver.mjs");
	writeFileSync(
		driver,
		`import { Seats, RigQueue } from "${join(ROOT, "src", "rig.mjs")}";
import { selfMergeExtension } from "${join(ROOT, "extensions", "self-merge.mjs")}";
const mode = process.argv[2];
const branch = process.argv[3] ?? "";
// The two queue reads the tool makes, stubbed. Seats: one conversation, id 42. Queue: item 101
// done, item 102 claimed by that seat. The git facts are NOT stubbed - they are read from the
// fixture repository by the real instrument.
const seats = { seats: { impl: { conversationId: 42, role: "implementation engineer" } } };
const queue = { nextId: 3, items: [{ id: 101, to: "impl", status: "done" }, { id: 102, to: "impl", status: "claimed" }] };
const api = { conversationId: 42, commit: async (fn) => fn({ doc: (d) => (d === Seats ? seats : d === RigQueue ? queue : {}) }) };
const tool = selfMergeExtension.tools.find((t) => t.name === mode);
const out = await tool.execute({ branch }, api, {});
console.log(out.output?.[0]?.text ?? out.content?.[0]?.text);
`,
	);
	git(repo, ["add", "seat-driver.mjs"]);
	git(repo, ["commit", "-q", "-m", "fixture: the seat driver"]);

	const mainBefore = git(repo, ["rev-parse", "main"]);

	/* ── 1. the seat lands its OWN branch from INSIDE its worktree ── */
	console.log("=== 1. land_my_item, run with cwd = the seat's own item worktree ===");
	const run = spawnSync(process.execPath, [driver, "land_my_item", "item-102"], {
		cwd: join(repo, "item-102"),
		encoding: "utf8",
		timeout: 120000,
		env: { ...process.env, DURIG_REAL_LAND: join(ROOT, "scripts", "land.mjs"), DURIG_MAX_CONCURRENT_SEATS: "1", DURIG_DB: join(repo, "fixture.sqlite") },
	});
let report = null;
try {
	report = JSON.parse(run.stdout);
} catch {
	report = null;
}
check("the verb returns a JSON report", report && typeof report === "object", run.stdout.slice(0, 300) || run.stderr.slice(0, 300));
check("the plan's argv is the rig's own helper, not a hand-rolled merge", report?.plan?.argv?.[1] === "scripts/land.mjs", JSON.stringify(report?.plan?.argv));
	check("...and the gate flag is the derived one", report?.plan?.argv?.includes("--changed-suite"), JSON.stringify(report?.plan?.argv));
check("...and it names the SHARED ROOT as the landing target, not the worktree", report?.plan?.argv?.[4] === repo, JSON.stringify(report?.plan?.argv));
check("...and the argv contains no push", !JSON.stringify(report?.plan?.argv).includes("push"), JSON.stringify(report?.plan?.argv));
check("the helper exits 0", report?.helper_exit === 0, JSON.stringify(report?.report?.error ?? report?.report).slice(0, 300));
check("...and the helper reports ok", report?.report?.ok === true, JSON.stringify(report?.report?.error ?? "").slice(0, 300));
check("...and the gate that ran is recorded as the DERIVED one", report?.report?.gate?.kind === "derived", JSON.stringify(report?.report?.gate));
	check("...and the derived set is stated, not assumed", typeof report?.report?.gate?.statement === "string", JSON.stringify(report?.report?.gate));
check("main ADVANCED", git(repo, ["rev-parse", "main"]) !== mainBefore, `${mainBefore.slice(0, 8)} -> ${git(repo, ["rev-parse", "main"]).slice(0, 8)}`);
check("...and the seat's branch is now an ANCESTOR of main", report?.proof?.ancestor === true, JSON.stringify(report?.proof));
check("...and the landed content is in the shared tree", spawnSync("git", ["show", "main:feature.txt"], { cwd: repo }).stdout.includes("the seat's work"));
check("no scratch worktree is left registered", !git(repo, ["worktree", "list"]).includes(".land-scratch-"), git(repo, ["worktree", "list"]));
check("the shared tree is not mid-merge", !existsSync(join(repo, ".git", "MERGE_HEAD")), "MERGE_HEAD present — the shared tree is mid-merge");

	/* ── 2. the verb refuses a branch that is not the seat's own ── */
	console.log("\n=== 2. the ownership check: a seat cannot land a branch it does not hold ===");
	const mainAfterLand = git(repo, ["rev-parse", "main"]);
	const stranger = spawnSync(process.execPath, [driver, "land_my_item", "item-999"], {
		cwd: join(repo, "item-102"),
		encoding: "utf8",
		timeout: 30000,
		env: { ...process.env, DURIG_REAL_LAND: join(ROOT, "scripts", "land.mjs"), DURIG_DB: join(repo, "fixture.sqlite") },
	});
	const strangerText = stranger.stdout.trim();
	check("the verb REFUSES before touching git", strangerText.startsWith("REFUSED:"), strangerText.slice(0, 200));
	check("...and names which items the seat holds", /held: 102/.test(strangerText), strangerText);
	check("...and main did not move", git(repo, ["rev-parse", "main"]) === mainAfterLand);

	/* ── 3. the read verb, from the seat's cwd ── */
	console.log("\n=== 3. landing_health: the backlog as git sees it ===");
	const health = spawnSync(process.execPath, [driver, "landing_health", ""], {
		cwd: join(repo, "item-102"),
		encoding: "utf8",
		timeout: 30000,
		env: { ...process.env, DURIG_DB: join(repo, "fixture.sqlite") },
	});
	const h = JSON.parse(health.stdout);
	check("the read reports the refs it looked at", h.refs >= 1, JSON.stringify({ refs: h.refs, counts: h.counts }));
	check("...and the just-landed branch is counted as landed", (h.counts.landed ?? 0) >= 1, JSON.stringify(h.counts));
	check("...and it writes nothing", git(repo, ["rev-parse", "main"]) === mainAfterLand);

	/* ── 4. the negative fixture for the check rule: ready + overdue = a finding ── */
	console.log("\n=== 4. ready-ref-stale: the rule FIRES on a ready ref past the SLA (negative fixture) ===");
	const wt = join(repo, "item-201-work");
	git(repo, ["worktree", "add", "-q", "-b", "item-201", wt]);
	writeFileSync(join(wt, "late.txt"), "work that sat for two days\n");
	git(wt, ["add", "."]);
	commit(wt, "item-201: ready and stale", hoursAgo(48));
	git(repo, ["worktree", "remove", "--force", wt]);
	git(repo, ["worktree", "prune"]);

	const rule = selfMergeExtension.checks[0];
	const finding = rule.run({ repo, db: join(repo, "fixture.sqlite") });
	check("the rule names the rule it is", rule.id === "ready-ref-stale" && rule.severity === "error", JSON.stringify({ id: rule.id, severity: rule.severity }));
	check("a 48 h old ready ref produces a finding", (finding.findings ?? []).some((f) => f.subject === "item-201"), JSON.stringify(finding).slice(0, 400));
	check("...with its age in hours", (finding.findings ?? []).some((f) => f.detail.includes("48")), JSON.stringify(finding.findings));
	check("...and only the stale ref is named, never the landed one", (finding.findings ?? []).map((f) => f.subject).join(",") === "item-201", JSON.stringify((finding.findings ?? []).map((f) => f.subject)));
	check("...and a fix command that is the rig's own helper", (finding.findings ?? []).every((f) => String(f.fix ?? "").includes("scripts/land.mjs")), JSON.stringify((finding.findings ?? []).map((f) => f.fix)));
	check("...and the fix never contains a push", (finding.findings ?? []).every((f) => !/push/i.test(f.fix)), JSON.stringify((finding.findings ?? []).map((f) => f.fix)));
	const audit = auditRig({
		rig: "fixture.json",
		spec: { seats: [] },
		specConstitution: "shared norms",
		stored: { reason: "read", text: "shared norms" },
		runbooks: [],
		extensionRules: [rule],
		extensionFindings: finding.findings ?? [],
	});
	const checkLine = audit.checks.find((c) => c.id === rule.id);
	check("the audit lists the extension rule as a check", Boolean(checkLine), JSON.stringify(audit.checks.map((c) => c.id)));
	check("...and reports it as a FAIL", checkLine?.status === "fail", JSON.stringify(checkLine));
	check("...and the audit's exit code is 1, which is what `check` gates on", audit.exitCode === 1, String(audit.exitCode));

	/* ── 5. the prompt the seat actually sees ── */
	console.log("\n=== 5. the standing prompt says the same thing the tools do ===");
	const section = selfMergeExtension.sections[0];
	const text = typeof section.render === "function" ? section.render() : String(section.text ?? section);
	check("the section names both verbs", /landing_health/.test(text) && /land_my_item/.test(text), String(text).slice(0, 200));
	check("...and states that it never pushes", /never pushes/i.test(text), String(text).slice(0, 300));

	console.log(failures === 0 ? "\nSEAT SELF-MERGE OK" : `\nFAIL - ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err?.stack ?? err);
	failures += 1;
} finally {
	try {
		git(repo, ["worktree", "remove", "--force", join(repo, "item-102")]);
	} catch {}
	rmSync(tmp, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
