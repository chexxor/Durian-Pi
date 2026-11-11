// demo/suite-provenance.test.mjs — #6196/#6202: every suite verdict names the tree AND the dependency set it ran in.
//
// WHY THIS EXISTS. The rig has two pi graphs: the pinned vendored build (dependencySet built-pin) and the
// lockfile release the package-lock installs when nothing is linked. Lead's ruling (#6201):
// the gate is the PIN; a worktree that resolves anything else is a CONDITIONAL observation - admissible as landing
// evidence only if it names the set it ran against." Measured by #6243/#6300: the same tree forked from
// main, unlinked (1.3.0) ran 262/283 exit 1; linked to the pin (1.5.1) it ran 282/282 exit 0. Twenty-one
// reds appeared and vanished with no change to the code, and neither header said which graph it was.
//
// WHAT THIS ASSERTS, in the order the failure modes actually happened:
//   1. the emitter exists and is the ONE format (no second emitter inventing its own vocabulary);
//   2. a tree whose link FAILED but whose resolved version EQUALS the declared one is the FALLBACK, not drift;
//   3. a tree whose resolved version differs from the declared one is DRIFT, naming package + both versions;
//   4. a genuinely linked tree reads built-pin and says no fallback;
//   5. the suite runner itself prints the header, so a number cannot travel without its tree.
//
// Run: node demo/suite-provenance.test.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { dependencyProvenance, formatDependencyProvenance } from "../src/provenance.mjs";

const PIN = {
	repo: "https://github.com/earendil-works/pi.git",
	branch: "main",
	sha: "0000000000000000000000000000000000000000",
	packages: [
		{ name: "@earendil-works/pi-durable", dir: "packages/pi-durable" },
		{ name: "@earendil-works/pi-ai", dir: "packages/pi-ai" },
	],
};

/** Build a disposable tree: pin file, lockfile, node_modules, and optionally the vendored build it links to. */
function fixture(name, { declared, resolved, linkToBuild = false }) {
	const root = join(realpathSync(process.cwd()), ".spike", `prov-${name}`);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "pi-main.pin.json"), JSON.stringify(PIN, null, 2) + "\n");
	writeFileSync(
		join(root, "package-lock.json"),
		JSON.stringify({
			name: "fixture",
			packages: Object.fromEntries(
			 Object.entries(declared).map(([n, v]) => [`node_modules/${n}`, { version: v }]),
			),
		}, null, 2) + "\n",
	);
	const buildDir = join(root, "vendor", "pi-main");
	for (const [pkgName, version] of Object.entries(resolved)) {
		const dir = join(root, "node_modules", ...pkgName.split("/"));
		if (linkToBuild) {
			// npm's --link makes node_modules/<pkg> resolve to the PACKAGE directory of the build tree,
			// not to its dist/ - inspectLinked() decides on that realpath, so the fixture mirrors it.
			const pkgDir = join(buildDir, PIN.packages.find((p) => p.name === pkgName).dir);
			const dist = join(pkgDir, "dist");
			mkdirSync(dist, { recursive: true });
			writeFileSync(join(dist, "index.js"), "// built from the pinned commit\n");
			writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkgName, version }) + "\n");
			mkdirSync(join(root, "node_modules", ...pkgName.split("/").slice(0, -1)), { recursive: true });
			symlinkSync(pkgDir, dir, "dir");
		} else {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkgName, version }) + "\n");
		}
	}
	return root;
}

try {
	// 1. the shape of the line, asserted on the real tree so the vocabulary is never a hypothesis.
	const real = dependencyProvenance(realpathSync(process.cwd()));
	const line = formatDependencyProvenance(real);
	const headerLine = line.split("\n")[0];
	assert.match(headerLine, /^PROVENANCE tree=\S+ branch=\S+ node=v[\d.]+ host=.+ pi-durable=\S+ dependencySet=\S+ pin=\S+$/, "the header must name the tree, the resolved version and the set, in that order; got: " + headerLine);
	for (const key of ["tree", "dependencySet", "pinRef"]) assert.ok(key in real, `dependencyProvenance() must return ${key}`);
	// Compact by design: a header that prints one line per package is noise, and noise gets ignored.
	assert.ok(line.split("\n").length <= 3, `the header is PROVENANCE plus at most one FALLBACK and one DRIFT line; got ${line.split("\n").length} lines: ${line}`);

	// 2. LINK FAILED, RESOLVED == DECLARED: that is the fallback, and it must be LOUD, and it is not drift.
	const unlinked = fixture("unlinked", { declared: { "@earendil-works/pi-durable": "1.3.0", "@earendil-works/pi-ai": "1.3.0" }, resolved: { "@earendil-works/pi-durable": "1.3.0", "@earendil-works/pi-ai": "1.3.0" } });
	const p1 = dependencyProvenance(unlinked, PIN);
	assert.equal(p1.dependencySet, "lockfile-released", "no link, lockfile present -> the fallback set");
	assert.equal(p1.fallback, true, "the fallback must be flagged, not silently taken");
	assert.deepEqual(p1.drift, [], "resolved == declared is NOT drift");
	assert.match(formatDependencyProvenance(p1), /FALLBACK/, "the fallback is printed, not merely a field");

	// 3. RESOLVED != DECLARED: drift, naming the package and BOTH versions.
	const drifted = fixture("drift", { declared: { "@earendil-works/pi-durable": "1.3.0", "@earendil-works/pi-ai": "1.3.0" }, resolved: { "@earendil-works/pi-durable": "1.5.1", "@earendil-works/pi-ai": "1.3.0" } });
	const p2 = dependencyProvenance(drifted, PIN);
	assert.equal(p2.drift.length, 1, "exactly the one package that differs is drift");
	const d = p2.drift[0];
	assert.equal(d.name, "@earendil-works/pi-durable", "drift names the package");
	assert.equal(d.declared, "1.3.0", "drift states what the lockfile declared");
	assert.equal(d.resolved, "1.5.1", "drift states what is actually resolved");
	assert.match(
		formatDependencyProvenance(p2),
		/DRIFT: 1 of 2 pin packages resolve differently from package-lock\.json: @earendil-works\/pi-durable \(1\.3\.0 -> 1\.5\.1\)/,
		"the DRIFT line names the package and both versions: " + formatDependencyProvenance(p2),
	);

	// 4. a linked tree reads built-pin: no fallback, and the drift is still visible against the lockfile.
	const linked = fixture("linked", { declared: { "@earendil-works/pi-durable": "1.3.0", "@earendil-works/pi-ai": "1.3.0" }, resolved: { "@earendil-works/pi-durable": "1.5.1", "@earendil-works/pi-ai": "1.5.1" }, linkToBuild: true });
	const p3 = dependencyProvenance(linked, PIN);
	assert.equal(p3.dependencySet, "built-pin", "every pin package pointing at vendor/pi-main is the built pin");
	assert.equal(p3.fallback, false, "a linked tree is not running on the fallback");
	assert.equal(p3.resolved.every((r) => r.via === "built-pin"), true, "the emitter names HOW each package was resolved, not just what version");

	// 5. THE RUNNER PRINTS IT. A suite number without its tree is not a measurement, so the runner's own
	//    header is part of the contract. readapi is the cheapest real selection (~3s), and the exit code is
	//    irrelevant here: the header must be printed even when the suite itself is red (which, in an
	//    unlinked tree, it is - see the FALLBACK line).
	const run = spawnSync("node", ["scripts/test.mjs", "--area", "readapi", "--jobs", "7"], { encoding: "utf8", cwd: realpathSync(process.cwd()) });
	const out = String(run.stdout ?? "");
	const header = out.split("\n")[0];
	assert.match(header, /^PROVENANCE tree=\S+ .*dependencySet=\S+/, `the suite runner must open with the PROVENANCE line, got: ${header}`);
	assert.ok(/running \d+ test\(s\)/.test(out), "and then say what it is running");
	// The runner's own statement about the set matches what the emitter computes for this tree - one truth,
	// not two emitters disagreeing (#6202: reuse, do not invent).
	assert.ok(out.includes(`dependencySet=${real.dependencySet}`), "the runner reports the same dependencySet the emitter computes");

	console.log("ok   header format is the one format");
	console.log("ok   link-failed-but-equal is a LOUD fallback, not drift");
	console.log("ok   resolved != declared is drift naming package and both versions");
	console.log("ok   a linked tree reads built-pin");
	console.log("ok   scripts/test.mjs opens with the provenance header");
} finally {
	for (const name of ["unlinked", "drift", "linked"]) {
		rmSync(join(realpathSync(process.cwd()), ".spike", `prov-${name}`), { recursive: true, force: true });
	}
}
