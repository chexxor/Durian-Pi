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
	deepenClone,
	dependencySet,
	describePinRef,
	driftReport,
	inspectBuildTree,
	inspectBuilt,
	inspectLinked,
	isShallowClone,
	linkSpecs,
	namePinRef,
	parseArgs,
	parseLsRemote,
	readPin,
	resolveRef,
	tagsBetween,
} from "../scripts/sync-pi.mjs";

// --- arguments -------------------------------------------------------------
assert.deepEqual(
	parseArgs([]),
	{ check: true, sync: false, update: false, observe: false, link: false, unlink: false, report: false, ref: null },
	"no flags means a drift check",
);
assert.equal(parseArgs(["--report"]).report, true, "--report is a verb of its own: pin vs resolved, read-only");
assert.equal(parseArgs(["--report"]).check, false, "--report is an action, so it is not also a drift check");
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
// A gap the tool could not measure is reported as a NAMED unknown state, never as a bare null the
// reader has to interpret (#6061).
const shallow = driftReport({ pin: floating, upstreamSha: "tip9", behind: null, ahead: null, gap: "unknown", gapReason: "the deepening fetch FAILED: ...", tags: ["v1.4.0"], tagsReason: "the list below is INCOMPLETE, not authoritative", now });
assert.equal(shallow.behind, null, "an unmeasurable count stays null - never a fabricated 0");
assert.equal(shallow.gap, "unknown", "the uncertainty itself is the field a caller can filter on");
assert.match(shallow.gapReason, /fetch FAILED/, "the reason says what was TRIED, not a hypothetical fix");
assert.equal(shallow.countsReason, shallow.gapReason, "countsReason stays readable for an existing reader");
assert.match(shallow.tagsReason, /INCOMPLETE, not authoritative/, "a partial tag list is labelled partial");
const measuredGap = driftReport({ pin: floating, upstreamSha: "tip9", behind: 515, ahead: 0, gap: "measured", gapReason: null, tags: [], tagsReason: null, now });
assert.equal(measuredGap.gap, "measured", "a counted gap says it is counted");
assert.equal(measuredGap.gapReason, null, "and carries no excuse");
// And a tagged pin says so, with no policy gap.
const tagged = driftReport({ pin: { ...floating, ref: "v1.4.0", refType: "tag" }, upstreamSha: "tip9", behind: 3, ahead: 0, countsReason: null, tags: ["v1.5.0"], tagsReason: null, now });
assert.equal(tagged.policyGap, null, "a tag pin has no policy gap");
assert.equal(tagged.ref, "v1.4.0");
console.log("DRIFT OK");

// --- the git FACT layer, against a fixture repo with a gap we control ----------
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
	assert.equal(counts.gap, "measured", "a counted gap is labelled counted");
	assert.equal(counts.gapReason, null, "a measured count carries no excuse");
	assert.equal(counts.countsReason, null, "the old field name still reads");
	assert.equal(counts.deepened, false, "a deep clone needs no deepening");
	assert.deepEqual(
		behindAhead(repo, shaA, shaA),
		{ behind: 0, ahead: 0, gap: "measured", gapReason: null, countsReason: null, deepened: false },
		"pin at tip measures zero, not null",
	);

	const tagFacts = tagsBetween(repo, shaA);
	assert.deepEqual(tagFacts.tags, ["v1.1.0"], "the tag the pin does NOT contain is listed; the one it does is not");
	assert.equal(tagFacts.tagsReason, null);
	assert.deepEqual(tagsBetween(repo, shaC).tags, [], "a pin at tip has nothing in between");

	// A ref the clone cannot see is an UNCERTAINTY with the fix named, never a confident 0/0.
	const absentSha = "f".repeat(40);
	const missing = behindAhead(repo, absentSha, shaC);
	assert.equal(missing.behind, null);
	assert.equal(missing.gap, "unknown", "the state is named, so a caller can filter on it");
	assert.match(missing.gapReason, /is not in this clone/, "the reason names the endpoint git could not resolve");
	// No clone at all is its own named absence.
	const noClone = behindAhead(join(dir, "nope"), shaA, shaC);
	assert.equal(noClone.behind, null);
	assert.match(noClone.countsReason, /no vendored clone/);
	assert.match(tagsBetween(join(dir, "nope"), shaA).tagsReason, /no vendored clone/);

	// #6061: a SHALLOW clone is one fetch away from a number. The report used to print nulls and point
	// at a command the reader had to run by hand; now it runs the fetch itself and counts.
	const shallowDir = join(dir, "shallow");
	sh(dir, ["clone", "--quiet", "--depth", "1", `file://${repo}`, "shallow"]);
	assert.equal(isShallowClone(shallowDir), true, "the fixture clone really is shallow");
	const deepenedFacts = behindAhead(shallowDir, shaA, shaC);
	assert.equal(deepenedFacts.behind, 2, "the shallow clone was deepened and the gap became a NUMBER");
	assert.equal(deepenedFacts.ahead, 0);
	assert.equal(deepenedFacts.gap, "measured");
	assert.equal(deepenedFacts.deepened, true, "the report says it did the fetching itself");
	assert.equal(isShallowClone(shallowDir), false, "the clone is left deep, so the next report needs no fetch");

	// When the deepening fetch FAILS the gap is UNKNOWN with the failure named - not bare nulls, and
	// never a fabricated count.
	const unreachableDir = join(dir, "unreachable");
	sh(dir, ["clone", "--quiet", "--depth", "1", `file://${repo}`, "unreachable"]);
	sh(unreachableDir, ["remote", "set-url", "origin", "file:///nonexistent/nowhere.pi"]);
	assert.equal(isShallowClone(unreachableDir), true);
	const stuck = behindAhead(unreachableDir, shaA, shaC);
	assert.equal(stuck.behind, null, "an unmeasurable gap stays null - never a 0");
	assert.equal(stuck.gap, "unknown", "and the state is a field, not an inference the reader must make");
	assert.match(stuck.gapReason, /deepening fetch FAILED/, "the reason names the fetch that was attempted");
	assert.match(stuck.gapReason, /fetch --unshallow origin -> exit \d+/, "and shows the command run and its exit code");
	const probe = deepenClone(unreachableDir);
	assert.equal(probe.ok, false, "deepening against an unreachable origin fails rather than pretending");
	assert.ok(probe.tried.length >= 3, "the failure lists every command it actually tried");

	// #5093: a pin whose sha IS a published tag gets NAMED - the sha does not move.
	const named = namePinRef(shallowDir, { sha: shaA, branch: "main" });
	assert.equal(named.named, true, "v1.0.0 points exactly at the pinned commit, so the checkpoint can be named");
	assert.equal(named.ref, "v1.0.0");
	assert.equal(named.refType, "tag");
	assert.equal(named.reason, null);
	const untagged = namePinRef(shallowDir, { sha: shaC, branch: "main" });
	assert.equal(untagged.named, false, "a pin on an untagged commit is not given a name it does not have");
	assert.match(untagged.reason, /none points exactly at/, "the reason says why, with the tags it did find");
	assert.match(untagged.reason, /--update <tag>/, "and names the verb that would fix it");
	const already = namePinRef(shallowDir, { sha: shaA, ref: "v1.0.0", refType: "tag", branch: "main" });
	assert.equal(already.named, false, "an already-named pin is left alone: the write is idempotent");
	assert.equal(already.alreadyNamed, true);
	assert.match(namePinRef(join(dir, "nope"), { sha: shaA, branch: "main" }).reason, /no vendored clone/);

	// THE REPORT ITSELF, end to end: a fixture rig whose pin names no ref and whose vendored clone is
	// shallow. Before #6061 this printed `behind: null, ahead: null, pinRef: null`.
	const rigDir = join(dir, "rig");
	mkdirSync(join(rigDir, "scripts"), { recursive: true });
	mkdirSync(join(rigDir, "vendor"), { recursive: true });
	const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
	writeFileSync(join(rigDir, "scripts", "sync-pi.mjs"), readFileSync(join(ROOT, "scripts", "sync-pi.mjs"), "utf8"));
	// #6196: sync-pi now imports src/provenance.mjs for the dependency report, so the fixture rig needs it
	// too - a copied tool must carry what it imports, or the fixture fails for a reason unrelated to the
	// behaviour under test.
	mkdirSync(join(rigDir, "src"), { recursive: true });
	writeFileSync(join(rigDir, "src", "provenance.mjs"), readFileSync(join(ROOT, "src", "provenance.mjs"), "utf8"));
	writeFileSync(
		join(rigDir, "pi-main.pin.json"),
		JSON.stringify({ repo: `file://${repo}`, branch: "main", sha: shaA, pinnedAt: "2026-11-01T00:00:00.000Z", packages: [] }, null, 2) + "\n",
	);
	sh(join(rigDir, "vendor"), ["clone", "--quiet", "--depth", "1", `file://${repo}`, "pi-main"]);
	const ran = spawnSync("node", [join(rigDir, "scripts", "sync-pi.mjs")], { encoding: "utf8" });
	assert.equal(ran.status, 0, `the report must still exit 0: ${ran.stderr}`);
	const report = JSON.parse(ran.stdout);
	assert.equal(report.drift.gap, "measured", "the report answers the gap instead of printing nulls");
	assert.equal(report.drift.behind, 2, "how far behind is the only question that matters - it is answered");
	assert.equal(report.drift.ahead, 0);
	assert.equal(report.pinRef, "v1.0.0", "the validated checkpoint is NAMED in the report");
	assert.equal(report.pinRefType, "tag");
	assert.equal(report.pinRefNamed, true);
	assert.equal(report.pinnedSha, shaA, "naming the ref did NOT move the sha (#6061: do not move the pin)");
	const writtenPin = JSON.parse(readFileSync(join(rigDir, "pi-main.pin.json"), "utf8"));
	assert.equal(writtenPin.ref, "v1.0.0", "the name is written into the pin file");
	assert.equal(writtenPin.sha, shaA, "and the pin file's sha is untouched");
	const second = JSON.parse(spawnSync("node", [join(rigDir, "scripts", "sync-pi.mjs")], { encoding: "utf8" }).stdout);
	assert.equal(second.pinRefNamed, false, "the second run writes nothing: naming is idempotent");
	assert.equal(second.drift.policyGap, null, "the #5093 policy gap disappears once the pin is named");
	assert.equal(second.drift.gap, "measured", "the clone is deep now, so the count needs no fetch");
	assert.equal(second.drift.deepened, false, "and the second report does not fetch again");
	console.log("GIT FACTS OK (shallow clone deepened and counted; a failed fetch reported as a named unknown; a tag name written in place without moving the sha; the report answers the gap end to end)");

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

// --- the report INSPECTS state (#5282) -------------------------------------
// THE DEFECT this pins: `buildTree`/`built`/`linked` were ACTION OUTPUTS, so the
// no-flag report printed `null`/`[]`/`null` in a fully built AND linked tree and
// `built: []` read as "unbuilt" when it was only "this call did not build".
// Fixtures, not a real build: the three inspection functions take the tree as
// an argument, so the report can be pinned without network or npm.
// spawnSync, mkdtempSync, tmpdir and join are already imported above (#5094's fixture layer);
// only the four names below are new to this file, so the merge does not re-import them.
import { mkdirSync, realpathSync, rmSync as rmFixtures, symlinkSync } from "node:fs";

const fxRoot = mkdtempSync(join(tmpdir(), "syncpi-inspect-"));
const fakePin = {
	sha: "a".repeat(40),
	packages: [
		{ name: "@earendil-works/alpha", dir: "packages/alpha" },
		{ name: "@earendil-works/beta", dir: "packages/beta" },
		{ name: "@earendil-works/gamma", dir: "packages/gamma" },
	],
};
try {
	const buildDir = join(fxRoot, "vendor", "pi-main");
	// alpha and beta have a built entry; gamma is checked out but unbuilt.
	for (const p of ["alpha", "beta"]) {
		mkdirSync(join(buildDir, "packages", p, "dist"), { recursive: true });
		writeFileSync(join(buildDir, "packages", p, "dist", "index.js"), "export {};\n");
	}
	mkdirSync(join(buildDir, "packages", "gamma"), { recursive: true });

	assert.deepEqual(
		inspectBuilt(fakePin, buildDir),
		["@earendil-works/alpha", "@earendil-works/beta"],
		"built lists the packages that HAVE a dist entry, in pin order",
	);
	assert.deepEqual(
		inspectBuilt(fakePin, join(fxRoot, "no-such-build-dir")),
		[],
		"an absent build tree reports built:[] - and now that IS evidence, because the report measures disk",
	);

	// node_modules: alpha is a LINK into the built tree, beta is a REAL directory
	// (the released package from the lockfile - NOT a link), gamma is absent.
	const nm = join(fxRoot, "node_modules", "@earendil-works");
	mkdirSync(join(nm, "beta"), { recursive: true });
	let linkMade = true;
	try {
		symlinkSync(join(buildDir, "packages", "alpha"), join(nm, "alpha"), "junction");
	} catch {
		linkMade = false; // unprivileged Windows: the link assertions are skipped, the rest still run
	}
	if (linkMade) {
		const linked = inspectLinked(fakePin, fxRoot, buildDir);
		assert.deepEqual(
			linked.map((l) => l.name),
			["@earendil-works/alpha"],
			"only an entry that RESOLVES into the built tree counts as linked; a real directory does not",
		);
		assert.equal(
			linked[0].target,
			realpathSync(join(buildDir, "packages", "alpha")).replace(/\\/g, "/"),
			"the report names the directory the link actually resolves to",
		);
		assert.equal(
			linked[0].spec,
			`@earendil-works/alpha@file:${join(buildDir, "packages", "alpha").replace(/\\/g, "/")}`,
			"the --link spec string is still there, so the old prose reading still works",
		);
		assert.equal(dependencySet(fakePin, fxRoot, buildDir), "mixed", "1 of 3 linked is not 'built-pin'");
		// All three linked is 'built-pin' - the dependency set a suite green is
		// comparable in, and the one the harness provisions worktree to.
		for (const p of ["beta", "gamma"]) {
			rmSync(join(nm, p), { recursive: true, force: true });
			symlinkSync(join(buildDir, "packages", p), join(nm, p), "junction");
		}
		assert.equal(inspectLinked(fakePin, fxRoot, buildDir).length, 3, "all three now resolve into the built tree");
		assert.equal(dependencySet(fakePin, fxRoot, buildDir), "built-pin");
		// --unlink shape: npm restores REAL directories, so the links vanish.
		for (const p of ["alpha", "beta", "gamma"]) {
			rmSync(join(nm, p), { recursive: true, force: true });
			mkdirSync(join(nm, p), { recursive: true });
		}
	}
	// Installed from the lockfile (real directories, no links) is a DIFFERENT
	// dependency set from the built pin, and the report must say which.
	assert.equal(inspectLinked(fakePin, fxRoot, buildDir).length, 0, "real directories are not links");
	assert.equal(dependencySet(fakePin, fxRoot, buildDir), "lockfile-released", "installed but not linked");
	assert.equal(dependencySet(fakePin, join(fxRoot, "nowhere"), buildDir), "not-installed");

	// build tree: present means a .git and a HEAD sha, and atPin is its own field.
	assert.deepEqual(
		inspectBuildTree(fakePin, buildDir),
		{ present: false, head: null, atPin: false },
		"a vendor/pi-main with no .git is no build tree",
	);
	const treeDir = join(fxRoot, "vendor", "pi-tree");
	mkdirSync(treeDir, { recursive: true });
	// A REAL repo, so this exercises the exact code path the report uses on disk
	// (`git rev-parse HEAD`), not a hand-made .git that git itself refuses.
	const gitFx = (args) => spawnSync("git", args, { cwd: treeDir, encoding: "utf8" });
	gitFx(["init", "--quiet"]);
	gitFx(["-c", "user.name=fixture", "-c", "user.email=fixture@example", "commit", "--allow-empty", "-qm", "fixture"]);
	const treeHead = (gitFx(["rev-parse", "HEAD"]).stdout || "").trim();
	assert.match(treeHead, /^[0-9a-f]{40}$/, "the fixture repo has a HEAD");
	assert.deepEqual(
		inspectBuildTree({ ...fakePin, sha: treeHead }, treeDir),
		{ present: true, head: treeHead, atPin: true },
		"a tree at the pin reads as atPin",
	);
	const stale = inspectBuildTree(fakePin, treeDir);
	assert.equal(stale.head, treeHead, "a tree at another sha reports the sha it is at");
	assert.equal(stale.atPin, false, "and says plainly that it is NOT the pin");
	console.log("INSPECT OK");
} finally {
	rmFixtures(fxRoot, { recursive: true, force: true });
}

console.log("SYNCPI TEST PASS — args refuse unknown flags and misplaced refs; a ref resolves against upstream's real refs and an unknown one names the known tags instead of falling back to a branch tip; drift reports behind/ahead COUNTS, pin age and the tags in between, and calls out a pin that names no ref; the git facts (counts, tags-between, shallow-clone uncertainty) are pinned against a fixture repo with a gap we control; and a tag pin round-trips through readPin with its move history capped at 10 (#5094).");
