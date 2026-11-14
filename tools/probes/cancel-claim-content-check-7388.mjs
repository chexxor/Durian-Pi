#!/usr/bin/env node
/*
 * #7388 - a cancellation says "artifact already fully on main". Ancestry is a FAST PATH (#3337);
 * content is the decision. Checks the substance a commit added against main, at FRAGMENT granularity.
 * Why fragments and not lines: a line-level substring test reports MISSING when the line was later
 * EXTENDED - measured here, the runbook's evidence_addendum line added in 3c4973c9 is not a substring
 * of main's version of that line because six later addenda were appended to it. A check that reports
 * a false absence is worse than no check: it reopens closed work.
 * Falsifier: exit 1 when a fragment the commit added is absent from main.
 * Run: node tools/probes/cancel-claim-content-check-7388.mjs <sha>
 */
import { execFileSync } from "node:child_process";

const sha = process.argv[2] ?? "3c4973c99c9a879dea06b857fa9ec8208a40304a";
const git = (args) => execFileSync("git", args, { encoding: "utf8" });

const ancestor = (() => { try { git(["merge-base", "--is-ancestor", sha, "main"]); return true; } catch { return false; } })();
console.log(`commit ${sha.slice(0, 10)} resolves; ancestor of main: ${ancestor} (fast path only, not the decision)`);

// Sentences, clauses and quoted spans - the units a claim is actually made of.
const fragments = (line) => line.split(/;\s+|\s—\s+|\.\s+/).flatMap((f) => f.split(/,\s+/)).map((f) => f.trim()).filter((f) => f.length >= 40);

let missing = 0, present = 0, checked = 0;
let current = null;
for (const line of git(["diff", `${sha}^`, sha]).split("\n")) {
  const m = /^diff --git a\/(\S+) b\/\S+$/.exec(line);
  if (m) { current = m[1]; continue; }
  if (!current || !line.startsWith("+") || line.startsWith("+++")) continue;
  for (const frag of fragments(line.slice(1))) {
    let onMain = "";
    try { onMain = git(["show", `main:${current}`]); } catch { onMain = ""; }
    checked++;
    if (onMain.includes(frag)) present++;
    else { missing++; console.log(`  ABSENT from main:${current}: ${frag.slice(0, 100)}`); }
  }
}
console.log(`fragments checked: ${checked}; present on main: ${present}; absent: ${missing}`);
console.log("\n=== VERDICT ===");
console.log(missing === 0
  ? "the cancellation's claim holds for this artifact: the substance it added is on main"
  : `the cancellation's claim does NOT hold: ${missing} fragment(s) are absent from main`);
process.exit(missing === 0 ? 0 : 1);
