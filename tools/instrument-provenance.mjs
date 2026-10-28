// tools/instrument-provenance.mjs — ROADMAP 233 as a running check: an instrument that is not in git
// is not landed, and a suite that silently loses members is not a suite.
//
// Why this exists (docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md §2-§4): a
// delegate session ran `node demo/<name>.test.mjs` on eight instruments, `docs/ROADMAP.md` credited them,
// and mid-session they were gone from disk — with NO `git status` entry, because they had never been
// committed. `git log --all --diff-filter=A -- <path>` printed nothing: nothing to restore. The suite
// runner enumerates members from DISK (`scripts/suite.mjs:36`, `readdirSync(demoDir).filter(...)`), so a
// member that vanishes is a SILENT SHRINK: the suite goes green having run fewer tests.
//
// This instrument makes both facts loud, read-only, from git rather than from disk:
//   1. SUITE MEMBERSHIP — `git ls-files demo/` vs what is on disk, both directions.
//      git-only  = a member tracked but deleted from disk (a missing test the suite will not run, and
//                  which `node demo/x.test.mjs` would hit as MODULE_NOT_FOUND).
//      disk-only = an untracked member (invisible to the next clone, un-diffable, unrecoverable, and the
//                  exact class that got swept: EVERY survivor of the sweep was tracked, every loss was not).
//   2. ROADMAP CITE RESOLUTION — every repo path a ROADMAP row names in `Where:`/`Acceptance:` must
//      resolve to a tracked path (or a ref). A row that credits an absent file is a lie the next session
//      will act on; row 217's acceptance named `demo/broker-serve.test.mjs`, which no longer exists.
//   3. PINNED COUNTS — the member count is printed, so a shrink is visible across sessions even in prose.
//
// Exit code: 1 on MEMBERSHIP or LEDGER drift always (those are the silent-shrink and blind-sweep facts);
// cite drift only fails under `--strict-cites`, because a historical row may legitimately cite a file that
// was deliberately deleted afterwards. `--quiet` prints only the
// counts, for a digest line. Read-only by construction: it runs `git ls-files` / `git cat-file` and reads
// the tree. It never prunes, never removes, never writes.
//
//   node tools/instrument-provenance.mjs [--quiet] [--demo-dir demo] [--strict-cites]
//   --strict-cites also fails on a ROADMAP cite that resolves to nothing; the default reports it, because
//   historical rows legitimately cite files that were deliberately deleted later.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const strictCites = args.includes("--strict-cites");
const demoIdx = args.indexOf("--demo-dir");
const demoDir = demoIdx >= 0 ? args[demoIdx + 1] : "demo";

const git = (...a) => {
	try {
		return execFileSync("git", ["-c", "safe.directory=*", ...a], { encoding: "utf8", maxBuffer: 1 << 26 });
	} catch (e) {
		return String(e.stdout ?? e.stderr ?? e.message);
	}
};
const say = (...a) => {
	if (!quiet) console.log(...a);
};

let drift = 0; // hard: membership / ledger — always fails the run
let citeDrift = 0; // soft: ROADMAP cite resolution — fails only under --strict-cites

// ---- 1. suite membership: git is the authority, disk is the observation ----------------------------
const tracked = git("ls-files", "--", demoDir)
	.split("\n")
	.filter((n) => n.endsWith(".test.mjs"))
	.map((p) => p.split("/").pop())
	.sort();
const onDisk = readdirSync(demoDir)
	.filter((n) => n.endsWith(".test.mjs"))
	.sort();
const gitOnly = tracked.filter((n) => !onDisk.includes(n));
const diskOnly = onDisk.filter((n) => !tracked.includes(n));

console.log(`suite members: git=${tracked.length} disk=${onDisk.length}`);
if (gitOnly.length) {
	drift++;
	console.log(`  GIT-ONLY (${gitOnly.length}) — tracked but absent from disk; the suite will NOT run these and`);
	console.log(`  ` + "`" + `node demo/<name>.test.mjs` + "`" + ` dies with MODULE_NOT_FOUND: ${gitOnly.join(", ")}`);
}
if (diskOnly.length) {
	drift++;
	console.log(`  DISK-ONLY (${diskOnly.length}) — suite members that are NOT in git: un-diffable, unrecoverable,`);
	console.log(`  invisible to the next clone, and the only class the 2026-10-28 sweep destroyed: ${diskOnly.join(", ")}`);
}

// ---- 2. does the suite RUNNER enumerate the same set this check just printed? ----------------------
// scripts/suite.mjs reads disk, so a disk-only member is run today and gone tomorrow, and a git-only
// member is simply missing. Print what the runner WOULD run, from the runner's own rule.
const runnerSet = onDisk;
say(`  the runner's own rule (scripts/suite.mjs:36 readdirSync+filter) would run ${runnerSet.length} members`);

// ---- 3. ROADMAP cites: does every named repo path resolve? ----------------------------------------
// LIMITATION worth stating rather than hiding: a cite can be unresolved for three different reasons, and
// this check cannot tell them apart from reading text alone — (a) a file that was lost or never committed
// (the 233 defect), (b) a file a row PLANS to create (`src/host.mjs` for #725), (c) a path that belongs to
// another project's tree. So the output is a review queue for the row's author, not a verdict; the row's
// own `Where:`/`Acceptance:` wording is what makes it a lie. A seat that wants to close 233 properly makes
// the predicate per-row ("cited as landed" vs "to be created"), which text parsing cannot decide for it.
const roadmapPath = process.env.DURIG_ROADMAP ?? "docs/ROADMAP.md";
const roadmap = readFileSync(roadmapPath, "utf8");
// A cite looks like `src/worktree.mjs:649` or `docs/runbooks/x.md` — take backticked path-ish tokens.
const cites = new Set();
for (const m of roadmap.matchAll(/`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?::\d+)?)(?:`|\[)/g)) {
	const raw = m[1];
	const path = raw.replace(/:\d+$/, "");
	if (!/\.(mjs|js|ts|md|json|txt|sqlite|sql|sh|ps1)$/.test(path)) continue;
	// Not repo-path claims: vendored upstream code (own repo), a runtime artifact written next to the
	// store, or a path that names ANOTHER project's tree (docs cited from pi, durable, upstream RFCs).
	if (/^(vendor\/|\.\/|\.\.\/)/.test(path)) continue;
	if (/\.(sqlite|sql)$/.test(path)) continue;
	cites.add(path);
}
const lsFiles = new Set(git("ls-files").split("\n"));
const unresolved = [];
for (const p of cites) {
	if (lsFiles.has(p)) continue;
	if (existsSync(p) && statSync(p).isFile()) continue; // on disk but untracked -> counted below, not unresolved
	unresolved.push(p);
}
const untracked = [...cites].filter((p) => existsSync(p) && statSync(p).isFile() && !lsFiles.has(p));
console.log(`roadmap cites: ${cites.size} distinct paths cited; ${unresolved.length} resolve to nothing; ${untracked.length} exist but are UNTRACKED`);
if (unresolved.length) {
	citeDrift++;
	console.log(`  UNRESOLVED CITES (${unresolved.length}) — a row names a path no clone can check out:`);
	for (const p of unresolved.slice(0, 25)) console.log(`    ${p}`);
	if (unresolved.length > 25) console.log(`    … ${unresolved.length - 25} more`);
}
if (untracked.length) {
	citeDrift++;
	console.log(`  UNTRACKED BUT CITED (${untracked.length}) — credited as landed, present on disk, absent from git:`);
	for (const p of untracked.slice(0, 25)) console.log(`    ${p}`);
}

// ---- 4. the worktree ledger: print its size so a collapse is visible -------------------------------
const wt = git("worktree", "list").trim().split("\n").filter(Boolean).length;
console.log(`git worktree registrations: ${wt}`);
if (wt < 1) {
	drift++;
	console.log("  a checkout with ZERO worktree registrations cannot answer a sweep question (ROADMAP 232)");
}

const failing = drift + (strictCites ? citeDrift : 0);
console.log(
	failing === 0
		? `PROVENANCE CLEAN${citeDrift && !strictCites ? ` (cite drift ${citeDrift} — soft; pass --strict-cites to fail on it)` : ""}`
		: `PROVENANCE DRIFT: ${failing} check(s) failing (hard=${drift}, cite=${citeDrift})`
);
process.exitCode = failing ? 1 : 0;
