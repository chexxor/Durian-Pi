// Delegate-landed instrument (2026-10-29, ROADMAP 233 hygiene family). Pairs with probe-preflight.mjs.
//
// WHY. When the box runs out of memory the kernel picks the LARGEST process, not the guilty one. On 2026-10-29 the
// victim was the seats' server:
//   kernel: Out of memory: Killed process 2289527 (strata-host) ... anon-rss:53969596kB ... oom_score_adj:200
// and the allocating process was `esbuild` — a toolchain process. So a probe that grows without bound is not "a bit of
// pressure"; it is a random number generator for which server dies.
//
// THE FIX, MEASURED HERE. Put the probe in its own cgroup and let the kernel kill THAT. Verified on this box
// (cgroup2fs, a running systemd user instance, Linux/Fedora, node v24.22.1):
//   systemd-run --user --scope -p MemoryMax=200M node -e 'while(true) Buffer.alloc(64*1024*1024)'
//     -> journal: "run-p2756020-i2781901.scope: Failed with result 'oom-kill'" + "… 200M memory peak"
//   and in the same window: strata-host RSS 52,712,604 -> 52,602,224 kB, llama-server RSS unchanged at 3,926,924 kB.
// The throwaway scope died; both servers lived. That is the whole point.
//
// THE KNOB THAT MATTERS, MEASURED (so the guard is not a placebo):
//   MemoryMax=300M MemorySwapMax=1G, 600 MiB of page-TUCHED buffers -> **survived**. MemoryMax caps RAM only and
//     MemorySwapMax hands the unit the box's swap on top — and swap here is zram at 8 GiB, ~78 % used, i.e. the effective
//     ceiling is the resource we are trying to protect. So --swap-max defaults to **0**.
//   MemoryMax=300M MemorySwapMax=0, same job -> "the CAP fired — the arm was killed inside its own scope", and
//     afterwards strata-host was still resident at 52,739,964 kB, llama-server at 3,926,924 kB.
//   Second trap: Buffer.alloc is zero-filled lazily, so allocating alone never becomes resident and will NOT trip a cap
//     (400 x 1 MiB untouched buffers under a 300 M cap completed). Prove a cap with a page-touching workload (`b.fill(1)`).
//
// THE OTHER HALF, ALSO MEASURED: this session runs at oom_score_adj=200 (`cat /proc/$$/oom_score_adj`), and so do BOTH model
// servers (/proc/2686804/oom_score_adj = 200, /proc/2687793/oom_score_adj = 200). Equal scores ⇒ the killer decides by size
// alone, which is why the server was executed. Raising a score is unprivileged and is ours to do: `choom -n 100 -p $$`
// -> "changed from 200 to 100". Lowering one is not: `choom -n -1000 -p $$` -> "failed to set score adjust value: Permission
// denied" (CAP_SYS_RESOURCE). So --oom-adj makes the ARM the cheaper victim here; protecting the SERVER is an operator- or
// system-level step, recorded in the runbook with the command that needs privilege.
//
// A desktop notification saying "run-<digits>.scope has been terminated ... low on memory" is THEREFORE EXPECTED when
// a capped arm overshoots. `run-*.scope` = an arm we capped. `app-…appimage@…service` or a llama-server/strata unit =
// a real server, and that is an incident. See docs/runbooks/verifier-model-server.md §probe discipline.
//
// Usage:
//   node tools/model-probes/capped-run.mjs [--node-mem-max 6G] [--swap-max 0] [--tasks 256]
//                                          [--skip-preflight] [--force] -- <command> [args...]
// Exit code is the child's. Preflight refusal exits 1 unless --force.

import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const val = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i === -1 ? dflt : argv[i + 1];
};
const dashdash = argv.indexOf("--");
if (dashdash === -1 || dashdash === argv.length - 1) {
  console.error('usage: node tools/model-probes/capped-run.mjs [--node-mem-max 6G] [--swap-max 0] [--force] -- <cmd> [args...]');
  process.exit(2);
}
const cmd = argv.slice(dashdash + 1);
const memMax = val("--node-mem-max", "6G");
const swapMax = val("--swap-max", "0");
const oomAdj = val("--oom-adj", "700");
const tasksMax = val("--tasks", "256");

if (!argv.includes("--skip-preflight")) {
  const pre = spawnSync(process.execPath, [join(here, "probe-preflight.mjs")], { stdio: "inherit" });
  if (pre.status !== 0 && !argv.includes("--force")) {
    console.error("\ncapped-run: refusing to start (preflight REFUSE). Free RAM/swap, or pass --force if you accept the risk.");
    process.exit(1);
  }
  if (pre.status !== 0) console.error("\ncapped-run: proceeding under --force despite the preflight refusal.");
}

// Does this box actually honour a per-unit cap? Proved by running `true` inside a 32 MiB scope.
const probe = spawnSync("systemd-run", ["--user", "--scope", "-p", "MemoryMax=32M", "true"], { encoding: "utf8", timeout: 30000 });
const capsAvailable = probe.status === 0;
if (!capsAvailable) {
  console.error("capped-run: no systemd user instance / cgroup delegation available — refusing to run uncapped.");
  console.error("  (that is deliberate: an uncapped arm is what killed strata-host on 2026-10-29)");
  process.exit(1);
}

const startedAt = new Date();
console.log(`capped-run: MemoryMax=${memMax} MemorySwapMax=${swapMax} TasksMax=${tasksMax} oom_score_adj -> ${oomAdj} — ${cmd.join(" ")}`);
// The scope's bootstrap raises its OWN oom_score_adj (writing /proc/self/oom_score_adj upward is unprivileged — measured:
// choom -n 100 -p $$ succeeded, choom -n -1000 -p $$ -> "Permission denied") and then execs the arm, which inherits the
// higher score. So if the box tips anyway the kernel picks the arm, not the 50 GiB server.
const bootstrap =
  'const{spawnSync}=require("node:child_process"),fs=require("node:fs");' +
  'try{fs.writeFileSync("/proc/self/oom_score_adj",String(' + Number(oomAdj) + '))}' +
  'catch(e){console.error("capped-run: could not raise oom_score_adj:",e.code)}' +
  'const r=spawnSync(process.argv[1],process.argv.slice(2),{stdio:"inherit"});' +
  'process.exit(r.status==null?1:r.status)';
const child = spawnSync(
  "systemd-run",
  ["--user", "--scope", "-p", `MemoryMax=${memMax}`, "-p", `MemorySwapMax=${swapMax}`, "-p", `TasksMax=${tasksMax}`, "node", "-e", bootstrap, ...cmd],
  { stdio: "inherit" }
);

const since = startedAt.toISOString().replace(/\.\d+Z$/, "");
const log = spawnSync("journalctl", ["--user", "-b", "--since", since, "--no-pager"], { encoding: "utf8" }).stdout || "";
for (const line of log.split("\n")) {
  if (/memory peak|oom-kill|OOM killer/i.test(line)) console.log("scope: " + line.replace(/^.*scope: /, ""));
}
if (child.status === null || child.status === 137 || /oom-kill/.test(log)) {
  console.log("capped-run: the CAP fired — the arm was killed inside its own scope.");
  const ps = spawnSync("sh", ["-c", "ps -eo pid,rss,comm | grep -E 'strata|llama-server' | grep -v grep"], { encoding: "utf8" });
  console.log("capped-run: servers still resident afterwards:\n" + (ps.stdout || "  (none found — that would be an incident)"));
}
process.exit(child.status ?? 1);
