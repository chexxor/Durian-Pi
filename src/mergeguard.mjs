// src/mergeguard.mjs — landing safety: refuse a WRITE verb while the working tree is
// mid-merge (lead #1164 Q2, the incident of 2026-10-17).
//
// THE INCIDENT: a multi-branch landing pass merged into the SHARED working tree while the
// rig was live. When one branch conflicted, the tree sat with `.git/MERGE_HEAD` and
// `<<<<<<<` markers in src/checkup.mjs, and because cli.mjs loaded checkup at startup
// EVERY verb died — `status`, `queue`, `run`, `serve` — until the merge was resolved. The
// harm was not the conflict; it was running anything at all against a half-merged tree.
//
// WHY IT LIVES HERE (the placement rule from #1164 Q2): this module imports NOTHING but
// node:fs and node:path, so it loads before — and independently of — any heavy module. A
// guard that pulled in checkup (or the store, or the provider) would be disabled by the
// very fault it exists to catch.
//
// READ verbs stay allowed on purpose: an operator or seat must be able to DIAGNOSE a
// stuck merge (`status`, `queue`, `log`) instead of being locked out of the rig.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Find the git root governing `start`, and its git DIRECTORY. Walks upward, because a
 * command may be run from a subdirectory.
 *
 * A linked worktree (how every durig item is checked out) has a `.git` FILE —
 * `gitdir: <path>` — not a directory. The file form MUST be followed: otherwise the guard
 * would be blind in exactly the checkouts a seat works in.
 *
 * @returns {{root: string, gitDir: string}|null} null when there is no git root at all
 *   (an unpacked tarball, a test temp dir) — the guard must not invent a failure there.
 */
export function findGitRoot(start = process.cwd()) {
  let current = resolve(start);
  for (;;) {
    const dotGit = join(current, ".git");
    if (existsSync(dotGit)) {
      try {
        if (statSync(dotGit).isDirectory()) return { root: current, gitDir: dotGit };
        const text = readFileSync(dotGit, "utf8");
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
        if (m) return { root: current, gitDir: resolve(current, m[1]) };
      } catch {
        // An unreadable .git is not our business to report: say "no git root" and let
        // the command fail on its own terms rather than as a guard error.
        return null;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Describe an in-progress merge for `start`, or null when the tree is not mid-merge.
 *
 * @returns {{root: string, gitDir: string, mergeHead: string, sha: string|null}|null}
 */
export function mergeInProgress(start = process.cwd()) {
  const found = findGitRoot(start);
  if (found === null) return null;
  const mergeHead = join(found.gitDir, "MERGE_HEAD");
  if (!existsSync(mergeHead)) return null;
  let sha = null;
  try {
    sha = readFileSync(mergeHead, "utf8").trim().split(/\s+/)[0] || null;
  } catch {
    // Unreadable MERGE_HEAD is still a merge in progress — report the state, not a sha.
    sha = null;
  }
  return { root: found.root, gitDir: found.gitDir, mergeHead, sha };
}

/**
 * The refusal text. Exported so the guard and its message cannot drift, and so a test can
 * assert the remedy is NAMED rather than a bare "refused".
 */
export function mergeRefusal(verb, merge) {
  const where = merge.root === process.cwd() ? "" : ` (git root ${merge.root})`;
  const commit = merge.sha ? `, merge commit ${merge.sha.slice(0, 12)}` : "";
  return (
    `${verb} refuses to run: a MERGE IS IN PROGRESS${where} — ${merge.mergeHead}${commit}. ` +
    `A write verb would act on a half-merged working tree; on 2026-10-17 a conflicted ` +
    `src/checkup.mjs left every cli verb unable to load. ` +
    `Finish the merge (resolve the conflicts and commit) or abort it, then re-run ${verb}. ` +
    `Read verbs (status, queue, ps, log, watch, events, metrics, check, config) are unaffected.`
  );
}
