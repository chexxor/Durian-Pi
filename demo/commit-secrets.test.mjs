// demo/commit-secrets.test.mjs — #1317: the commit-time secret pre-flight.
//
// Security finding #1315 (HIGH): the commit path had NO automated gate — nothing
// stopped a secret-shaped line from being committed into portable history. This proves
// the gate the guard now runs on a seat's own `git commit`: it scans the STAGED
// content, refuses a secret-shaped value, names the FILE, and NEVER echoes the value.
//
// Precision-first is part of the contract: the gate uses #700's provider-PREFIX shapes
// only, so a full git sha (40 hex chars) in a diff is NOT refused — a gate that blocks
// ordinary commits is an outage (the posture rule: prefer a false negative).
//
// Failing-first: before the gate, `git commit` is allowed and the first block
// assertion fails (RED).
//
// Run: node demo/commit-secrets.test.mjs  (exit 0 = pass)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeTool, secretOffendersInDiff } from "../src/seatguard.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// Shaped like an OpenAI key (not a real one).
const FAKE_KEY = "sk-" + "a".repeat(32);

// --- unit: the diff scanner ---------------------------------------------------
console.log("\nthe diff scanner reads ADDED lines only, by token shape");
const diffWithSecret =
	"diff --git a/durig.config.json b/durig.config.json\n" +
	"--- a/durig.config.json\n" +
	"+++ b/durig.config.json\n" +
	"@@ -0,0 +1,2 @@\n" +
	`+{"DEEPINFRA_API_KEY":"${FAKE_KEY}"}\n` +
	'+{"DURIG_DB":"./rig.sqlite"}\n';
const hit = secretOffendersInDiff(diffWithSecret);
check("a secret-shaped token on an added line is an offender", hit.length === 1, JSON.stringify(hit));
check("the offender names the file", hit[0]?.path === "durig.config.json", JSON.stringify(hit));
check("the offender NEVER carries the value", !JSON.stringify(hit).includes(FAKE_KEY));
check(
	"a REMOVED line is not scanned (the value is leaving the tree)",
	secretOffendersInDiff(`diff --git a/x b/x\n+++ b/x\n@@ -1,1 +1,0 @@\n-{"K":"${FAKE_KEY}"}\n`).length === 0,
);
check(
	"a 40-hex git sha is NOT an offender (precision-first, no false positive)",
	secretOffendersInDiff('diff --git a/x.json b/x.json\n+++ b/x.json\n@@ -0,0 +1,1 @@\n+{"rev":"850d53b6bb0e3a23396610f912a9a55ba58c558b"}\n').length === 0,
);
check(
	"a clean diff has no offenders",
	secretOffendersInDiff("diff --git a/x b/x\n+++ b/x\n@@ -0,0 +1,1 @@\n+x=1\n").length === 0,
);

// --- integration: the guard blocks a `git commit` whose STAGED content leaks ---
const root = mkdtempSync(join(tmpdir(), "durig-commit-secrets-"));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
git("init", "-q");
git("config", "user.email", "t@example.invalid");
git("config", "user.name", "t");
process.env.DURIG_SEAT_ROOT = root;
const commitCall = (id, command) => beforeTool({ type: "toolCall", id, name: "bash", arguments: { command } });

try {
	console.log("\na clean staged change commits");
	writeFileSync(join(root, "clean.txt"), "nothing secret here\n");
	git("add", "clean.txt");
	check("a clean staged file is allowed", (await commitCall("1", "git commit -m x")) === undefined);
	git("commit", "-q", "-m", "clean", "--", "clean.txt");

	console.log("\na secret-shaped value in the staged content is refused, without the value");
	writeFileSync(join(root, "leak.json"), JSON.stringify({ DEEPINFRA_API_KEY: FAKE_KEY }) + "\n");
	git("add", "leak.json");
	const blocked = await commitCall("2", "git commit -m x");
	check("the commit is BLOCKED", typeof blocked?.block === "string", JSON.stringify(blocked));
	check("the block names the file", blocked?.block?.includes("leak.json"), blocked?.block);
	check("the block NEVER echoes the value", !blocked?.block?.includes(FAKE_KEY), blocked?.block);
	git("reset", "-q", "leak.json");
	rmSync(join(root, "leak.json"));

	console.log("\n`git commit -a` is scanned through the working tree, not just the index");
	writeFileSync(join(root, "tracked.txt"), "before\n");
	git("add", "tracked.txt");
	git("commit", "-q", "-m", "add tracked");
	writeFileSync(join(root, "tracked.txt"), `key = ${FAKE_KEY}\n`);
	const blockedA = await commitCall("3", "git commit -a -m x");
	check("git commit -a with a secret in the tree is BLOCKED", typeof blockedA?.block === "string", JSON.stringify(blockedA));
	check("the -a block never echoes the value", !blockedA?.block?.includes(FAKE_KEY));

	console.log("\nnon-commit commands are untouched");
	check("git status is allowed", (await commitCall("4", "git status")) === undefined);
	check("a git commit with no staged secret is allowed", (await commitCall("5", "git commit --amend -m x")) === undefined);
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nPASS — the commit-time secret pre-flight holds" : `\nFAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
