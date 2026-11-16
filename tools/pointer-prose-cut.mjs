// tools/pointer-prose-cut.mjs — pay the pointer's CLOCK-IN DIGEST budget by moving PROSE VERBATIM, and prove
// the cut was APPLIED (not merely claimed) from the bytes on disk AFTER the write.
//
// SYMPTOM this answers: `node scripts/clockin.mjs --budget 1` exits 1 with
// `clockin: digest is 20,337 B, over its 20000 B budget` — the pointer grew and the digest that a cold session
// pays grew with it. Paying that budget BY HAND cost five separate prose moves in one window (2026-11-16:
// `aebebd9fc`, `b8dcceb47`, `.spike/cut-five.mjs`, `.spike/fix-halfcut.mjs`, `.spike/cut-tally-clause.mjs`),
// and one of them (SELFDEV pitfall 412) wrote the cut, failed its own rebuild check, exited 1, and left the
// text out of the live file AND out of the archive — a half-cut every gate stayed green over
// (`tools/pointer-sha-coverage.mjs` exit 0, `tools/doc-integrity-guard.mjs` 0 hard, `scripts/clockin.mjs` exit 0).
// That is the same family as the row half-cut `tools/pointer-table-trim.mjs` refuses: the archive CLAIMS a move,
// the live file still has the text — or the live file lost text the archive never got.
//
// THE RULE, in this tool's own words:
//   * a cut moves text, it never retypes it — the bytes that leave the live file are the bytes appended to the
//     archive, so the VERBATIM claim is a substring check, not a promise;
//   * a cut pays the digest ONLY if it is INSIDE the digest slice. The slice is not re-spelled here: it is the
//     imported `pointerSection` of `scripts/clockin.mjs:71-79` (the ONE derivation the digest itself uses), and
//     a cut outside that span REFUSES, because a rows-only or below-slice move buys the byte budget ZERO bytes
//     (§43 TENTH, re-proven 2026-11-16) — the cheap currency is `tools/pointer-table-trim.mjs` for the LINE cap,
//     this tool for the BYTES;
//   * the proof is computed from the file AS IT IS AFTER the write (runbook Do step 1: never trust a write's
//     return value): the disk file must equal the plan applied to the pre-cut bytes, the archive must still
//     begin with its older bytes (append-only), every moved chunk must be in the appended region exactly once,
//     no moved chunk may survive in the live file, and the slice's own byte count must have shrunk by exactly
//     what was saved. A proof that fails says RECONCILE — this tool never writes a cut it cannot keep, and it
//     never writes-then-refuses silently: every pre-write refusal (bad anchor, ambiguous anchor, a chunk
//     overlapping another, a chunk outside the slice, a chunk that contains a pointer TABLE ROW, a chunk that
//     does not shrink, a chunk already VERBATIM in the archive = the half-cut above) writes NOTHING.
//
// Two shapes this tool keeps apart, because they read the same and cost differently:
//   * a pointer TABLE ROW (`^\|\s*`[0-9a-f]{7,40}`\s*\|`, the shape `tools/pointer-sha-coverage.mjs:97` counts)
//     is NOT prose: moving one here would add a row line to the archive and let the coverage audit compare the
//     wrong file, so a row REFUSES here and moves under `tools/pointer-table-trim.mjs` instead;
//   * the 200-LINE cap (`demo/next-pointer.test.mjs:84`, `scripts/clockin.mjs:44` POINTER_CAP_LINES) is a LINE
//     budget paid by rows; the 20,000 B digest budget (`scripts/clockin.mjs:46` DIGEST_BUDGET_BYTES) is a BYTE
//     budget paid by prose in the slice. One breach does not pay the other.
//
// Run: node tools/pointer-prose-cut.mjs --cuts=<path.json> [--file=docs/NEXT.md]
//        [--archive=docs/NEXT-ARCHIVE.md] [--dry-run] [--writes] [--json]
//      Flags arrive ONLY in `=` form; the space form is REFUSED (exit 2), not silently defaulted (pitfall 394/398:
//      an ignored flag is a false green). WITHOUT `--writes` this call only PLANS — it prints the chunks, their
//      byte sizes and the digest delta it predicts, and writes nothing, so an instrument that re-runs the
//      pointer's `Run these first` block cannot perform a cut by accident (`tools/cost-claim-audit.mjs` REFUSES
//      the `--writes` token in a block line for the same reason).
//      `--cuts=<path.json>` is a JSON ARRAY of cuts, each `{ "from": "…", "to": "…", "repl": "…" }` or
//      `{ "chunk": "…", "repl": "…" }`: `from` is the anchor, `to` (optional) is an END anchor taken INCLUSIVE
//      and searched AFTER `from`, so a long paragraph is named by its ends rather than retyped; `repl` (default
//      "") is what stays in the live file. The cut file is a session artifact — keep it in gitignored `.spike/`
//      and delete nothing: the archive copy is the record.
//
// COST: 0.31 s for a planning pass over the LIVE pointer (four cuts, one refused); 0.36 s for the same plan
//       WITH `--writes` (measured 2026-11-16 on Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64,
//       node v24.22.1, git 2.56.0 at `bff677f6d`); 0.24 s for a refusal. The import of `pointerSection` costs 0.03 s.
//       No store, no network, no model. Re-measure rather than trust this line.
//
// Exit: 0 = the plan wrote nothing (a planning pass) or the write's proofs all held;
//       1 = a refusal (see the FINDING it prints) or a proof failed — the files were written, reconcile them;
//       2 = usage (a space-form flag, a missing --cuts file, a cuts file that is not a JSON array).
//
// last_verified: 2026-11-16 — `node tools/pointer-prose-cut-test.mjs` PASS, 34 checks / 0 FAIL, 0.62 s, `.err` 0 B
// on Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0 (fixture pointer
// pairs in a throwaway tmpdir repo; no store, no network, no model). RED-FIRST against the pre-change `tools/`
// (`git archive HEAD tools | tar -x -C .spike/prechange-prose`, which carries 0 files matching `pointer-prose-cut`)
// exits 1 with `Cannot find module`. History of this same test on the same day, kept so the check count is not read
// as a regression: the leg set below is the whole pin, written in one sitting.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname as dname, join } from "node:path";

// The digest's slice is the ONE derivation `scripts/clockin.mjs` uses to build the digest itself. Importing it
// is the point: a second spelling of "`## NEXT SESSION` → next `## `" in here is the pair-of-spellings defect,
// and the pair is what lets a cut that pays ZERO digest bytes look like one that pays bytes.
import { pointerSection } from "../scripts/clockin.mjs";

// A pointer TABLE ROW, in the shape the coverage audit counts (tools/pointer-sha-coverage.mjs:97).
const ROW = /^\|\s*`[0-9a-f]{7,40}`\s*\|/;

const T0 = Date.now();

function hostLine() {
  // Hostname-free on purpose (operator ruling 2026-11-04): OS + distro + kernel + node, never user@hostname.
  const u = spawnSync("uname", ["-s"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  const k = spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  let distro = "unknown";
  try {
    const rel = readFileSync("/etc/os-release", "utf8");
    distro = (rel.match(/^PRETTY_NAME="([^"]+)"/m) ?? [])[1] ?? "unknown";
  } catch {
    /* non-Linux hosts: the OS and kernel still name the box adequately */
  }
  return `${u}, ${distro}, kernel ${k}, node ${process.version}`;
}

const is = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = is.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
for (const name of ["cuts", "file", "archive"]) {
  if (is.some((a) => a === `--${name}`)) {
    console.log("usage: every flag must arrive in `=` form (--cuts=.spike/cuts.json, --file=docs/NEXT.md); the space form is refused (pitfall 394)");
    console.log(`pointer-prose-cut cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
    process.exit(2);
  }
}
const cutsFile = flag("cuts");
const file = flag("file", "docs/NEXT.md");
const archive = flag("archive", "docs/NEXT-ARCHIVE.md");
const dryRun = is.includes("--dry-run");
const writes = is.includes("--writes");
const asJson = is.includes("--json");

const say = asJson ? () => {} : (msg) => console.log(msg);
const report = { file, archive, cuts: [], slices: null, findings: [] };
function finding(kind, detail = "") {
  report.findings.push({ kind, detail });
  say(`  FINDING ${kind}${detail ? ` — ${detail}` : ""}`);
}
function done(code) {
  say(`pointer-prose-cut cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
  process.exit(code);
}

if (!cutsFile) {
  console.log("usage: --cuts=<path.json> is required (a JSON array of {from,to?,repl?} cuts); a cut is a session artifact, keep it in gitignored .spike/");
  done(2);
}

let spec;
try {
  spec = JSON.parse(readFileSync(cutsFile, "utf8"));
} catch (e) {
  console.log(`cannot read the cut spec ${cutsFile}: ${e.message}`);
  done(1);
}
if (!Array.isArray(spec) || !spec.length) {
  console.log(`usage: ${cutsFile} must hold a NON-EMPTY JSON array of cuts`);
  done(2);
}

let pre;
try {
  pre = readFileSync(file, "utf8");
} catch (e) {
  console.log(`cannot read ${file}: ${e.message}`);
  done(1);
}
let archPre;
try {
  archPre = readFileSync(archive, "utf8");
} catch (e) {
  console.log(`cannot read ${archive}: ${e.message}`);
  done(1);
}

const preLines = pre.split(/\r?\n/);
if (pre !== preLines.join("\n")) {
  finding("line-shape", `the live file is not plain split-\`\\n\` text — refusing to re-join it, since the byte proof would be a re-join lie`);
  say("nothing written");
  done(1);
}

// THE SLICE, from the digest's own derivation — never re-spelled here.
const ps = pointerSection(pre);
if (ps.start < 0) {
  finding("no-slice", `the live file has no \`## NEXT SESSION\` section, so it has no digest slice and no prose to cut`);
  say("nothing written");
  done(1);
}
say(`${file}: ${preLines.length} lines (split-count), digest slice lines ${ps.start}-${ps.end} of ${ps.fileLines} (${Buffer.byteLength(ps.lines.join("\n"))} B of slice text)`);

// (1) RESOLVE EVERY CUT AGAINST THE PRE-CUT FILE, not against a mutating text: positions are only meaningful
// in one coordinate system, and "apply the plan" is then a single splice rather than a chain of string rewrites
// whose later anchors were chosen after earlier cuts moved the text.
const edits = []; // { start, end, repl, chunk, label }
for (const c of spec) {
  const anchor = c.from ?? c.chunk;
  if (!anchor || typeof anchor !== "string") {
    finding("bad-cut", `a cut names neither \`from\` nor \`chunk\` as a string — refusing the whole plan rather than applying part of it`);
    say("nothing written");
    done(1);
  }
  const a = pre.indexOf(anchor);
  if (a < 0) {
    finding("anchor-absent", `the anchor ${anchor.slice(0, 80)}… is not in ${file} — this session's idea of the pointer is not the pointer on disk`);
    say("nothing written");
    done(1);
  }
  if (pre.indexOf(anchor, a + 1) >= 0) {
    finding("anchor-ambiguous", `the anchor ${anchor.slice(0, 80)}… occurs more than once — a cut that could land in two places is not a cut`);
    say("nothing written");
    done(1);
  }
  let end;
  if (typeof c.to === "string") {
    const b = pre.indexOf(c.to, a);
    if (b < 0) {
      finding("end-anchor-absent", `the end anchor ${c.to.slice(0, 80)}… is not after ${anchor.slice(0, 80)}… — refusing rather than inventing an extent`);
      say("nothing written");
      done(1);
    }
    end = b + c.to.length;
  } else {
    end = a + anchor.length;
  }
  const repl = typeof c.repl === "string" ? c.repl : "";
  if (repl.split("\n").some((l) => /^## /.test(l))) {
    finding("repl-carries-a-heading", `the replacement text ${repl.slice(0, 60)}\u2026 opens a new \`## \` heading inside the slice \u2014 that moves where the digest slice ends, which is a rewrite of the pointer's shape, not a cut`);
    say("nothing written");
    done(1);
  }
  const chunk = pre.slice(a, end);
  if (chunk.split("\n").some((l) => ROW.test(l))) {
    finding("row-not-prose", `the chunk contains a pointer TABLE ROW line — rows pay the 200-line cap under \`tools/pointer-table-trim.mjs\` (a VERBATIM row move there costs the digest ZERO bytes); prose in the slice pays the digest bytes, which is what this tool does`);
    say("nothing written");
    done(1);
  }
  const firstLine = pre.slice(0, a).split("\n").length; // 1-indexed line the chunk starts on
  const lastLine = firstLine + chunk.split("\n").length - 1;
  if (firstLine < ps.start || lastLine > ps.end) {
    finding("outside-the-slice", `the chunk spans lines ${firstLine}-${lastLine} and the digest slice is ${ps.start}-${ps.end} — a cut outside the slice pays the clock-in digest ZERO bytes (§43 TENTH), so it cannot be a way to pay the byte budget`);
    say("nothing written");
    done(1);
  }
  if (Buffer.byteLength(repl) >= Buffer.byteLength(chunk)) {
    finding("no-shrink", `${Buffer.byteLength(chunk)} B of text would be replaced by ${Buffer.byteLength(repl)} B — this tool pays the byte budget, so a cut that does not shrink is not one`);
    say("nothing written");
    done(1);
  }
  if (archPre.includes(chunk)) {
    finding("half-cut", `the chunk ${chunk.slice(0, 80)}… is ALREADY VERBATIM in ${archive} — a cut was claimed and never applied (pitfall 412); reconcile the pointer/archive pair before cutting again`);
    say("nothing written");
    done(1);
  }
  for (const e of edits) {
    if (a < e.end && end > e.start) {
      finding("overlapping-cuts", `this chunk (bytes ${a}-${end}) overlaps an earlier chunk (bytes ${e.start}-${e.end}) — one text cannot be cut in two overlapping places in one pass`);
      say("nothing written");
      done(1);
    }
  }
  edits.push({ start: a, end, repl, chunk });
  report.cuts.push({ start: a, end, saved: Buffer.byteLength(chunk) - Buffer.byteLength(repl), chunk });
}
edits.sort((x, y) => x.start - y.start);

const planned = (() => {
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += pre.slice(at, e.start) + e.repl;
    at = e.end;
  }
  return out + pre.slice(at);
})();
const saved = edits.reduce((n, e) => n + Buffer.byteLength(e.chunk) - Buffer.byteLength(e.repl), 0);
const psPost = pointerSection(planned);
const slicePre = Buffer.byteLength(ps.lines.join("\n"));
const slicePost = psPost.start < 0 ? -1 : Buffer.byteLength(psPost.lines.join("\n"));

say(`  cuts: ${edits.length}, ${saved} B would leave the live file (slice text ${slicePre} B -> ${slicePost} B)`);
for (const e of edits) say(`    ${Buffer.byteLength(e.chunk)} B out: ${e.chunk.slice(0, 100)}${e.chunk.length > 100 ? "…" : ""}`);

if (psPost.start < 0) {
  finding("loses-the-slice", `the plan leaves the live file with no \`## NEXT SESSION\` section — the digest would stop existing, which is not what paying its budget means`);
  say("nothing written");
  done(1);
}

const linkLine = (s) => s.split("\n").filter((l) => /ARCHIVE\.md/i.test(l));
if (linkLine(planned).length === 0 && linkLine(pre).length > 0) {
  finding("loses-the-archive-link", `the plan drops the pointer's own line to its archive — a pointer that cannot point at its history is not a pointer (demo/next-pointer.test.mjs)`);
  say("nothing written");
  done(1);
}
if (planned.split("\n").some((l) => edits.some((e) => l === e.chunk))) {
  finding("chunk-still-live", `a chunk the plan moves is still a whole line of the planned file — the plan does not actually remove it`);
  say("nothing written");
  done(1);
}

if (dryRun || !writes) {
  say(
    dryRun
      ? "  DRY RUN: nothing written — a planning pass names no removals and proves no cut; run with --writes to apply this plan"
      : "  PLANNING PASS: nothing written — this tool writes only when `--writes` is given, so re-running the pointer's block cannot cut a doc by accident; add --writes to apply this plan",
  );
  if (asJson) console.log(JSON.stringify({ ...report, written: false, saved, slicePre, slicePost }, null, 2));
  done(0);
}

const date = new Date().toISOString().slice(0, 10);
const heading =
  `**Cut VERBATIM — the ${edits.length} clause(s) below left the \`## NEXT SESSION\` slice of \`${file}\` on ${date} via ` +
  "`tools/pointer-prose-cut.mjs` (the bytes that left the live file are the bytes below, never retyped; " +
  `proof: applying this tool's plan to the pre-cut \`${file}\` is the file on disk now, and these blocks sit in the archive exactly once, ` +
  `${saved} B of slice text and therefore of the clock-in digest):**`;
const block = `\n${heading}\n\n${edits.map((e) => e.chunk).join("\n\n")}\n`;
if (block.split("\n").some((l) => ROW.test(l))) {
  finding("archive-row", `the appended block would itself carry a pointer TABLE ROW line — refusing, since the coverage audit counts rows in the archive too`);
  say("nothing written");
  done(1);
}

writeFileSync(file, planned);
const archBase = archPre.endsWith("\n") ? archPre : archPre + "\n";
writeFileSync(archive, archBase + block);

// (2) PROVE, from the bytes on disk AFTER the write (never from what the write returned).
const post = readFileSync(file, "utf8");
const archPost = readFileSync(archive, "utf8");
const appended = archPost.slice(archBase.length);
const postLines = post.split(/\r?\n/);
const psNow = pointerSection(post);
const sliceNow = psNow.start < 0 ? -1 : Buffer.byteLength(psNow.lines.join("\n"));

let ok = true;
if (post !== planned) {
  ok = false;
  finding("proof-failed", `the live file on disk is ${Buffer.byteLength(post)} B, the plan said ${Buffer.byteLength(planned)} B — the write is not the plan`);
}
if (!archPost.startsWith(archBase)) {
  ok = false;
  finding("archive-not-append-only", `the archive's older ${Buffer.byteLength(archBase)} B are not the bytes they were — an append-only ledger was rewritten`);
}
const occurrences = (haystack, needle) => {
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) n += 1;
  return n;
};
for (const e of edits) {
  const hits = occurrences(appended, e.chunk);
  if (hits === 0) {
    ok = false;
    finding("not-verbatim", `${Buffer.byteLength(e.chunk)} B of cut text is not in the archive — the move was claimed, the text is LOST (pitfall 412's shape)`);
  } else if (hits > 1) {
    ok = false;
    finding("twice-in-archive", `a moved clause appears ${hits} times in the appended region — a clause cut twice is a duplicate, not a move`);
  }
  if (post.includes(e.chunk)) {
    ok = false;
    finding("half-cut-live", `a chunk the plan moved is STILL in the live file — the archive and the pointer disagree about where this text is`);
  }
}
if (sliceNow !== slicePre - saved) {
  ok = false;
  finding("digest-delta", `the digest's own slice went ${slicePre} B -> ${sliceNow} B, not the ${saved} B this tool moved — some of what moved was never in the slice`);
}
if (postLines.length > preLines.length) {
  ok = false;
  finding("grew-the-line-cap", `the live file went from ${preLines.length} to ${postLines.length} lines — a prose cut that lengthens the file pays the byte budget nowhere and pushes the 200-line cap`);
}
say(`  wrote ${edits.length} cut(s); the archive gained ${Buffer.byteLength(block)} B under a dated heading`);
say(`  proof: the live file on disk equals the plan applied to the pre-cut ${file} (${Buffer.byteLength(post)} B, ${preLines.length} -> ${postLines.length} lines)`);
say(`  proof: the digest slice (clockin's own \`pointerSection\`) shrank ${slicePre} B -> ${sliceNow} B, exactly the ${saved} B moved`);
say(`  proof: the archive still begins with its older ${Buffer.byteLength(archBase)} B and carries every moved clause in the appended region exactly once`);
say(`  the reader's verdict on the WHOLE digest is one call: node scripts/clockin.mjs --budget 1 (exit 0 = inside its budget)`);

if (!ok) {
  say("a proof failed — the files were written, so reconcile them before anything else trusts this tree");
  done(1);
}
if (asJson) console.log(JSON.stringify({ ...report, written: true, saved, slicePre, sliceNow }, null, 2));
done(0);
