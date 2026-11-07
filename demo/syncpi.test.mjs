// sync-pi logic tests: argument parsing, drift reporting, pin integrity and
// the npm specifiers used to link the built tree. Network and builds are NOT
// exercised here - those are covered by running `node scripts/sync-pi.mjs`
// itself, which this test must stay cheap enough to run in the normal suite.
// Run: node demo/syncpi.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import {
	decideDrift,
	dependencySet,
	inspectBuildTree,
	inspectBuilt,
	inspectLinked,
	linkSpecs,
	parseArgs,
	readPin,
} from "../scripts/sync-pi.mjs";

// --- arguments -------------------------------------------------------------
assert.deepEqual(
	parseArgs([]),
	{ check: true, sync: false, update: false, link: false, unlink: false },
	"no flags means a drift check",
);
assert.equal(parseArgs(["--sync"]).sync, true);
assert.equal(parseArgs(["--update"]).update, true);
assert.equal(parseArgs(["--link"]).link, true);
assert.equal(parseArgs(["--unlink"]).unlink, true);
assert.equal(parseArgs(["--sync", "--link"]).sync, true, "flags combine");
assert.equal(parseArgs(["--sync"]).check, false, "an action flag is not a check");
assert.equal(parseArgs(["--unlink"]).check, false);
console.log("ARGS OK");

// --- drift -----------------------------------------------------------------
assert.equal(decideDrift("aaa", "aaa").drift, false, "same sha is no drift");
assert.equal(decideDrift("aaa", "bbb").drift, true, "different sha is drift");
assert.equal(decideDrift("aaa", "bbb").upstreamSha, "bbb");
const offline = decideDrift("aaa", null);
assert.equal(offline.drift, null, "an unreachable upstream is not 'up to date'");
assert.match(offline.reason, /unavailable/);
console.log("DRIFT OK");

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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "syncpi-pin-"));
try {
	const badPath = join(dir, "pi-main.pin.json");
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
	const shapePath = join(dir, "shape.pin.json");
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
	rmSync(dir, { recursive: true, force: true });
}

// --- the report INSPECTS state (#5282) -------------------------------------
// THE DEFECT this pins: `buildTree`/`built`/`linked` were ACTION OUTPUTS, so the
// no-flag report printed `null`/`[]`/`null` in a fully built AND linked tree and
// `built: []` read as "unbuilt" when it was only "this call did not build".
// Fixtures, not a real build: the three inspection functions take the tree as
// an argument, so the report can be pinned without network or npm.
import { mkdirSync, realpathSync, rmSync as rmFixtures, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

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

console.log("SYNCPI TEST PASS");
