// worktree.mjs — isolate a seat's work from the tree the operator is editing.
//
// Why this exists: seats are confined (SC1) but confined to whatever `cwd` they are given, and
// nothing was giving them one - so before this they worked in durig's LIVE tree, where an author
// seat could overwrite the operator's uncommitted work. A per-item worktree is what makes "the
// operator reviews a diff, then merges" true instead of aspirational, and it is also what bounds
// the verifier's shell-write residual: a verifier can scribble freely in its own copy, where
// nothing of the operator's is at stake.

import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, cp, mkdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve, dirname, isAbsolute, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Resolve a PORTABLE, shell-free way to run npm.
 *
 * `execFile("npm", …)` fails on Windows with `spawn npm ENOENT`: `npm` is an
 * `.cmd` shim, and Node does not apply PATHEXT when resolving a bare name for
 * `execFile` without `shell: true` (#822). Naming `npm.cmd` does not help —
 * Node refuses to spawn `.cmd`/`.bat` directly (CVE-2024-27980 → `spawn EINVAL`).
 * `shell: true` works but is deprecated for argument arrays (args are concatenated
 * unescaped → injection surface) and would put a shell between durig and npm.
 *
 * The portable form is to run npm's own JS entry point with the SAME interpreter
 * that is running durig, so `src/worktree.mjs` stays pure Node and identical on
 * every platform (the item-63 host constraint). Returns `{ file, prefixArgs }`;
 * the caller appends npm's own args.
 *
 * `execFileSync` is used for the two lookups because resolution must complete
 * before `npm` is invoked and is cheap; a failed lookup is caught per candidate.
 */
export function resolveNpmInvocation() {
	// 1. The npm CLI shipped beside the running node (…/nodejs/node_modules/npm/…).
	const beside = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
	if (existsSync(beside)) return { file: process.execPath, prefixArgs: [beside] };

	// 2. Ask npm where it is, on platforms where `npm` resolves for execFile
	//    (POSIX). On Windows the bare name is exactly what ENOENTs, so fall back
	//    to `where`/`which` to locate the real shim, whose sibling npm-cli.js is
	//    then run through node (never executed as a `.cmd`).
	try {
		const which = process.platform === "win32" ? "where" : "which";
		const found = execFileSync(which, ["npm"], { encoding: "utf8", shell: false })
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		for (const bin of found) {
			const cli = join(dirname(bin), "node_modules", "npm", "bin", "npm-cli.js");
			if (existsSync(cli)) return { file: process.execPath, prefixArgs: [cli] };
		}
	} catch {
		// No npm on PATH — fall through to the bare name so the caller's own error
		// (with its stderr) is what surfaces, not this resolver's failure.
	}

	// 3. Last resort: the bare name, which works on POSIX and reproduces the
	//    precise ENOENT on Windows rather than silently doing nothing.
	return { file: "npm", prefixArgs: [] };
}

/** The git repository containing `dir`: durig is normally a subdirectory of a larger repository. */
export async function repoRoot(dir) {
	const { stdout } = await run("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
	// git reports forward slashes on Windows; `resolve` normalises it so callers can compare and
	// join it as an ordinary platform path instead of getting a path that only looks equal.
	return resolve(stdout.trim());
}

/**
 * Ensure a path is git-ignored BEFORE it is created, so a worktree/scratch
 * directory never leaks into the shared tree's `git status` as `?? <dir>/`.
 *
 * This is durig's form of the vendored `using-git-worktrees` rule
 * (vendor/eval/superpowers/skills/using-git-worktrees/SKILL.md, "Safety
 * Verification"): run `git check-ignore -q <dir>` and make it ignored FIRST,
 * "because an unignored worktree directory commits/leaks the whole tree".
 *
 * A target OUTSIDE the repository (or the repo root itself) cannot leak into it
 * and is left alone. The rule is written to the repository's LOCAL exclude file
 * (`<git-common-dir>/info/exclude`), NEVER to the tracked `.gitignore`: ignoring
 * a runtime-created path is machine-local state, and editing a tracked file here
 * would itself dirty the very tree the guard exists to keep clean.
 *
 * Idempotent: an already-ignored path is a no-op, and a rule already present in
 * the exclude file is not appended twice. The rule is directory-anchored
 * (`/<path>/`) so a FILE of a similar name is never swept up.
 */
export async function ensureIgnored({ repo, target }) {
	const rel = relative(resolve(repo), resolve(target));
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		return { ignored: false, outside: true };
	}
	const relPosix = rel.split(sep).join("/");
	try {
		await run("git", ["-C", repo, "check-ignore", "-q", "--", relPosix]);
		return { ignored: true, alreadyIgnored: true, pattern: relPosix };
	} catch {
		// exit 1 => not ignored yet; add the rule below.
	}
	const common = (await run("git", ["-C", repo, "rev-parse", "--git-common-dir"])).stdout.trim();
	const excludePath = join(isAbsolute(common) ? common : resolve(repo, common), "info", "exclude");
	const rule = `/${relPosix}/`;
	let existing = "";
	try {
		existing = await readFile(excludePath, "utf8");
	} catch {
		// No exclude file yet — it is created below.
	}
	const present = existing.split(/\r?\n/).map((line) => line.trim()).includes(rule);
	if (!present) {
		await mkdir(dirname(excludePath), { recursive: true });
		const separator = existing !== "" && !existing.endsWith("\n") ? "\n" : "";
		await writeFile(excludePath, `${existing}${separator}${rule}\n`, "utf8");
	}
	return { ignored: true, added: rule, pattern: relPosix };
}

/** The installed version of `name` in a worktree's `node_modules` (null when absent/unreadable). */
function installedVersion(worktreePath, name) {
	try {
		const pkg = JSON.parse(readFileSync(join(worktreePath, "node_modules", ...name.split("/"), "package.json"), "utf8"));
		return typeof pkg.version === "string" ? pkg.version : null;
	} catch {
		return null;
	}
}

/** The pi package whose version drifts in practice, and the one the tui demos need. */
const PINNED_PACKAGE = "@earendil-works/pi-durable";

/**
 * Run `node scripts/sync-pi.mjs --link` in a worktree and REPORT what happened (#3821).
 *
 * Exported because it is the step that silently did nothing: `--link` needs a BUILT
 * `vendor/pi-main`, which a fresh worktree never has, so it exits 1 with
 * `nothing built yet; run --sync before --link` — and the caller downgraded that to a
 * `console.warn` nobody reads. A caller must be able to assert this outcome without a
 * terminal, so the result is data, not a warning.
 */
export async function linkWorktreeDeps(worktreePath) {
	const syncPi = join(worktreePath, "scripts", "sync-pi.mjs");
	if (!existsSync(syncPi)) return { attempted: false, ok: null, reason: null, detail: null };
	const { file } = resolveNpmInvocation();
	try {
		await run(file, [syncPi, "--link"], { cwd: worktreePath });
		return { attempted: true, ok: true, reason: null, detail: null };
	} catch (linkErr) {
		// The step reports its failure as JSON on STDOUT (`{ok:false, error:"..."}`) and exits 1, so
		// stdout carries the reason. Dropping it here would leave the caller with "Command failed" and
		// no cause — the same shape of silence this item is about.
		const detail = [linkErr.message, linkErr.stdout, linkErr.stderr].filter(Boolean).join("\n").trim();
		return { attempted: true, ok: false, reason: linkFailureReason(detail), detail };
	}
}

/**
 * Name WHY a `--link` failed, in the words the caller needs to act (#3821).
 *
 * The dominant case is not a mystery: a fresh worktree has no `vendor/pi-main`, so the
 * step reports "nothing built yet; run --sync before --link". That is a MISSING
 * PREREQUISITE, not a broken install, and it must not read like an unexplained failure.
 */
function linkFailureReason(detail) {
	if (/nothing built yet/i.test(detail)) {
		return "vendor/pi-main is not built in this worktree, so there is nothing to link to (the step says: run --sync first)";
	}
	return detail.split("\n")[0]?.slice(0, 300) || "the link step failed";
}

/**
 * The seat-facing sentence for a provisioning record, or "" when there is nothing to say.
 *
 * This is the half that makes the defect non-silent (#3821): a worktree provisioned with a
 * FAILED link step must say so where the SEAT will see it — the tool result — not in a
 * `console.warn` on a stream nobody reads. It names the state, the version actually
 * resolved, and the consequence (verdicts from this tree are not comparable).
 */
export function dependencyNoteFor(dependency) {
	if (!dependency || dependency.state !== "unlinked") return "";
	const have = dependency.worktreeVersion
		? `${PINNED_PACKAGE} ${dependency.worktreeVersion} from the lockfile`
		: `whatever the lockfile pins for ${PINNED_PACKAGE}`;
	const want = dependency.sourceVersion
		? `, while the seat root resolves ${dependency.sourceVersion}`
		: "";
	return (
		`\nDEPENDENCY NOT LINKED in this worktree: the sync-pi --link step FAILED (${dependency.reason}). ` +
		`This tree resolves ${have}${want}. A suite run here is NOT comparable with the seat root's, so ` +
		`state which tree and dependency set a verdict came from; run \`node scripts/sync-pi.mjs --sync\` ` +
		`(then prepare the workspace again) if you need parity.`
	);
}

/**
 * Run `npm ci --prefer-offline` in a worktree to make it usable checkout.
 * Called after createWorktree/claimWorktree because a fresh worktree has no
 * node_modules (gitignored, not bridged).
 *
 * Skips if no package.json exists (throwaway repos).
 * Measured: ~12 s, ~111 MB per worktree. Fails loudly on error.
 *
 * Invokes npm through `resolveNpmInvocation` so the call works on every platform
 * without a shell (#822: a bare `execFile("npm", …)` is `spawn npm ENOENT` on
 * Windows). The failure message includes `err.message` as well as stderr, because
 * an ENOENT/EINVAL spawn failure has EMPTY stderr and the old message hid the cause.
 *
 * Pre-install: runs `node scripts/sync-pi.mjs --link` FIRST to point node_modules
 * at the built vendor/pi-main tree (the PINNED pi build). The pi packages
 * (@earendil-works/pi-agent-core, pi-durable, etc.) are not published to the npm
 * registry, so `npm ci` alone would ETARGET on them. The --link step installs
 * file: specifiers that resolve locally, allowing `npm ci` to succeed for the
 * remaining registry-resolvable deps (chord, pi-ai, get-east-asian-width, js-yaml).
 *
 * Post-install: runs `--link` again to ensure the file: packages are firmly in
 * place even if `npm ci` resolved a stale cached copy. The second pass is
 * idempotent — `npm install --no-save` overwrites with the same file: target.
 *
 * This ordering fixes the #2801/#2976 recurrence where `npm ci` ran before
 * --link and ETARGET-failed on unpublishable pi packages (#2412).
 */
export async function installWorktreeDeps(worktreePath, { source = null } = {}) {
	const pkgPath = join(worktreePath, "package.json");
	if (!existsSync(pkgPath)) {
		return { ok: true, skipped: true, worktree: worktreePath, dependency: null };
	}
	const { file, prefixArgs } = resolveNpmInvocation();

	// Pre-install: point node_modules at the built vendor/pi-main tree BEFORE
	// npm ci, so the unpublishable pi packages resolve from the local file:
	// specifiers instead of the npm registry (which does not host them).
	//
	// #3821: this step FAILS in every fresh worktree (no vendor/pi-main =>
	// "nothing built yet; run --sync before --link"), and the old code only
	// console.warned, so the worktree was silently provisioned with the locked
	// package. Provisioning still continues — a runnable tree beats none — but the
	// outcome is now RECORDED and reported to the caller, never downgraded to a
	// warning nobody reads.
	const preLink = await linkWorktreeDeps(worktreePath);

	let result;
	try {
		result = await run(file, [...prefixArgs, "ci", "--prefer-offline"], { cwd: worktreePath });
	} catch (err) {
		const detail = [err.message, err.stderr].filter(Boolean).join("\n").trim();
		throw new Error(
			`npm ci --prefer-offline failed in ${worktreePath}:\n${detail}`,
		);
	}

	// Post-install: run the link again to ensure the file: packages are firmly in
	// place even if `npm ci` resolved a stale cached copy. Idempotent when it works.
	const postLink = await linkWorktreeDeps(worktreePath);

	// The worktree counts as LINKED only if a link actually succeeded. `ok === null`
	// means there was no sync-pi script at all (nothing to link — not a failure).
	const link = postLink.attempted ? postLink : preLink;
	const state =
		link.ok === null ? "no-sync-script" : link.ok === true ? "linked" : "unlinked";
	const dependency = {
		state,
		packageName: PINNED_PACKAGE,
		reason: link.ok === true ? null : link.reason,
		worktreeVersion: installedVersion(worktreePath, PINNED_PACKAGE),
		sourceVersion: source ? installedVersion(source, PINNED_PACKAGE) : null,
	};
	return { ok: true, worktree: worktreePath, stdout: result.stdout.trim(), dependency };
}

/**
 * Add a detached worktree of the repository containing `source`, and make it usable.
 *
 * `source` is not only the repository to copy: its path inside the repository is reproduced in
 * the new worktree, so the returned `cwd` is the same relative place a seat would otherwise have
 * had, and a rig's declared `cwd` keeps meaning when the tree underneath it changes.
 */
export async function createWorktree({ source, target, ref = null, branch = null, carry = true }) {
	const root = await repoRoot(source);
	// `ref === null` means "no base was asked for" and is distinct from an explicit `HEAD`; the
	// distinction is what lets an existing item branch be re-attached without silently ignoring a
	// base the caller DID ask for (#3807).
	const explicitRef = ref !== null && ref !== undefined && ref !== "";
	const baseRef = explicitRef ? ref : "HEAD";
	if (existsSync(target)) {
		throw new Error(`refusing to reuse an existing path as a worktree: ${target}`);
	}
	// ASK F (#506): a concurrent team's shared tree is EXPECTED to be dirty — one
	// seat's in-flight edit or untracked demo used to block worktree creation for
	// EVERY seat (observed: "BROKER: worktree claim failed … M docs/NEXT.md"), so
	// isolation degraded to shared-tree editing, defeating #473's purpose. F23's
	// refusal is superseded by CARRY: fork HEAD, then carry the visible state in
	// and RETURN it. The anti-stale guarantee stays — the fork contains everything
	// the source visibly held (#240) — but the fork is no longer “a tree neither
	// git nor the operator tracks”: it is HEAD plus an enumerated, returned list.
	// #2360: CARRY is OPT-IN (`carry`, default true). The SEAT path
	// (claimWorktree/prepareSeatWorkspace) passes `carry: false`, so a seat's item worktree is a
	// CLEAN HEAD checkout. The old unconditional carry copied the shared tree's dirty state into
	// every fork, which made a completed item's worktree permanently un-removable (teardown is
	// clean-only, D60) while the shared tree was dirty — the CARRY/teardown collision.
	const dirty = await uncommittedInSource(source);
	// Attach the item's own BRANCH when asked — the P2 commit discipline expects
	// commits to land on `impl-item-N`, not a detached HEAD (#859). `-b` creates the
	// branch; an EXISTING branch is attached rather than reset, so a leftover item
	// branch that already carries commits is never silently rewound.
	const branchAttached = branch ? await branchExists(root, branch) : false;
	// #3807: `git worktree add <target> <branch>` checks out the EXISTING branch and IGNORES `ref`,
	// so a caller that asked to fork from a base got a tree at the branch's own tip while being told
	// "Forked from base ref X" — a false success about the one thing every verify depends on. When a
	// base was asked for and the branch already exists, HONOUR it or REFUSE: never hand back a tree
	// nobody asked for. (The reuse path has the same obligation and is reported, not re-forked.)
	if (branchAttached && explicitRef) {
		const want = await resolveRef(root, baseRef);
		const tip = await resolveRef(root, `refs/heads/${branch}`);
		if (want === "") {
			throw new Error(
				`refusing to create a worktree on branch ${branch}: you asked to fork from \`${showRef(baseRef)}\`, ` +
					`which does not resolve to a commit here. Nothing was created. Name a readable ref (branch, tag ` +
					`or commit), or drop the base to attach the existing branch at ${shortSha(tip)} as it is.`,
			);
		}
		if (want !== tip) {
			throw new Error(
				`refusing to create a worktree on branch ${branch}: the branch ALREADY EXISTS at ${shortSha(tip)} ` +
					`and you asked to fork from \`${showRef(baseRef)}\` (${shortSha(want)}). Attaching the existing branch would ` +
					`leave the worktree at ${shortSha(tip)} — not the base you asked for — so it is refused rather than ` +
					`silently ignored. Nothing was created. Drop the base to accept the branch as it is, prepare a ` +
					`different item, or land/delete ${branch} first.`,
			);
		}
	}
	const addArgs = branch
		? branchAttached
			? ["worktree", "add", target, branch]
			: ["worktree", "add", "-b", branch, target, baseRef]
		: ["worktree", "add", "--detach", target, baseRef];
	// IGNORE BEFORE CREATE (#2328): make the target git-ignored BEFORE `git worktree add`
	// so the new directory never leaks into the source repo's `git status` (the vendored
	// using-git-worktrees rule). A target outside the repo is a no-op.
	await ensureIgnored({ repo: root, target });
	await run("git", ["-C", root, ...addArgs]);
	const carried = carry && dirty.trim() !== "" ? await carryVisibleState({ source, target }) : [];

	const inside = relative(root, resolve(source));
	const cwd = inside === "" ? target : join(target, inside);

	// `node_modules` is gitignored, so a fresh worktree has none - and then `node demo/x.test.mjs`
	// cannot run there at all, which would make the worktree useless for the one thing seats do.
	// No junction: Git 2.42 on this host deletes THROUGH a junction, which would destroy the
	// live tree's node_modules (docs/DOGFOOD.md F8, #330). Instead the caller must install
	// dependencies independently: `npm ci --prefer-offline` (~12 s, ~111 MB) per worktree.
	// The worktree is unusable without this step — the seat that needs it should run the install
	// before working.

	// #4514 (decision (a)): THE CLI VERB'S JSON IS A CONTRACT, AND A CONTRACT WITH A HOLE LIES BY OMISSION.
	// Before this, a `--ref` worktree's record carried NONE of `base`/`requestedBase`/`baseHonoured`, so a
	// consumer reading the unified field set got `undefined` for every fork-point question — SILENTLY, because
	// a missing field reads as "not applicable" rather than "wrong path". `cli.mjs` SPREADS this object
	// straight into its JSON, so the absence was visible to anyone who asked the CLI what it had forked.
	// AND `explicitRef`/`baseRef` DO NOT BECOME THE PUBLIC SPELLING: they are INTERNAL LOCALS. `--ref` IS a
	// name for the base — the same fact the other two paths call `requestedBase` — so there is ONE vocabulary.
	// Nulls when no `ref` was asked for: a value nobody requested must not be invented (the same convention as
	// the REUSE path's `requestedBase === "" ? null : …`), while `base` is STILL reported — the fork point is
	// a fact either way.
	const forkPoint = await headSha(target);
	const askedBase = explicitRef ? await resolveRef(root, baseRef) : "";
	return {
		repo: root,
		worktree: resolve(target),
		cwd,
		carried,
		branch: branch ?? null,
		branchAttached,
		base: forkPoint,
		requestedBase: askedBase === "" ? null : askedBase,
		baseHonoured: askedBase === "" ? null : askedBase === forkPoint,
	};
}

/** Whether `refs/heads/<branch>` exists in the repo at `root`. */
async function branchExists(root, branch) {
	try {
		await run("git", ["-C", root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

/**
 * The sha `ref` resolves to in the repo at `path` ("" when it does not resolve). Used to answer "is
 * the tree at the base that was requested?" WITHOUT throwing on a ref the caller got wrong — the
 * refusal has to name the problem, not be a raw git error (#3807).
 */
async function resolveRef(path, ref) {
	if (!ref) return "";
	try {
		const { stdout } = await run("git", [
			"-C",
			path.replace(/\\/g, "/"),
			"rev-parse",
			"--verify",
			"--quiet",
			`${ref}^{commit}`,
		]);
		return stdout.trim();
	} catch {
		return "";
	}
}

/** Short sha for a message. A bare 40-hex token is redacted as secret-shaped (#3128), so a full sha
 * in a refusal would be swallowed out of the very message that has to say which commit it means. */
function shortSha(sha) {
	return typeof sha === "string" && sha !== "" ? sha.slice(0, 9) : "unknown";
}

/** How a caller-named base appears in a message: a branch/tag name verbatim, a bare hex sha SHORT
 * (the redactor eats 40/64-hex, #3128 — the same rule the workspace text follows). */
function showRef(ref) {
	return /^[0-9a-f]{40}$/i.test(ref) || /^[0-9a-f]{64}$/i.test(ref) ? shortSha(ref) : String(ref);
}

/**
 * Make a worktree sit on `branch`, creating/switching to it AT the current HEAD.
 * Used when an item worktree is REUSED (#859): a pre-existing worktree is often on
 * a detached HEAD (older runs, or a commit made before the branch existed), so a
 * resumed run must re-establish the branch without losing anything. `checkout -B`
 * resets only the BRANCH ref to HEAD; the working tree does not move, so both the
 * commits already made on the detached HEAD and any uncommitted work survive.
 * Returns what it did, for the tool message.
 */
async function ensureWorktreeBranch(worktreePath, branch) {
	const wtNorm = worktreePath.replace(/\\/g, "/");
	const current = await currentBranch(worktreePath);
	if (current === branch) return { action: "already-on-branch", branch };
	await run("git", ["-C", wtNorm, "checkout", "-B", branch]);
	return { action: current === "" ? "created-at-detached-head" : `switched-from-${current}`, branch };
}

/** The SHORT branch a worktree has checked out ("" when detached or unreadable). */
async function currentBranch(worktreePath) {
	try {
		return (await run("git", ["-C", worktreePath.replace(/\\/g, "/"), "branch", "--show-current"])).stdout.trim();
	} catch {
		return "";
	}
}

/** The full sha a worktree's HEAD points at ("" when unreadable). */
async function headSha(worktreePath) {
	try {
		return (await run("git", ["-C", worktreePath.replace(/\\/g, "/"), "rev-parse", "HEAD"])).stdout.trim();
	} catch {
		return "";
	}
}

/**
 * The sha `ref` resolves to inside `worktreePath` ("" when it does not resolve — a caller may name a
 * branch that does not exist there, and that must not throw). Used to answer "is the tree at the base
 * that was requested?" for a REUSED worktree (#3558).
 */
async function resolveCommit(worktreePath, ref) {
	if (!ref) return "";
	try {
		const { stdout } = await run("git", [
			"-C",
			worktreePath.replace(/\\/g, "/"),
			"rev-parse",
			"--verify",
			"--quiet",
			`${ref}^{commit}`,
		]);
		return stdout.trim();
	} catch {
		return "";
	}
}

/**
 * Free the BRANCH a worktree holds WITHOUT touching its files (#3174).
 *
 * `git switch --detach` is the LOSSLESS op the delegate applied by hand to unblock the
 * item-2103 landing (docs/incidents/2026-10-19-terminal-worktree-mistaken-for-lost-work.md,
 * RECURRENCE): the branch is released so it can be checked out elsewhere, while every tracked
 * file, every untracked file and the worktree's lock stay exactly where they are. `worktree
 * remove` is NOT a substitute — it refuses on untracked files and destroys scratch a seat may
 * still want.
 */
async function detachWorktreeBranch(worktreePath) {
	await run("git", ["-C", worktreePath.replace(/\\/g, "/"), "switch", "--detach"]);
	return { worktree: worktreePath, detached: true };
}

/**
 * Carry the visible (uncommitted) state of `source`'s subtree into a just-created
 * worktree, and report what moved (#506). Disk visibility decides the action:
 * a dirty path that exists on disk is copied (tracked edit, staged add, untracked
 * file - or an untracked directory, recursively); a dirty path absent on disk is
 * deleted in the fork too, so an uncommitted deletion stays a deletion instead of
 * resurrecting from HEAD. Reads the SHARED tree, writes only inside the NEW
 * worktree; the shared tree is never touched.
 *
 * `--porcelain -z` is parsed by \0-chunks with repo-root-relative paths (porcelain
 * v1), so the carried list uses the same path names `git status` shows the
 * operator. Rename pairs carry the new path and remove the old.
 */
export async function carryVisibleState({ source, target }) {
	if (!target) throw new Error("carryVisibleState needs `target` — the new worktree root (the write side)");
	const repo = await repoRoot(source);
	const worktree = resolve(target);
	const { stdout } = await run("git", ["-C", source, "status", "--porcelain", "-z", "--", "."]);
	if (!stdout) return [];
	const carried = [];
	// #998/#506: a LINKED worktree (the just-created target, or a sibling item worktree) shows
	// up in the source's status as an untracked directory, but it is not visible state to carry.
	// Copying the TARGET would place the destination inside its own source
	// (`cp(repo/item-2, repo/item-2/item-2)` -> ERR_FS_CP_EINVAL); copying a sibling copies a
	// whole foreign checkout (node_modules and all). Only the source's own state travels.
	const worktreeRoots = await linkedWorktreeRoots(source, repo, worktree);
	const chunks = stdout.split("\0").filter((c) => c !== "");
	for (let i = 0; i < chunks.length; i++) {
		let entry = chunks[i];
		if (!entry.includes(" ") && entry.length === 2) continue; // stray status chunk defence
		const status = entry.slice(0, 2);
		let path = entry.slice(3);
		if (status[0] === "R" || status[1] === "R") {
			const oldPath = chunks[++i] ?? ""; // -z rename: the OLD path is the next chunk
			if (oldPath && !existsSync(join(repo, oldPath))) {
				await rm(join(worktree, oldPath), { force: true, recursive: true });
			}
		}
		const srcPath = join(repo, path);
		if (worktreeRoots.some((root) => isWithin(srcPath, root))) continue; // #998: never carry a worktree into a worktree
		const dstPath = join(worktree, path);
		if (existsSync(srcPath)) {
			await mkdir(dirname(dstPath), { recursive: true });
			if (entry.endsWith("/") || (await stat(srcPath)).isDirectory()) {
				await cp(srcPath, dstPath, { recursive: true, force: true });
			} else {
				await copyFile(srcPath, dstPath);
			}
		} else {
			await rm(dstPath, { force: true, recursive: path.endsWith("/") });
		}
		carried.push(path);
	}
	return carried;
}

/**
 * Absolute roots of the repository's LINKED worktrees — every `git worktree list` entry
 * except the source's own root (the source's own tree must still be carried; only its
 * SIBLINGS and the new target are excluded). `target` is added explicitly because
 * `git worktree add` has already registered it by the time the carry runs.
 */
async function linkedWorktreeRoots(source, repo, target) {
	const { stdout } = await run("git", ["-C", source, "worktree", "list", "--porcelain"]);
	const roots = new Set([resolve(target)]);
	for (const line of stdout.split("\n")) {
		const match = /^worktree (.+)$/.exec(line.trim());
		if (!match) continue;
		const path = resolve(match[1]);
		if (path !== resolve(repo)) roots.add(path);
	}
	return [...roots];
}

/** Is `candidate` `root` itself, or a path inside it? (#998) */
function isWithin(candidate, root) {
	const rel = relative(resolve(root), resolve(candidate));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Uncommitted changes in `source` (its subtree of the repository), or "" when clean.
 *
 * Scoped with `-- .` from `source`, so the answer is about the tree being forked and not about
 * unrelated dirty paths elsewhere in a larger repository. Ignored paths (node_modules) do not
 * count as dirty, which is what keeps a forkable tree forkable.
 */
export async function uncommittedInSource(source) {
	try {
		const { stdout } = await run("git", ["-C", source, "status", "--porcelain", "--", "."]);
		return stdout;
	} catch (error) {
		// Not a git checkout (or git missing): there is no HEAD to fork from, so there is nothing
		// to guard and the caller will fail on the worktree add itself. Do not mask that here.
		return "";
	}
}

/**
 * Uncommitted WORK in `worktree`: modified tracked files and new files, minus the
 * regenerated dependency tree. `node_modules` is installed per worktree, so counting
 * it as work would refuse every legitimate cleanup; the D60 refusal is about a seat's
 * own changes, not its dependencies. A path git cannot read returns a sentinel so a
 * removal fails closed instead of falling through to `rm -rf`.
 */
async function uncommittedWork(worktree) {
	const wtNorm = worktree.replace(/\\/g, "/");
	let stdout;
	try {
		({ stdout } = await run("git", ["-C", wtNorm, "status", "--porcelain"]));
	} catch (error) {
		return [`<cannot read status: ${error.message}>`];
	}
	return stdout
		.split("\n")
		.filter((line) => line.trim() !== "")
		.filter((line) => !line.includes("node_modules/"));
}

/**
 * The COUNT of uncommitted paths in a worktree (node_modules excluded). The audit surface
 * reports this number; the D60 clean gate is the same predicate (`removeClaimedWorktree`).
 * A path git cannot read returns 1 (fail-closed), never a false "clean".
 */
export async function uncommittedCount(worktree) {
	return (await uncommittedWork(worktree)).length;
}

/**
 * Remove a worktree. 
 *
 * `force` is required rather than defaulted, because removing a worktree discards whatever is in
 * it: a caller has to say that is what it means. The default fails loudly instead of quietly
 * deleting work, which is the same reason the guard refuses `git reset --hard`.
 */
/**
 * Prune STALE worktree registrations (#2329).
 *
 * `git worktree remove` deletes the tree AND its registration, but a directory removed OUT OF
 * BAND (by a harness/viewer, or a crashed run) leaves the registration under `.git/worktrees/`
 * behind: `git worktree list` keeps listing it and `worktree audit` cannot classify a tree whose
 * path is gone. `git worktree prune` clears those, and the vendored
 * `finishing-a-development-branch` skill (Step 6) makes it a post-removal step — "one line,
 * prevents silent rot". Best-effort: a prune failure must never undo a successful removal.
 */
export async function pruneWorktrees(repoPath) {
	if (!repoPath) return { pruned: false, reason: "no-repo" };
	try {
		await run("git", ["-C", repoPath, "worktree", "prune"]);
		return { pruned: true, repo: repoPath };
	} catch (error) {
		console.warn(`worktree: prune in ${repoPath} failed: ${error.message}`);
		return { pruned: false, reason: error.message };
	}
}

export async function removeWorktree({ source, worktree, force = false }) {
	const root = await repoRoot(source);
	// No more junctions to unlink — the node_modules bridge was removed in #330.
	const args = ["-C", root, "worktree", "remove", ...(force ? ["--force"] : []), worktree];
	await run("git", args);
	// PRUNE AFTER REMOVE (#2329): clear any stale registration the removal may have left (or that
	// an out-of-band delete left) so `git worktree list` does not accumulate ghosts.
	await pruneWorktrees(root);
}

/**
 * The worktree holding `branch`, or null. STRICT on purpose: `listWorktrees` swallows a git
 * failure and returns `[]`, and a safety check that reads "nothing holds this ref" because git
 * itself failed is a SILENT failure — it would authorise the delete it exists to prevent.
 */
async function worktreeHoldingBranch(repoPath, branch) {
	let stdout;
	try {
		({ stdout } = await run("git", ["-C", repoPath, "worktree", "list", "--porcelain"]));
	} catch (error) {
		throw new Error(
			`cannot read the worktree list (${String(error.stderr ?? error.message ?? error).trim()}); refusing to delete a ref while the check that protects it could not run`,
		);
	}
	// Porcelain blocks are "worktree <path>" then "branch refs/heads/<name>"; `locked` and
	// `detached` are their OWN lines (branch-cleanup.md step 1 — a naive parse attributes a
	// `locked` line to the FOLLOWING tree).
	let current = null;
	for (const line of stdout.split("\n")) {
		if (line.startsWith("worktree ")) current = line.slice("worktree ".length).trim();
		else if (line.startsWith("branch ") && current) {
			if (line.slice("branch ".length).trim() === `refs/heads/${branch}`) return current;
		} else if (line.trim() === "") current = null;
	}
	return null;
}

/**
 * `worktree prune-branch <name>` (#3491): the ONE sanctioned place a SEAT may remove a ref.
 *
 * WHY THIS EXISTS. `git branch -d` correctly refuses a ref whose tip is not an ancestor of main,
 * and the seat guard refuses `git branch -D` (`src/confine.mjs` `branchForceDelete`, #1211). A
 * branch landed by REBASE is exactly that shape — its content is on main by PATCH, not by
 * ancestry — so before this verb no seat could clean one up and every cleanup pass escalated to
 * the operator (`docs/runbooks/branch-cleanup.md` step 3, run by hand on `designer-item-2103`).
 *
 * WHAT IT IS NOT. Not a wider force-delete grant: the guard is untouched, and this door is the
 * narrowest that admits the class. It removes a ref ONLY when BOTH hold, checked in this order:
 *   1. `git cherry <main> <branch>` prints AT LEAST ONE line and EVERY line starts with `-`
 *      (patch-equivalent). An ANCESTOR prints NOTHING — empty is NOT "all `-`", because vacuous
 *      truth would hand this verb every ref in the repo. An ancestor needs no force delete.
 *   2. no worktree holds the ref.
 * Everything else is REFUSED with a reason the caller can act on, and nothing is removed.
 *
 * R-B still governs: this removes a REF whose content is provably on main; it cancels no CLAIM.
 * The recovery command is printed on success because an unrecoverable delete is not recoverable
 * evidence — the sha stays reachable by that command (and by reflog) after the ref is gone.
 *
 * Returns { branch, sha, mainRef, patchEquivalent, recovery }.
 */
export async function prunePatchEquivalentBranch({ repoPath, branch, mainRef = "main" }) {
	const name = String(branch ?? "").trim().replace(/^refs\/heads\//, "");
	if (!name) throw new Error("a branch name is required, e.g. `worktree prune-branch designer-item-2103`");
	if (name === mainRef) throw new Error(`refusing to prune "${name}": it is the landing branch itself`);
	const root = await repoRoot(repoPath);

	// Condition 0 — it must be a LOCAL BRANCH. `--verify refs/heads/<name>` refuses a tag, a
	// remote-tracking ref and a bare sha, so this verb can never delete something that is not one.
	let sha;
	try {
		sha = (await run("git", ["-C", root, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`])).stdout.trim();
	} catch {
		sha = "";
	}
	if (!sha) throw new Error(`refusing to prune "${name}": not a local branch (no refs/heads/${name} in ${root})`);

	// Condition 1 — patch-equivalence, with the non-empty guard described above.
	let cherryOut;
	try {
		({ stdout: cherryOut } = await run("git", ["-C", root, "cherry", mainRef, name]));
	} catch (error) {
		throw new Error(
			`refusing to prune "${name}": cannot compare it with "${mainRef}" (${String(error.stderr ?? error.message ?? error).trim()})`,
		);
	}
	const lines = cherryOut
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length === 0) {
		throw new Error(
			`refusing to prune "${name}": it is already an ANCESTOR of "${mainRef}" (git cherry prints nothing), so it is not a patch-equivalent duplicate. Use \`git branch -d ${name}\` — that route is allowed and cannot lose work.`,
		);
	}
	const unlanded = lines.filter((l) => !l.startsWith("-"));
	if (unlanded.length > 0) {
		const shas = unlanded.map((l) => l.replace(/^\+\s*/, "")).join(", ");
		throw new Error(
			`refusing to prune "${name}": ${unlanded.length} of ${lines.length} commit(s) are NOT patch-equivalent to "${mainRef}" (unlanded: ${shas}). That work is not on main — land or rebase it first; this verb removes duplicates only.`,
		);
	}

	// Condition 2 — no worktree may hold the ref.
	const holder = await worktreeHoldingBranch(root, name);
	if (holder) {
		throw new Error(
			`refusing to prune "${name}": it is checked out in the worktree at ${holder}. Release that worktree first (docs/runbooks/leaked-worktrees.md); never delete a ref out from under a tree.`,
		);
	}

	// Both conditions hold. `-D` is required (git refuses `-d` for a non-ancestor) and is the
	// narrowest possible use of it: every commit is provably on main by patch.
	try {
		await run("git", ["-C", root, "branch", "-D", name]);
	} catch (error) {
		throw new Error(
			`git refused to delete "${name}" (${String(error.stderr ?? error.message ?? error).trim()}); the ref is unchanged`,
		);
	}
	const recovery = `git branch ${name} ${sha}`;
	return { branch: name, sha, mainRef, patchEquivalent: lines.length, recovery };
}

// unlinkModulesBridge removed in #330 — no more junctions to drop.

/* ================================================================ */
/*  P2-1: worktree-per-task lifecycle (claim → lock → release → remove)  */
/* ================================================================ */
import { readFile, writeFile, unlink, readdir } from "node:fs/promises";

/**
 * Validate that a worktree's git identity is correct — it resolves to itself,
 * its `.git` entry is a file (not a directory), and its private git dir is
 * under the common dir's `worktrees/` (not the common dir itself).
 *
 * Returns { ok: true } or throws with a descriptive message. This mirrors
 * Claude Code's worktree-identity validation: refuse directories whose git
 * metadata "resolves into the main checkout" (Claude Code docs).
 */
export async function validateWorktreeIdentity(worktreePath) {
	// Use forward slashes for -C on Windows.
	const wtNorm = worktreePath.replace(/\\/g, "/");
	const showToplevel = (await run("git", ["-C", wtNorm, "rev-parse", "--show-toplevel"])).stdout.trim().replace(/\\/g, "/");
	const absoluteGitDir = (await run("git", ["-C", wtNorm, "rev-parse", "--absolute-git-dir"])).stdout.trim().replace(/\\/g, "/");
	const gitCommonDir = (await run("git", ["-C", wtNorm, "rev-parse", "--git-common-dir"])).stdout.trim().replace(/\\/g, "/");

	const expectedToplevel = resolve(worktreePath).replace(/\\/g, "/");

	// 1. toplevel must be this worktree's own directory.
	if (showToplevel !== expectedToplevel) {
		throw new Error(
			`worktree identity violation: --show-toplevel (${showToplevel}) ` +
				`does not match expected (${expectedToplevel})`,
		);
	}
	// 2. private git dir must differ from common dir (not the main checkout).
	if (absoluteGitDir === gitCommonDir) {
		throw new Error(
			`worktree identity violation: --absolute-git-dir === --git-common-dir ` +
				`(${absoluteGitDir}) — the worktree resolves to the main checkout`,
		);
	}
	// 3. the .git entry must be a FILE, not a directory.
	const gitEntryPath = join(worktreePath, ".git");
	const stat = await import("node:fs/promises").then((m) => m.stat(gitEntryPath));
	if (stat.isDirectory()) {
		throw new Error(
			`worktree identity violation: .git is a directory (main checkout) at ${gitEntryPath}`,
		);
	}
	return { ok: true, showToplevel, absoluteGitDir, gitCommonDir };
}

/**
 * Create a worktree for a specific queue item, create a dedicated branch,
 * and hold a `git worktree lock` so concurrent cleanup cannot remove it
 * while the item is being processed.
 *
 * Returns the worktree metadata needed for later release/remove.
 *
 * `itemLabel` is used for the branch name (e.g. `wt/item-123`), kept short
 * to avoid MAX_PATH issues.
 */
export async function claimWorktree({ source, worktreeRoot, itemLabel, ref = null, branch = null }) {
	const target = join(worktreeRoot, itemLabel);
	if (existsSync(target)) {
		throw new Error(`worktree path already exists: ${target}`);
	}
	// #2360: the SEAT path forks HEAD-CLEAN (`carry: false`) so a completed item's worktree is
	// never born dirty with the shared tree's foreign WIP and CAN be torn down (teardown is
	// clean-only, D60). A direct caller can still opt into the anti-stale carry (#240).
	const result = await createWorktree({ source, target, ref, branch, carry: false });
	// Validate identity before returning — refuses if the worktree resolves
	// back to the main checkout through a redirect.
	await validateWorktreeIdentity(result.worktree);
	// Hold a lock so concurrent cleanup cannot remove this worktree.
	await run("git", ["-C", result.repo, "worktree", "lock", result.worktree]);
	// Install deps — a fresh worktree has no node_modules, so it is unusable
	// until dependencies are installed. npm ci --prefer-offline (~12 s, ~111 MB).
	// #3821: the install's own RECORD (were the pinned pi packages linked, or did the
	// tree fall back to the lockfile?) is returned instead of discarded.
	const deps = await installWorktreeDeps(result.worktree, { source });
	// Enable rerere so conflict resolutions are recorded for the merge-on-complete step.
	await enableRerere(result.worktree);
	return { ...result, itemLabel, locked: true, dependency: deps.dependency };
}

/**
 * Prepare the isolated worktree for one claimed item, idempotently.
 *
 * This is the seat-facing `prepare_workspace` core: it puts the worktree under
 * `worktreeRoot/item-<id>` (the deterministic path a later cleanup can recompute)
 * and returns the `cwd` the seat should adopt. An existing worktree is REUSED
 * rather than re-created, so a resumed run that calls the tool again does not pay
 * the `npm ci` cost twice, and a seat cannot accidentally nest a second worktree
 * inside the first (#506's recursive carry).
 *
 * `worktreeRoot` is the directory the seat is working from (durig's own tree, the
 * broker's process cwd); the worktree is placed beside it under the same repo.
 *
 * The worktree is put ON AN ITEM BRANCH (#859): `<seat>-item-<id>` (or `item-<id>`
 * when no seat is given), so a seat's commits land on a branch instead of a
 * detached HEAD and do not need hand-rolled branch creation. A REUSED worktree is
 * re-attached to that branch if it was detached, preserving any commits already
 * made there.
 */
/** The queue statuses that mean an item is finished either way. */
const TERMINAL_ITEM_STATUSES = new Set(["done", "cancelled"]);

/**
 * Is `status` a TERMINAL queue-item status (`done`/`cancelled`)? A missing or unrecognised
 * status is NOT terminal — `prepareSeatWorkspace` fails CLOSED, refusing to free a branch it
 * cannot prove is safe to reclaim (#3174).
 */
export function isTerminalItemStatus(status) {
	return typeof status === "string" && TERMINAL_ITEM_STATUSES.has(status);
}

/**
 * Is an existing item worktree ACTUALLY provisioned? A tree with no `package.json`
 * needs no install; one with a `package.json` is only provisioned once `node_modules`
 * exists (`npm ci` writes it — a zero-dependency package is the exception, and
 * re-installing that cheap case is harmless). `installWorktreeDeps` is the only
 * writer, so this is exactly the condition its success establishes.
 */
function isProvisioned(worktreePath) {
	if (!existsSync(join(worktreePath, "package.json"))) return true;
	return existsSync(join(worktreePath, "node_modules"));
}

export async function prepareSeatWorkspace({ source, worktreeRoot, itemId, seatName = null, ref = null, itemStatus = null }) {
	const repo = await repoRoot(source);
	const itemLabel = `item-${itemId}`;
	const worktreePath = join(worktreeRoot, itemLabel);
	// The item BRANCH the worktree commits to (#859): `<seat>-item-<id>` when the
	// seat is known (the convention the queue and the constitution name), else
	// `item-<id>`. The worktree no longer lands on a detached HEAD.
	const branch = seatName ? `${seatName}-${itemLabel}` : itemLabel;
	// The worktree reproduces the source's path inside the repo, so a rig that
	// declares no cwd still lands in the same relative place after the switch.
	const inside = relative(repo, resolve(worktreeRoot));
	const cwdFor = (worktree) => (inside === "" ? worktree : join(worktree, inside));

	// --- #3174: resolve WHO HOLDS the branch BEFORE any git mutation, and NEVER steal ---
	// `prepare_workspace` keys the worktree PATH by item but the BRANCH by seat, and on reuse it
	// used to run `git checkout -B <branch>` unconditionally. Two real consequences followed:
	// (1) a SECOND seat preparing the same item silently repurposed the first seat's worktree
	// (its working state was switched and its branch left unheld) — the #2412 identity guard
	// does not catch this, because that guard is about a leftover DIRECTORY that is not a
	// worktree at all, whereas this is a VALID worktree belonging to someone else; (2) nothing
	// asked who holds the BRANCH it needs, so a seat could not reach an item branch held by
	// another worktree (the item-2103 blockage) with no in-product move.
	//
	// The holder's item is the item named in the branch (the item ids agree: we are preparing
	// `item-<id>`). `itemStatus` is that item's queue status; when it is TERMINAL (done/cancelled)
	// the branch is free to reclaim by DETACHING the holder (lossless). When it is LIVE — or
	// unknown, because a caller that cannot vouch for liveness must fail CLOSED — the request is
	// REFUSED rather than allowed to steal. No `--force`, no branch deletion, no worktree removal.
	const terminal = isTerminalItemStatus(itemStatus);
	const detachedHolders = [];
	// #3821: the install record from a REPAIR on the reuse path (null when the existing
	// worktree was already provisioned and nothing was re-checked).
	let reusedDeps = null;
	const norm = (p) => resolve(p).replace(/\\/g, "/");
	const targetPath = norm(worktreePath);
	const refBranch = `refs/heads/${branch}`;
	const branchHolder = (await listWorktrees(repo, { strict: true })).find(
		(w) => (w.branch === branch || w.branch === refBranch) && norm(w.worktree) !== targetPath,
	);
	if (branchHolder) {
		if (!terminal) {
			throw new Error(
				`refusing to prepare item ${itemId}: branch ${branch} is checked out by another worktree ` +
					`${branchHolder.worktree} (holder item ${itemId}). Detaching it would free the branch, but that is ` +
					`safe only once the holder's item is TERMINAL (done/cancelled); it is not, so this is refused ` +
					`rather than stolen. Finish or cancel the holder's item first, or prepare a different item.`,
			);
		}
		await detachWorktreeBranch(branchHolder.worktree);
		detachedHolders.push(resolve(branchHolder.worktree));
	}

	if (existsSync(worktreePath)) {
		// A leftover directory at the item's path is not necessarily a WORKTREE. A first attempt can
		// create `item-<id>` and fail before the registration is usable, and a removed worktree can
		// leave its directory behind. Reusing it unvalidated made `ensureWorktreeBranch` run
		// `git checkout -B` against whatever repository the path resolved to; when the leftover sits
		// inside the shared tree with no `.git`, that switched the SHARED tree's branch and defeated
		// isolation (2026-10-19, devtools #2412 - docs/incidents/2026-10-17-seat-root-fallback-commit.md).
		// Validate identity BEFORE any git mutation and fail closed on a non-worktree.
		try {
			await validateWorktreeIdentity(worktreePath);
		} catch (identityErr) {
			throw new Error(
				`item ${itemId}'s workspace path is a leftover directory, not a registered git worktree: ` +
					`${worktreePath} (${identityErr?.message ?? identityErr}). Refusing to prepare a workspace ` +
					`there - remove the leftover directory or restore the worktree, then retry.`,
			);
		}
		// The reused PATH may itself sit on ANOTHER seat's branch (a valid worktree that a second
		// seat must not repurpose). Never `checkout -B` over it: detach it only when the item is
		// TERMINAL (lossless — every file stays), otherwise REFUSE and name the path and item.
		const current = await currentBranch(worktreePath);
		if (current !== "" && current !== branch) {
			if (!terminal) {
				throw new Error(
					`refusing to prepare item ${itemId}: ${worktreePath} is a valid worktree on branch ${current} ` +
						`(another seat's item branch, item ${itemId}). Switching it to ${branch} would silently steal that ` +
						`seat's working state. The holder's item must be TERMINAL (done/cancelled) first. Never steal, never force.`,
				);
			}
			await detachWorktreeBranch(worktreePath);
			detachedHolders.push(worktreePath);
		}
		// Reuse is only safe when the worktree is ACTUALLY provisioned. A first attempt can
		// create the `item-<id>` dir and then FAIL inside installWorktreeDeps, leaving a dir
		// with no `node_modules`; returning it as "provisioned" hands the seat a dep-less
		// worktree (#916 "poisoned-item-dir reuse"). Verify, and (re)install when missing, so
		// a retry REPAIRS the tree or FAILS LOUD rather than reporting a lie. (We repair in
		// place rather than deleting the dir: it is a real git worktree the seat may have
		// branched in, and the branch-naming lifecycle is #859/#995's concern.)
		if (!isProvisioned(worktreePath)) {
			reusedDeps = await installWorktreeDeps(worktreePath, { source });
		}
		// REUSE must still ensure the branch: a worktree from an older run (or one
		// whose seat committed before the branch existed) may be on a detached HEAD.
		const ensured = await ensureWorktreeBranch(worktreePath, branch);
		// #3558: REUSE never re-forks, so `ref` is IGNORED on this path — the worktree stays at
		// whatever commit it was on. Reporting only "reused" let a caller believe it was standing on
		// the base it asked for (auditor hit this on #3441 and worked around it rather than trust the
		// tree). So report the base the tree is ACTUALLY at, plus whether it matches the request:
		//   base        — the sha HEAD points at now
		//   requestedBase — what `ref` resolves to here (null when it does not resolve)
		//   baseHonoured — true/false, or null when the request could not be resolved
		const actualBase = await headSha(worktreePath);
		const requestedBase = await resolveCommit(worktreePath, ref);
		return {
			worktree: worktreePath,
			cwd: cwdFor(worktreePath),
			itemLabel,
			branch,
			branchAction: ensured.action,
			created: false,
			carried: [],
			locked: true,
			holderDetached: detachedHolders[0] ?? null,
			detachedHolders,
			// #3821: a repair install reports its own outcome; an ALREADY-provisioned
			// worktree was not re-checked here, so the state is UNKNOWN (null) rather than
			// assumed linked — an assumed "linked" is the false green this item is about.
			dependency: reusedDeps?.dependency ?? null,
			dependencyNote: dependencyNoteFor(reusedDeps?.dependency),
			// #3558/#3807 (main): what base this REUSE actually sits on. Both field sets are
			// kept because they answer different questions — `dependency*` is about the
			// install, `base*` is about the fork point — and the object is the unit of merge,
			// not the text.
			base: actualBase,
			requestedBase: requestedBase === "" ? null : requestedBase,
			baseHonoured: requestedBase === "" ? null : requestedBase === actualBase,
		};
	}
	const wt = await claimWorktree({ source, worktreeRoot, itemLabel, ref, branch });
	// A CREATED worktree did fork from `ref`, so its HEAD is the honoured base (#3558).
	const createdBase = await headSha(wt.worktree);
	return {
		worktree: wt.worktree,
		cwd: wt.cwd,
		itemLabel,
		branch,
		// #3807: "created" must mean the branch was CREATED from the base that was asked for. When an
		// existing item branch was attached instead, say so — the caller decides from this whether the
		// tree is the one it asked for.
		branchAction: wt.branchAttached ? "attached-existing" : "created",
		created: true,
		carried: wt.carried ?? [],
		locked: true,
		holderDetached: detachedHolders[0] ?? null,
		detachedHolders,
		// #3821: what the install actually achieved, and the sentence that tells the seat —
		// in the TOOL RESULT, not a warn on a stream nobody reads — that this tree's
		// dependency state is not the seat root's.
		dependency: wt.dependency ?? null,
		dependencyNote: dependencyNoteFor(wt.dependency),
		// #3807 (main): and the fork point, which is a different fact from the install.
		base: createdBase,
		requestedBase: createdBase === "" ? null : createdBase,
		baseHonoured: createdBase === "" ? null : true,
	};
}

/**
 * Remove the worktree `prepareSeatWorkspace`/`claimWorktree` created for `itemId`,
 * if it exists. Best-effort and idempotent: a missing worktree is a no-op, and a
 * worktree still holding uncommitted work is refused by `removeClaimedWorktree`
 * (a seat must commit or the operator must clean it — D60).
 */
export async function removeSeatWorkspace({ worktreeRoot, itemId, force = false, releaseIfRefused = false }) {
	const worktreePath = join(worktreeRoot, `item-${itemId}`);
	const result = await removeClaimedWorktree({ worktree: worktreePath, force });
	if (!result.removed && releaseIfRefused) {
		// LEAK SOURCE A (#1881 / ROADMAP 76). A dirty worktree is refused (D60, correct — never
		// discard uncommitted work), but leaving it LOCKED forever is the leak: 58 terminal items
		// still held a lock. RELEASE it, so the orphan sweep can reap the tree once it is clean and
		// the audit reports it as unlocked+dirty instead of hiding it behind a lock.
		try {
			await releaseWorktreeLock(worktreePath);
			result.released = true;
		} catch {
			// Already gone, or unlock failed; the sweep/audit will surface it either way.
		}
	}
	return result;
}

/**
 * Release the lock on a previously claimed worktree. After release the
 * worktree may be removed (it may contain changes). The lock prevents
 * concurrent `git worktree remove` from clobbering a worktree holding work.
 */
export async function releaseWorktreeLock(worktreePath) {
	// Use forward slashes for -C on Windows.
	const wtNorm = worktreePath.replace(/\\/g, "/");
	// Resolve repo root first to use for -C.
	let repoRoot;
	try {
		repoRoot = (await run("git", ["-C", wtNorm, "rev-parse", "--show-toplevel"])).stdout.trim();
	} catch {
		// Worktree already gone — nothing to unlock
		return { worktree: worktreePath, locked: false };
	}
	await run("git", ["-C", repoRoot, "worktree", "unlock", wtNorm]);
	return { worktree: worktreePath, locked: false };
}

/**
 * Remove a worktree that has been locked-released. Uses `git worktree remove`
 * (never `rm -rf`) to avoid stale `.git/worktrees/` metadata.
 *
 * Refuses when a junction/symlink/DirLink exists inside the worktree
 * (Git 2.42 on this host deletes THROUGH junctions, risking the main tree).
 */
export async function removeClaimedWorktree({ worktree, force = false }) {
	// If the worktree is already gone, nothing to do.
	if (!existsSync(worktree)) {
		return { worktree, removed: false, skipped: true };
	}
	// D60: never discard a seat's uncommitted work. Both removal paths below end in
	// `rm -rf` when git refuses a dirty tree, so a dirty worktree must be refused here,
	// before either runs. `force` is the caller explicitly accepting that loss.
	if (!force) {
		const work = await uncommittedWork(worktree);
		if (work.length > 0) {
			console.warn(`worktree: refusing to remove ${worktree}: ${work.length} uncommitted path(s)`);
			return { worktree, removed: false, refused: "dirty", dirty: work.length };
		}
	}
	// Unlock first if held — a locked worktree cannot be removed even with --force.
	// Read the .git pointer to find the repo root, then unlock from the repo root.
	try {
		const gitPointer = existsSync(join(worktree, ".git"))
			? readFileSync(join(worktree, ".git"), "utf8").trim()
			: "";
		const wtNormForUnlock = worktree.replace(/\\/g, "/");
		let repoRootUnlock;
		if (gitPointer.startsWith("gitdir: ")) {
			// gitdir points to <repo>/.git/worktrees/<name> — the repo is two levels up.
			const gitDir = gitPointer.slice(8).replace(/\\/g, "/");
			// gitDir is like /path/to/repo/.git/worktrees/item-1; split on /.git/ to get the repo root.
			const parts = gitDir.split("/.git/");
			repoRootUnlock = parts[0] ? parts[0].replace(/\\/g, "/") : resolve(gitDir).replace(/\\/g, "/").replace(/\\.git\//, "/");
		} else {
			// Fallback: try rev-parse from the worktree.
			repoRootUnlock = (await run("git", ["-C", wtNormForUnlock, "rev-parse", "--show-toplevel"])).stdout.trim().replace(/\\/g, "/");
		}
		await run("git", ["-C", repoRootUnlock, "worktree", "unlock", wtNormForUnlock]);
	} catch (err) {
		// A worktree that is not locked (or already gone) is removed anyway; report the
		// failure so a real unlock error is visible instead of silently swallowed.
		console.warn(`worktree: unlock of ${worktree} did not apply: ${err.message}`);
	}
	// Refuse when a junction/symlink exists inside the worktree.
	// Git 2.42 on this host deletes THROUGH junctions, risking the main tree.
	const entries = await readdir(worktree, { recursive: true, withFileTypes: true });
	for (const entry of entries) {
		if (entry.isSymbolicLink()) {
			throw new Error(
				`refusing to remove worktree ${worktree}: junction/symlink detected at ${entry.path}/${entry.name}`,
			);
		}
	}
	// Forward-slash paths for -C on Windows.
	const wtNorm = worktree.replace(/\\/g, "/");
	// The COMMON repo root that owns the worktree REGISTRATIONS. `git -C <worktree> rev-parse
	// --show-toplevel` returns the worktree's OWN root, which is gone after removal, so
	// `git worktree prune` must run against the common dir's parent (#2329).
	let commonRoot = null;
	try {
		const commonDir = (await run("git", ["-C", wtNorm, "rev-parse", "--git-common-dir"])).stdout.trim();
		commonRoot = dirname(isAbsolute(commonDir) ? commonDir : resolve(wtNorm, commonDir));
	} catch {
		// Fall through to the walk-up root below.
	}
	// Find the repo root by walking up from the worktree path.
	// A worktree's metadata lives in its source repo's .git/worktrees/<name>/,
	// so the first .git directory encountered walking up is the repo root.
	let repoRoot;
	try {
		repoRoot = (await run("git", ["-C", wtNorm, "rev-parse", "--show-toplevel"])).stdout.trim().replace(/\\/g, "/");
	} catch {
		// Try parent directories.
		const resolved = resolve(worktree).replace(/\\/g, "/");
		let candidate = resolved;
		const found = [];
		while (true) {
			const candidateGit = join(candidate, ".git");
			let isGitDir = false;
			try {
				const { stat } = await import("node:fs/promises");
				isGitDir = (await stat(candidateGit)).isDirectory();
			} catch (statErr) {
				// .git not present at this level — continue walking up.
				console.debug(`worktree: stat ${candidateGit} failed: ${statErr.message}`);
			}
			if (isGitDir) {
				try {
					const r = await run("git", ["-C", candidate, "rev-parse", "--show-toplevel"]);
					repoRoot = r.stdout.trim().replace(/\\/g, "/");
					found.push(candidate);
				} catch (err) {
					// Not a valid git dir — continue walking up to the next ancestor.
					console.error(`worktree: rev-parse failed for ${candidate}: ${err.message}`);
				}
			}
			const parent = resolved.split(/[\\/]/);
			parent.pop();
			if (parent.length === 0) break;
			candidate = parent.join(process.platform === "win32" ? "\\" : "/");
		}
		if (!repoRoot) {
			// Entirely gone — nothing to do
			return { worktree, removed: false, skipped: true };
		}
	}
	// Run from the repo root so git can still find the worktree metadata.
	const args = ["-C", repoRoot, "worktree", "remove", ...(force ? ["--force"] : []), wtNorm];
	try {
		await run("git", args);
	} catch (gitErr) {
		// On Windows `git worktree remove` can fail with permission errors
		// when file handles are still open (e.g., node_modules, editor locks).
		// The worktree may have been partially removed; report success if the
		// .git metadata is gone and fall through to the fallback cleanup.
		console.warn(`worktree: git worktree remove failed: ${gitErr.message}`);
	}
	// Clean up the .git pointer file that `git worktree remove` may leave behind.
	const gitFile = join(worktree, ".git");
	try {
		await unlink(gitFile);
	} catch (err) {
		// ENOENT is the expected case (`git worktree remove` already cleaned it up);
		// anything else is worth surfacing rather than swallowing. Cleanup continues below.
		if (err.code !== "ENOENT") console.warn(`worktree: could not unlink ${gitFile}: ${err.message}`);
	}
	// Final cleanup: if git left the directory behind, remove it.
	if (existsSync(worktree)) {
		try {
			await rm(worktree, { recursive: true, force: true });
		} catch (rmErr) {
			// On Windows the directory may still be locked briefly after git removes it.
			console.warn(`worktree: final rm of ${worktree} failed: ${rmErr.message}`);
		}
	}
	// PRUNE AFTER REMOVE (#2329): this is the single choke point for every teardown path
	// (removeWorktree, removeVerifyScratch/cleanVerifyScratch, and the broker sweep), so pruning
	// here clears the stale registration of any OTHER out-of-band-deleted tree at the same time.
	await pruneWorktrees(commonRoot ?? repoRoot);
	return { worktree, removed: true };
}

/**
 * Enable `git rerere` in a worktree so conflict resolutions are recorded and replayed.
 * Called during worktree creation or first use.
 */
export async function enableRerere(worktreePath) {
	const wtNorm = worktreePath.replace(/\\/g, "/");
	await run("git", ["-C", wtNorm, "config", "rerere.enabled", "true"]);
	return { worktree: worktreePath, rerereEnabled: true };
}

/**
 * Rebase the worktree's item branch onto a target branch (e.g. main).
 * The worktree must have a branch checked out (not detached).
 * Used during merge-on-complete integration.
 */
export async function rebaseItemBranch({ worktreePath, targetBranch }) {
	const wtNorm = worktreePath.replace(/\\/g, "/");
	// Verify this worktree has a branch (not detached HEAD).
	const branch = (await run("git", ["-C", wtNorm, "branch", "--show-current"])).stdout.trim();
	if (!branch) {
		throw new Error(`worktree ${worktreePath} has no branch (detached HEAD); cannot rebase`);
	}
	// Rebase onto the target branch.
	const result = await run("git", ["-C", wtNorm, "rebase", targetBranch]);
	return { worktree: worktreePath, branch, rebasedOnto: targetBranch, stdout: result.stdout.trim() };
}

/**
 * List existing worktrees for cleanup / audit. Returns an array of objects
 * with path, branch (null if detached), and locked status.
 *
 * #3605 — THE EMPTY LIST USED TO MEAN TWO THINGS: "no worktrees" and "could not determine
 * worktrees". The second reading is the PERMISSIVE one, so a git failure answered "nothing holds
 * this ref" — which is precisely the answer a safety check must not invent, because it AUTHORISES
 * the action the check exists to prevent (`prepareSeatWorkspace`'s branch-holder guard reads it as
 * "no other worktree holds this branch" and stops refusing).
 *
 * `strict` is how a caller STATES which reading it wants:
 *   - `strict: true`  — a caller that DECIDES on the result. A failure THROWS, because "unknown"
 *                       must never be mistakable for "empty".
 *   - default (false) — a caller that REPORTS. The lenient `[]` is kept because a path that is not
 *                       a git repository is a normal input for the audit surface (broker.mjs), but
 *                       the failure is no longer SILENT: anything that is not the expected
 *                       "not a git repository" case is written to stderr.
 *
 * Do not "fix" the default to fail-closed for every caller: the sweep and the audit legitimately
 * read a non-repo path, and a throw there would take down a reporting surface over an expected
 * input. The strict flag exists so the decision is made per call site, not globally.
 */
export async function listWorktrees(repoPath, { strict = false } = {}) {
	try {
		const { stdout } = await run("git", ["-C", repoPath, "worktree", "list", "--porcelain"]);
		const worktrees = [];
		let current = {};
		for (const line of stdout.split("\n")) {
			const [key, ...rest] = line.split(" ");
			const value = rest.join(" ");
			if (key === "worktree") current.worktree = value;
			if (key === "branch") current.branch = value || null;
			if (key === "locked") current.locked = true;
			if (line === "" && current.worktree) {
				// Normalize the DEFAULTS FIRST and let the parsed values override them: the old
				// `{ ...current, locked: false }` put the default LAST, so a `locked` line parsed
				// from `git worktree list` was always overwritten and NO caller could ever see a
				// locked worktree (#1194 — which is how the orphan sweep reaped one).
				worktrees.push({ branch: null, locked: false, ...current });
				current = {};
			}
		}
		if (current.worktree) worktrees.push({ branch: null, locked: false, ...current });
		return worktrees;
	} catch (err) {
		const detail = String(err?.stderr ?? err?.message ?? err).trim();
		if (strict) {
			throw new Error(
				`could not list worktrees for ${repoPath} — refusing to answer "none" when the truth is ` +
					`"unknown" (pass { strict: false } only for a caller that REPORTS rather than decides): ${detail}`,
			);
		}
		// An unexpected failure is loud; the documented non-repo case stays quiet so the audit and the
		// sweep do not fill the broker log with an expected input.
		if (!/not a git repository/i.test(detail)) {
			console.error(`worktree: could not list worktrees for ${repoPath}: ${detail}`);
		}
		return [];
	}
}
