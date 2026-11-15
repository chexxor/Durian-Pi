// demo/broker-serve-pipe-safe.test.mjs — an instrument must not crash when a reader closes stdout early.
// WHY: `node tools/broker-serve.mjs --status | head -1` is the shape every session reaches for when a
// preflight outprints a screen. Before the guard it printed a 1,001 B `Error: write EPIPE` stack and the
// PIPELINE still exited 0 — a green exit code over a crashed instrument (docs/SELFDEV.md pitfall 398's
// sixth shape; there the falsifier was `wc -c` on .err, not the exit code). A pipe-safety contract with
// no pin drifts silently, and the drift reads as truth, so the pin reads the tool's OWN exit code (bash's
// PIPESTATUS[0], never the pipeline's `$?`, which is the READER's exit) plus the stderr byte count.
// Pins: behind `| head -1` the tool exits 3 = TRUNCATED; stderr has zero stack frames and zero EPIPE
// words; the truncation is ANNOUNCED (a truncated run must not read as a clean preflight); the reader
// still gets the first line whole; a draining reader does not truncate; unpiped keeps a real verdict 0/1.
// Trigger: any edit to tools/broker-serve.mjs' output path, or any claim that an instrument is safe to pipe.
// Cost: measured 2026-11-15, Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1 — RED 4 failing checks / exit 1 / 3.605 s against the tool WITHOUT the guard block, then exit
// 0 / 11 pins / 3.803 s with it, `.err` 0 B both runs. Six spawns of a 0.8-0.9 s instrument; no store
// write, no git, no seat, no network beyond the provider probes the instrument already makes unsourced.
import { existsSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rigRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TOOL = path.join(rigRoot, "tools", "broker-serve.mjs");
const tmp = path.join(os.tmpdir(), "broker-serve-pipe-safe");

let fails = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    fails += 1;
    console.log(`FAIL ${name}: ${detail}`);
  }
};

const text = (p) => (existsSync(p) ? spawnSync("cat", [p], { capture: true, encoding: "utf8" }).stdout || "" : "");
const bytes = (p) => (existsSync(p) ? statSync(p).size : -1);

// The tool's OWN exit code behind a pipe: bash reports PIPESTATUS[0] on ITS stdout, which this capture
// reads; the tool's stdout goes to the reader, the reader's output goes to a file.
const piped = (reader) => {
  const script =
    "node " + TOOL + " --status 2> " + tmp + ".err | " + reader + " > " + tmp + ".head; echo tool_exit=" + "$" + "{PIPESTATUS[0]}";
  const r = spawnSync("bash", ["-c", script], { capture: true, encoding: "utf8", timeout: 60000 });
  const m = /tool_exit=(-?\d+)/.exec(r.stdout || "");
  return {
    code: m ? Number(m[1]) : null,
    bytes: bytes(`${tmp}.err`),
    err: text(`${tmp}.err`),
    head1: text(`${tmp}.head`),
  };
};

const head = piped("head -1");
// RED before the guard: the tool dies of an uncaught async EPIPE throw (stack on stderr) and the exit
// code the shell reports is the READER's, so the crash looks green.
check(
  "the tool behind `| head -1` exits 3 = TRUNCATED, not a stack and not a green 0",
  head.code === 3,
  `tool_exit=${head.code} stderr=${head.bytes} B`
);
check(
  "stderr carries no stack — every line is the announced truncation, not an uncaught throw",
  !/Error:/.test(head.err) && !/Unhandled/.test(head.err) && !/^\s+at /m.test(head.err) && String(head.err).split("\n").filter((l) => l.trim().length > 0).every((l) => /^TRUNCATED:/.test(l)),
  `${head.bytes} B stderr — ${(String(head.err).split("\n").filter((l) => /^\s+at /.test(l)).length)} frame(s), ${(String(head.err).match(/Error:|Unhandled/g) || []).length} throw marker(s): ${String(head.err).slice(0, 200)}`
);
check(
  "the truncation is announced, so a truncated run cannot read as a clean preflight",
  /TRUNCATED/.test(head.err),
  `${head.bytes} B stderr: ${String(head.err).slice(0, 200)}`
);
check(
  "the note is one bounded line, not a screen of frames",
  head.bytes > 0 && head.bytes <= 200,
  `${head.bytes} B on stderr`
);
check(
  "a truncating reader still gets the first line whole — the guard stops later writes, it does not swallow the head",
  String(head.head1).split("\n")[0] === String(piped("cat").head1).split("\n")[0] && String(head.head1).trim().length > 0,
  `head -1 got ${String(head.head1).slice(0, 80)} vs cat ${String(piped("cat").head1).slice(0, 80)}`
);

const cat = piped("cat");
check("a reader that drains stdout does not truncate", cat.code !== 3 && !/TRUNCATED/.test(cat.err), `tool_exit=${cat.code} stderr=${cat.bytes} B note=${/TRUNCATED/.test(cat.err)}`);
check("a draining reader sees no stack", !/EPIPE|Error:/.test(cat.err), `${cat.bytes} B stderr: ${String(cat.err).slice(0, 200)}`);

const direct = spawnSync("node", [TOOL, "--status"], { capture: true, encoding: "utf8", timeout: 60000 });
check(
  "unpiped run reports a verdict (0 clean / 1 blocked), never TRUNCATED 3",
  direct.status === 0 || direct.status === 1,
  `status ${direct.status} err=${String(direct.stderr).slice(0, 200)}`
);
check("unpiped stderr stays free of EPIPE frames", !/EPIPE|Error:/.test(String(direct.stderr)), String(direct.stderr).slice(0, 300));
const directLines = String(direct.stdout).split("\n").filter((l) => l.trim().length > 0);
check("the unpiped run prints the preflight (a body, not a stub)", directLines.length >= 20, `${directLines.length} line(s)`);
check(
  "the guarded pipe leads with the same line the unpiped run leads with",
  String(head.head1).split("\n")[0] === String(direct.stdout).split("\n")[0] && String(direct.stdout).split("\n")[0].includes("BROKER PREFLIGHT"),
  `piped ${String(head.head1).split("\n")[0].slice(0, 90)} vs unpiped ${String(direct.stdout).split("\n")[0].slice(0, 90)}`
);

for (const p of [`${tmp}.err`, `${tmp}.head`]) {
  if (existsSync(p)) rmSync(p, { force: true });
}
console.log(fails ? `${fails} FAILURE(S)` : "all pins hold");
process.exit(fails ? 1 : 0);
