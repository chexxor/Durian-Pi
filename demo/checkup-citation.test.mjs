// demo/checkup-citation.test.mjs — prove ROADMAP 190: a cited commit must RESOLVE, or the row must
// not cite it.
//
// WHY A CHECK AND NOT A NOTE: measured on this workspace 2026-10-26, 178 distinct commit shas were
// cited across the queue and 90 of them resolved NOWHERE — not this clone, not the vendored pi tree,
// not `origin` after a clean fetch. They sat on 240 terminal rows and on 14 non-terminal ones whose
// verification evidence a seat picking them up cannot re-check. The archaeology that followed (mount
// the Windows volume, fetch its branches, recover dangling objects, then resolve the rest by
// patch-equivalence) was a session's work. A sentence in a runbook did not prevent it and would not
// catch the next one: what is missing is a RULE, so the count is a failing test rather than a manual
// audit.
//
// THE CLASS, precisely: the queue cites MACHINE-LOCAL GIT OBJECTS as durable evidence. A sha is a
// pointer, and a pointer into an object store that did not travel with the store is not evidence.
// Worked example from the same audit: `#3743`/`#4378` cite `0c6fd7665`, which matches NO object,
// while the landing commit is `0c6fd76e465…` — the seat cited its branch commit and landing rewrote
// it. Nothing was lost; the pointer was stale. The rule cannot tell those two cases apart (only
// patch-equivalence can), so it reports exactly what it measured: THIS CLONE CANNOT CHECK IT.
//
// Three surfaces, kept distinct: the pure extractor (which tokens even look like citations), the
// reader (one `git cat-file --batch-check` for all of them), and the rule (what a person is told).
//
// Run: node demo/checkup-citation.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { auditRig } from "../src/checkup.mjs";
import { extractCitedShas, readCitations } from "../src/citation.mjs";

let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
};

// ── 1. the extractor: what even looks like a citation ────────────────────────────────────────────
// A hex run must carry BOTH a digit and a letter. Without that, the extractor reports every date
// (`2026-10-26`), every round number and every bare word as a commit, and the rule's findings become
// noise a reader learns to ignore — the failure mode the rule exists to avoid.
{
	const text = "landed as 0c6fd7665 and 0c6fd76e4659b1deeaa7c0765c2654469a57abfd, base 351b03add";
	const got = extractCitedShas(text);
	check("a 9-char and a 40-char citation are both found", got.includes("0c6fd7665") && got.includes("0c6fd76e4659b1deeaa7c0765c2654469a57abfd"), JSON.stringify(got));
	check("a date is not a citation", extractCitedShas("measured 2026-10-26 at 12:34").length === 0);
	check("a bare decimal is not a citation", extractCitedShas("175 tokens, 8192 max").length === 0);
	check("a pure-letter hex run is not a citation", extractCitedShas("the word deadbeefcafe appears").length === 0);
	check("duplicates collapse", extractCitedShas("abc12345 then abc12345").length === 1);
	check("a 7-char prefix is too short to be a citation", extractCitedShas("0c6fd76").length === 0);
}

// ── 2. the reader: one process, and UNKNOWN is not clean ─────────────────────────────────────────
{
	check("no repository means null (skipped), never an empty pass", readCitations({ root: join(tmpdir(), "definitely-not-a-repo-xyz"), queueItems: [] }) === null);

	const dir = mkdtempSync(join(tmpdir(), "durig-citation-"));
	try {
		const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		git("init", "-q");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "real commit");
		const real = git("rev-parse", "HEAD").trim();
		const fake = "0c6fd7665";
		const items = [
			{ id: 1, status: "held", subject: `gated on ${fake}`, body: "" },
			{ id: 2, status: "done", subject: `landed as ${real.slice(0, 9)}`, body: "" },
			{ id: 3, status: "done", subject: "no citation at all", body: "" },
		];
		const got = readCitations({ root: dir, queueItems: items });
		check("a resolvable citation is marked resolved", got?.find((c) => c.itemId === 2)?.resolves === true, JSON.stringify(got));
		check("an unresolvable citation is marked unresolved", got?.find((c) => c.itemId === 1)?.resolves === false, JSON.stringify(got));
		check("a row with no citation produces no record", !got?.some((c) => c.itemId === 3), JSON.stringify(got));
		check("the row's status travels with the citation", got?.find((c) => c.itemId === 1)?.status === "held");
	} finally {
		try { rmSync(dir, { recursive: true, force: true }); } catch (err) { console.error(`CLEANUP WARNING: ${err?.message ?? err}`); }
	}
}

// ── 3. the rule: a live row is a finding, a terminal row is a baseline count ─────────────────────
{
	const base = { rig: "rig.json", spec: { seats: [{ name: "pm" }] }, specConstitution: "be honest", stored: { reason: "absent" }, storedSeats: null };

	const skipped = auditRig({ ...base, citations: null });
	check("no citation data means SKIPPED with a reason (D25)", skipped.checks.find((c) => c.id === "citation-unresolvable")?.status === "skipped", JSON.stringify(skipped.checks.find((c) => c.id === "citation-unresolvable")));

	const live = auditRig({
		...base,
		citations: [
			{ itemId: 3743, status: "held", sha: "0c6fd7665", resolves: false },
			{ itemId: 3744, status: "held", sha: "abc1234d", resolves: true },
		],
	});
	const f = live.findings.filter((x) => x.id === "citation-unresolvable");
	check("a non-terminal row citing a dead sha is a finding", f.length === 1, JSON.stringify(f));
	check("the finding names the item", /#3743/.test(f[0]?.subject ?? ""), f[0]?.subject);
	check("the finding names the sha", /0c6fd7665/.test(f[0]?.detail ?? ""), f[0]?.detail);
	check("the finding tells you to resolve it by patch-equivalence", /patch-equal|git log -S/.test(f[0]?.fix ?? ""), f[0]?.fix);
	check("a resolvable citation is not a finding", !f.some((x) => /#3744/.test(x.subject)));

	const terminal = auditRig({
		...base,
		citations: [
			{ itemId: 100, status: "done", sha: "dead1234", resolves: false },
			{ itemId: 101, status: "done", sha: "dead5678", resolves: false },
		],
	});
	const tf = terminal.findings.filter((x) => x.id === "citation-unresolvable");
	check("terminal rows collapse to ONE baseline finding, not one per row", tf.length === 1, JSON.stringify(tf));
	check("the baseline finding reports the count", /2\b/.test(tf[0]?.detail ?? ""), tf[0]?.detail);
	check("the baseline finding says no action is needed unless re-opened", /re-open/i.test(tf[0]?.fix ?? ""), tf[0]?.fix);
}

assert.ok(true);
console.log(failures === 0 ? "\nCHECKUP-CITATION TEST PASS" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
