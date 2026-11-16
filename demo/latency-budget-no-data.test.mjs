#!/usr/bin/env node
// demo/latency-budget-no-data.test.mjs — a wall-clock instrument pointed at a store with NOTHING TO COUNT
// must say what it cannot claim, not crash and not print a number.
//
// SYMPTOM this answers (SELFDEV pitfall: named in docs/NEXT.md's `f57d16e43` row as "a pre-existing defect
// named, not hidden"): `node tools/latency-budget.mjs --db .spike/empty-gen.sqlite` died with
// `RangeError: Invalid time value` at `tools/latency-budget.mjs:211` — exit 1, 0 B of stdout, 772 B of
// stack. `Math.min(...[])` is Infinity, and `new Date(Infinity).toISOString()` throws. Measured 2026-11-16
// on Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0:
// `timeout 60 node tools/latency-budget.mjs --db .spike/empty-gen.sqlite > .spike/lb-empty.out 2>
// .spike/lb-empty.err` -> exit 1, 0 B out, 772 B err (`.spike/lb-empty.out`, `.spike/lb-empty.err`).
// A crash on a fresh store reads, to every reader of this instrument, as "the rig is too fast to measure" —
// the same false-measurement family as the flag-form false greens (pitfall 394/398/426/428), one level down:
// the FLAGS were honoured, the NUMBERS were not measurements.
//
// THE RULE this pins: an instrument that measures prints n/a when the denominator is 0, NAMES which half is
// blind (`SANITY:`), and keeps exit 0 — "this store has no data" is a measurement OF the store, not a failure
// of the tool. Two shapes reach that state, and both are pinned below:
//   (a) no `pi.generation` entries at all (an empty/fresh store) — the span line and every MACHINE rate;
//   (b) no DONE rows among the rows `cli.mjs status` CARRIES (the view is BOUNDED: it carried 200 non-terminal
//       rows here and no terminal one), which blanks the whole ITEM half even on the live store.
//
// RED FIRST (one bounded call, before the guard existed):
//   mkdir -p .spike/pc-red4 && git archive HEAD tools scripts src cli.mjs | tar -x -C .spike/pc-red4
//   node demo/latency-budget-no-data.test.mjs --tool "$(pwd)/.spike/pc-red4/tools/latency-budget.mjs"
//   -> exit 1 with the no-data legs FAILing on the crash (`status=1`, stdout empty); the legs that do not
//   depend on the guard stay ok. GREEN at this tree -> exit 0, 0 FAIL.
//
// The mocked plane: no model, no network, no seat woken. The fixture store is an EMPTY sqlite file in a
// throwaway tmpdir; `cli.mjs status` is a viewer (D11) and never wakes a seat. $0.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const TOOL = (() => {
  const given = argv.includes("--tool") ? argv[argv.indexOf("--tool") + 1] : "tools/latency-budget.mjs";
  return given.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(given) ? given : join(process.cwd(), given);
})();

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
  }
}

const root = mkdtempSync(join(tmpdir(), "durig-latency-no-data-"));

try {
  const store = join(root, "fresh.sqlite");
  {
    const db = new DatabaseSync(store);
    db.close();
  }
  const run = (extra) => spawnSync(process.execPath, [TOOL, `--db=${store}`, ...extra], { encoding: "utf8", timeout: 120000 });

  // (0) THE TOOL RAN AT ALL — a pre-change tree still gives a real tool here (the guard is INSIDE it), so the
  // red witness is the crash, not a missing file.
  const human = run([]);
  check("the tool ran on a store with no generations", !/Cannot find module/.test(human.stderr || ""), human.stderr);

  // (a) the empty store. The pre-change tool died here; the guarded tool says what it cannot claim.
  check("it exits 0 rather than dying on `new Date(Infinity)`", human.status === 0, `status=${human.status} err=${String(human.stderr).slice(0, 200)}`);
  check("its stderr carries no RangeError stack", !/RangeError/.test(human.stderr || ""), String(human.stderr).slice(0, 240));
  check("the span line NAMES the missing rows instead of a date", /no "pi\.generation" entries/.test(human.stdout), human.stdout.split("\n").filter((l) => /store span/.test(l)).join("\n"));
  check("a SANITY line says the machine half answers NOTHING", /SANITY: gens=0/.test(human.stdout), human.stdout.split("\n").filter((l) => /SANITY/.test(l)).join("\n"));
  check("a SANITY line says the item half is blind on a bounded view", /SANITY: 0 DONE rows/.test(human.stdout), human.stdout.split("\n").filter((l) => /SANITY/.test(l)).join("\n"));
  check("no rate prints as NaN", !/NaN/.test(human.stdout), human.stdout.split("\n").filter((l) => /NaN/.test(l)).join("\n"));
  check("no duration prints as -Infinity (`Math.max(...[])`)", !/-Infinity/.test(human.stdout), human.stdout.split("\n").filter((l) => /-Infinity/.test(l)).join("\n"));
  check("the empty case is named out loud, not left as a bare 0", /n\/a/.test(human.stdout), human.stdout.split("\n").filter((l) => /n\/a/.test(l)).slice(0, 3).join("\n"));
  check("it still reports its own cost and finishes", /run in [\d.]+s \(read-only\)/.test(human.stdout), human.stdout.slice(-120));

  const json = run(["--json"]);
  let doc = null;
  try {
    doc = JSON.parse(json.stdout);
  } catch {
    doc = null;
  }
  check("--json on the empty store prints one machine document", json.status === 0 && doc !== null, `status=${json.status} out=${String(json.stdout).slice(0, 160)}`);
  check("`span: null` rather than an Infinity pair", doc && doc.span === null, JSON.stringify(doc && doc.span));
  check("`measurable.generations: false` names the half that answers nothing", doc && doc.measurable && doc.measurable.generations === false, JSON.stringify(doc && doc.measurable));
  check("`measurable.doneRows: false` names the half the bounded view cannot see", doc && doc.measurable && doc.measurable.doneRows === false, JSON.stringify(doc && doc.measurable));
  check("the JSON still exits 0 (no data is a measurement, not a failure)", json.status === 0, `status=${json.status}`);

  // (b) the SAME item-half blindness on a store that HAS machine data — this is what the LIVE store reads,
  // because the bounded view carries only non-terminal rows. Pinned on the repo's own store (a viewer read;
  // no seat woken, no store write by this tool, $0).
  const live = spawnSync(process.execPath, [TOOL, "--db", "./selfdev.sqlite"], { encoding: "utf8", timeout: 120000 });
  const liveHead = String(live.stdout).split("\n").filter((l) => /ITEM LATENCY|SANITY: 0 DONE rows|store span/.test(l)).join("\n");
  check("the live store still measures the machine half (a span and a gens count)", live.status === 0 && /store span: 2\d{3}-/.test(live.stdout), `status=${live.status}\n${liveHead}`);
  check("and it NAMES that the item half has no done rows in the carried view", /SANITY: 0 DONE rows/.test(live.stdout), liveHead);
  check("no NaN survives on the live store either", !/NaN/.test(live.stdout), String(live.stdout).split("\n").filter((l) => /NaN/.test(l)).join("\n"));

  console.log(`\nlatency-budget no-data test: ${failures === 0 ? "PASS" : `${failures} FAIL(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
