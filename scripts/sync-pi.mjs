#!/usr/bin/env node
// Track pi's main branch instead of its release channel.
//
// Why: @earendil-works/pi-durable ships from a fast-moving monorepo (14 commits
// ahead of the last tag within a day, including a tool-result rename that
// breaks durig's tools). There is no dev/nightly npm dist-tag, so main IS the
// dev channel. main is not published, so the packages must be built from
// source; this script does that reproducibly against a pinned commit.
//
// PIN POLICY (#5093, lead's ruling, implemented here by #5094): **we pin a TAG, we do not
// float on `main`.** Upstream tags AND npm-publishes its releases (`dist-tags.latest`), so a
// named, validated checkpoint costs only the plumbing, and a pin that names no ref cannot be
// argued with or aged. The defect this closes is not the 508-commit gap itself: it is that 508
// commits across two releases sat UNNOTICED for 16 days because drift was only printed when
// someone chose to look. So drift is now reported on EVERY invocation, with behind/ahead counts,
// the pin's age, and the tags in between - and a ref that does not exist FAILS LOUDLY naming the
// refs it knows, instead of quietly pinning main's tip (the same fail-open class as #5071's
// queue-args refusal and #4955's `no_store`).
//
// Commands (JSON on stdout, like every other durig entry point):
//   node scripts/sync-pi.mjs                     INSPECT the tree + report drift vs the pin (default)
//   node scripts/sync-pi.mjs --sync              build the pinned commit
//   node scripts/sync-pi.mjs --update            move the pin to the branch tip, then build
//                                                (LOUD policy gap: prefer a ref, below)
//   node scripts/sync-pi.mjs --update v1.4.0     move the pin to the TAG v1.4.0, then build
//   node scripts/sync-pi.mjs --observe [ref]     record upstream's tip as OBSERVED without moving
//                                                the pin (what makes drift checkable offline later)
//   node scripts/sync-pi.mjs --link              point node_modules at the built tree
//   node scripts/sync-pi.mjs --unlink            restore the released packages
//
// `--unlink` is NOT a rollback (#5093): it restores the RELEASED packages, and a released package
// cannot open a store migrated past the schema it understands. Rollback is a restored backup.
//
// --link installs with `npm install --no-save`, so package.json stays clean
// and nothing un-installable-by-others can be committed; a plain `npm install`
// reverts to the released packages.
//
// THE REPORT IS A MEASUREMENT, NOT A RUN LOG (#5282): `buildTree`, `built` and
// `linked` describe what is ON DISK after the call, whatever the call did. The
// default path used to print `buildTree: null, built: [], linked: null` in a
// fully built AND linked tree, because those fields were filled only by the
// action that produced them - so `built: []` read as "unbuilt" and was not
// evidence of anything. Every caller can now ask "what state is this tree in?"
// with one no-side-effect command.
import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DURIG = resolve(HERE, "..");
const PIN_PATH = join(DURIG, "pi-main.pin.json");
// Gitignored: a built upstream tree is reproducible from the pin, so it must
// never become part of durig's own history.
const BUILD_DIR = join(DURIG, "vendor", "pi-main");

// Every flag the tool knows. An unlisted flag is REFUSED, never ignored: an ignored
// flag used to mean `--update v1.4.1`(typo) pinned main's tip and looked like success.
export const FLAGS = ["--check", "--sync", "--update", "--observe", "--link", "--unlink"];

export function parseArgs(argv) {
	const known = new Set(FLAGS);
	const bare = [];
	let ref = null;
	for (const tok of argv) {
		if (!tok.startsWith("--")) {
			bare.push(tok);
			continue;
		}
		const name = tok.split("=")[0];
		if (!known.has(name)) {
			throw new Error(
				`sync-pi: unknown flag ${JSON.stringify(tok)}. Known flags: ${FLAGS.join(", ")}. ` +
				`An unknown flag is refused rather than ignored - ignoring it is how a misspelled verb became a silent success (#5094).`,
			);
		}
		if (tok.includes("=")) {
			if (ref !== null) throw new Error(`sync-pi: more than one ref given ("${ref}" and "${tok.slice(tok.indexOf("=") + 1)}")`);
			ref = tok.slice(tok.indexOf("=") + 1);
		}
	}
	if (bare.length > 1) throw new Error(`sync-pi: more than one ref given (${bare.join(", ")}); pass at most one`);
	if (bare.length === 1) {
		if (ref !== null) throw new Error(`sync-pi: more than one ref given ("${ref}" and "${bare[0]}")`);
		ref = bare[0];
	}
	const flags = new Set(argv.map((a) => a.split("=")[0]).filter((a) => a.startsWith("--")));
	const acting = flags.has("--sync") || flags.has("--update") || flags.has("--observe") || flags.has("--link") || flags.has("--unlink");
	if (ref !== null && !flags.has("--update") && !flags.has("--observe")) {
		throw new Error(`sync-pi: a ref belongs to --update or --observe, not to the flags given (${[...flags].join(", ") || "none"}).`);
	}
	return {
		check: !acting,
		sync: flags.has("--sync"),
		update: flags.has("--update"),
		observe: flags.has("--observe"),
		link: flags.has("--link"),
		unlink: flags.has("--unlink"),
		ref,
	};
}

// A malformed pin must fail LOUDLY (naming the file and the parse error) rather
// than surfacing downstream as a confusing suite count. A hand-edited pin â€” e.g.
// a missing comma before "packages" â€” previously threw a bare SyntaxError with
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
	// The ref fields are OPTIONAL here on purpose: the shipped pin still floats on a branch tip,
	// and #5094 must not invalidate the pin it is about to move (#5095 moves it). But a ref field
	// that IS present must be well-formed - a pin that claims `"refType": "tag"` with no `ref`
	// is a provenance lie, and a lie in the pin file is worse than a gap.
	if (pin.ref !== undefined && typeof pin.ref !== "string") {
		throw new Error(`pi-main.pin.json is malformed: ${path} has a "ref" that is not a string.`);
	}
	if (pin.refType !== undefined && !["tag", "branch", "sha"].includes(pin.refType)) {
		throw new Error(
			`pi-main.pin.json is malformed: ${path} has refType ${JSON.stringify(pin.refType)}; expected "tag", "branch" or "sha".`,
		);
	}
	if (pin.refType !== undefined && pin.ref === undefined) {
		throw new Error(`pi-main.pin.json is malformed: ${path} declares refType ${JSON.stringify(pin.refType)} but names no "ref".`);
	}
	if (pin.previous !== undefined && !Array.isArray(pin.previous)) {
		throw new Error(`pi-main.pin.json is malformed: ${path} has a "previous" that is not an array.`);
	}
	if (pin.observedUpstream !== undefined && (typeof pin.observedUpstream !== "object" || pin.observedUpstream === null)) {
		throw new Error(`pi-main.pin.json is malformed: ${path} has "observedUpstream" that is not an object.`);
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

/** Parse `git ls-remote` stdout into {sha, ref} pairs. Pure, so the decision is testable offline. */
export function parseLsRemote(stdout) {
	return (stdout || "")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [sha, ref] = line.split(/\s+/);
			return { sha, ref };
		})
		.filter((e) => typeof e.sha === "string" && typeof e.ref === "string");
}

/**
 * What a ref MEANS against upstream's refs. Pure: it never guesses.
 *
 * The fail-open this exists to prevent: `--update v1.4.1` (a tag that does not exist) resolving to
 * "no ref found, use the branch tip anyway" would move the validated checkpoint to unreviewed
 * upstream code while reporting a successful pin move. That is the worst failure available in this
 * file, so an unknown ref THROWS, naming the refs upstream actually has (#5094).
 */
export function resolveRef(entries, ref, repoLabel = "the pinned repo") {
	if (typeof ref !== "string" || ref.trim() === "") {
		throw new Error(`sync-pi: refusing to resolve an empty ref (${JSON.stringify(ref)}).`);
	}
	if (/^[0-9a-f]{7,40}$/.test(ref)) {
		// A sha is what the pin already stores; ls-remote lists refs, not commits, so absence from
		// `entries` is not evidence of absence upstream. ensureBuildTree fetches the exact commit and
		// fails LOUDLY if it does not exist, which is the real gate for this form.
		const hit = entries.find((e) => e.sha.startsWith(ref));
		return { sha: hit ? hit.sha : ref, refType: "sha", ref };
	}
	const tag = entries.find((e) => e.ref === `refs/tags/${ref}`);
	if (tag) {
		// An annotated tag points at a tag OBJECT; the commit is the peeled ^{} entry when present.
		const peeled = entries.find((e) => e.ref === `refs/tags/${ref}^{}`);
		return { sha: (peeled ?? tag).sha, refType: "tag", ref };
	}
	const head = entries.find((e) => e.ref === `refs/heads/${ref}`);
	if (head) return { sha: head.sha, refType: "branch", ref };
	const tags = entries
		.filter((e) => e.ref.startsWith("refs/tags/"))
		.map((e) => e.ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, ""))
		.filter((v, i, a) => a.indexOf(v) === i);
	const heads = entries.filter((e) => e.ref.startsWith("refs/heads/")).map((e) => e.ref.replace(/^refs\/heads\//, ""));
	throw new Error(
		`unknown ref ${JSON.stringify(ref)} for ${repoLabel}. Known tags: ${tags.length ? tags.join(", ") : "(none upstream or none fetched)"}. ` +
			`Known branches: ${heads.length ? heads.join(", ") : "(none)"}. ` +
			`sync-pi does NOT fall back to a branch tip when a ref is misspelled (#5094: a typo that pins main's tip is the worst fail-open in this file).`,
	);
}

/** A tag pin, a branch pin, or the legacy pin that names no ref at all. Pure. */
export function describePinRef(pin) {
	if (pin.refType && pin.ref) return { ref: pin.ref, refType: pin.refType, policyGap: null };
	if (pin.branch) {
		return {
			ref: pin.branch,
			refType: "branch",
			policyGap: `POLICY GAP (#5093): the pin names no ref and floats on branch ${JSON.stringify(pin.branch)}; pin a TAG so the validated checkpoint is named and ageable`,
		};
	}
	return { ref: null, refType: null, policyGap: "POLICY GAP (#5093): the pin names no ref at all" };
}

/**
 * The pin object that a move produces. Pure - no network, no file - so the round-trip is testable
 * without touching the shipped pin. `previous` keeps the last 10 moves: provenance for "what were we
 * validated against before, and when", which is the question every pi-upgrade incident asks.
 */
export function applyPinUpdate(pin, resolved, now = new Date().toISOString()) {
	const hop = {
		ref: pin.ref ?? null,
		refType: pin.refType ?? null,
		sha: pin.sha,
		pinnedAt: pin.pinnedAt ?? null,
	};
	const carried = Array.isArray(pin.previous) ? pin.previous : [];
	return {
		...pin,
		ref: resolved.ref,
		refType: resolved.refType,
		sha: resolved.sha,
		pinnedAt: now,
		previous: [hop, ...carried].slice(0, 10),
	};
}

/**
 * Is this clone shallow? `git rev-parse --is-shallow-repository` answers it directly, so the report
 * never has to INFER shallowness from a failed rev-list (the inference that produced the nulls).
 */
export function isShallowClone(cloneDir) {
	if (!existsSync(join(cloneDir, ".git"))) return null;
	const res = run("git", ["rev-parse", "--is-shallow-repository"], cloneDir, { allowFail: true });
	if (res.status !== 0) return null;
	return (res.stdout || "").trim() === "true";
}

/**
 * Deepen a shallow vendored clone so the gap can actually be COUNTED (#6061).
 * A shallow clone is not an unmeasurable gap; it is one fetch away from being measurable. The report
 * used to print `behind: null, ahead: null` and hand the reader a shell command, which is a null that
 * LOOKS like a finding: the instrument could not answer "how far behind are we?" and nobody had to
 * notice that it could not.
 * Returns { ok, tried, detail }. `tried` is every command actually run, so a failure names what was
 * attempted rather than a hypothetical fix.
 */
export function deepenClone(cloneDir) {
	const attempts = [
		["fetch", "--unshallow", "origin"],
		["fetch", "--unshallow"],
		["fetch", "--tags", "origin"],
	];
	const tried = [];
	let last = null;
	for (const args of attempts) {
		const res = run("git", args, cloneDir, { allowFail: true });
		tried.push({ command: `git -C ${cloneDir} ${args.join(" ")}`, exit: res.status, detail: (res.stderr || res.stdout || "").trim().slice(0, 200) });
		last = res;
		// A successful unshallow is enough; a successful --tags fetch alone does not make the history
		// countable, so keep going and let the caller's retry decide whether the gap is now measurable.
		if (args[1] === "--unshallow" && res.status === 0) return { ok: true, tried, detail: null };
	}
	return {
		ok: false,
		tried,
		detail: (last?.stderr || last?.stdout || "").trim().slice(0, 200) || `exit ${last?.status}`,
	};
}

/**
 * Which endpoint of the symmetric difference git cannot see. Names the object that is missing instead
 * of blaming "shallow history" for a sha that was simply never fetched.
 */
function missingEndpoint(cloneDir, sha) {
	if (!/^[0-9a-f]{7,40}$/.test(String(sha || ""))) return `${JSON.stringify(sha)} is not a sha`;
	const probe = run("git", ["cat-file", "-e", `${sha}^{commit}`], cloneDir, { allowFail: true });
	return probe.status === 0 ? null : `${sha} is not in this clone`;
}

/**
 * How far the pin sits from upstream's tip.
 *
 * THREE OUTCOMES, kept distinct, because a null that is not labelled is the defect (#6061):
 *   gap "measured"  - behind/ahead are integers, counted from a clone deep enough to count;
 *   gap "unknown"   - the count could not be obtained: no clone, no upstream sha, the deepening
 *                     fetch failed, or an endpoint object is simply not present. The reason names
 *                     what was TRIED and what it returned, never a bare suggestion.
 * `countsReason` is kept as a synonym of `gapReason` so an existing reader still finds the text.
 */
export function behindAhead(cloneDir, pinnedSha, upstreamSha) {
	const nulls = (reason, deepened = false) => ({
		behind: null,
		ahead: null,
		gap: "unknown",
		gapReason: reason,
		countsReason: reason,
		deepened,
	});
	if (!upstreamSha) {
		return nulls("upstream sha unavailable (offline?) - run: node scripts/sync-pi.mjs --observe");
	}
	if (!existsSync(join(cloneDir, ".git"))) {
		return nulls(`no vendored clone at ${cloneDir} - run: node scripts/sync-pi.mjs --sync`);
	}
	const count = () => run("git", ["rev-list", "--left-right", "--count", `${pinnedSha}...${upstreamSha}`], cloneDir, { allowFail: true });
	const read = (res) => {
		const [aheadOfPin, behindPin] = (res.stdout || "").trim().split(/\s+/);
		const behind = Number(behindPin);
		const ahead = Number(aheadOfPin);
		if (!Number.isInteger(behind) || !Number.isInteger(ahead)) return null;
		return { behind, ahead, gap: "measured", gapReason: null, countsReason: null };
	};
	const first = count();
	if (first.status === 0) {
		const measured = read(first);
		if (measured) return { ...measured, deepened: false };
		return nulls(`git rev-list --left-right --count ${pinnedSha}...${upstreamSha} in ${cloneDir} printed an unparseable count: ${(first.stdout || "").trim().slice(0, 120)}`);
	}
	// The count failed. A shallow clone is a FETCH away from a number, so try the fetch before
	// declaring the gap unknown, and re-measure if it worked.
	if (isShallowClone(cloneDir)) {
		const deep = deepenClone(cloneDir);
		if (deep.ok) {
			const again = count();
			if (again.status === 0) {
				const measured = read(again);
				if (measured) return { ...measured, deepened: true };
				return nulls(`the clone deepened (git fetch --unshallow succeeded) but the count still failed in ${cloneDir} (exit ${again.status}): ${(again.stderr || "").trim().slice(0, 160)}`, true);
			}
			return nulls(`the clone was deepened but the count is still unmeasurable: ${missingEndpoint(cloneDir, pinnedSha) ?? missingEndpoint(cloneDir, upstreamSha) ?? "git rev-list exit ${again.status}"}`, true);
		}
		return nulls(
			`the vendored clone at ${cloneDir} is shallow and the deepening fetch FAILED: ${deep.detail} (tried: ${deep.tried.map((t) => `${t.command} -> exit ${t.exit}`).join("; ")})`,
			false,
		);
	}
	const missing = missingEndpoint(cloneDir, pinnedSha) ?? missingEndpoint(cloneDir, upstreamSha);
	return nulls(
		missing
			? `${missing} - git rev-list --left-right --count ${pinnedSha}...${upstreamSha} cannot count it (exit ${first.status})`
			: `git rev-list --left-right --count ${pinnedSha}...${upstreamSha} failed in ${cloneDir} (exit ${first.status}): ${(first.stderr || first.stdout || "").trim().slice(0, 160)}`,
	);
}

/**
 * Tags upstream has published that the pin does NOT contain - the releases sitting between us and
 * tip. Read from the VENDORED CLONE's tags (no network on a check), and an uncertainty is reported
 * as uncertainty rather than as "no tags in between".
 */
export function tagsBetween(cloneDir, pinnedSha) {
	if (!existsSync(join(cloneDir, ".git"))) {
		return { tags: [], tagsReason: `no vendored clone at ${cloneDir} - run: node scripts/sync-pi.mjs --sync` };
	}
	const listed = run("git", ["tag", "--list", "--sort=version:refname"], cloneDir, { allowFail: true });
	if (listed.status !== 0) {
		return { tags: [], tagsReason: `git tag --list failed in ${cloneDir} (exit ${listed.status})` };
	}
	const names = (listed.stdout || "")
		.trim()
		.split("\n")
		.filter((n) => /^v?\d+(\.\d+)*$/.test(n));
	if (names.length === 0) {
		return { tags: [], tagsReason: `the clone at ${cloneDir} has no version tags fetched - run: git -C ${cloneDir} fetch --tags origin` };
	}
	const newer = [];
	for (const name of names) {
		const anc = run("git", ["merge-base", "--is-ancestor", name, pinnedSha], cloneDir, { allowFail: true });
		if (anc.status === 1) newer.push(name); // exit 1 = a real answer: not contained in the pin
		else if (anc.status !== 0) {
			return {
				tags: newer,
				tagsReason: `cannot test tag ${JSON.stringify(name)} against ${pinnedSha} in ${cloneDir} (exit ${anc.status}): ${(anc.stderr || "").trim().slice(0, 120)} - the list below is INCOMPLETE, not authoritative`,
			};
		}
	}
	return { tags: newer, tagsReason: null };
}

/**
 * NAME THE PIN (#6061, closing the #5093 policy gap). A pinned sha that no ref names cannot be
 * argued with, aged, or compared: "we are validated against 2ec55d80" is a fact nobody can check
 * against a release. If a published tag points EXACTLY at the pinned commit, that tag is the name.
 *
 * This never moves the sha - it only attaches the ref that already describes it. When no tag does,
 * the reason says which tags exist and what to do, rather than leaving `pinRef: null` with no
 * explanation (the same fail-open shape as a null behind/ahead).
 */
export function namePinRef(cloneDir, pin) {
	if (pin.refType === "tag" && typeof pin.ref === "string" && pin.ref) {
		return { named: false, alreadyNamed: true, ref: pin.ref, refType: "tag", reason: null };
	}
	if (!existsSync(join(cloneDir, ".git"))) {
		return { named: false, ref: null, refType: null, reason: `cannot name the pin: no vendored clone at ${cloneDir} - run: node scripts/sync-pi.mjs --sync` };
	}
	const probe = run("git", ["describe", "--tags", "--exact-match", pin.sha], cloneDir, { allowFail: true });
	const tag = (probe.stdout || "").trim();
	if (probe.status === 0 && tag) return { named: true, ref: tag, refType: "tag", reason: null };
	const listed = run("git", ["tag", "--list", "--sort=version:refname"], cloneDir, { allowFail: true });
	const names = (listed.stdout || "").trim().split("\n").filter((n) => /^v?\d+(\.\d+)*$/.test(n));
	if (names.length === 0) {
		return { named: false, ref: null, refType: null, reason: `no tag refs are fetched in ${cloneDir} - run: git -C ${cloneDir} fetch --tags origin` };
	}
	const missing = missingEndpoint(cloneDir, pin.sha);
	return {
		named: false,
		ref: null,
		refType: null,
		reason:
			`${names.length} tag refs exist in ${cloneDir} and none points exactly at the pinned sha ${pin.sha}${missing ? ` (${missing})` : ""}. ` +
			`The pin floats on branch ${JSON.stringify(pin.branch ?? "main")}. Name it deliberately with: node scripts/sync-pi.mjs --update <tag> (nearest tags: ${names.slice(-3).join(", ")})`,
	};
}

/** Assemble the drift finding. Pure: every fact is passed in, so a demo can pin a known gap. */
export function driftReport({ pin, upstreamSha, behind, ahead, gap = "unknown", gapReason = null, countsReason = null, deepened = false, tags, tagsReason, observedAt = null, now = Date.now() }) {
	const described = describePinRef(pin);
	const pinnedAt = typeof pin.pinnedAt === "string" ? pin.pinnedAt : null;
	const ageDays = pinnedAt ? Math.round(((now - Date.parse(pinnedAt)) / 86400000) * 10) / 10 : null;
	return {
		drift: upstreamSha ? upstreamSha !== pin.sha : null,
		reason: !upstreamSha ? "upstream sha unavailable" : upstreamSha === pin.sha ? "pin is upstream tip" : "upstream has moved",
		pinnedSha: pin.sha,
		ref: described.ref,
		refType: described.refType,
		policyGap: described.policyGap,
		upstreamSha: upstreamSha ?? null,
		behind,
		ahead,
		// #6061: the gap is a NAMED state, not a null the reader has to interpret.
		gap,
		gapReason: gapReason ?? countsReason,
		countsReason: gapReason ?? countsReason,
		// Did THIS report have to deepen the clone to get the number? Said out loud, because a report
		// that quietly fetches is a report whose cost nobody sees.
		deepened,
		tagsBetween: tags,
		tagsReason,
		pinnedAt,
		pinAgeDays: ageDays,
		observedUpstream: observedAt ?? pin.observedUpstream ?? null,
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

/**
 * Upstream's tag AND branch refs, or null when they cannot be reached.
 * #5094's rule: resolving a ref from a STALE local clone is not acceptable - a tag created after
 * the last fetch would read as "unknown ref", and a stale answer must never be sold as absence.
 */
export function upstreamRefs(pin) {
	const res = run("git", ["ls-remote", "--tags", "--heads", pin.repo], DURIG, { allowFail: true });
	if (res.status !== 0 || res.error) return null;
	return parseLsRemote(res.stdout);
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

/** The file that says a pin package is built (one definition, used by the
 *  build and by the report, so "built" cannot mean two different things). */
export function builtEntry(pkg, buildDir = BUILD_DIR) {
	return join(buildDir, pkg.dir, "dist", "index.js");
}

/** Install workspace deps and build each package in dependency order. */
export function buildPackages(pin) {
	run("npm", ["install", "--include-workspace-root"], BUILD_DIR);
	const built = [];
	for (const pkg of pin.packages) {
		run("npm", ["run", "build", "-w", pkg.name], BUILD_DIR);
		const entry = builtEntry(pkg);
		if (!existsSync(entry)) {
			throw new Error(`${pkg.name} built without ${entry}`);
		}
		built.push(pkg.name);
	}
	return built;
}

// --- inspection (read-only: no fetch, no install, no build) ----------------

function pathKey(path) {
	const key = resolve(path).replace(/\\/g, "/");
	// Windows paths are case-insensitive; a link written as vendor/Pi-Main and
	// the pin's vendor/pi-main are the same directory there.
	return process.platform === "win32" ? key.toLowerCase() : key;
}

/**
 * What the build tree is, as opposed to what a run made it:
 * `{present, head, atPin}` - `head` is the checked-out sha (null when the tree
 * is absent or has no HEAD), `atPin` says whether it is the commit durig is
 * validated against. A tree left at an older sha is a finding on its own.
 */
export function inspectBuildTree(pin, buildDir = BUILD_DIR) {
	if (!existsSync(join(buildDir, ".git"))) {
		return { present: false, head: null, atPin: false };
	}
	const res = git(buildDir, ["rev-parse", "HEAD"], { allowFail: true });
	const head = res.status === 0 ? (res.stdout || "").trim() : "";
	if (!head) return { present: false, head: null, atPin: false };
	return { present: true, head, atPin: head === pin.sha };
}

/** Which pin packages have a built entry on disk (a subset, in pin order). */
export function inspectBuilt(pin, buildDir = BUILD_DIR) {
	return pin.packages.filter((pkg) => existsSync(builtEntry(pkg, buildDir))).map((pkg) => pkg.name);
}

/**
 * Which pin packages `node_modules` currently resolves to the BUILT tree, and
 * the directory each link actually resolves to. A real entry (a released
 * package from the lockfile) is NOT a link. npm uses junctions as well as
 * symlinks on Windows, where `lstat` does not report a reparse point as a
 * symlink, so the decisive test is what the entry resolves to.
 */
export function inspectLinked(pin, durigDir = DURIG, buildDir = BUILD_DIR) {
	const linked = [];
	for (const pkg of pin.packages) {
		const entry = join(durigDir, "node_modules", ...pkg.name.split("/"));
		const builtDir = join(buildDir, pkg.dir);
		let resolved;
		try {
			resolved = realpathSync(entry);
		} catch {
			continue; // not installed at all
		}
		if (pathKey(resolved) !== pathKey(builtDir)) continue;
		// `link` keeps the raw link text when there is one, so a relative or
		// oddly-written target is still visible; `spec` keeps the same string
		// --link has always reported.
		let link = null;
		try {
			if (lstatSync(entry).isSymbolicLink()) link = readlinkSync(entry);
		} catch {
			/* junction or plain dir: realpath above already decided it */
		}
		linked.push({
			name: pkg.name,
			target: resolved.replace(/\\/g, "/"),
			link,
			spec: `${pkg.name}@file:${builtDir.replace(/\\/g, "/")}`,
		});
	}
	return linked;
}

/**
 * One-line answer to "which pi does a suite run in this tree test?" - the
 * verdict-bearing question after a pin move, and the reason a green in a
 * linked tree is not comparable with a green in an unlinked one (#3821).
 */
export function dependencySet(pin, durigDir = DURIG, buildDir = BUILD_DIR) {
	const linked = inspectLinked(pin, durigDir, buildDir).length;
	if (linked === pin.packages.length) return "built-pin";
	if (linked > 0) return "mixed";
	const installed = pin.packages.some((pkg) =>
		existsSync(join(durigDir, "node_modules", ...pkg.name.split("/"))),
	);
	return installed ? "lockfile-released" : "not-installed";
}

function out(payload) {
	console.log(JSON.stringify(payload, null, 2));
}

function main(argv) {
	const args = parseArgs(argv);
	let pin = readPin();
	let pinWritten = false;
	let observedTip = null; // upstream tip seen on THIS run, so drift costs no second round-trip

	if (args.update) {
		if (args.ref) {
			// Resolve against UPSTREAM, never against a possibly-stale local clone: a tag created after
			// the last fetch must not read as "unknown ref", and a misspelled ref must not fall back to
			// a branch tip. Both failures are named, not smoothed over (#5094).
			const refs = upstreamRefs(pin);
			if (refs === null) {
				throw new Error(
					`cannot reach ${pin.repo} to resolve ${JSON.stringify(args.ref)}: sync-pi will not move the pin from stale local data. ` +
						`An unresolved ref leaves the pin EXACTLY where it was.`,
				);
			}
			const resolved = resolveRef(refs, args.ref, pin.repo);
			pin = applyPinUpdate(pin, resolved);
			if (resolved.refType === "branch") observedTip = resolved.sha;
		} else {
			const tip = upstreamSha(pin);
			if (!tip) throw new Error("cannot reach upstream to update the pin");
			pin = applyPinUpdate(pin, { sha: tip, refType: "branch", ref: pin.branch });
			observedTip = tip;
		}
		writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`);
		pinWritten = true;
	}

	if (args.observe) {
		// Observe WITHOUT moving the pin. This is the hook that makes drift checkable offline later:
		// the pin then carries "the last upstream state we actually saw, and when we saw it", so a
		// future `check` finding needs no network call to say the pin is behind or the observation is
		// stale. It records only what it measured (#5094).
		let observed = null;
		if (args.ref) {
			const refs = upstreamRefs(pin);
			if (refs === null) {
				throw new Error(`cannot reach ${pin.repo} to observe ${JSON.stringify(args.ref)}: sync-pi records observations it actually made, never a stale guess`);
			}
			observed = resolveRef(refs, args.ref, pin.repo);
		} else {
			const tip = upstreamSha(pin);
			if (!tip) throw new Error(`cannot reach ${pin.repo} to observe upstream's tip for refs/heads/${pin.branch}`);
			observed = { sha: tip, refType: "branch", ref: pin.branch };
		}
		if (observed.refType === "branch") observedTip = observed.sha;
		pin = { ...pin, observedUpstream: { sha: observed.sha, ref: observed.ref, refType: observed.refType, observedAt: new Date().toISOString() } };
		writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`);
		pinWritten = true;
	}

	// --unlink only restores the released packages; it needs no build tree.
	if (args.unlink) {
		run("npm", ["install"], DURIG);
		out({
			ok: true,
			command: "sync-pi",
			action: "unlink",
			dependencies: "released packages",
			pin: describePinRef(pin),
			// Said OUT LOUD because this is the verb a seat reaches for when a pin move goes wrong, and
			// for us it does not restore access: the live store sits at a durable_schema version the
			// released package cannot open (#5093). Rollback is a restored backup.
			warning:
				"--unlink is NOT a rollback: it restores the RELEASED packages, and a released pi-durable cannot open a store migrated past the schema it understands. Rollback = restore a backup.",
		});
		return;
	}

	// Drift is reported on EVERY path, not only when asked: the 16-day silence was not a missing
	// feature, it was a surface nobody had to look at.
	const tip = observedTip ?? upstreamSha(pin);
	const tags = tagsBetween(BUILD_DIR, pin.sha);
	// Measure first: behindAhead deepens a shallow clone when it can, and a deepened clone is the same
	// clone the pin-naming step needs to resolve a tag (#6061).
	const counts = behindAhead(BUILD_DIR, pin.sha, tip);

	// #6061/#5093: name the pin. If the pinned commit IS a published tag, the pin file says so - the
	// sha does not move, only the ref that describes it. Idempotent: once named, namePinRef reports
	// `alreadyNamed` and nothing is written.
	const naming = namePinRef(BUILD_DIR, pin);
	if (naming.named) {
		pin = { ...pin, ref: naming.ref, refType: "tag", refNamedAt: new Date().toISOString() };
		writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`);
		pinWritten = true;
	}
	const drift = {
		...driftReport({
			pin,
			upstreamSha: tip,
			...counts,
			tags: tags.tags,
			tagsReason: tags.tagsReason,
			observedAt: pin.observedUpstream ?? null,
		}),
		reason: decideDrift(pin.sha, tip).reason,
	};

	// The build tree must exist and be at the pin before anything is built.
	if (args.sync || args.update) {
		ensureBuildTree(pin);
		buildPackages(pin);
	}

	if (args.link) {
		if (!existsSync(join(BUILD_DIR, "packages", "durable", "dist", "index.js"))) {
			throw new Error("nothing built yet; run --sync before --link");
		}
		run("npm", ["install", "--no-save", ...linkSpecs(pin)], DURIG);
	}

	// Every field below is READ BACK FROM DISK after the action, so the report
	// states the resulting state and a reader never has to guess whether the
	// action ran in an earlier call (#5282).
	const tree = inspectBuildTree(pin);
	out({
		ok: true,
		command: "sync-pi",
		pinnedSha: pin.sha,
		pinRef: pin.ref ?? null,
		pinRefType: pin.refType ?? null,
		pinRefNamed: naming.named,
		pinRefReason: naming.reason ?? null,
		pinShaMoved: naming.named ? false : null, // naming a ref NEVER moves the sha (#5093)
		pinFileWritten: pinWritten,
		drift,
		upstream: drift, // kept: the old key name, same finding, so an existing reader still finds it
		upstream: drift,
		buildTree: tree.head,
		buildTreeAtPin: tree.atPin,
		built: inspectBuilt(pin),
		linked: inspectLinked(pin),
		dependencySet: dependencySet(pin),
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

