// demo/commit-model.test.mjs — #475: the commit MODEL documented where seats read it.
//
// MODEL (delegate's hand-made tranche as the shape): PER-CONCERN commits (one commit per
// concern/item); the ITEM ID(s) in the commit MESSAGE; LOCAL ONLY — never push (operator
// merges/pushes). Pairs with #473 (lifecycle) and #474 (scoping/where).
//
// Asserts the model is carried in BOTH surfaces seats actually read:
//   1. constitution.txt P2 Authority (always loaded);
//   2. EVERY selfdev seat's instructions (Commit discipline block);
// plus the mirror integrity from #474 (both constitutionInline copies byte-identical).
//
// Failing-first: against the #474-only text these model assertions FAIL (RED); after
// the #475 amendment they pass (GREEN).
// Run: node demo/commit-model.test.mjs  (exit 0 = pass)

import { readFileSync } from "node:fs";
import { join } from "node:path";

const durigDir = process.cwd();
const starter = JSON.parse(readFileSync(join(durigDir, "rig.starter.json"), "utf8"));
const selfdev = JSON.parse(readFileSync(join(durigDir, "rig.selfdev.json"), "utf8"));
const constitution = readFileSync(join(durigDir, "constitution.txt"), "utf8");
// AUTHOR WARNING (#977, D83): a byte-equality compare MUST be EOL-insensitive. This repo has
// core.autocrlf=true, so the LF blob is checked out as CRLF while a JSON-parsed inline copy
// carries LF — a raw `a === b` then flakes by platform/checkout. Normalize CRLF->LF on BOTH
// sides before comparing (the file-scoped .gitattributes half is a separate item, #1055).
const lf = (text) => String(text ?? "").replace(/\r\n/g, "\n");

const MODEL_REQUIRED = [
  "one commit per concern",
  "commit message names",
  "item id",
  "never push",
];

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

try {
  console.log("\n=== #475: commit model (per-concern, item id, local only) ===\n");

  const p2 = constitution.split("\n").find((l) => /P2 Authority/i.test(l)) ?? "";
  for (const phrase of MODEL_REQUIRED) {
    check(`constitution P2 Authority carries "${phrase}"`, p2.toLowerCase().includes(phrase.toLowerCase()), p2.slice(0, 120));
  }

  for (const seat of selfdev.seats) {
    const text = String(seat.instructions ?? "");
    for (const phrase of MODEL_REQUIRED) {
      check(`${seat.name}: instructions carry "${phrase}"`, text.toLowerCase().includes(phrase.toLowerCase()));
    }
  }

  check("starter constitutionInline === constitution.txt (EOL-insensitive)",
    lf(starter.constitutionInline) === lf(constitution),
    "content differs after EOL normalization — regenerate the starter (#976)");
  check("selfdev constitutionInline === constitution.txt (EOL-insensitive)",
    lf(selfdev.constitutionInline) === lf(constitution),
    "content differs after EOL normalization — re-point the selfdev inline (#975)");

  console.log(failures === 0
    ? "\nPASS — commit model documented in the constitution and every seat's instructions"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
  failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
