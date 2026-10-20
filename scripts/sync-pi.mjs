#!/usr/bin/env node
// Track pi's main branch instead of its release channel.
//
// Why: @earendil-works/pi-durable ships from a fast-moving monorepo (14 commits
// ahead of the last tag within a day, including a tool-result rename that
// breaks durig's tools). There is no dev/nightly npm dist-tag, so main IS the
// dev channel. main is not published, so the packages must be built from
// source; this script does that reproducibly against a pinned commit.
//
// Commands (JSON on stdout, like every other durig entry point):
//   node scripts/sync-pi.mjs                 report drift vs the pin (default)
//   node scripts/sync-pi.mjs --sync          build the pinned commit
//   node scripts/sync-pi.mjs --update        move the pin to main's tip, then build
//   node scripts/sync-pi.mjs --link          point node_modules at the built tree
//   node scripts/sync-pi.mjs --unlink        restore the released packages
//
// --link installs with `npm install --no-save`, so package.json stays clean
// and nothing un-installable-by-others can be committed; a plain `npm install`
// reverts to the released packages.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DURIG = resolve(HERE, "..");
const PIN_PATH = join(DURIG, "pi-main.pin.json");
// Gitignored: a built upstream tree is reproducible from the pin, so it must
// never become part of durig's own history.
const BUILD_DIR = join(DURIG, "vendor", "pi-main");

export function parseArgs(argv) {
	const flags = new Set(argv.filter((a) => a.startsWith("--")));
	return {
		check: flags.has("--check") || flags.size === 0,
		sync: flags.has("--sync"),
		update: flags.has("--update"),
		link: flags.has("--link"),
		unlink: flags.has("--unlink"),
	};
}

// A malformed pin must fail LOUDLY (naming the file and the parse error) rather
// than surfacing downstream as a confusing suite count. A hand-edited pin — e.g.
// a missing comma before "packages" — previously threw a bare SyntaxError with
// no file context, which read as a mystery failure.
export function readPin(path = PIN_PATH) {
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new Error(`cannot read pin ${path}: ${err?.message ?? err}`);
	}
	let pin;
	try {
		pin = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`pi-main.pin.json is malformed: ${path} failed to parse as JSON (${err?.message ?? err}). ` +
				`Fix the pin before running sync-pi.`,
		);
	}
	if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
		throw new Error(`pi-main.pin.json is malformed: ${path} is not a JSON object.`);
	}
	if (typeof pin.sha !== "string" || !Array.isArray(pin.packages)) {
		throw new Error(
			`pi-main.pin.json is malformed: ${path} is missing a string "sha" and/or a "packages" array.`,
		);
	}
	return pin;
}

/** Compare the pinned commit with upstream's tip. */
export function decideDrift(pinnedSha, upstreamSha) {
	if (!upstreamSha) return { drift: null, reason: "upstream sha unavailable" };
	return {
		drift: pinnedSha !== upstreamSha,
		reason: pinnedSha === upstreamSha ? "pin is upstream tip" : "upstream has moved",
		pinnedSha,
		upstreamSha,
	};
}

/** npm specifiers that point node_modules at the locally built packages. */
export function linkSpecs(pin, buildDir = BUILD_DIR) {
	return pin.packages.map((p) => `${p.name}@file:${join(buildDir, p.dir).replace(/\\/g, "/")}`);
}

// On Windows npm ships only as npm.cmd, which Node refuses to spawn without a
// shell (EINVAL), while git is a real .exe that must not go through cmd.exe.
// npm runs as ONE shell string rather than an args array: that form carries no
// unescaped-argument hazard, and every argument here is a durig-authored
// constant (package names and paths), never operator input.
function tool(name) {
	return name;
}

function quoteForCmd(arg) {
	return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

function run(cmd, args, cwd, { allowFail = false } = {}) {
	let res;
	if (process.platform === "win32" && cmd === "npm") {
		res = spawnSync(["npm", ...args.map(quoteForCmd)].join(" "), {
			cwd,
			encoding: "utf8",
			shell: true,
		});
	} else {
		res = spawnSync(tool(cmd), args, { cwd, encoding: "utf8" });
	}
	if (res.error && !allowFail) {
		throw new Error(`${cmd} ${args.join(" ")} could not start in ${cwd}: ${res.error.message}`);
	}
	if (res.status !== 0 && !allowFail) {
		throw new Error(
			`${cmd} ${args.join(" ")} failed in ${cwd} (exit ${res.status}): ${(res.stderr || res.stdout || "").trim().slice(0, 800)}`,
		);
	}
	return res;
}

function git(dir, args, opts) {
	return run("git", args, dir, opts);
}

/** Upstream tip sha for the pinned branch, or null when the network is down. */
export function upstreamSha(pin) {
	// A failed lookup must not look like "no drift"; callers report it as
	// "unavailable" so an offline check never reads as up-to-date.
	const res = run("git", ["ls-remote", pin.repo, `refs/heads/${pin.branch}`], DURIG, { allowFail: true });
	if (res.status !== 0 || res.error) return null;
	const line = (res.stdout || "").trim().split("\n")[0] ?? "";
	return line.split(/\s+/)[0] || null;
}

/** Materialize BUILD_DIR at the pinned sha (sparse: only the needed packages). */
export function ensureBuildTree(pin) {
	const dirs = [...new Set([...pin.packages.map((p) => p.dir), "scripts"])];
	if (!existsSync(join(BUILD_DIR, ".git"))) {
		mkdirSync(BUILD_DIR, { recursive: true });
		git(BUILD_DIR, ["init", "--quiet"]);
		git(BUILD_DIR, ["remote", "add", "origin", pin.repo]);
		git(BUILD_DIR, ["sparse-checkout", "init", "--cone"]);
	}
	// Re-applied on EVERY sync, not only at init: upstream splits new workspaces
	// out of existing ones (pi-codemode became a pi-durable dependency), and an
	// existing build tree would otherwise never check the new one out.
	git(BUILD_DIR, ["sparse-checkout", "set", ...dirs]);
	// Fetch the exact commit rather than the branch tip: the pin must win even
	// after upstream moves, which is the whole point of pinning.
	git(BUILD_DIR, ["fetch", "--depth", "1", "origin", pin.sha]);
	git(BUILD_DIR, ["checkout", "-f", "FETCH_HEAD"]);

	const head = git(BUILD_DIR, ["rev-parse", "HEAD"]).stdout.trim();
	if (head !== pin.sha) {
		throw new Error(`build tree is at ${head}, expected pinned ${pin.sha}`);
	}
	return head;
}

/** Install workspace deps and build each package in dependency order. */
export function buildPackages(pin) {
	run("npm", ["install", "--include-workspace-root"], BUILD_DIR);
	const built = [];
	for (const pkg of pin.packages) {
		run("npm", ["run", "build", "-w", pkg.name], BUILD_DIR);
		const entry = join(BUILD_DIR, pkg.dir, "dist", "index.js");
		if (!existsSync(entry)) {
			throw new Error(`${pkg.name} built without ${entry}`);
		}
		built.push(pkg.name);
	}
	return built;
}

function out(payload) {
	console.log(JSON.stringify(payload, null, 2));
}

function main(argv) {
	const args = parseArgs(argv);
	let pin = readPin();
	let linked = null;

	if (args.update) {
		const tip = upstreamSha(pin);
		if (!tip) throw new Error("cannot reach upstream to update the pin");
		pin = { ...pin, sha: tip, pinnedAt: new Date().toISOString() };
		writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`);
	}

	// --unlink only restores the released packages; it needs no build tree.
	if (args.unlink) {
		run("npm", ["install"], DURIG);
		out({ ok: true, command: "sync-pi", action: "unlink", dependencies: "released packages" });
		return;
	}

	const drift = args.update ? null : decideDrift(pin.sha, upstreamSha(pin));
	// The build tree must exist and be at the pin before anything is built.
	const head = args.sync || args.update ? ensureBuildTree(pin) : null;
	const built = args.sync || args.update ? buildPackages(pin) : [];

	if (args.link) {
		if (!existsSync(join(BUILD_DIR, "packages", "durable", "dist", "index.js"))) {
			throw new Error("nothing built yet; run --sync before --link");
		}
		run("npm", ["install", "--no-save", ...linkSpecs(pin)], DURIG);
		linked = linkSpecs(pin);
	}

	out({
		ok: true,
		command: "sync-pi",
		pinnedSha: pin.sha,
		upstream: drift,
		buildTree: head,
		built,
		linked,
		buildDir: BUILD_DIR,
	});
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		console.log(JSON.stringify({ ok: false, command: "sync-pi", error: String(err?.message ?? err) }, null, 2));
		process.exit(1);
	}
}
