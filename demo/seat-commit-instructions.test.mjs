// demo/seat-commit-instructions.test.mjs — #474: every seat's instructions require
// worktree-scoped, explicit-path commits before completing; forbidden: shared-tree
// commits without a worktree, `git add -A`, push.
//
// Pairs with #473 (the wired per-item worktree lifecycle) and #475 (the model).
// Also pins the constitution mirrors: constitution.txt must equal rig.starter.json's
// constitutionInline (a COPY), and the selfdev rig must SOURCE constitution.txt (a reference
// after 806ce7f). Both compared EOL-insensitively (#977/D83).
//
// Failing-first: against the UNAMENDED files the directive assertions fail (RED);
// after the amendment (+ regeneration of the mirrors) they pass (GREEN).
// Run: node demo/seat-commit-instructions.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
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

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

// The directives every seat's instructions must carry (#474's DO list).
const REQUIRED = [
  "work in your item's worktree",
  "commit your item's files before completing the item",
  "explicit file paths only",
  "never `git add -a`",
  "never push or publish",
  "do not commit from the shared tree",
];

try {
  console.log("\n=== #474: worktree-scoped commit discipline in every seat's instructions ===\n");

  // 1. Constitution carries the discipline (extended P2 Authority).
  check("constitution.txt: item's-worktree commit clause",
    /work in your item's worktree/i.test(constitution) &&
    /commit your item's files there before completing/i.test(constitution),
    constitution.split("\n").find((l) => /P2 Authority/i.test(l)) ?? "(no P2 Authority line)");
  check("constitution.txt: explicit paths only, never add -A",
    /explicit file paths only/i.test(constitution) && /git add -a/i.test(constitution));
  check("constitution.txt: never push or publish (retained)",
    /never push or publish/i.test(constitution));
  check("constitution.txt: no-worktree rider (no shared-tree commit)",
    /if your item has no worktree/i.test(constitution) &&
    /not commit from the shared tree/i.test(constitution));

  // 2. Mirror integrity across the three surfaces — EOL-insensitive (#977/D83).
  check("rig.starter.json constitutionInline === constitution.txt (EOL-insensitive)",
    lf(starter.constitutionInline) === lf(constitution),
    "content differs after EOL normalization — regenerate the starter (#976)");
  // #975/#1079: 806ce7f replaced selfdev's inline copy with a `constitution` REFERENCE, so
  // `selfdev.constitutionInline` is undefined and the old byte compare proved nothing. Assert the
  // structural single source instead: the selfdev rig POINTS at constitution.txt and that file
  // matches what ships. Same shape as the #975 fix in demo/commit-model.test.mjs.
  check(
    "rig.selfdev.json sources constitution.txt (single source, EOL-insensitive)",
    selfdev.constitution === "constitution.txt" &&
      lf(readFileSync(join(durigDir, selfdev.constitution), "utf8")) === lf(constitution),
    "the selfdev rig must point at constitution.txt and that file must match what ships",
  );

  // 3. EVERY seat in the self-dev rig carries the block.
  check("selfdev has seats", Array.isArray(selfdev.seats) && selfdev.seats.length > 0);
  for (const seat of selfdev.seats) {
    const text = String(seat.instructions ?? "");
    for (const directive of REQUIRED) {
      check(`${seat.name}: instructions carry "${directive}"`,
        text.toLowerCase().includes(directive.toLowerCase()),
        directive);
    }
  }

  // 4. The starter rig's constitutionInline alone does NOT have to appear in per-seat
  //    instructions (the starter teaches via check + constitution), but its four seats
  //    must still parse and it must still be self-contained — nothing to assert beyond
  //    the mirror above; kept explicit so a later tightening has a marker.
  check("starter seats parse", starter.seats.every((s) => typeof s.instructions === "string" && s.instructions.length > 0));

  console.log(failures === 0
    ? "\nPASS — commit discipline in every seat's instructions; mirrors byte-identical"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
  failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
