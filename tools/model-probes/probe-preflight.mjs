// Delegate-landed instrument (2026-10-29, ROADMAP 233 hygiene family). Cheap, read-only, no GPU work.
//
// WHY THIS EXISTS. On 2026-10-29 the kernel OOM-killed the seats' model server while I was running verifier probes:
//   kernel: esbuild invoked oom-killer: ... oom_score_adj=200
//   kernel: oom-kill: ... task=strata-host, pid=2289527
//   kernel: Out of memory: Killed process 2289527 (strata-host) total-vm:132182136kB, anon-rss:53969596kB,
//           file-rss:65056kB, shmem-rss:2016944kB, oom_score_adj:200
// Two facts that no existing surface printed: (1) the seat server pins tens of GiB of HOST RAM — the IQ3_S pack is
// two GGUFs of 52 GB + 27 GB and only ~12.6 GiB sits on GPU0, and its smaps showed Pss_Shmem 42,651,468 kB; (2) the
// OOM killer chooses the LARGEST process, so the server dies for a sin committed by a probe. A probe therefore has to
// ask "how much headroom is left AFTER the servers" before it starts, which is what this prints.
//
// Read-only: it runs `free`, `swapon`, `nvidia-smi`, `ps`, reads /proc/<pid>/smaps_rollup and durig.config.json.
// It starts nothing, loads nothing, and sends no request to any model server.
//
// Usage:  node tools/model-probes/probe-preflight.mjs [--json] [--need-gib N] [--max-swap-pct P]
// Exit:   0 = safe to start one arm;  1 = REFUSE (reasons printed);  2 = bad invocation.
// Pair it with: tools/model-probes/capped-run.mjs, which puts the probe in its own cgroup so the kernel kills
// the probe instead of the server.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const num = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i === -1 ? dflt : Number(argv[i + 1]);
};
// Defaults measured on this box, 2026-10-29: 94.2 GiB total, strata-host alone at 50.0 GiB RSS, zram 8 GiB.
const NEED_GIB = num("--need-gib", 10);
const MAX_SWAP_PCT = num("--max-swap-pct", 50);

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 15000 });
  } catch (e) {
    return `__ERR__ ${e.message}`;
  }
};

const mem = sh("free", ["-b"]);
const lineFor = (label) => mem.split("\n").find((l) => l.trim().startsWith(label + ":")) || "";
const gib = (b) => (b / 2 ** 30).toFixed(1);
// `free -b` prints a header line first, then `Mem:` and `Swap:`; on Linux the last Mem field is available.
const mf = lineFor("Mem").trim().split(/\s+/).slice(1).map(Number);
const memAvailableGiB = mf.length >= 6 ? mf[5] : mf[2];

const swap = sh("swapon", ["--show=NAME,TYPE,SIZE,USED", "--bytes"]);
let swapTotal = 0;
let swapUsed = 0;
for (const line of swap.split("\n").slice(1)) {
  const p = line.trim().split(/\s+/);
  if (p.length >= 4) {
    swapTotal += Number(p[2]) || 0;
    swapUsed += Number(p[3]) || 0;
  }
}
const swapPct = swapTotal ? Math.round((100 * swapUsed) / swapTotal) : 0;

const gpu = sh("nvidia-smi", ["--query-gpu=index,name,memory.used,memory.total", "--format=csv,noheader"]);
const gpus = gpu
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [index, name, used, total] = l.split(",").map((s) => s.trim());
    return { index, name, usedMiB: Number(used.replace("MiB", "")), totalMiB: Number(total.replace("MiB", "")) };
  });

// The servers: whose RSS dominates the choice the OOM killer will make, and what window they were configured with.
const psOut = sh("ps", ["-eo", "pid,rss,args", "--sort=-rss"]);
const servers = [];
for (const line of psOut.split("\n").slice(1)) {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
  if (!m) continue;
  const args = m[3];
  const bin = args.split(" ")[0].split("/").pop();
  if (!["llama-server", "strata", "strata-host", "strata-launcher"].includes(bin)) continue;
  const flag = (name) => (args.match(new RegExp(`--${name}\\s+(\\S+)`)) || [])[1] ?? null;
  const pid = Number(m[1]);
  let shmemKiB = null;
  try {
    const roll = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    shmemKiB = Number((roll.match(/^Pss_Shmem:\s+(\d+) kB$/m) || [])[1] ?? 0);
  } catch {}
  servers.push({
    pid,
    rssGiB: Number((Number(m[2]) / 2 ** 20).toFixed(1)),
    shmemGiB: shmemKiB == null ? null : Number((shmemKiB / 2 ** 20).toFixed(1)),
    bin: args.split(" ")[0].split("/").pop(),
    ctx: flag("ctx-size") ?? flag("max-context"),
    parallel: flag("parallel") ?? flag("kv-resident"),
    residentExperts: /--resident-experts/.test(args),
    loadMode: flag("load-mode"),
    gguf: (args.match(/--(?:model|native)\s+(\S+\.gguf)/) || [])[1] ?? null,
  });
}

// What the rig THINKS the verifier window is, against what the server was actually started with.
let declared = null;
const cfgPath = resolve("durig.config.json");
if (existsSync(cfgPath)) {
  try {
    const c = JSON.parse(readFileSync(cfgPath, "utf8"));
    declared = {
      verifierModel: c.DURIG_VERIFIER_MODEL ?? null,
      verifierContext: c.DURIG_VERIFIER_CONTEXT ?? null,
      verifierMaxTokens: c.DURIG_VERIFIER_MAX_TOKENS ?? null,
      verifierBaseUrl: c.DURIG_VERIFIER_BASE_URL ?? null,
    };
  } catch (e) {
    declared = { error: e.message };
  }
}

const reasons = [];
if (memAvailableGiB < NEED_GIB) reasons.push(`only ${gib(memAvailableGiB)} GiB MemAvailable (need >= ${NEED_GIB})`);
if (swapPct > MAX_SWAP_PCT) reasons.push(`swap ${swapPct}% used (max ${MAX_SWAP_PCT}%) — zram is the ceiling here, not RAM`);
for (const g of gpus) {
  const freeMiB = g.totalMiB - g.usedMiB;
  if (freeMiB < 1024) reasons.push(`GPU${g.index} ${g.name} has only ${freeMiB} MiB free — a load or a second engine will not fit`);
}
const warnings = [];
for (const g of gpus) {
  const pct = Math.round((100 * g.usedMiB) / g.totalMiB);
  if (pct > 90) warnings.push(`GPU${g.index} ${g.name} is ${pct} % full — anything needing VRAM there will be rejected or force an eviction`);
}
if (servers.length) {
  const top = servers[0];
  warnings.push(`largest resident process is ${top.bin} at ${top.rssGiB} GiB RSS${top.shmemGiB ? ` (${top.shmemGiB} GiB of it shmem)` : ""} — that is what the OOM killer will pick if anything else pushes the box over`);
}
if (declared?.verifierContext && declared?.verifierMaxTokens && Number(declared.verifierMaxTokens) > Number(declared.verifierContext))
  warnings.push(`DURIG_VERIFIER_MAX_TOKENS ${declared.verifierMaxTokens} > _CONTEXT ${declared.verifierContext}: an unsatisfiable request (ROADMAP 259)`);

const report = {
  at: new Date().toISOString(),
  verdict: reasons.length ? "REFUSE" : "GO",
  reasons,
  warnings,
  memAvailableGiB: Number(gib(memAvailableGiB)),
  swapUsedPct: swapPct,
  gpus,
  servers,
  declared,
  thresholds: { needGiB: NEED_GIB, maxSwapPct: MAX_SWAP_PCT },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`PROBE PRE-FLIGHT — ${report.verdict}`);
  console.log(`  MemAvailable ${gib(memAvailableGiB)} GiB   swap ${(swapUsed / 2 ** 30).toFixed(1)} / ${(swapTotal / 2 ** 30).toFixed(1)} GiB (${swapPct}%)`);
  for (const g of gpus) console.log(`  GPU${g.index} ${g.name}: ${g.usedMiB} / ${g.totalMiB} MiB (free ${g.totalMiB - g.usedMiB})`);
  for (const s of servers)
    console.log(
      `  server pid ${s.pid} ${s.bin}: ${s.rssGiB} GiB RSS${s.shmemGiB ? `, shmem ${s.shmemGiB} GiB` : ""}` +
        `${s.ctx ? `, window ${s.ctx}` : ""}${s.parallel ? `, parallel/resident ${s.parallel}` : ""}${s.residentExperts ? ", resident-experts" : ""}${s.loadMode ? `, load ${s.loadMode}` : ""}`
    );
  if (declared) console.log(`  rig declares verifier: model=${declared.verifierModel} ctx=${declared.verifierContext} max_tokens=${declared.verifierMaxTokens}`);
  for (const w of warnings) console.log(`  NOTE: ${w}`);
  for (const r of reasons) console.log(`  REFUSE: ${r}`);
  if (reasons.length)
    console.log(
      "  Options: free host RAM (lower the seat server's --max-context / --resident-experts), or add real swap,\n" +
        "           or run the arm under a cap: node tools/model-probes/capped-run.mjs --node-mem-max 6G -- <cmd...>"
    );
}
process.exit(reasons.length ? 1 : 0);
