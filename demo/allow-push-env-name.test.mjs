// demo/allow-push-env-name.test.mjs — the push-grant variable the docs name is the one the guard reads (#5777).
//
// WHY THIS FILE EXISTS (qa's measurement, reproduced here as an assertion). `src/confine.mjs:299` refuses
// `git push` unless `operatorGranted("DURIG_ALLOW_PUSH")`, and `operatorGranted` is literally
// `process.env[name] === "1"` (src/confine.mjs:363). There is no alias. Yet the operative docs told the
// reader to set `DURIAN_PI_ALLOW_PUSH=1` - constitution.txt (P2 Authority), AGENTS.md, docs/FEATURES.md,
// docs/runbooks/leaked-secret.md, and the `rig.starter.json` constitution mirror. A seat that trusts the
// doc sets a variable that does nothing, then reports itself blocked by the guard for a reason that is not
// real. The repo has been here before: the reverted #2143 rebrand renamed the variable in constitution.txt
// without regenerating the mirror and three demos went red (docs/runbooks/land.md, "REVERTED" entry).
//
// The accepted names are parsed out of the guard's own source, not typed here, so if the guard ever gains
// an alias the doc pin follows it instead of freezing a second truth.
//
// RED-FIRST: on the unfixed tree this exits 1 -
//   node demo/allow-push-env-name.test.mjs   -> exit 1 before the fix, 0 after
// Run: node demo/allow-push-env-name.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* Where a human or a seat is TOLD what to set. Historical records (docs/DECISIONS.md,
   docs/NEXT-ARCHIVE.md, docs/reviews/) are deliberately NOT here: they record what happened, including
   renames that were reverted, and rewriting them to today's name erases the evidence of the mistake. */
const OPERATIVE = [
  "constitution.txt",
  "rig.starter.json",
  "AGENTS.md",
  "docs/FEATURES.md",
  "docs/runbooks/leaked-secret.md",
];

/** Names the git guard actually consults, read out of its own source. */
function namesTheGuardRead() {
  const src = readFileSync(join(ROOT, "src", "confine.mjs"), "utf8");
  return [...src.matchAll(/operatorGranted\(\s*"([A-Z0-9_]+)"\s*\)/g)].map((m) => m[1]);
}

/** Every push-grant name in a text, with file and line, so a failure is actionable. */
function namesIn(text, label) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/\b([A-Z][A-Z0-9_]*_ALLOW_PUSH)\b/g)) {
      out.push({ file: label, line: i + 1, name: m[1] });
    }
  }
  return out;
}

function mismatches(allowed) {
  return OPERATIVE
    .flatMap((file) => namesIn(readFileSync(join(ROOT, file), "utf8"), file))
    .filter((h) => !allowed.includes(h.name));
}

const allowed = namesTheGuardRead();
assert.ok(allowed.length >= 1, "could not read any grant name from src/confine.mjs - the pin has no ground truth");
console.log(`guard reads: ${allowed.join(", ")}`);

const bad = mismatches(allowed);
for (const h of bad) console.log(`MISMATCH: ${h.file}:${h.line} says set ${h.name}, which nothing reads`);
assert.deepEqual(bad, [], "every push-grant name in the operative docs must be one the guard reads");

/* The real name must be PRESENT, not merely free of the wrong one: a doc that says nothing about the
   grant would pass the filter and still leave a seat without instructions. */
const constitution = readFileSync(join(ROOT, "constitution.txt"), "utf8");
assert.ok(
  allowed.some((name) => constitution.includes(name)),
  `constitution.txt must name the grant variable the guard reads (${allowed.join(" or ")})`,
);

/* NEGATIVE CONTROL, so a green run is not luck: the same checker, fed a doc that names the dead variable,
   must report it. Without this the assertion above only proves the doc happens to be clean today. */
const control = namesIn("relaunch with DURIAN_PI_ALLOW_PUSH=1", "synthetic-doc").filter((h) => !allowed.includes(h.name));
assert.equal(control.length, 1, "the checker fails to flag the name that does nothing - it is vacuous");
assert.equal(control[0].name, "DURIAN_PI_ALLOW_PUSH", "the control names the right variable");
console.log("negative control OK: naming a variable the guard does not read is detected");

console.log(`ALLOW-PUSH-ENV-NAME PASS — ${OPERATIVE.length} operative docs match src/confine.mjs (${allowed.join(", ")})`);
