// sync-pi logic tests: argument parsing, drift reporting, pin integrity and
// the npm specifiers used to link the built tree. Network and builds are NOT
// exercised here - those are covered by running `node scripts/sync-pi.mjs`
// itself, which this test must stay cheap enough to run in the normal suite.
// Run: node demo/syncpi.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import {
	decideDrift,
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

console.log("SYNCPI TEST PASS");
