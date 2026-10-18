// confine.mjs — the M3 boundary: a confining ExecutionEnv (security conditions SC1-SC3).
//
// Why the ENVIRONMENT and not the tools. `read`, `write` and `edit` accept absolute paths by
// design and resolve them through `env.absolutePath`, which is plain `resolvePath(this.cwd, path)`
// with no confinement at all (pi-durable env/node.ts:644) - and they never pass through bash's
// `prepare` hook, which only ever sees one shell command (bash.ts:33-36). So the environment is
// the single seam that covers bash AND the file tools, and the only place a verifier's read-only
// can hold while it also holds a shell: omitting the `write`/`edit` tools does not remove the
// write CAPABILITY, because PowerShell can write whatever the OS user can. See
// docs/reviews/security-sec-m3-seat-tools.md (F2, F3) and docs/SEAT-TOOLS.md (SC1-SC3).

import { mkdtemp, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ExecutionError, FileError, err, ok } from "@earendil-works/pi-durable/env";

/**
 * Commands a seat may never run, whatever else it is allowed.
 *
 * This is a NARROWING layer, not the boundary. A string check against a shell is unsound by
 * nature - PowerShell defeats any allowlist through aliases, `-EncodedCommand` and piped
 * subcommands - which is why the boundary is the path confinement below, and this list only
 * removes the escape hatches that would leave it entirely. WSL and Docker are unsupported on
 * this host by policy; the destructive git forms are refused because they discard exactly the
 * work the worktree boundary exists to protect.
 *
 * `unless` is the one exemption mechanism, and it may only consult durig's OWN process
 * environment. That is deliberate: every in-repo channel is seat-forgeable (D-ENV-AUTH - one OS
 * user, and a seat can write files), so a grant stored in the rig, the store or a config file
 * would be a grant the seat could write for itself. A seat's command environment is the
 * allowlist-filtered set from `pickEnv`, and an inline assignment inside its own command affects
 * only that child process - never this one - so reading `process.env` here is the only gate a
 * seat cannot reach.
 */
/**
 * A bounded shell tokenizer: split a command into per-segment token lists, honouring
 * single/double quotes and treating `;`, `&`, `|`, `(`, `)` and newlines as segment
 * separators. Quoted content becomes part of a token and is NEVER re-read as a command,
 * which is what stops a quoted commit message from being mistaken for an invocation
 * (#1211). Perfect shell parsing is out of scope; this is enough to place the git
 * subcommand at the command position.
 */
function shellSegments(text) {
	const segments = [];
	let tokens = [];
	let cur = "";
	let quote = null;
	const flush = () => {
		if (cur !== "") {
			tokens.push(cur);
			cur = "";
		}
	};
	const end = () => {
		flush();
		if (tokens.length > 0) segments.push(tokens);
		tokens = [];
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote !== null) {
			if (ch === quote) {
				quote = null;
				continue;
			}
			if (quote === '"' && ch === "\\" && i + 1 < text.length) {
				cur += text[++i];
				continue;
			}
			cur += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === "\\" && i + 1 < text.length) {
			cur += text[++i];
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "&" || ch === "\n" || ch === "(" || ch === ")") {
			end();
			continue;
		}
		if (ch === " " || ch === "\t" || ch === "\r") {
			flush();
			continue;
		}
		cur += ch;
	}
	end();
	return segments;
}

/**
 * The git subcommand and its arguments, skipping git's global options (and the value an
 * option like `-C <path>` consumes) so `git -C x branch -D` reads as `branch`.
 */
function gitSubcommand(args) {
	const VALUE_GLOBALS = new Set([
		"-C",
		"-c",
		"--git-dir",
		"--work-tree",
		"--namespace",
		"--exec-path",
		"--config-env",
	]);
	let i = 0;
	while (i < args.length) {
		const t = args[i];
		if (VALUE_GLOBALS.has(t)) {
			i += 2;
			continue;
		}
		if (t.startsWith("-")) {
			i += 1;
			continue;
		}
		break;
	}
	return { sub: args[i], rest: args.slice(i + 1) };
}

/**
 * True when the command FORCE-deletes a branch: `git branch -D …`, or a delete flag
 * (`-d`/`--delete`) combined with `-f`/`--force`. Branch CREATE (`git branch <name> <sha>`),
 * RENAME (`-m`) and SAFE DELETE (`git branch -d`, which git refuses for an unmerged branch)
 * are ref-ops that do not touch the working tree, so they are allowed (#1211). The match is
 * anchored at the COMMAND position and skips quoted content, so a commit message containing
 * the literal text is not mistaken for an invocation.
 */
function branchForceDelete(text) {
	for (const tokens of shellSegments(text)) {
		const head = tokens[0]?.toLowerCase();
		if (head !== "git" && head !== "git.exe") continue;
		const { sub, rest } = gitSubcommand(tokens.slice(1));
		if (sub !== "branch") continue;
		let del = false;
		let force = false;
		for (const t of rest) {
			if (t === "--delete") {
				del = true;
				continue;
			}
			if (t === "--force") {
				force = true;
				continue;
			}
			if (t.startsWith("--")) continue;
			if (t.startsWith("-") && t.length > 1) {
				const flags = t.slice(1);
				if (flags.includes("D")) {
					del = true;
					force = true;
				}
				if (flags.includes("d")) del = true;
				if (flags.includes("f")) force = true;
			}
		}
		if (del && force) return true;
	}
	return false;
}

const DENIED_COMMANDS = [
	{ re: /(^|[\s;&|"'()])wsl(\.exe)?([\s"'()]|$)/i, why: "WSL is unsupported on this host" },
	{ re: /(^|[\s;&|"'()])docker(-compose)?(\.exe)?([\s"'()]|$)/i, why: "Docker is unsupported on this host" },
	// State-mutating git the operator controls: a seat produces files in its worktree and the
	// operator integrates them. A seat may commit its own work (scoped to its item) but cannot
	// reset, re-checkout, switch, stash, clean, revert, or force-delete branches — those diverge the
	// tree. `git switch` is the modern `git checkout` (it moves HEAD and rewrites the working tree,
	// `-c` also creates a branch), so it is refused in the same class.
	// Branch ref-ops that do NOT touch the working tree (create/rename/`-d`) are allowed; only
	// the FORCE delete (`-D`, or a delete flag with `--force`) stays blocked (#1211).
	// Read-only git (status/log/diff/show/rev-parse) is deliberately NOT matched.
	// Bypass prevention: each pattern ends in \b (word boundary) or an explicit separator
	// class so trailing punctuation (git stash;) or separators (&&, |) cannot defeat the
	// match — the whole class of bug that caused a seat to wipe the shared tree (RD #257).
	// The -C <path> forms cover the case where a seat tries to redirect git into another
	// checkout; refuse them the same way (RD #257).
	{ re: /git\s+reset\b/i, why: "would restage or discard work a seat did not integrate" },
	{ re: /git\s+checkout\b/i, why: "would change the seat's working tree or HEAD" },
	{ re: /git\s+switch\b/i, why: "would change the seat's working tree or HEAD (`switch` is the modern `checkout`)" },
	{ re: /git\s+restore\b/i, why: "would discard uncommitted work" },
	{ re: /git\s+revert\b/i, why: "would rewrite committed work" },
	{ re: /git\s+clean\b/i, why: "would discard untracked work" },
	{ re: /git\s+stash\b/i, why: "would move uncommitted work out of the tree" },
	{
		check: branchForceDelete,
		why: "would force-delete a branch (`-D`/`--force`) — the safe `git branch -d` and branch create/rename are allowed",
	},
	// Unscoped staging would sweep up files outside the current item — in a shared tree
	// this includes other seats' and the operator's uncommitted work. Even in an item's
	// worktree, `git add -A` can accidentally stage scratch or temp files. Stage only
	// the explicit paths you changed.
	{ re: /git\s+add\s+-A\b/i, why: "unscoped staging: stage only the explicit paths you changed, never git add -A or git add ." },
	{ re: /git\s+add\s+\.(?:$|[\s;&|"'()])/i, why: "unscoped staging: stage only the explicit paths you changed, never git add -A or git add ." },
	{
		re: /git\s+push\b/i,
		why: "publishing needs the operator's authorization; ask with defer_work, or have the operator relaunch durig with DURIG_ALLOW_PUSH=1",
		unless: () => operatorGranted("DURIG_ALLOW_PUSH"),
	},
	// git -C <path> <verb> redirects the git operation to another directory. Even when
	// the target looks "safe," the seat cannot verify that it is the right directory
	// (a redirecting seat cannot validate git identity; that is the operator's job).

	{ re: /git\s+-C\s+\S+\s+reset\b/i, why: "same as `git reset` — discards or restages work" },
	{ re: /git\s+-C\s+\S+\s+checkout\b/i, why: "same as `git checkout` — changes the working tree" },
	{ re: /git\s+-C\s+\S+\s+switch\b/i, why: "same as `git switch` — changes the working tree" },
	{ re: /git\s+-C\s+\S+\s+restore\b/i, why: "same as `git restore` — discards uncommitted work" },
	{ re: /git\s+-C\s+\S+\s+revert\b/i, why: "same as `git revert` — rewrites committed work" },
	{ re: /git\s+-C\s+\S+\s+clean\b/i, why: "same as `git clean` — discards untracked work" },
	{ re: /git\s+-C\s+\S+\s+stash\b/i, why: "same as `git stash` — moves uncommitted work out of the tree" },

	// Unscoped staging redirected to another directory.
	{ re: /git\s+-C\s+\S+\s+add\s+-A\b/i, why: "unscoped staging redirected" },
	{ re: /git\s+-C\s+\S+\s+add\s+\.(?:$|[\s;&|"'()])/i, why: "unscoped staging redirected" },
	{ re: /git\s+-C\s+\S+\s+push\b/i, why: "same as `git push` — needs operator authorization" },
];

/** True only when the operator set this in durig's own environment, which a seat cannot reach. */
function operatorGranted(name) {
	return process.env[name] === "1";
}

/**
 * Environment a seat's command may see.
 *
 * `inheritEnv: false` alone is not enough: a caller can hand its own map, so the allowlist is
 * what makes "the seat's environment" a closed set rather than whatever was last requested. The
 * list is the minimum a command needs to resolve an executable and write its own scratch, and
 * nothing else - anything secret-shaped is refused even if a caller asks for it by name.
 */
const ENV_ALLOWLIST = [
	"PATH",
	"PATHEXT",
	"SystemRoot",
	"SystemDrive",
	"ComSpec",
	"TEMP",
	"TMP",
	"HOME",
	"USERPROFILE",
	"LANG",
	"LC_ALL",
	"TERM",
];

/** A name that looks like a credential never crosses, whatever allowlist was configured. */
const SECRET_NAME = /(key|token|secret|password|passwd|credential|cookie|authorization)/i;

function pickEnv(requested, allowlist) {
	const kept = {};
	// `inheritEnv` is forced false, so the allowlisted baseline has to be supplied here or a
	// command could not resolve an executable at all. The allowlist is exactly the selection from
	// durig's own environment that a seat is permitted to see.
	for (const name of allowlist) {
		const value = process.env[name];
		if (value !== undefined && !SECRET_NAME.test(name)) kept[name] = value;
	}
	for (const [name, value] of Object.entries(requested ?? {})) {
		if (SECRET_NAME.test(name)) continue;
		if (allowlist.length > 0 && !allowlist.includes(name)) continue;
		kept[name] = value;
	}
	return kept;
}

/** The refusal a seat sees, phrased so it can act on it rather than retry blindly. */
function refusalFor(command) {
	const text = Array.isArray(command) ? command.join(" ") : String(command);
	for (const { re, why, unless, check } of DENIED_COMMANDS) {
		if (!(check ? check(text) : re.test(text))) continue;
		if (unless?.() === true) continue;
		return `refused by durig: ${why} — to test without your change, run the test RED BEFORE the fix, or use a throwaway detached worktree / temp copy (never revert the shared tree)`;
	}
	return null;
}

/**
 * Is `target` inside `root`?
 *
 * `relative` is the check rather than a string prefix, because a prefix test accepts siblings
 * that merely share a name (`/work/x` vs `/work/xy`) and mishandles the separator on Windows.
 */
export function isInside(root, target) {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Wrap `base` so every filesystem path it touches resolves inside `root`, and (with
 * `readOnly`) so no mutation is possible through it.
 *
 * The methods are wrapped from one table rather than hand-written one by one, so a member that
 * takes a path cannot be added to the environment without appearing in `PATH_METHODS` - a
 * hand-maintained list of 25 wrappers is exactly where a hole would go unnoticed.
 */
export function confinedEnv(base, { root, readOnly = false, envAllowlist = ENV_ALLOWLIST, readOnlyRoots = [] } = {}) {
	const confinedRoot = resolve(root ?? base.cwd);
	const allowlist = envAllowlist;
	// #1465: directories the seat may READ but never write, even though they sit outside its
	// worktree. The one caller passes the shared `.durig/` — where `claim_work` writes an
	// over-threshold item body — so a seat that has since run `prepare_workspace` (which narrows its
	// root) can still read the body it was handed. READ ONLY is the whole point: a seat must never
	// write the shared queue (the scratch rule, #1458).
	const extraReadRoots = readOnlyRoots.map((r) => resolve(r));
	/** Inside the worktree, or inside a read-only root when this call is not a mutation. */
	const within = (candidate, mutating) =>
		isInside(confinedRoot, candidate) || (!mutating && extraReadRoots.some((r) => isInside(r, candidate)));

	const denied = (what, target, why) =>
		err(new FileError("permission_denied", `refused by durig: ${what} ${target} ${why}`, target));

	/**
	 * Resolve `p` exactly as the base environment would - so `~`, `file://` and absolute paths
	 * behave as the tools expect - and then require the result to be under the root.
	 */
	const check = async (p, context, mutating = false) => {
		const resolved = await base.absolutePath(p, context);
		if (!resolved.ok) return resolved;
		if (!within(resolved.value, mutating)) {
			return denied("path", resolved.value, `is outside the seat's worktree (${confinedRoot})`);
		}
		// A link inside the root can still point outside it, and the base FOLLOWS links. Canonicalise
		// the path when it exists; when it does NOT (a CREATE), canonicalise the DEEPEST EXISTING
		// ANCESTOR instead. Without that, `canonicalPath` fails with ENOENT for a not-yet-existing
		// destination, the deny below is skipped, and the base writes THROUGH a junction in the
		// worktree into a read-only root or the shared tree (qa #1489 — HIGH; a junction needs no
		// admin on this host). The loop cannot fail open: the resolved path is inside the root and the
		// root exists, so some ancestor always canonicalises.
		let probe = resolved.value;
		let canonical = await base.canonicalPath(probe, context);
		while (!canonical.ok) {
			const parent = dirname(probe);
			if (parent === probe) break;
			probe = parent;
			canonical = await base.canonicalPath(probe, context);
		}
		if (canonical.ok && !within(canonical.value, mutating)) {
			return denied("symlink", canonical.value, `escapes the seat's worktree (${confinedRoot})`);
		}
		return resolved;
	};

	/** Run `fn` only after every path argument it takes has been confined. */
	const withPaths = (fn, pathIndexes, contextIndex, mutating = false) =>
		async (...args) => {
			const context = args[contextIndex];
			const confined = [...args];
			for (const index of pathIndexes) {
				const checked = await check(args[index], context, mutating);
				if (!checked.ok) return checked;
				confined[index] = checked.value;
			}
			return fn.apply(base, confined);
		};

	/** Refuse before touching `base`, so a read-only environment cannot mutate even by accident. */
	const readOnlyGuard = () =>
		async (...args) => denied("write", String(args[0]), "(this seat's environment is read-only)");

	// name -> [indexes of path arguments, index of the context argument]
	const PATH_METHODS = {
		// `absolutePath` is the primitive every other resolution goes through, so it is confined
		// here and not delegated: an unconfined absolute path escaping this method is precisely the
		// F2 hole the security position found.
		absolutePath: [[0], 1],
		canonicalPath: [[0], 1],
		readTextFile: [[0], 1],
		openTextLineReader: [[0], 1],
		readTextLines: [[0], 2],
		readBinaryFile: [[0], 1],
		openBinaryReader: [[0], 2],
		fileInfo: [[0], 1],
		listDir: [[0], 1],
		openDirReader: [[0], 1],
		exists: [[0], 1],
		writeFile: [[0], 2],
		appendFile: [[0], 2],
		truncateFile: [[0], 2],
		flushFile: [[0], 1],
		renameFile: [[0, 1], 2],
		createDir: [[0], 2],
		remove: [[0], 2],
	};

	const MUTATING = new Set([
		"writeFile",
		"appendFile",
		"truncateFile",
		"flushFile",
		"renameFile",
		"createDir",
		"remove",
	]);

	const wrapper = {
		// Identity and `cwd` pass through: `cwd` is the base's, and every path is resolved
		// against the root regardless of what it says, so a changed cwd cannot widen the boundary.
		get id() {
			return base.id;
		},
		get cwd() {
			return base.cwd;
		},
		set cwd(value) {
			base.cwd = value;
		},

		// `joinPath` touches nothing; confining is the resolve step, not the join.
		joinPath: (...args) => base.joinPath(...args),

		/**
		 * The base creates temp entries in the operating system's temp directory, which is
		 * outside any worktree by definition, so temp creation is reimplemented here instead of
		 * delegated - a seat's scratch space has to live inside the boundary it is confined to.
		 */
		createTempDir: async (prefix, _context) => {
			if (readOnly) return denied("write", "(temp dir)", "(this seat's environment is read-only)");
			try {
				return ok(await mkdtemp(join(confinedRoot, `${prefix ?? "durig"}-`)));
			} catch (cause) {
				return err(new FileError("unknown", `cannot create a temp dir inside ${confinedRoot}`, confinedRoot, cause));
			}
		},
		createTempFile: async (options, _context) => {
			if (readOnly) return denied("write", "(temp file)", "(this seat's environment is read-only)");
			try {
				const directory = await mkdtemp(join(confinedRoot, `${options?.prefix ?? "durig"}-`));
				const file = join(directory, `tmp${options?.suffix ?? ""}`);
				await writeFile(file, "");
				return ok(file);
			} catch (cause) {
				return err(new FileError("unknown", `cannot create a temp file inside ${confinedRoot}`, confinedRoot, cause));
			}
		},

		watch: async (targets, onChange, context) => {
			const confined = [];
			for (const target of targets) {
				const checked = await check(target.path, context);
				if (!checked.ok) return checked;
				confined.push({ ...target, path: checked.value });
			}
			return base.watch(confined, onChange, context);
		},

		cleanup: (...args) => base.cleanup(...args),

		/**
		 * A command that leaves the boundary is refused before it is spawned. It reports the
		 * `spawn_error` code because that is literally what happened - nothing started - and
		 * there is no `denied` code in `ExecutionErrorCode`; the message names the policy so the
		 * seat can `defer_work` on it instead of retrying variants.
		 */
		exec: async (command, options, context) => {
			const refusal = refusalFor(command);
			if (refusal) return err(new ExecutionError("spawn_error", refusal));
			// A read-only seat may still RUN things - that is how a verifier reproduces a claim -
			// but it must not write, so its cwd is pinned to the root and its environment is
			// stripped (SC3). Its copy of the work is disposable, which is what makes the
			// read-only claim true without an OS-level sandbox.
			// `inheritEnv: false` stops the process environment from reaching the command; the
			// allowlist stops a caller from re-supplying one. A caller that asks for `inheritEnv: true`
			// is overridden deliberately - "the seat asked for the key" is not a reason to hand it over
			// (SC3: an explicit allowlist, applied at the environment layer).
			return base.exec(
				command,
				{ ...options, cwd: confinedRoot, inheritEnv: false, env: pickEnv(options?.env, allowlist) },
				context,
			);
		},
	};

	for (const [name, [pathIndexes, contextIndex]] of Object.entries(PATH_METHODS)) {
		const fn = base[name];
		if (typeof fn !== "function") continue;
		wrapper[name] = readOnly && MUTATING.has(name)
			? readOnlyGuard()
			: withPaths(fn, pathIndexes, contextIndex, MUTATING.has(name));
	}

	return wrapper;
}

/**
 * The author's environment: confined to one worktree, and able to write inside it.
 *
 * `inheritEnv` is forced false by `exec` above, so the provider key in durig's own process
 * environment never reaches a seat's command (the `inheritEnv: true` default at bash.ts:76 is
 * exactly the leak SC3 exists to close).
 */
export function authorEnv(base, root, { readOnlyRoots = [] } = {}) {
	return confinedEnv(base, { root, readOnly: false, readOnlyRoots });
}

/**
 * The verifier's environment: confined to a DISPOSABLE COPY of the worktree, and unable to
 * mutate through the file API.
 *
 * This is SC2 resolved by filesystem semantics rather than by OS identity. A verifier needs to
 * run the suite - that is what makes its verdict independent - but a shell cannot be made
 * read-only (writes are arbitrary), so instead the verifier works on a snapshot: whatever it
 * writes lands in the throwaway copy and is discarded. It therefore cannot alter the artifact it
 * is verifying, which is the property that was actually wanted.
 */
export function verifierEnv(base, snapshotRoot, { readOnlyRoots = [] } = {}) {
	return confinedEnv(base, { root: snapshotRoot, readOnly: true, readOnlyRoots });
}

/**
 * Exported so the guard (`src/seatguard.mjs`) refuses the same commands the environment does:
 * one policy list, because two lists would drift and the drift would be a hole.
 */
export { refusalFor };

