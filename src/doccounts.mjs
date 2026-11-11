// src/doccounts.mjs — read the COUNT a doc claims about a set the code DECLARES (#6155).
//
// WHY THIS EXISTS. `docs/WORKFLOWS.md` said `check` runs "eight rules". Nobody had counted
// `src/checkup.mjs`'s `RULES`, so the number was authority without a source: it reads as a fact,
// drifts silently as rules are added, and no check can catch it. That is the same failure mode as a
// threshold nobody can reproduce. This module is the READ half; `src/checkup.mjs` is the JUDGE, and it
// stays pure (ROADMAP 81a), so the filesystem work lives here.
//
// SCOPE, stated so it cannot be over-read: only the two sets whose size is declared in code are
// checked - `check`'s rules and `metrics`' measures - and only in top-level `docs/*.md`, the live
// operational docs. `docs/reviews/*` and `docs/evidence/*` are dated records: a count written there is
// a snapshot of what was true when the review was written, and re-writing history is not drift control.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** A claim shaped like `` `check` (eight rules) `` or `` `metrics` (six measures) ``. The backtick is
 * load-bearing: it marks the SET NAME as a code identifier, which is what makes the number checkable. */
export const DOC_COUNT_CLAIM = /`(?<set>check|metrics)`\s*\(\s*(?<num>\d+|[a-z]+(?: [a-z]+)*)\s+(?<noun>rules|measures)\b/gi;

/** Spelled-out numbers, because a doc may say "eight" rather than 8. */
const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

/**
 * Extract every count claim from ONE doc's text. `claimed` is `null` when the word is not a number
 * ("a few rules") - an unparseable claim is not a pass, it is a claim nobody can re-check.
 */
export function parseDocCountClaims(text, file) {
  const claims = [];
  for (const match of String(text ?? "").matchAll(DOC_COUNT_CLAIM)) {
    const raw = match.groups.num;
    claims.push({
      file,
      line: String(text ?? "").slice(0, match.index).split("\n").length,
      set: match.groups.set,
      noun: match.groups.noun,
      claimed: /^\d+$/.test(raw) ? Number(raw) : (WORD_NUMBERS[raw.toLowerCase()] ?? null),
      claimedText: match[0],
    });
  }
  return claims;
}

/**
 * Read the claims from `dir` (default `docs`) under `root`. Returns `null` when the directory cannot
 * be read - the caller reports the rule as UNKNOWN rather than as a pass. An empty array is a real
 * finding: "these docs state no declared-set counts".
 */
export function readDocCountClaims({ root = process.cwd(), dir = "docs" } = {}) {
  const base = join(root, dir);
  if (!existsSync(base)) return null;
  let names;
  try {
    names = readdirSync(base);
  } catch {
    return null;
  }
  const claims = [];
  for (const name of names) {
    if (!name.endsWith(".md") || name.startsWith("_")) continue;
    const file = `${dir}/${name}`;
    let text;
    try {
      text = readFileSync(join(base, name), "utf8");
    } catch {
      continue; // unreadable file: no claim can be attributed to it
    }
    claims.push(...parseDocCountClaims(text, file));
  }
  return claims;
}
