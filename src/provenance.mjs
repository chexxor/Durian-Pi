// Config provenance: which revision of durig ran, and what was enabled.
//
// Why this exists (ROADMAP item 19): `metrics` can see that a measure moved but
// not what was live when it moved, so "I changed the config and the measure
// moved" is a coincidence rather than an inference. A rig is driven by a
// committed spec, so git is already the append-only change log — `security.sec`
// preferred exactly this over adding a store write path, because a write path
// would add a mutable, untrusted attribution surface while git is already
// append-only and hash-chained. This module therefore only READS.
//
// Three honesty rules, all of which the security position asked for:
//   - "no repository" is unknown, not clean. A published or vendored copy of
//     durig is not evidence that the tree was clean, it is absence of evidence.
//   - a dirty tree is a FLAG, because the revision then does not describe what
//     ran; printing a hash without it implies more than it can support.
//   - git authorship is not authentication. The revision identifies content,
//     not who wrote it, and nothing here should be read as a trust claim.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { dependencySet, readPin } from "../scripts/sync-pi.mjs";

/** The extension durig installs itself, so "the active set" is never empty and
 * a change in durig itself is visible as a change in what was live. */
export const BUILTIN_EXTENSION = "durig.router";

/**
 * Run git and return trimmed stdout, or null when git, the repository, or the
 * command is unavailable. Every failure mode collapses to null deliberately:
 * from a reader's point of view "I could not read this" is one state, and a
 * caller must not have to tell "no git installed" from "not a repository" to
 * report the provenance honestly.
 */
function git(args, cwd) {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5000,
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Read the repository revision and whether the working tree is dirty.
 *
 * `-- .` is load-bearing: durig is usually a subtree of a larger repository, so
 * an unscoped `git status` reports every sibling project's edits. Measured in
 * this repository: unscoped reported 92 changed paths while the durig subtree
 * reported 0 — a flag that is always true is worse than no flag. Scoping to the
 * working directory is what makes the answer about durig.
 *
 * Untracked files count as dirty (the default), because an untracked extension
 * module is genuinely part of the active set and is genuinely absent from the
 * revision. Gitignored files never appear, which is why rig databases and
 * `node_modules` do not make every reading dirty.
 *
 * @param {string} [cwd]
 * @returns {{revision: string|null, dirty: boolean|null, reason: string|null}}
 */
export function gitProvenance(cwd = process.cwd()) {
	const revision = git(["rev-parse", "--short", "HEAD"], cwd);
	if (!revision) {
		return {
			revision: null,
			dirty: null,
			reason: "no git revision (not a repository, or no commits yet)",
		};
	}
	const status = git(["status", "--porcelain", "--", "."], cwd);
	if (status === null) {
		return { revision, dirty: null, reason: "the working tree could not be read" };
	}
	return { revision, dirty: status.length > 0, reason: null };
}

/**
 * The active extension set: what was installed when a seat ran.
 *
 * `declared` is what the configuration names — the file paths in
 * `DURIG_EXTENSIONS`. Paths rather than loaded names because loading a module
 * executes it, and a read-only `metrics` query must not run arbitrary code to
 * report what it would have run.
 *
 * @param {string[]} declared
 * @returns {string[]}
 */
export function activeSet(declared = []) {
	return [BUILTIN_EXTENSION, ...declared];
}

/**
 * One line for a person. Kept pure so the wording is asserted in a test rather
 * than eyeballed, and so the dirty case cannot silently lose its warning.
 *
 * @param {{revision: string|null, dirty: boolean|null, reason: string|null}} provenance
 * @param {string[]} active
 */
export function formatProvenance(provenance, active) {
	const { revision, dirty, reason } = provenance ?? {};
	let where;
	if (revision === null || revision === undefined) {
		where = `rev unknown (${reason ?? "unavailable"})`;
	} else if (dirty === true) {
		where = `rev ${revision} DIRTY (uncommitted changes: this revision does not describe what ran)`;
	} else if (dirty === false) {
		where = `rev ${revision} clean`;
	} else {
		where = `rev ${revision}, tree unreadable (${reason ?? "unknown"})`;
	}
	return `config  ${where} · active: ${active.join(", ")}`;
}

/**
 * Which pi a suite run actually used (#6196, #6202).
 *
 * WHY THIS EXISTS. The same command in two trees can print opposite verdicts: a tree forked from main
 * that resolves pi-durable 1.3.0 from the lockfile runs 262/283 (exit 1), while the identical tree after
 * `sync-pi --sync --link` (dependencySet built-pin, 1.5.1) runs 282/282 (exit 0). Neither tree says which
 * set it ran, so a red in one is read as a red in main. Lead's ruling on the pin model (#6201) makes this
 * a policy requirement: a result from a tree resolving a different set is a CONDITIONAL observation, and is
 * admissible as landing evidence only if it names the set it ran against.
 *
 * THREE THINGS ARE KEPT SEPARATE, because conflating them is the defect:
 *   - the PIN: the commit the rig is validated against (pi-main.pin.json);
 *   - the DECLARED set: the versions package-lock.json says will be installed;
 *   - the RESOLVED set: what is actually in node_modules, and whether it is the vendored pin build or the
 *     released version the lockfile pulled.
 * "link failed but resolved == declared" is not drift - it is the fallback, and it must be LOUD.
 * "resolved != declared" IS drift, and it names the package and the two versions.
 *
 * Read-only: nothing here installs, links or writes. It imports the link inspection from
 * scripts/sync-pi.mjs rather than re-implementing it, because a second classifier of "is this tree linked"
 * is the same drift class this module exists to prevent.
 */
export function declaredPiSet(root) {
	try {
		const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
		const packages = lock.packages ?? lock.dependencies ?? {};
		const out = {};
		for (const [key, value] of Object.entries(packages)) {
			const name = key.startsWith("node_modules/") ? key.slice("node_modules/".length) : key;
			if (name.includes("@earendil-works/") && value?.version) out[name] = value.version;
		}
		return out;
	} catch {
		return {};
	}
}

/** What is actually in node_modules, and through what path it got there. */
export function resolvedPiSet(pin, root) {
	return (pin?.packages ?? []).map((pkg) => {
		const dir = join(root, "node_modules", ...pkg.name.split("/"));
		if (!existsSync(dir)) return { name: pkg.name, resolved: null, via: "absent" };
		let version = null;
		try {
			version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version ?? null;
		} catch {
			version = null;
		}
		let real = dir;
		try {
			real = realpathSync(dir);
		} catch {
			/* unresolvable: keep the nominal path */
		}
		return {
			name: pkg.name,
			resolved: version,
			via: real.replace(/\\/g, "/").includes("vendor/pi-main") ? "built-pin" : "lockfile",
		};
	});
}

export function dependencyProvenance(root = process.cwd(), pinArg = null) {
	let pin = pinArg;
	let pinReason = null;
	if (pin === null) {
		try {
			pin = readPin();
		} catch (err) {
			pinReason = String(err?.message ?? err);
		}
	}
	const set = pin ? dependencySet(pin, root, join(root, "vendor", "pi-main")) : "no-pin-file";
	const declared = declaredPiSet(root);
	const resolved = resolvedPiSet(pin, root);
	const drift = resolved
		.filter((r) => declared[r.name] && r.resolved && declared[r.name] !== r.resolved)
		.map((r) => ({ name: r.name, declared: declared[r.name], resolved: r.resolved, via: r.via }));
	const git = gitProvenance(root);
	const branch = execFileSyncSafe(["rev-parse", "--abbrev-ref", "HEAD"], root);
	const status = git !== null ? execFileSyncSafe(["status", "--porcelain", "--", "."], root) : null;
	const dirtyPaths = status === null ? null : status.split("\n").filter((l) => l.trim()).length;
	const piDurable = resolved.find((r) => r.name === "@earendil-works/pi-durable")?.resolved ?? null;
	return {
		tree: git.revision,
		branch: branch ?? "unknown",
		uncommittedPaths: dirtyPaths,
		node: process.version,
		host: `${process.platform} ${release()}`,
		dependencySet: set,
		pinRef: pin ? describePinRefSafe(pin) : null,
		pinSha: pin?.sha ?? null,
		pinReason,
		piDurable,
		declared,
		resolved,
		drift,
		fallback: set !== "built-pin",
	};
}

function describePinRefSafe(pin) {
	try {
		return pin.branch ? `${pin.branch}@${String(pin.sha).slice(0, 12)}` : String(pin.sha).slice(0, 12);
	} catch {
		return null;
	}
}

/** git stdout, or null when git is unavailable - never a thrown error in a read-only report. */
function execFileSyncSafe(args, cwd) {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
}

/**
 * THE ONE FORMAT. Anything that reports a suite verdict prints this line, so a number can always be traced
 * to the tree and dependency set that produced it (#6196). `dependencySet` values come from
 * scripts/sync-pi.mjs: built-pin | mixed | lockfile-released | not-installed.
 */
export function formatDependencyProvenance(p) {
	const lines = [
		`PROVENANCE tree=${p.tree ?? "unknown"} branch=${p.branch ?? "unknown"} node=${p.node} host=${p.host} ` +
			`pi-durable=${p.piDurable ?? "absent"} dependencySet=${p.dependencySet} pin=${p.pinRef ?? "no pin file"}`,
	];
	if (p.fallback) {
		lines.push(
			`FALLBACK: this tree is NOT running the pinned pi (${p.pinRef ?? "unknown"}). dependencySet=${p.dependencySet}; ` +
			`it resolves ${p.piDurable ?? "nothing"} from the lockfile. Run node scripts/sync-pi.mjs --sync --link before treating ` +
			`this result as a verdict about main - it is a conditional observation about THIS tree.`,
		);
	}
	if (p.drift.length) {
		// One summary line, not one per package: the header is read on every suite run, and a linked tree
		// legitimately resolves the pin build while the lockfile still names the released version. The full
		// per-package table is `node scripts/sync-pi.mjs --report`.
		const named = p.drift.slice(0, 3).map((d) => `${d.name} (${d.declared} -> ${d.resolved})`);
		lines.push(
			`DRIFT: ${p.drift.length} of ${p.resolved.length} pin packages resolve differently from package-lock.json: ` +
				named.join(", ") + (p.drift.length > 3 ? ` (+${p.drift.length - 3} more; run node scripts/sync-pi.mjs --report)` : ""),
		);
	}
	return lines.join("\n");
}
