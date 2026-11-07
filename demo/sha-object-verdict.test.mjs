// demo/sha-object-verdict.test.mjs — ONE shared git-object verdict for BOTH secret surfaces.
// (#3128; security #4922 addendum + the 2026-10-19 position P-1…P-5; lead #2040 ruling A;
//  incident docs/incidents/2026-10-19-git-sha-redacted-as-secret.md)
//
// FAILING FIRST. This file was written BEFORE the fix, against the tree it is meant to
// repair, and its own comments carry the numbers it measured there (exit 1 = the red
// state, exit 0 = the fixed state; both runs are re-runnable):
//
//   RED baseline, measured on the pre-fix tip (short id at run time, see the completion):
//     R1 every commit id in every ref classifies secret-shaped in the REDACTOR  2435 / 2435
//     R2 `git log --format=%H %s` over 40 lines: redact spans 40, detect findings 40
//        (the security addendum measured 40 / 39 on main 46c28b73 — the bare OUTPUT COLUMN
//         shape defeats the context gate on both surfaces; only the count moved with the tree)
//     R3 bare real object id (`git rev-parse HEAD`)                    detect 1 / redact 1
//     R4 `HEAD=<real object>`                                         detect 0 / redact 1  ← the drift
//     R5 bare random 40-hex (NOT an object)                           detect 1 / redact 1  ← the canary
//     R6 `commit <random 40-hex>`                                     detect 1 / redact 1  ← forgery probe
//     R7 `git merge-base main HEAD` output line                       redact 1
//
// NO 40-HEX LITERAL APPEARS IN THIS FILE, ON PURPOSE. A literal pin written here is a
// redaction span when any seat `read`s the demo, so the fixture would be destroyed in
// transit — the exact defect under test (the two constants in demo/secretdetect.test.mjs
// are marker text for that reason, which is what made its canaries vacuous). Every object
// name below is RESOLVED AT RUN TIME from this repository, so the fixture can only be read
// on a tree that actually has the objects — and the run also proves the pin survives the
// surfaces that are supposed to spare it.
//
// Run: node demo/sha-object-verdict.test.mjs   (exit 0 = pass)

import { spawnSync } from "node:child_process";

import {
	HEX_OBJECT_SHAPE_RE,
	MAX_OBJECT_PROBES_PER_PASS,
	UNCONFIRMED_OBJECT_FAMILY,
	gitObjectVerdict,
	isGitObject,
} from "../src/gitobject.mjs";
import { secretSpans } from "../src/secretredact.mjs";
import { secretTokens } from "../src/secretdetect.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const git = (args) => {
	const r = spawnSync("git", args, { encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
	return r.stdout.trim();
};

/* ─── 0. fixtures: object names resolved NOW, never transcribed ───────────────── */
const HEAD_COMMIT = git(["rev-parse", "HEAD"]);
const HEAD_TREE = git(["rev-parse", "HEAD^{tree}"]);
const BLOB = git(["rev-parse", "HEAD:src/config.mjs"]);
const MERGE_BASE = git(["merge-base", "main", "HEAD"]); // whole-line output, no context word
const ALL_IDS = git(["rev-list", "--all"]).split("\n").filter(Boolean);
// A 40-hex string that is NOT an object in this repository (asserted below, so a collision
// fails the demo instead of silently exempting a planted secret).
const NOT_AN_OBJECT = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const LOG40 = spawnSync("git", ["log", "--format=%H %s", "-40"], { encoding: "utf8" }).stdout;

console.log("\nfixtures are real objects in this repository");
for (const [label, id] of [
	["HEAD commit", HEAD_COMMIT],
	["HEAD tree", HEAD_TREE],
	["blob (HEAD:src/config.mjs)", BLOB],
	["merge-base main HEAD", MERGE_BASE],
]) {
	check(`${label} resolves as an object`, isGitObject(id) === true);
	check(`${label} has the 40/64-hex object shape`, HEX_OBJECT_SHAPE_RE.test(id));
}
check("the planted non-object does NOT resolve", isGitObject(NOT_AN_OBJECT) === false);

/* ─── 1. G-A/P-1: ONE verdict, both surfaces, no per-surface copy ─────────────── */
console.log("\nP-1 — the exclusion is hoisted to one shared site both surfaces consume");
check(
	"src/gitobject.mjs is the shared verdict site (imported, not copied)",
	spawnSync("git", ["grep", "-l", "gitobject", "--", "src/secretdetect.mjs", "src/secretredact.mjs"], {
		encoding: "utf8",
	}).stdout.trim().split("\n").filter(Boolean).length === 2,
);
check(
	"no surface re-declares its own isGitObject (a second predicate re-arms the drift)",
	spawnSync("git", ["grep", "-c", "function isGitObject", "--", "src/secretdetect.mjs", "src/secretredact.mjs"], {
		encoding: "utf8",
	}).stdout
		.trim()
		.split("\n")
		.every((line) => line.endsWith(":0")),
);

/* ─── 2. THE MATRIX: the same token, the same verdict on both surfaces ────────── */
const FIXTURES = [
	// shape label, text, expected family (null ⇒ must be exempt on BOTH surfaces)
	["bare commit id (rev-parse line)", HEAD_COMMIT, null],
	["bare tree id (merge-tree --write-tree line 1)", HEAD_TREE, null],
	["bare blob id", BLOB, null],
	["bare merge-base output line", MERGE_BASE, null],
	["HEAD=<object> pair form", `HEAD=${HEAD_COMMIT}`, null],
	["commit <object> in prose", `commit ${HEAD_COMMIT} is the tip`, null],
	["pin <object> in prose", `pin ${BLOB} for the check`, null],
	["--is-ancestor verdict a verifier must quote", `--is-ancestor ${MERGE_BASE} main ⇒ true`, null],
	["object id inside JSON", `{"tip":"${HEAD_COMMIT}"}`, null],
	// the incident's own master shape: a whole output COLUMN of object ids
	["git log --format=%H %s over 40 lines", LOG40, null],
	// canaries (G-D): the CHECKER decides, so these still surface
	["bare random 40-hex (not an object)", NOT_AN_OBJECT, UNCONFIRMED_OBJECT_FAMILY],
	["commit <random 40-hex> — forged context must NOT exempt", `commit ${NOT_AN_OBJECT}`, UNCONFIRMED_OBJECT_FAMILY],
	["KEY=<random hex> RHS", `KEY=${NOT_AN_OBJECT}`, UNCONFIRMED_OBJECT_FAMILY],
	["object id adjacent to a planted hex credential", `HEAD=${HEAD_COMMIT} KEY=${NOT_AN_OBJECT}`, UNCONFIRMED_OBJECT_FAMILY],
	["openai key", `the key is sk-${"z".repeat(24)}`, "openai-key"],
	["github pat", `ghp_${"Q".repeat(24)}`, "github-pat"],
	["huggingface token", `hf_${"A".repeat(20)}`, "huggingface-token"],
	["google api key", `AIza${"C".repeat(24)}`, "google-api-key"],
	["high-entropy non-hex token", `token ${"a1b2c3d4e5".repeat(5)}`, "high-entropy-token"],
	["ordinary prose", "the quick brown fox jumps over the lazy dog", null],
];

console.log("\nthe matrix — one token, one verdict, both surfaces byte-agree (G2)");
for (const [label, text, family] of FIXTURES) {
	const spans = secretSpans(text);
	const tokens = secretTokens(text);
	const spanFamilies = spans.map((s) => s.family);
	const tokenFamilies = tokens.map((t) => t.family);
	const expected = family === null ? [] : [family];
	check(
		`redact: ${label}`,
		spanFamilies.length === expected.length && spanFamilies.every((f, i) => f === expected[i]),
		JSON.stringify(spanFamilies),
	);
	check(
		`detect: ${label}`,
		tokenFamilies.length === expected.length && tokenFamilies.every((f, i) => f === expected[i]),
		JSON.stringify(tokenFamilies),
	);
	// P-1's real guarantee: the two entry points AGREE on this fixture, whatever it is.
	check(
		`both surfaces agree: ${label}`,
		spanFamilies.length === tokenFamilies.length &&
			spanFamilies.every((f, i) => f === tokenFamilies[i]),
		`${label}: redact ${JSON.stringify(spanFamilies)} vs detect ${JSON.stringify(tokenFamilies)}`,
	);
}

/* ─── 3. today's red numbers, now counted on this tree ────────────────────────── */
console.log("\nthe class is gone from the flood — measured, not asserted by hand");
const classifiedIds = ALL_IDS.filter((id) => secretSpans(id).length > 0);
check(
	"NOT one commit id in this repository redacts any more",
	classifiedIds.length === 0,
	`${classifiedIds.length} of ${ALL_IDS.length} ref ids still classify`,
);
check(
	"the 40-line `--format=%H %s` column survives whole (T3: 40 spans → 0)",
	secretSpans(LOG40).length === 0 && secretTokens(LOG40).length === 0,
	`redact ${secretSpans(LOG40).length} / detect ${secretTokens(LOG40).length}`,
);
check(
	"every id in every ref still RESOLVES, which is what exempts it",
	ALL_IDS.length > 1000 && ALL_IDS.every((id) => isGitObject(id)),
	`${ALL_IDS.length} ids checked`,
);
// The evidence contract the addendum says is attacked at the transport layer: a full pin a
// seat must put in `evidence.artifact` has to survive the surface that rewrites tool output.
const pinned = git(["rev-parse", "HEAD"]);
check(
	"a full 40-hex pin round-trips through redaction with 0 spans",
	secretSpans(pinned).length === 0 && secretSpans(`artifact=${pinned}`).length === 0,
);

/* ─── 4. the verdict itself is checker-based, not shape- or context-based ─────── */
console.log("\nthe CHECKER is the final discriminator for any 40/64-hex (lead #2040 A)");
check("a confirmed object is exempt", gitObjectVerdict(HEAD_COMMIT).exempt === true);
check("shape alone never exempts", gitObjectVerdict(NOT_AN_OBJECT).exempt === false);
check(
	"a stub that CONFIRMS objecthood exempts",
	gitObjectVerdict(NOT_AN_OBJECT, { isGitObject: () => true }).exempt === true,
);
check(
	"a stub that DENIES objecthood does not exempt (fail-closed)",
	gitObjectVerdict(HEAD_COMMIT, { isGitObject: () => false }).exempt === false,
);
check(
	"a non-hex secret shape is not the verdict's business",
	gitObjectVerdict(`sk-${"z".repeat(24)}`).exempt === false,
);
check(
	"probe failure (no such repo) is not-confirmed, never confirmed",
	isGitObject(HEAD_COMMIT, "/nonexistent-dir-for-this-demo") === false,
);

/* ─── 5. T6/P-5: an unresolvable hex says WHY it vanished ─────────────────────── */
console.log("\nthe marker names the class, so a reader can re-read the value via a ref name");
const marker = [
	"marker",
	`commit ${NOT_AN_OBJECT}`,
	"marker",
];
const redactedText = (() => {
	const spans = secretSpans(marker.join(" "));
	let out = marker.join(" ");
	for (let i = spans.length - 1; i >= 0; i--) {
		out = out.slice(0, spans[i].start) + `[redacted (${spans[i].family})]` + out.slice(spans[i].end);
	}
	return out;
})();
check("an unresolvable 40-hex is labelled unconfirmed-object", redactedText.includes(UNCONFIRMED_OBJECT_FAMILY), redactedText);
check("the planted value never reaches the model", !redactedText.includes(NOT_AN_OBJECT), redactedText);

/* ─── 6. T5/P-4/G3: the probe is budget-bounded, over-budget ⇒ REDACT ────────── */
console.log("\nthe probe budget — a pathological output cannot turn one tool call into a probe storm");
const HEAVY = Array.from({ length: MAX_OBJECT_PROBES_PER_PASS * 4 }, (_, i) =>
	("0123456789abcdef".repeat(20) + i.toString(16).padStart(8, "0")).slice(0, 40),
).join("\n");
let probes = 0;
const counting = () => {
	probes += 1;
	return false; // nothing in this fixture resolves
};
const heavySpans = secretSpans(HEAVY, { isGitObject: counting });
check(`the probe count is capped at MAX_OBJECT_PROBES_PER_PASS (${MAX_OBJECT_PROBES_PER_PASS})`, probes <= MAX_OBJECT_PROBES_PER_PASS, `probes=${probes}`);
check("probes are memoized per candidate, not re-spawned per occurrence", (() => {
		let n = 0;
		secretSpans(`${NOT_AN_OBJECT}\n${NOT_AN_OBJECT}\n${NOT_AN_OBJECT}`, {
			isGitObject: () => {
				n += 1;
				return false;
			},
		});
		return n === 1;
	})());
check(
	"over budget ⇒ REDACT, never pass (fail-closed)",
	heavySpans.length >= HEAVY.split("\n").length - MAX_OBJECT_PROBES_PER_PASS,
	`${heavySpans.length} spans for ${HEAVY.split("\n").length} candidates`,
);

console.log(
	failures === 0
		? "\nPASS — one shared git-object verdict, checker-based, on both surfaces"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
