// sync-pi logic tests: argument parsing, ref resolution, drift reporting, pin integrity and
// the npm specifiers used to link the built tree. Network and builds are NOT
// exercised here - those are covered by running `node scripts/sync-pi.mjs`
// itself, which this test must stay cheap enough to run in the normal suite.
// The git-FACT layer (#5094) is exercised against a throwaway fixture repo in tmp, so the
// behind/ahead counts and the tags-in-between list are pinned across a gap we KNOW, rather than
// against upstream's tip, which moves and would make the suite flaky-by-construction.
// Run: node demo/syncpi.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import {
	applyPinUpdate,
	behindAhead,
	decideDrift,
	describePinRef,
	driftReport,
	linkSpecs,
	parseArgs,
	parseLsRemote,
	readPin,
	resolveRef,
	tagsBetween,
} from "../scripts/sync-pi.mjs";

// --- arguments -------------------------------------------------------------
assert.deepEqual(
	parseArgs([]),
	{ check: true, sync: false, update: false, observe: false, link: false, unlink: false, ref: null },
	"no flags means a drift check",
);
assert.equal(parseArgs(["--sync"]).sync, true);
assert.equal(parseArgs(["--update"]).update, true);
assert.equal(parseArgs(["--link"]).link, true);
assert.equal(parseArgs(["--unlink"]).unlink, true);
assert.equal(parseArgs(["--sync", "--link"]).sync, true, "flags combine");
assert.equal(parseArgs(["--sync"]).check, false, "an action flag is not a check");
assert.equal(parseArgs(["--unlink"]).check, false);
// #5094: --update takes a REF, in both spellings, and --observe takes one without moving the pin.
assert.equal(parseArgs(["--update", "v1.4.0"]).ref, "v1.4.0", "--update <tag> pins the tag");
assert.equal(parseArgs(["--update=v1.4.0"]).ref, "v1.4.0", "--update=<tag> is the same request");
assert.equal(parseArgs(["--update=v1.4.0"]).update, true, "the = form still selects the verb");
assert.equal(parseArgs(["--observe", "v1.5.0"]).observe, true, "--observe is its own verb");
assert.equal(parseArgs(["--observe", "v1.5.0"]).ref, "v1.5.0");
assert.equal(parseArgs(["--update"]).ref, null, "no ref is still legal (branch-tip move, loudly flagged)");
// An unknown flag is REFUSED, never ignored: an ignored flag used to read as a successful pin move.
assert.throws(
	() => parseArgs(["--updateg", "v1.4.0"]),
	/unknown flag "--updateg"[\s\S]*Known flags/,
	"a misspelled flag must name the flags that exist",
);
assert.throws(
	() => parseArgs(["--sync", "v1.4.0"]),
	/a ref belongs to --update or --observe/,
	"a ref on a verb that cannot move the pin is a mistake, not a no-op",
);
assert.throws(() => parseArgs(["--update", "v1.4.0", "v1.5.0"]), /more than one ref given/);
assert.throws(() => parseArgs(["--update=v1.4.0", "v1.5.0"]), /more than one ref given/);
console.log("ARGS OK");

// --- ref resolution: never a fallback, and it names what upstream actually has -----
const REMOTE = [
	"aaa111 refs/heads/main",
	"bbb222 refs/tags/v1.3.0",
	"ccc333 refs/tags/v1.4.0",
	"ddd444 refs/tags/v1.4.0^{}",
	"eee555 refs/tags/v1.5.0^{}",
	"eee555 refs/tags/v1.5.0",
].join("\n");
const entries = parseLsRemote(REMOTE);
assert.equal(entries.length, 6, "ls-remote lines parse to {sha, ref}");
assert.deepEqual(resolveRef(entries, "v1.4.0", "repo"), { sha: "ddd444", refType: "tag", ref: "v1.4.0" }, "an ANNOTATED tag resolves to the PEELED commit, not the tag object");
assert.deepEqual(resolveRef(entries, "v1.3.0", "repo"), { sha: "bbb222", refType: "tag", ref: "v1.3.0" }, "a lightweight tag resolves to its own entry");
assert.deepEqual(resolveRef(entries, "main", "repo"), { sha: "aaa111", refType: "branch", ref: "main" }, "a branch is still resolvable (it is not the policy-preferred form)");
assert.equal(resolveRef(entries, "aaa111bbb222ccc333", "repo").refType, "sha", "a sha ref is what the pin already stored");
// THE fail-open this exists to prevent: a misspelled tag quietly pinning a branch tip.
assert.throws(
	() => resolveRef(entries, "v1.4.99", "https://example/pi.git"),
	/unknown ref "v1\.4\.99" for https:\/\/example\/pi\.git\. Known tags: v1\.3\.0, v1\.4\.0, v1\.5\.0[\s\S]*does NOT fall back to a branch tip/,
	"an unknown ref names the known tags AND the no-fallback rule",
);
assert.throws(() => resolveRef(entries, "", "repo"), /refusing to resolve an empty ref/, "an empty ref is not 'use the default'");
assert.throws(() => resolveRef(entries, null, "repo"), /refusing to resolve an empty ref/);
console.log("REF RESOLUTION OK");

// --- drift -----------------------------------------------------------------
assert.equal(decideDrift("aaa", "aaa").drift, false, "same sha is no drift");
assert.equal(decideDrift("aaa", "bbb").drift, true, "different sha is drift");
assert.equal(decideDrift("aaa", "bbb").upstreamSha, "bbb");
const offline = decideDrift("aaa", null);
assert.equal(offline.drift, null, "an unreachable upstream is not 'up to date'");
assert.match(offline.reason, /unavailable/);

// The drift FINDING, across a known gap: 515 commits behind over a 16-day-old pin, two releases in
// between. This is the #5094 shape, stated as data so a regression in the surface is a red test and
// not a re-derivation.
const now = Date.parse("2026-11-04T00:00:00.000Z");
const floating = {
	repo: "https://example/pi.git",
	branch: "main",
	sha: "pin0",
	pinnedAt: new Date(now - 16 * 86400000).toISOString(),
	packages: [],
};
const gap = driftReport({
	pin: floating,
	upstreamSha: "tip9",
	behind: 515,
	ahead: 0,
	countsReason: null,
	tags: ["v1.4.0", "v1.5.0"],
	tagsReason: null,
	now,
});
assert.equal(gap.drift, true, "a moved upstream is drift");
assert.equal(gap.behind, 515, "the gap is a COUNT, not a boolean - a boolean hid 515 commits for 16 days");
assert.equal(gap.ahead, 0);
assert.equal(gap.pinAgeDays, 16, "the pin's age is reported: an unaged pin is how 'unnoticed' happens");
assert.deepEqual(gap.tagsBetween, ["v1.4.0", "v1.5.0"], "the releases sitting between us and tip are named");
assert.match(gap.policyGap, /POLICY GAP \(#5093\)[\s\S]*floats on branch "main"/, "a pin that names no ref is called out on every run");
assert.equal(gap.refType, "branch", "a legacy pin resolves its identity through branch");
// A counted gap the tool cannot measure is reported as UNCERTAIN, naming the fix command.
const shallow = driftReport({ pin: floating, upstreamSha: "tip9", behind: null, ahead: null, countsReason: "the vendored clone is shallow; run: git -C vendor/pi-main fetch --unshallow origin", tags: ["v1.4.0"], tagsReason: "the list below is INCOMPLETE, not authoritative", now });
assert.equal(shallow.behind, null, "an unmeasurable count stays null - never a fabricated 0");
assert.match(shallow.countsReason, /fetch --unshallow/, "the null names the command that clears it");
assert.match(shallow.tagsReason, /INCOMPLETE, not authoritative/, "a partial tag list is labelled partial");
// And a tagged pin says so, with no policy gap.
const tagged = driftReport({ pin: { ...floating, ref: "v1.4.0", refType: "tag" }, upstreamSha: "tip9", behind: 3, ahead: 0, countsReason: null, tags: ["v1.5.0"], tagsReason: null, now });
assert.equal(tagged.policyGap, null, "a tag pin has no policy gap");
assert.equal(tagged.ref, "v1.4.0");
console.log("DRIFT OK");

// --- the git FACT layer, against a fixture repo with a gap we control ----------
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sh(at, args) {
	const r = spawnSync("git", args, { cwd: at, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} in ${at} (exit ${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
	return (r.stdout || "").trim();
}

const dir = mkdtempSync(join(tmpdir(), "syncpi-"));
try {
	const repo = join(dir, "upstream");
	existsSync(repo) || sh(dir, ["init", "--quiet", "upstream"]);
	sh(repo, ["config", "user.email", "fixture@example.invalid"]);
	sh(repo, ["config", "user.name", "fixture"]);
	sh(repo, ["config", "commit.gpgsign", "false"]);
	writeFileSync(join(repo, "a.txt"), "a\n");
	sh(repo, ["add", "a.txt"]);
	sh(repo, ["commit", "-q", "-m", "a"]);
	const shaA = sh(repo, ["rev-parse", "HEAD"]);
	sh(repo, ["tag", "v1.0.0"]);
	writeFileSync(join(repo, "b.txt"), "b\n");
	sh(repo, ["add", "b.txt"]);
	sh(repo, ["commit", "-q", "-m", "b"]);
	sh(repo, ["tag", "v1.1.0"]);
	writeFileSync(join(repo, "c.txt"), "c\n");
	sh(repo, ["add", "c.txt"]);
	sh(repo, ["commit", "-q", "-m", "c"]);
	const shaC = sh(repo, ["rev-parse", "HEAD"]);

	const counts = behindAhead(repo, shaA, shaC);
	assert.equal(counts.behind, 2, "two commits between the pinned commit and tip, counted from real history");
	assert.equal(counts.ahead, 0, "we are not ahead of upstream");
	assert.equal(counts.countsReason, null, "a measured count carries no excuse");
	assert.deepEqual(behindAhead(repo, shaA, shaA), { behind: 0, ahead: 0, countsReason: null }, "pin at tip measures zero, not null");

	const tagFacts = tagsBetween(repo, shaA);
	assert.deepEqual(tagFacts.tags, ["v1.1.0"], "the tag the pin does NOT contain is listed; the one it does is not");
	assert.equal(tagFacts.tagsReason, null);
	assert.deepEqual(tagsBetween(repo, shaC).tags, [], "a pin at tip has nothing in between");

	// A ref the clone cannot see is an UNCERTAINTY with the fix named, never a confident 0/0.
	const missing = behindAhead(repo, "0000000000000000000000000000000000000000", shaC);
	assert.equal(missing.behind, null);
	assert.match(missing.countsReason, /fetch --unshallow|Invalid symmetric difference/);
	// No clone at all is its own named absence.
	const noClone = behindAhead(join(dir, "nope"), shaA, shaC);
	assert.equal(noClone.behind, null);
	assert.match(noClone.countsReason, /no vendored clone/);
	assert.match(tagsBetween(join(dir, "nope"), shaA).tagsReason, /no vendored clone/);

	// A SHALLOW clone (what --sync creates with fetch --depth 1) must say so instead of reporting 0.
	const shallowDir = join(dir, "shallow");
	sh(dir, ["clone", "--quiet", "--depth", "1", `file://${repo}`, "shallow"]);
	const shallowFacts = behindAhead(shallowDir, shaA, shaC);
	assert.equal(shallowFacts.behind, null, "a shallow clone cannot prove the gap; it must not answer 0");
	assert.match(shallowFacts.countsReason, /shallow|Invalid symmetric difference/);
	console.log("GIT FACTS OK");

	// --- tag round-trip: move the pin in a COPY, read it back, prove the provenance ----
	const legacy = { ...floating };
	const moved = applyPinUpdate(legacy, resolveRef(entries, "v1.4.0", "repo"), "2026-11-04T12:00:00.000Z");
	assert.equal(moved.ref, "v1.4.0", "the pin NAMES the tag it validates against");
	assert.equal(moved.refType, "tag");
	assert.equal(moved.sha, "ddd444", "the sha still travels with the ref - the ref is not a substitute");
	assert.equal(moved.pinnedAt, "2026-11-04T12:00:00.000Z");
	assert.equal(moved.previous[0].sha, "pin0", "the move records what it replaced");
	assert.equal(moved.previous[0].refType, null, "and the previous pin's (absent) ref type");
	const movedPath = join(dir, "moved.pin.json");
	writeFileSync(movedPath, `${JSON.stringify(moved, null, 2)}\n`);
	const reread = readPin(movedPath);
	assert.equal(reread.ref, "v1.4.0", "a tag pin round-trips through readPin");
	assert.equal(describePinRef(reread).policyGap, null, "and stops raising the policy gap");
	// A ten-move history stays bounded: provenance without an unbounded file.
	let chain = { ...reread };
	for (let i = 0; i < 14; i++) chain = applyPinUpdate(chain, { ref: `v2.${i}.0`, refType: "tag", sha: `sha${i}` }, `2026-11-0${1 + (i % 9)}T00:00:00.000Z`);
	assert.equal(chain.previous.length, 10, "the move history is capped at 10");
	// ref fields that lie are refused at read time: a claimed type with no ref is provenance rot.
	const liePath = join(dir, "lie.pin.json");
	writeFileSync(liePath, `{ "sha": "abc0", "packages": [], "refType": "tag" }`);
	assert.throws(() => readPin(liePath), /declares refType "tag" but names no "ref"/);
	const dialectPath = join(dir, "dialect.pin.json");
	writeFileSync(dialectPath, `{ "sha": "abc0", "packages": [], "ref": "1.4.0", "refType": "release" }`);
	assert.throws(() => readPin(dialectPath), /expected "tag", "branch" or "sha"/);
	// The shipped pin may still omit ref fields (this row must not invalidate the pin it moves).
	const legacyPath = join(dir, "legacy.pin.json");
	writeFileSync(legacyPath, JSON.stringify(legacy));
	assert.equal(readPin(legacyPath).ref, undefined, "a pin with no ref is legal but flagged");
	assert.match(describePinRef(readPin(legacyPath)).policyGap, /#5093/);
	console.log("PIN ROUND-TRIP OK");
} finally {
	rmSync(dir, { recursive: true, force: true });
}

// --- the pin this repo actually ships with ---------------------------------
const pin = readPin();
assert.match(pin.repo, /github\.com\/earendil-works\/pi/, "pins the pi monorepo");
assert.equal(pin.branch, "main", "tracks main, not a release tag");
assert.match(pin.sha, /^[0-9a-f]{40}$/, "pin is a full commit sha");
assert.ok(pin.packages.length >= 4, "all four packages durig needs are pinned");
for (const pkg of pin.packages) {
	assert.ok(pkg.name.startsWith("@earendil-works/"), `${pkg.name} is a workspace package`);
	assert.ok(pkg.dir.startsWith("packages/"), `${pkg.name} has a repo directory`);
}
// pi-ai depends on pi-telemetry on main; dropping it breaks the build.
assert.ok(
	pin.packages.some((p) => p.name === "@earendil-works/pi-telemetry"),
	"pi-telemetry is pinned because pi-ai requires it",
);
// Build order matters: durable typechecks against ai's dist.
const order = pin.packages.map((p) => p.name);
assert.ok(
	order.indexOf("@earendil-works/pi-telemetry") < order.indexOf("@earendil-works/pi-ai"),
	"pi-telemetry is built before pi-ai",
);
assert.ok(
	order.indexOf("@earendil-works/pi-ai") < order.indexOf("@earendil-works/pi-durable"),
	"pi-ai is built before pi-durable",
);
console.log("PIN OK");

// --- link specifiers -------------------------------------------------------
const specs = linkSpecs(pin, "C:/build");
assert.equal(specs.length, pin.packages.length);
assert.ok(
	specs.every((s) => s.includes("@file:C:/build/packages/")),
	"specs are forward-slashed file: urls (npm on Windows rejects backslashes)",
);
assert.ok(
	specs.some((s) => s === "@earendil-works/pi-durable@file:C:/build/packages/durable"),
	"durable spec points at its built directory",
);
console.log("LINK SPECS OK");

// --- malformed pin fails LOUDLY, naming the file ----------------------------
// A hand-edited pin (missing comma before "packages") used to surface as a
// bare SyntaxError with no file context — read downstream as a mystery suite
// count. readPin must name the pin and the parse error. We write fixtures to a
// temp dir so the shipped pin is never touched.
// (mkdtempSync/writeFileSync/rmSync/tmpdir/join are imported once, in the fixture section above;
// ES module imports are hoisted, so this block uses the same bindings rather than redeclaring them.)
const dir2 = mkdtempSync(join(tmpdir(), "syncpi-pin-"));
try {
	const badPath = join(dir2, "pi-main.pin.json");
	writeFileSync(badPath, `{ "sha": "abc" "packages": [] }`);
	let threw = null;
	try {
		readPin(badPath);
	} catch (err) {
		threw = err;
	}
	assert.ok(threw, "a malformed pin must throw, not return nonsense");
	assert.match(threw.message, /pi-main\.pin\.json is malformed/, "the error names the pin file");
	assert.match(threw.message, /failed to parse as JSON/, "the error names the parse failure");
	assert.match(threw.message, /position \d+/, "the underlying JSON position is carried through");
	console.log("MALFORMED PIN OK");

	// A structurally valid JSON object that is missing "sha"/"packages" is also
	// a broken pin and must fail loudly.
	const shapePath = join(dir2, "shape.pin.json");
	writeFileSync(shapePath, `{ "repo": "x" }`);
	let threwShape = null;
	try {
		readPin(shapePath);
	} catch (err) {
		threwShape = err;
	}
	assert.ok(threwShape, "a pin missing sha/packages must throw");
	assert.match(threwShape.message, /is malformed/, "the shape error is also named");
} finally {
	rmSync(dir2, { recursive: true, force: true });
}

console.log("SYNCPI TEST PASS — args refuse unknown flags and misplaced refs; a ref resolves against upstream's real refs and an unknown one names the known tags instead of falling back to a branch tip; drift reports behind/ahead COUNTS, pin age and the tags in between, and calls out a pin that names no ref; the git facts (counts, tags-between, shallow-clone uncertainty) are pinned against a fixture repo with a gap we control; and a tag pin round-trips through readPin with its move history capped at 10 (#5094).");
