// tools/rig-portability-audit.mjs — can this rig DEFINITION run on the host it is sitting on? (delegate-landed 2026-10-29)
//
// WHY. The rig moved Windows → Linux and every host-dependent value that had been persisted stayed behind: the store's
// `pi.agent.cwd` for ALL TWELVE seats names a `C:\Users\Alex\...` path (`cli.mjs worktree audit` -> seatRoots), and
// `resolveSeatRoot` (src/seatroot.mjs:29) returns a persisted cwd **unconditionally — no existence check** — so a woken
// seat resolves a foreign path that `classifyGitRoot` then reports as `main-worktree`, i.e. the seat believes it is in
// the live checkout (measured 2026-10-29; the same phantom `docs/ROADMAP.md` 221 recorded for pm on 2026-10-28).
// ROADMAP 210's proposed `check` rule reads only `seats[].cwd` **from the rig file**, which today names no cwd for any
// seat — so it would report green while 12/12 seats are broken. This instrument measures the layer that actually wins.
//
// It also measures the second, unregistered mechanism found the same day: `classifyWorktrees` protects a seat's own
// worktree by EXACT normalized-string equality (src/broker.mjs:988-1010), so a stored Windows root can never match a
// Linux worktree path and the `seat-root` keep-reason is UNREACHABLE on this host — while `reconcileOrphanedWorktrees`
// runs its sweep at every broker start (src/broker.mjs:1145-1170). It proves reachability by calling the product's own
// classifier twice, rather than asserting it.
//
// READ-ONLY: it spawns `cli.mjs worktree audit` (the product's own reader — no hand-rolled store query, per the
// docs/SELFDEV.md pitfall), reads the rig file, and imports the product's decision functions instead of re-deriving them.
// It writes nothing and decides nothing: fixes are the team's, and the start is the operator's.
//
// Usage: node tools/rig-portability-audit.mjs [--db ./selfdev.sqlite] [--rig ./rig.selfdev.json] [--json] [--self-test]
// Exit 0 = portable on this host (or the self-test passed); exit 1 = findings, naming the ROADMAP item that owns each.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { resolveSeatRoot, classifyGitRoot, sameRoot } from "../src/seatroot.mjs";
import { classifyWorktrees } from "../src/broker.mjs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
// Resolved absolutely (#4955, and the #4947 divergence class): a relative default made the audit's
// answer depend on which tree served the process, and the CLI read it spawns used to CREATE the file
// when the answer was "not here" - so the audit measured a store it had just manufactured (#4923).
const DB = resolve(opt("--db", process.env.DURIG_DB || "./selfdev.sqlite"));
const RIG = opt("--rig", "./rig.selfdev.json");
const asJson = argv.includes("--json");
const selfTest = argv.includes("--self-test");
const t0 = Date.now();
const findings = [];
const notes = [];
const add = (rule, msg, roadmap) => findings.push({ rule, msg, roadmap });

// A drive-letter path (`C:\x`, `c:/x`) is the shape that cannot resolve on POSIX, and a POSIX path is the shape that
// cannot resolve on Windows. Naming the SHAPE, not just "missing", is what lets a fix target the join, not the file.
const DRIVE_RE = /^[A-Za-z]:[\\/]/;
const shapeOf = (p) => (DRIVE_RE.test(String(p)) ? "windows-drive" : isAbsolute(String(p)) ? "posix-absolute" : "relative");

/** The normalizer the proposed host-portable matching would use: separators, case-fold, AND the POSIX↔drive mapping. */
function hostNormalize(p, host = process.platform) {
  let s = String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (host !== "win32" && DRIVE_RE.test(s)) s = "/" + s[0] + s.slice(2); // c:/x -> /c/x (the MSYS shape)
  return s;
}

if (selfTest) {
  // The falsifier, in-process: the SAME classifier must go GREEN on a synthetic portable definition and RED on the
  // foreign-shaped one. Without this, a tool that only ever reports findings cannot tell you it is broken.
  const wt = [{ worktree: "/srv/durian/item-42", branch: "refs/heads/item-42", locked: false }];
  const portable = classifyWorktrees({ worktrees: wt, seatRoots: ["/srv/durian/item-42"] });
  const foreign = classifyWorktrees({ worktrees: wt, seatRoots: ["C:\\Users\\Alex\\item-42"] });
  const portableHost = classifyWorktrees({ worktrees: wt, seatRoots: ["/srv/durian/item-42"] });
  const ok =
    portable[0]?.keepReason === "seat-root" &&
    foreign[0]?.keepReason !== "seat-root" &&
    hostNormalize("C:\\Users\\Alex\\item-42") === "/c/users/alex/item-42" &&
    portableHost[0]?.keepReason === "seat-root";
  console.log(
    `SELF-TEST ${ok ? "PASS" : "FAIL"}  seat-root reachable for a same-host root: ${portable[0]?.keepReason}; ` +
      `for a foreign-OS root: ${foreign[0]?.keepReason}; drive->msys: ${hostNormalize("C:\\Users\\Alex\\item-42")}`,
  );
  process.exit(ok ? 0 : 1);
}

// 1 HOST — every measurement names the OS (AGENTS.md: "name the OS in every measurement you report").
const host = { platform: process.platform, release: (spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout || "").trim(), node: process.version };

// 2 THE SEAT ROOTS THAT ACTUALLY WIN — read through the product's own surface.
const aud = spawnSync(process.execPath, ["cli.mjs", "worktree", "audit"], {
  env: { ...process.env, DURIG_DB: DB },
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (aud.status !== 0) {
  console.error("cli.mjs worktree audit failed:", (aud.stderr || "").slice(0, 400));
  process.exit(1);
}
const audit = JSON.parse(aud.stdout.slice(0, aud.stdout.lastIndexOf("}") + 1));
const seatRoots = audit.seatRoots || [];
const worktrees = audit.worktrees || [];

// 3 THE RIG LAYER — the portable declaration. A host-absolute path here is 210's named defect.
const rig = JSON.parse(readFileSync(RIG, "utf8"));
const declaredCwds = (rig.seats || []).filter((s) => s.cwd !== undefined && s.cwd !== null).map((s) => ({ name: s.name, cwd: s.cwd }));
for (const s of declaredCwds) {
  if (!existsSync(s.cwd)) add("rig-cwd-unresolvable", `${RIG} seats[].cwd for "${s.name}" = ${s.cwd} does not exist on ${host.platform}`, "210");
}

const rootMap = new Map(seatRoots.map((r) => [r.name, r.cwd]));
for (const seat of rig.seats || []) {
  const persisted = rootMap.get(seat.name);
  const resolved = resolveSeatRoot({ persistedCwd: persisted });
  if (resolved.source !== "persisted seat cwd") {
    notes.push(`${seat.name}: no persisted cwd in the store; would resolve to ${resolved.source} (${resolved.root})`);
    continue;
  }
  const exists = existsSync(resolved.root);
  const kind = classifyGitRoot(resolved.root);
  const shape = shapeOf(resolved.root);
  if (!exists) {
    // This is the live defect 210's rig-file rule misses: the value that WINS is in the store, not the rig file.
    add(
      "seat-root-unresolvable",
      `seat "${seat.name}" resolves to ${JSON.stringify(resolved.root)} (source: ${resolved.source}, shape: ${shape}) which does not exist on ${host.platform}; ` +
        `classifyGitRoot calls it "${kind}" — a seat would believe that is ${kind === "main-worktree" ? "THE LIVE CHECKOUT" : "a tree"} while every file tool aims at a phantom path`,
      "221",
    );
  } else if (!sameRoot(resolved.root, resolve("."))) {
    notes.push(`${seat.name}: root resolves but is outside this checkout (${resolved.root})`);
  }
}

// 4 IS A SEAT'S OWN WORKTREE PROTECTABLE? Call the product's classifier with the roots the store carries, then with
// host-normalized roots, and report the difference. Reuse, never re-derivation.
const reach = { stored: [], normalized: [] };
for (const wt of worktrees) {
  const stored = classifyWorktrees({ worktrees: [wt], seatRoots: seatRoots.map((r) => r.cwd) })[0];
  reach.stored.push({ worktree: wt.worktree, keepReason: stored?.keepReason ?? null });
  const mapped = seatRoots
    .map((r) => hostNormalize(r.cwd))
    .map((p) => p.replace(/^\/c\/users\/alex\/dsh-projects\//, `${resolve(".")}/`)); // the synthetic portable shape
  const norm = classifyWorktrees({ worktrees: [wt], seatRoots: [hostNormalize(wt.worktree), ...mapped] })[0];
  reach.normalized.push({ worktree: wt.worktree, keepReason: norm?.keepReason ?? null });
}
const storedProtects = reach.stored.some((x) => x.keepReason === "seat-root");
const normProtects = reach.normalized.some((x) => x.keepReason === "seat-root");
if (seatRoots.length && !storedProtects && normProtects) {
  add(
    "seat-root-unmatchable",
    `${seatRoots.length} stored seat roots match ZERO of ${worktrees.length} registered worktrees by the product's exact-normalized equality ` +
      `(src/broker.mjs:988-1010), so the "seat-root" keep-reason is UNREACHABLE on this host — while reconcileOrphanedWorktrees sweeps at every ` +
      `broker start (src/broker.mjs:1145-1170). Under a host-normalized comparison the same tree is protected ("seat-root").`,
    "232",
  );
}

// 5 THE SHELL THE SEAT ACTUALLY GETS — imported, not re-derived (the docs' "guard's set ≠ registered tool" trap).
const seatTools = await import("../src/seattools.mjs");
const shellName = seatTools.seatTools?.shell?.name ?? "(none)";
const probe = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).status === 0;
const shells = { bash: probe("bash"), pwsh: probe("pwsh"), powershell: probe("powershell") };
if (shellName === "powershell" && !shells.powershell && !shells.pwsh) {
  add(
    "seat-shell-availability",
    `the registered seat shell tool is "${shellName}" and neither pwsh nor powershell exists on ${host.platform} (bash: ${shells.bash ? "present" : "absent"}), ` +
      `so every seat shell call is a spawn error: no git, no demo suite, and completions are self-declared`,
    "217",
  );
}

// 6 DOES A SEAT KNOW WHAT HOST IT IS ON? Competitor pattern, pinned: hermes-agent `_local_host_hints()` injects
// "Host: WSL/Windows (version)/…", the user home, the resolved cwd and the shell the terminal tool ACTUALLY starts
// (vendor/eval/hermes-agent/agent/prompt_builder.py:905-932, HEAD 07f075c2 2026-09-24) — its Windows comment is
// "Windows-local terminal runs bash, not PowerShell — without this the model issues PowerShell syntax". Our store shows
// the inverse failure reasoning live: entry #274090 "Maybe the shell is pwsh on Linux?".
const instr = JSON.stringify(rig.seats || []);
if (!/\bHost:|operating system:|shell:.*(bash|powershell)/i.test(instr)) {
  add(
    "seat-host-unaware",
    `no seat definition in ${RIG} names the host OS or which shell the shell tool starts; a seat has only its tool names to guess from, ` +
      `and the store shows it guessing (entries #274090)`,
    "217",
  );
}

// 7 THE HOST LAYER ITSELF — durig.config.json is gitignored and carries base URLs/ports: correct layering, so this is
// a NOTE, but a moved workspace has NO config until one is written (docs/runbooks/workspace-move.md Step 2).
const cfgPath = "./durig.config.json";
notes.push(existsSync(cfgPath) ? `host layer present (${cfgPath}, gitignored)` : `NO ${cfgPath}: a moved workspace has no host config at all`);

if (asJson) {
  console.log(JSON.stringify({ host, findings, notes, seatRoots, worktrees: reach, cost: Date.now() - t0 }, null, 2));
} else {
  console.log(`RIG PORTABILITY AUDIT — ${host.platform} ${host.release} node ${host.node}  rig=${RIG} db=${DB}`);
  console.log(`  seat roots read: ${seatRoots.length}  worktrees: ${worktrees.length}  rig-file declared cwds: ${declaredCwds.length}`);
  for (const f of findings) console.log(`  FINDING ${f.rule} (ROADMAP ${f.roadmap}) — ${f.msg}`);
  for (const n of notes) console.log(`  note: ${n}`);
  console.log(`  VERDICT: ${findings.length ? "NOT PORTABLE ON THIS HOST" : "portable on this host"} — ${findings.length} finding(s); cost ${Date.now() - t0}ms`);
  console.log(`  Fixes are the team's (210 measures the rig file; 221 the store-carried root; 217 the shell and the host hint; 232 the match). This instrument decides nothing.`);
}
process.exit(findings.length ? 1 : 0);
