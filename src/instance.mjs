// src/instance.mjs — instance identity for the OS namespace (ROADMAP 91,
// docs/BROKER-SUPERVISION.md §8, "Instance identity — one store ⇔ one driver ⇔ one
// instance key").
//
// The invariant: ONE STORE ⇔ ONE DRIVER ⇔ ONE INSTANCE KEY. Every OS-level artifact
// the host installs (trigger, Job Object / process-group name, log path, lock) is
// scoped by ONE key DERIVED from the store's canonicalized absolute path — so two
// durig instances on one machine never share a name, and a second driver on the SAME
// store is refused automatically (two processes opening the same store compute the
// same key, with no user cooperation).
//
// `--instance <name>` is a HUMAN LABEL ONLY; it never changes the derived key. The
// highest-risk detail is canonicalization: two spellings of ONE store
// (`C:\DB\RIG.sqlite`, `c:\db\rig.sqlite`, `C:\DB\RIG~1.SQL`) MUST yield ONE key, or
// they would derive two keys → two drivers → the wrong-rig class (#491, D18).

import { closeSync, openSync, realpathSync, unlinkSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * The store path canonicalized for IDENTITY: an absolute path with junctions and
 * symlinks resolved (`realpathSync.native`, which on Windows also expands an 8.3
 * short name to its long form), forward-slash separators, and — on Windows, where
 * the filesystem is case-insensitive — a lower-case fold. Two spellings of one store
 * therefore canonicalize to the SAME string.
 *
 * A store that does not exist yet cannot be realpath'd; identity must still be
 * computable, so the textual absolute path is the fallback (it cannot resolve a
 * junction or an 8.3 name, but it is the best answer for a path not on disk). The
 * case fold is Windows-only on purpose: POSIX is case-sensitive, so folding there
 * would collide two genuinely different stores.
 */
export function canonicalStorePath(storePath) {
	if (typeof storePath !== "string" || storePath.trim() === "") {
		throw new TypeError("canonicalStorePath needs a non-empty store path");
	}
	const absolute = resolve(storePath);
	let real = absolute;
	try {
		real = realpathSync.native(absolute);
	} catch {
		// Not on disk yet (or unresolvable): fall back to the resolved absolute text.
	}
	const slashed = real.replace(/\\/g, "/");
	return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

/**
 * The instance key: a short, filesystem- and case-insensitive-safe hex token derived
 * from the canonical store path. Same canonical store ⇒ same token; different stores
 * ⇒ different tokens. Safe to embed in a Task/label/unit/Job-Object/log/socket name.
 */
export function instanceKey(storePath) {
	return createHash("sha256").update(canonicalStorePath(storePath)).digest("hex").slice(0, 12);
}

/**
 * The store-scoped single-instance lock path. Because the path is derived from the
 * store, the lock is PER INSTANCE by construction (never a global lock): two different
 * stores get two locks, and two spellings of one store get the SAME lock.
 */
export function hostLockPath(storePath) {
	return `${canonicalStorePath(storePath)}.host.lock`;
}

/**
 * The instance's identity as a value: the derived `key`, the optional human `label`
 * (`--instance`, which never affects the key), the resolved `store`, and the
 * per-instance `lock` path. The host adapters (item 64) consume `key` for the trigger
 * / Job Object / log names.
 */
export function instanceIdentity(storePath, { label = null } = {}) {
	return {
		key: instanceKey(storePath),
		label,
		store: resolve(String(storePath)),
		lock: hostLockPath(storePath),
	};
}

/**
 * Acquire the per-instance host lock with an exclusive create (`wx`): the first
 * holder wins, a second holder on the SAME store is refused, and a holder on a
 * DIFFERENT store is unaffected. Liveness/backoff of a stale holder is the host's job
 * (ROADMAP 63) — this helper only takes and reports the lock.
 */
export function acquireHostLock(storePath, { pid = process.pid, now = Date.now() } = {}) {
	const path = hostLockPath(storePath);
	try {
		const fd = openSync(path, "wx");
		try {
			writeSync(fd, JSON.stringify({ pid, since: now }));
		} finally {
			closeSync(fd);
		}
		return { acquired: true, path, pid };
	} catch (err) {
		if (err?.code === "EEXIST") return { acquired: false, path, reason: "held" };
		throw err;
	}
}

/** Release the per-instance host lock. An absent lock is a no-op (idempotent). */
export function releaseHostLock(storePath) {
	try {
		unlinkSync(hostLockPath(storePath));
		return { released: true };
	} catch (err) {
		if (err?.code === "ENOENT") return { released: false, reason: "absent" };
		throw err;
	}
}
