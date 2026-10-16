// demo/seat-commit-instructions.test.mjs — #474: every seat's instructions require
// worktree-scoped, explicit-path commits before completing; forbidden: shared-tree
// commits without a worktree, `git add -A`, push.
//
// Pairs with #473 (the wired per-item worktree lifecycle) and #475 (the model).
// Also pins the constitution mirrors byte-for-byte: constitution.txt must equal BOTH
// rig.starter.json.constitutionInline and rig.selfdev.json.constitutionInline.
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

  // 2. Mirror integrity: byte-for-byte across the three surfaces.
  check("rig.starter.json constitutionInline === constitution.txt bytes",
    starter.constitutionInline === constitution);
  check("rig.selfdev.json constitutionInline === constitution.txt bytes",
    selfdev.constitutionInline === constitution);

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
