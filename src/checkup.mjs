// `check` — a static audit of a rig against the research-identified gaps.
//
// This is a LINTER, not a measurement, and the split is deliberate (D24):
// `metrics` answers "is this rig getting worse over time?" from persisted
// activity; `check` answers "can this rig work at all, and does it carry the
// safeguards the research says matter?" from the rig file and the stored state,
// once. A finding here is something to fix; a movement in `metrics` is
// something to investigate.
//
// Severity says WHO CAN FIX IT, which is the only distinction that changes what
// an operator does:
//   error    - the rig cannot do its job until this is edited; `check` exits 1.
//   fix-now  - a real gap the operator can close in the rig file; the rig still
//              runs, so this never fails a run (and never blocks a script).
//
// A third class, "code-gated" (gaps no rig edit can close — verification
// evidence, a deferral verb, termination semantics), was designed and then
// dropped: `check` cannot know about them without hand-mirroring the tool
// surface, which is exactly the drift that produced the constitution bug. Those
// gaps live in ROADMAP items 4-6, where they change when the code does.
//
// Everything here is a pure function over plain data, so the proving test
// drives every rule without a database, a provider, or a model.

import { ANSI } from "./ansi.mjs";
// The verifier vocabulary and predicate live in their own low-layer module
// (src/verifierrole.mjs) because `metrics` and `seattools` need them at RUNTIME:
// importing them from this audit made a conflicted checkup.mjs fatal to the whole
// CLI's load (2026-10-17, lead #1164). Re-exported so every importer keeps ONE
// definition.
import { VERIFIER_TERMS, seatsAreVerifier } from "./verifierrole.mjs";
// #5049: the over-window predicate lives with the MEASURE (src/context.mjs), not here, so `check` scores the
// same rule the `context_over_window` notice applies — two spellings of a threshold is how #5047's notice/rule
// pair un-paired. context.mjs is dependency-free, which is what makes importing it safe here; the verifierrole
// lesson (a checkup.mjs that drags runtime deps is fatal to the whole CLI load) is why it stays that way.
import { contextOverWindow } from "./context.mjs";
import { describeFaults } from "./textintegrity.mjs";
import { messageDefects } from "./commitmsg.mjs";
import { MEASURES } from "./metrics.mjs";
// The stranded-gate census lives with the repair it plans (src/queueops.mjs), so `check` reports exactly
// the rows the operator/delegate repair verb would touch — one rule, one census.
import { strandedGates } from "./queueops.mjs";
// The escalation census lives with the lease that produces it (src/deferlease.mjs), so `check` reports
// exactly the rows `selectWakes` escalates — one rule, one census.
import { escalations, escalationText } from "./deferlease.mjs";
// N19 row 7: the pool predicates are the SAME functions the claim path uses (src/rig.mjs), not a second
// spelling of them. A rule that re-derives "open pool row" or "requires" in prose is exactly the pair of
// spellings #5047 un-paired: the audit and the gate drift apart and both look correct.
import { openPoolRow, requiredCapabilities } from "./rig.mjs";

export { VERIFIER_TERMS, seatsAreVerifier };

/** Rule ids are the stable API: scripts match on them, prose may change. */
export const RULES = [
  {
    id: "constitution-missing",
    severity: "error",
    what: "no constitution reaches the seats",
  },
  {
    id: "constitution-not-applied",
    severity: "error",
    what: "the stored constitution is not the one the rig file declares",
  },
  {
    id: "unreachable-seat",
    severity: "error",
    what: "a seat has no org edge, so it cannot send anything",
  },
  {
    id: "dangling-edge",
    severity: "error",
    what: "an edge names a seat that does not exist",
  },
  {
    id: "store-missing-seat",
    severity: "error",
    what: "the rig file declares a seat the store does not hold",
  },
  {
    id: "stray-seat",
    severity: "fix-now",
    what: "the store holds a seat the rig file does not declare",
  },
  {
    id: "no-verifier-seat",
    severity: "fix-now",
    what: "no seat is an independent verifier",
  },
  {
    id: "single-model-rig",
    severity: "fix-now",
    what: "every seat resolves to one model",
  },
  {
    id: "seat-without-capabilities",
    severity: "fix-now",
    what: "a seat declares no capabilities, so per-seat tool scoping gives it no working tools",
  },
  {
    id: "runbook-stale",
    severity: "error",
    what: "a runbook was verified before a file it names changed",
  },
  {
    id: "runbook-unverified",
    severity: "fix-now",
    what: "a runbook's Verify step has never run",
  },
  {
    id: "runbook-front-matter",
    severity: "fix-now",
    what: "a runbook's front-matter block is missing, or its keys/values and skeleton sections do not conform to _template.md",
  },
  {
    id: "ownership-seat-missing",
    severity: "error",
    what: "an ownership class names an owner seat the rig does not declare",
  },
  {
    id: "verification-without-evidence",
    severity: "fix-now",
    what: "a verification task was completed with only an acknowledgement, or with evidence that names no artifact — not re-runnable evidence (#2547)",
  },
  {
    id: "evidence-tree",
    severity: "fix-now",
    what: "a terminal item's evidence names an artifact that names no tree and no store - a green depends on the tree it ran in, so an un-named artifact cannot be re-checked (#4153)",
  },
  {
    id: "citation-unresolvable",
    severity: "fix-now",
    what: "a non-terminal queue item cites a commit this clone does not hold, so the evidence cannot be re-checked — the queue cites machine-local git objects as durable evidence (ROADMAP 190)",
  },
  {
    id: "feature-row-missing",
    severity: "fix-now",
    what: "a feat commit landed with no docs/FEATURES.md row and no stated \"no feature surface\" note",
  },
  {
    id: "duplicate-item",
    severity: "fix-now",
    what: "a non-terminal queue item is SAME-INTENT with an already-terminal item (same from/to/tier plus high subject overlap)",
  },
  {
    // OPERATOR RULING 2026-11-12T20:2xZ: a park on the operator is a LEASE. Measured before it existed: 493
    // rows `deferredTo: "human"` at a median age of 5 days (32% of the non-terminal queue), which is why the
    // rig read as stalled while the team was closing 35 rows in 4 h. fix-now, like every census: 493 findings
    // must never make `check` exit 1, but they must be visible without anyone running a tool by hand.
    id: "human-deferral-past-clock",
    severity: "fix-now",
    what: "a row is parked on the human operator past its decision clock (or was parked before parks had one), so it escalates to lead",
  },
  {
    // THE READER THE ORPHANS NEVER HAD (operator ruling 2026-11-12T17:5xZ, src/queueops.mjs).
    // `workable()` treats a CANCELLED prerequisite as positive non-workability (lead-ratified #2677,
    // "terminal != done"), so a dependent of a cancelled row can NEVER be claimed — and nothing
    // repaired the chain. Measured on this rig: 151 such rows from
    // `node tools/queue-drain-audit.mjs`, plus two live casualties (#3503, #5885 behind cancelled
    // #3377). A tool printed that census and nothing consumed it, which is why it accrued for weeks.
    id: "stranded-gate",
    severity: "fix-now",
    what: "a non-terminal item is gated on a CANCELLED item, so it can never be claimed and nothing repairs it",
  },
  {
    // N19 "The Pool" (docs/POOL-QUEUE-SPEC.md §6.1-§6.4, D275) makes eligibility a capability SET checked at
    // CLAIM. A pooled row nobody can claim is not slow work - it is INVISIBLE work: `status` counts it as
    // queued, every seat's claim skips it, and no wake fires for it. The dead-gate rule (#6215) is the closest
    // analogue and is fix-now because a human can release a gate; a capability no seat has is a roster decision
    // the operator has to make, so the pool cannot be trusted until it is closed.
    id: "pool-dead-gate",
    severity: "error",
    what: "an OPEN pool row requires a capability NO seat in the roster advertises, so nobody can ever claim it",
  },
  {
    // The invariant the claim gate guarantees. It holds by construction for every row claimed after N19, so a
    // finding here means the roster changed AFTER the claim, or the row predates the gate and was handed to a
    // seat that cannot do it. Either way a seat is holding work it is not eligible for - the false positive the
    // pool exists to remove.
    id: "pool-claim-without-capability",
    severity: "error",
    what: "a pool row is owned by a seat that does not advertise every capability the row requires",
  },
  {
    id: "shared-tree-on-main",
    severity: "error",
    what: "the shared working tree is not on its integration branch, so a seat may be writing to a feature branch",
  },
  {
    id: "commit-message-encoding",
    severity: "fix-now",
    what: "a recent commit message carries a UTF-8 BOM (or a NUL / stray CR) — invisible in every normal view, so it surfaces only in a byte read; a body BOM corrupts a trailer (#4349)",
  },
  {
    id: "text-integrity",
    severity: "error",
    what: "a tracked file's newline structure COLLAPSED versus HEAD, or its encoding is broken (BOM / NUL / invalid UTF-8) — node --check is structurally blind to this class (#4305)",
  },
  {
    id: "context-over-window",
    severity: "fix-now",
    what: "a seat's newest reported turn MOVED more tokens than its OWN window allows, on a head nothing has reset since — the fraction `status` prints was consumed by nothing (#5049)",
  },
  {
    id: "doc-count-drift",
    severity: "fix-now",
    what: "a doc states a count of a set the code declares, and the declaration does not match it (#6155)",
  },
];

/** #6155: the sets whose SIZE is declared in code, so a doc may cite a number a machine can re-check.
 * A doc that states a count of anything else is not checkable, and the rule says so. */
export const DECLARED_COUNTS = {
  rules: RULES.length,
  measures: Object.keys(MEASURES).length,
};

const SEVERITY_OF = new Map(RULES.map((r) => [r.id, r.severity]));

/**
 * #4075: SAME-INTENT duplicate detection. The duplicate's cause is a ~10s retry OUTSIDE durig's
 * source, so a re-issue carries a NEW tool-call id and #3192's originCallId dedup cannot catch it;
 * and two of five observed pairs are REWORDED rather than replayed, so BYTE EQUALITY WOULD MISS
 * THEM. The recoverable signal is INTENT: same from, same to, same tier, PLUS high subject overlap.
 * These are exported so the demo pins the boundary rather than re-implementing it.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at", "by", "with",
  "is", "are", "be", "it", "its", "this", "that", "as", "from", "into", "per", "not",
]);
const OVERLAP_THRESHOLD = 0.6;

/** Content words of a subject, with a leading protocol marker (`DONE #N:` / `VERIFY #N:`) stripped. */
export function subjectTokens(subject) {
  return String(subject ?? "")
    .toLowerCase()
    .replace(/^[^:]*#\d+:\s*/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Overlap of two subjects' content-word sets, normalised by the SMALLER set (0..1). */
export function subjectOverlap(a, b) {
  const A = new Set(subjectTokens(a));
  const B = new Set(subjectTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

/** A terminal item is finished either way: `done` (the work happened) or `cancelled`. */
const TERMINAL_STATUSES = new Set(["done", "cancelled"]);
export function isTerminalStatus(item) {
  return TERMINAL_STATUSES.has(item?.status);
}

/** Same from + same to + same tier + high subject overlap. Byte equality is the STRONGEST signal,
 * not the only one — this is the weaker, intent-level test that catches a REWORDED re-issue. */
export function sameIntent(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.from !== b.from || a.to !== b.to) return false;
  if ((a.tier ?? null) !== (b.tier ?? null)) return false;
  return subjectOverlap(a.subject, b.subject) >= OVERLAP_THRESHOLD;
}

/**
 * #4099: a live item that NAMES its terminal twin is a SUPERSESSION — a deliberate correction
 * ("replaces #4063", "supersedes #3560", "re-registration of cancelled #2055") — NOT a duplicate.
 * A REISSUE satisfies sameIntent BY DESIGN: same sender, same recipient, same tier, near-identical
 * subject, and a cancelled predecessor. Without this carve-out the rule fires on every legitimate
 * correction — and a rule that fires on correct behaviour gets turned off, so it then catches
 * nothing. The citation is checkable and cheap: the live item's subject OR body cites `#<id>`.
 */
export function namesPredecessor(live, terminal) {
  if (!live || !terminal) return false;
  const needle = `#${terminal.id}`;
  return `${live.subject ?? ""}\n${live.body ?? ""}`.includes(needle);
}

/** First line of a possibly-multiline text, bounded for display. */
function firstLine(text, limit = 96) {
  const line = String(text ?? "").split("\n")[0].trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/**
 * An item that verifies another seat's work carries the protocol marker in its
 * subject (`VERIFY #N`, how a verification is routed to a verifier seat). Exported
 * so the marker has ONE definition, like VERIFIER_TERMS.
 */
export function isVerificationItem(item) {
  return /\bVERIFY\b/i.test(String(item?.subject ?? ""));
}

/**
 * Whether a completion carries re-runnable evidence — the shape `complete_work`
 * records: a non-blank command and a finite exit code. A blank command is a claim,
 * not evidence.
 */
export function hasEvidence(item) {
  const e = item?.evidence;
  return (
    e != null &&
    typeof e.command === "string" &&
    e.command.trim() !== "" &&
    typeof e.exitCode === "number" &&
    Number.isFinite(e.exitCode)
  );
}

/**
 * #2547 (lead ruling A): whether a completion NAMES the artifact its evidence is about.
 *
 * The evidence contract is `{ command, exitCode, artifact }` (ROADMAP 48 / W2). A command and
 * an exit code are re-runnable, but with no artifact the reader cannot tell WHICH revision was
 * checked — the same command against a different rev is a different check — so the completion
 * is not ADDRESSABLE. A blank or absent artifact is that gap; `hasEvidence` alone does not see
 * it (kept separate so "is there evidence at all" and "is it addressable" stay distinct).
 */
export function hasArtifact(item) {
  const e = item?.evidence;
  return e != null && typeof e.artifact === "string" && e.artifact.trim() !== "";
}

/**
 * #4153: whether an `artifact` NAMES WHAT THE CHECK RAN AGAINST. A green depends on the tree it ran
 * in - "a suite run in `.` measures the shared tree", a derived file verified on its own branch is
 * consistent with itself, two seats can disagree about `main` because both measured the wrong tree.
 * So an artifact that names nothing is un-re-checkable by a human later, which is the gap in all four
 * instances. A SUBJECT is either a GIT TREE (a sha 7-40 hex, a ref-like token, or `main`) or a
 * NON-GIT subject the check legitimately ran against instead (the store, the queue, a scratch) -
 * for those a git tree is genuinely N/A, so naming the store IS naming what was checked.
 *
 * MEASURED against the live queue before shipping (#4153): 774 terminal items carry evidence with a
 * non-blank artifact; 15 name no GIT tree, and after the non-git-subject carve-out 2 remain - both a
 * bare `"2148"`. A guard that fires on 2 of 774 is a guard; the duplicate rule's lesson is that a
 * rule shipped without this count is a rule that gets disabled.
 *
 * STATED LIMIT: this rule cannot reach a seat BEFORE it writes a completion - it reads what was
 * already written. The `complete_work` description carries the same convention so it shapes what
 * gets written. TWO MECHANISMS FOR TWO MOMENTS, neither a substitute for the other.
 * STATED LIMIT (the half NOT built): "a DERIVED artifact must be named as MERGED" needs ancestry
 * (`git merge-base --is-ancestor`), which is a SUBPROCESS, and checkup never runs one; and ancestry
 * gives FALSE NEGATIVES on squash-shaped landings (#3337), so a sha that is not an ancestor of main
 * may still BE the merged content. A rule on ancestry would flag correct evidence as wrong.
 */
export function namesCheckSubject(artifact) {
  const a = String(artifact ?? "");
  if (a.trim() === "") return false;
  // A git tree: a sha (7-40 hex, not part of a longer hex run), `main`, or a ref-like token.
  if (/(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/i.test(a)) return true;
  if (/(?:\bmain\b|\borigin\/|^refs\/|\b[\w.-]+-item-\d+\b|\bv?\d+\.\d+\.\d+\b)/i.test(a)) return true;
  // A non-git subject: the store, the queue, a scratch - where a git tree is genuinely N/A.
  if (/(\.sqlite|@read|\bqueue\b|\bstore\b|live state|live tree|scratch|\bno commit\b|no code changed)/i.test(a)) return true;
  return false;
}

/**
 * The MANDATORY runbook front-matter keys, in the order `docs/runbooks/README.md`
 * ("Front-matter (mandatory)") and `docs/runbooks/_template.md` list them. `check_rule`
 * is a REQUIRED key whose VALUE may legitimately be `null` — the key is what makes the
 * block retrievable as a schema, which is the whole point of the block.
 */
export const RUNBOOK_FRONT_MATTER_KEYS = [
  "runbook",
  "symptom",
  "writes",
  "precondition",
  "last_verified",
  "verified_by",
  "evidence",
  "check_rule",
];

/** The only legal `precondition` values (the header is enforced in code, not prose — ROADMAP 69). */
export const RUNBOOK_PRECONDITIONS = ["broker-stopped", "read-only", "none"];

/**
 * The fixed skeleton `_template.md` defines, in order. `Diagnose` is matched by
 * prefix so "Diagnose (read-only)" and a bare "Diagnose" both conform; the other
 * headings are exact, because the index and the readers rely on the same words.
 */
export const RUNBOOK_TEMPLATE_SECTIONS = [
  "When to use",
  "Impact",
  "Preconditions",
  "Diagnose (read-only)",
  "Do",
  "Verify",
  "If it fails",
  "Escalate to",
  "Evidence",
];

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * The reasons a runbook's header/body fails `_template.md` conformity — a PURE
 * function over plain data, so `auditRig` never touches the filesystem (ROADMAP 81a's
 * input surface). Returns [] when the entry conforms.
 *
 * Judged: the mandatory keys are present; `runbook` mirrors the filename stem (the
 * index key); `writes` is a boolean; `precondition` is one of the three legal values;
 * `last_verified` is a date or `unverified`; `verified_by`/`evidence` are non-empty;
 * `check_rule` is a string or null. When the caller also supplies the runbook's `body`,
 * the `_template.md` skeleton sections are judged too; without a body the section half
 * is simply not judged (the front-matter half still is).
 *
 * `_template.md` itself is EXEMPT: it carries placeholders (`<filename-stem>`) by design,
 * and it is the thing conformity is measured against.
 *
 * @param {{file?:string, frontMatter?:object|null, body?:string}} [runbook]
 * @returns {string[]} human-readable problems, [] when conformant
 */
export function runbookFrontMatterProblems(runbook) {
  const file = String(runbook?.file ?? "");
  const stem = file.split(/[\\/]/).pop().replace(/\.md$/i, "");
  if (stem === "_template") return [];
  const problems = [];
  const fm = runbook?.frontMatter;
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) {
    problems.push("no front-matter block");
  } else {
    for (const key of RUNBOOK_FRONT_MATTER_KEYS) {
      if (!hasKey(fm, key) || fm[key] === undefined) problems.push(`missing key \`${key}\``);
    }
    if (hasKey(fm, "runbook") && isNonEmptyString(fm.runbook) && fm.runbook.trim() !== stem) {
      problems.push(`runbook: "${fm.runbook}" does not mirror the filename stem "${stem}"`);
    }
    if (hasKey(fm, "symptom") && !isNonEmptyString(fm.symptom)) {
      problems.push("symptom: must be a non-empty string");
    }
    if (hasKey(fm, "writes") && typeof fm.writes !== "boolean") {
      problems.push(`writes: must be true or false (got ${JSON.stringify(fm.writes)})`);
    }
    if (hasKey(fm, "precondition") && !RUNBOOK_PRECONDITIONS.includes(fm.precondition)) {
      problems.push(
        `precondition: must be one of ${RUNBOOK_PRECONDITIONS.join(" | ")} (got ${JSON.stringify(fm.precondition)})`,
      );
    }
    if (
      hasKey(fm, "last_verified") &&
      fm.last_verified !== "unverified" &&
      !(isNonEmptyString(fm.last_verified) && /^\d{4}-\d{2}-\d{2}$/.test(fm.last_verified.trim()))
    ) {
      problems.push(`last_verified: must be a YYYY-MM-DD date or "unverified" (got ${JSON.stringify(fm.last_verified)})`);
    }
    if (hasKey(fm, "verified_by") && !isNonEmptyString(fm.verified_by)) {
      problems.push("verified_by: must name who verified it");
    }
    if (hasKey(fm, "evidence") && !isNonEmptyString(fm.evidence)) {
      problems.push("evidence: must name the item(s)/commit(s) that proved it");
    }
    if (hasKey(fm, "check_rule") && fm.check_rule !== null && !isNonEmptyString(fm.check_rule)) {
      problems.push("check_rule: must be a rule id or null");
    }
  }
  const body = runbook?.body;
  if (typeof body === "string") {
    const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
    for (const want of RUNBOOK_TEMPLATE_SECTIONS) {
      const found =
        want === "Diagnose (read-only)"
          ? headings.some((h) => /^Diagnose\b/.test(h))
          : headings.includes(want);
      if (!found) problems.push(`missing \`## ${want}\` section`);
    }
  }
  return problems;
}

/**
 * @param {object} input
 * @param {string} input.rig            rig file path, for display
 * @param {object} input.spec           parsed rig file
 * @param {string|undefined} input.specConstitution  resolved constitution text, if the spec declares one
 * @param {{reason:"read",text:string}|{reason:"absent"}|{reason:"unreadable",error:string}} input.stored
 * @param {string[]|null} [input.storedSeats]  seat names the store holds, or null when it was not read
 * @param {Record<string,string>} [input.modelsBySeat]  seat name -> "provider/modelId"
 * @param {Array<{file:string, frontMatter:object|null, body?:string, changedNamedFiles?:string[]}>} [input.runbooks]
 *   runbook data the CALLER read from docs/runbooks/* and passed as plain values (this module never
 *   touches the filesystem). Each entry carries the parsed front-matter and the files the runbook
 *   NAMES that changed since `last_verified`. Omit it entirely to leave the runbook rules unrun
 *   (they are then reported skipped, never as a false pass).
 * @param {Array<object>|null} [input.queueItems]  the store's queue items, or null when the queue was not read
 * @param {Array<{sha:string, subject:string, touchedFeatures:boolean, noSurfaceNote:boolean}>|null} [input.featureDocs]
 *   the `feat` commits the CALLER read from git history (src/featuredocs.mjs) and whether each
 *   touched docs/FEATURES.md; null when the history was not read. Omit it to leave the
 *   FEATURES-row rule unrun (it is then reported skipped, never as a false pass).
 * @param {Array<{file:string,line:number,set:string,noun:string,claimed:number|null,claimedText:string}>|null} [input.docCounts]
 *   the count claims the CALLER read from docs/*.md (src/doccounts.mjs). An EMPTY array is a real
 *   "these docs state no declared-set counts"; null / absent means the docs were never read, so the
 *   rule reports UNKNOWN, never a false pass (#6155).
 * @returns {{findings:Array, checks:Array, summary:object, pass:boolean, exitCode:number}}
 */
export function auditRig({ rig, spec, specConstitution, stored, storedSeats = null, modelsBySeat = {}, runbooks, queueItems = null, featureDocs = null, commitMessages = null, textIntegrity = null, citations = null, sharedTreeBranch = null, sharedTreeLinked = false, sharedTreeExpected = "main", contextBySeat = null, docCounts = null }) {
  const findings = [];
  const skipped = [];
  const add = (id, subject, detail, fix) =>
    findings.push({ id, severity: SEVERITY_OF.get(id), subject, detail, fix });

  const seats = Array.isArray(spec?.seats) ? spec.seats : [];
  const names = new Set(seats.map((s) => s.name));
  const storeRead = stored?.reason === "read";
  const storeHasText = storeRead && String(stored.text ?? "").trim() !== "";

  // 1. A constitution must reach the seats at all. When the spec declares none
  //    and the store could not be read, the honest answer is "unknown", not a
  //    pass and not a finding — so the rule is skipped with its reason.
  if (specConstitution !== undefined || storeRead) {
    if (specConstitution === undefined && !storeHasText) {
      add(
        "constitution-missing",
        "rig",
        "neither the rig file nor this store carries a constitution, so seats run with no shared norms",
        `add a "constitutionInline" text to ${rig} (or point "constitution" at a file) and run: node cli.mjs up ${rig}`,
      );
    }
  } else {
    skipped.push({
      id: "constitution-missing",
      why: "the store could not be read, so an absent constitution cannot be told from an unread one",
    });
  }

  // 2. The proven defect class: the spec declares text and the store holds
  //    something else. This is what let a rig's seats run without the team
  //    culture while the rig file looked correct.
  if (specConstitution !== undefined) {
    if (!storeRead) {
      skipped.push({
        id: "constitution-not-applied",
        why: "the store could not be read, so the applied text cannot be compared",
      });
    } else if (!storeHasText) {
      add(
        "constitution-not-applied",
        "rig",
        `the rig file declares a constitution (${specConstitution.length} bytes) but this store has none, so no seat has received it`,
        `DURIG_DB=<this store> node cli.mjs up ${rig}`,
      );
    } else if (stored.text !== specConstitution) {
      add(
        "constitution-not-applied",
        "rig",
        `store holds ${stored.text.length} bytes starting "${firstLine(stored.text)}"; the rig file has ${specConstitution.length} starting "${firstLine(specConstitution)}"`,
        `DURIG_DB=<this store> node cli.mjs up ${rig}`,
      );
    }
  } else {
    // Nothing declared means nothing to compare: "pass" here would read as
    // "the stored text matches", which was never checked.
    skipped.push({
      id: "constitution-not-applied",
      why: "the rig file declares no constitution, so there is no declared text to compare against the store",
    });
  }

  // 3. Restrictive edges mean every seat needs an outgoing link. A seat that
  //    others send to but that cannot send back is the D16 bug class: pm held
  //    the routing hub and zero edges, so nothing could be reported to it.
  //    Empty/absent edges are "open" here (assertSendAllowed's rule), not broken.
  const edges = Array.isArray(spec?.edges) ? spec.edges : [];
  if (edges.length > 0) {
    const stranded = seats
      .filter((s) => {
        const link = edges.find((e) => e.from === s.name);
        return !link || !Array.isArray(link.maySendTo) || link.maySendTo.length === 0;
      })
      .map((s) => s.name);
    if (stranded.length > 0) {
      add(
        "unreachable-seat",
        stranded.join(", "),
        `the rig declares org edges, but ${stranded.length === 1 ? "this seat has" : "these seats have"} no outgoing target, so nothing can be reported or delegated`,
        "give each seat an edge with at least one recipient (the OpenRig converter grants pm/lead explicit targets for exactly this reason)",
      );
    }
  }

  // 4. An edge to a seat that does not exist is dead routing: it fails only at
  //    send time, long after the config looked fine.
  const dangling = new Set();
  for (const e of edges) {
    if (e?.from !== undefined && !names.has(e.from)) dangling.add(`${e.from} (as a sender)`);
    for (const to of e?.maySendTo ?? []) {
      if (!names.has(to)) dangling.add(`${to} (as a recipient)`);
    }
  }
  if (dangling.size > 0) {
    add(
      "dangling-edge",
      [...dangling].join(", "),
      `the rig declares edges for ${dangling.size} name(s) that no seat has; a send fails at runtime with "unknown seat"`,
      "rename the edge to a real seat, or remove it",
    );
  }

  // 5. Whichever way the store's seat set and the rig file disagree. Both
  //    directions were found live at once (2026-10-11: the live store held a
  //    stray `worker` AND was missing `scribe`), and they are not symmetric:
  //      - a seat the rig file declares and the store lacks cannot receive work
  //        at all — a send fails with "unknown seat" — and the fix is `up`,
  //        exactly like an unapplied constitution, so it is an error;
  //      - a seat the store holds and the file does not declare keeps a
  //        conversation, a stored persona and a working address, and `up` never
  //        removes one, so it is a gap the operator closes by editing the file.
  //    Reporting only the stray direction would have reported half a real
  //    problem while looking complete, which is the failure this whole module is
  //    written against.
  if (!Array.isArray(storedSeats)) {
    for (const id of ["store-missing-seat", "stray-seat"]) {
      skipped.push({
        id,
        why: "the store could not be read, so its seats cannot be compared with the rig file",
      });
    }
  } else {
    const storedNames = new Set(storedSeats);
    const missing = seats.map((s) => s.name).filter((name) => !storedNames.has(name));
    const stray = storedSeats.filter((name) => !names.has(name));
    if (missing.length > 0) {
      add(
        "store-missing-seat",
        missing.join(", "),
        `the rig file declares ${missing.length === 1 ? "a seat" : `${missing.length} seats`} this store does not hold, so a send to ${missing.length === 1 ? "it" : "them"} fails at runtime with "unknown seat"`,
        `create ${missing.length === 1 ? "it" : "them"} in this store: DURIG_DB=<this store> node cli.mjs up ${rig}`,
      );
    }
    if (stray.length > 0) {
      add(
        "stray-seat",
        stray.join(", "),
        `this store holds ${stray.length === 1 ? "a seat" : `${stray.length} seats`} the rig file does not declare, so ${stray.length === 1 ? "it keeps" : "they keep"} a conversation, a stored persona and an address nothing in the file accounts for`,
        `declare ${stray.length === 1 ? "it" : "them"} in ${rig}, or start from a fresh store: up adds and refreshes seats but never removes one`,
      );
    }
  }

  // 6. Independent verification (MAST FC3) needs a seat whose job is checking
  //    someone else's work. A heuristic over name+role text, so it is fix-now
  //    and prints the basis it used.
  if (seats.length < 2) {
    skipped.push({
      id: "no-verifier-seat",
      why: "a rig with fewer than two seats has no second seat to verify anything",
    });
  } else {
    const verifiers = seats.filter(seatsAreVerifier).map((s) => s.name);
    if (verifiers.length === 0) {
      add(
        "no-verifier-seat",
        "rig",
        `no seat's name or role matches the verifier vocabulary (${VERIFIER_TERMS.join(", ")}), so nothing independently checks a completion — complete_work is self-declared`,
        "add a verifier seat (name or role containing e.g. \"verifier\", \"qa\" or \"reviewer\") that never signs off on its own author's work",
      );
    }
  }

  // 7. One model for every seat makes correlated failure systemic rather than
  //    isolated (Anthropic swarm). Exact: it counts resolved models.
  const resolved = Object.values(modelsBySeat).filter(Boolean);
  if (seats.length >= 2 && resolved.length === seats.length) {
    const distinct = [...new Set(resolved)];
    if (distinct.length === 1) {
      add(
        "single-model-rig",
        "rig",
        `all ${seats.length} seats resolve to ${distinct[0]}, so a shared blind spot is systemic; per-seat models are already supported`,
        "give verifier seats (qa/qa2 or their equivalent) a different model family from the authors they check, then re-run: node cli.mjs check " + rig,
      );
    }
  } else if (seats.length >= 2) {
    skipped.push({
      id: "single-model-rig",
      why: "seat models could not all be resolved in this process",
    });
  }

  // 8. Tool scoping is derived from each seat's declared capabilities, so a seat that declares NONE
  //    silently becomes a coordinator with no file or shell tools - it cannot do work at all. That
  //    is a rig-file omission almost every time, and it is invisible from the outside (the seat just
  //    defers everything), so it is reported rather than inferred. Same reasoning as `no-verifier-seat`:
  //    a heuristic with a printed basis beats a silent absence.
  const capless = seats.filter((s) => !(s.capabilities ?? []).length).map((s) => s.name);
  if (capless.length > 0) {
    add(
      "seat-without-capabilities",
      "rig",
      `${capless.join(", ")} - no capabilities declared, so per-seat tool scoping gives these seats no working tools and they cannot do work`,
      "declare what each seat does - \"implement\"/\"code\" to produce, \"verify\"/\"review\" to check, or \"route\"/\"plan\"/\"decide\" for coordination - so the tool set matches the role",
    );
  }

  // 9. Runbook health (docs/runbooks/README.md maintenance policy; ROADMAP 81/82). auditRig stays
  //    PURE: the caller reads docs/runbooks/* and passes plain data - each runbook's parsed
  //    front-matter (plus, when it has one, the body) and the files it NAMES that changed since
  //    `last_verified`. A runbook whose Verify step never ran is fix-now (unproven but harmless to a
  //    run); one verified before a file it names changed is an ERROR, because its literal steps may
  //    no longer match the code; one whose header/skeleton does not conform to _template.md is
  //    fix-now, because the block is how a seat or a rule retrieves the procedure's assumptions.
  //    Omitting `runbooks` leaves all three rules SKIPPED with a reason - never a false pass.
  // #5767 — "skipped" and "not judged" are DIFFERENT facts, and a seat reading the
  // output cannot tell them apart if both print the same word. A rule skipped because the
  // rig legitimately has no such block (ownership) has DECIDED something; these three have
  // judged nothing, because the caller supplied no runbook data. So they report UNKNOWN.
  if (!Array.isArray(runbooks)) {
    const why = "no runbook data was supplied, so no runbook can be judged";
    for (const id of ["runbook-stale", "runbook-unverified", "runbook-front-matter"]) {
      skipped.push({ id, why, unknown: true });
    }
  } else {
    for (const runbook of runbooks) {
      const file = runbook?.file ?? "(unnamed runbook)";
      // Conformity to _template.md (ROADMAP 82): judged on every entry, independent of
      // verification state — an unreadable header is a defect even when the Verify step ran.
      const problems = runbookFrontMatterProblems(runbook);
      if (problems.length > 0) {
        add(
          "runbook-front-matter",
          file,
          `${file} does not conform to _template.md: ${problems.join("; ")}`,
          "fix the runbook's front-matter block / skeleton to match docs/runbooks/_template.md (see the README's schema)",
        );
      }
      const lastVerified = runbook?.frontMatter?.last_verified;
      if (lastVerified === undefined || lastVerified === null || lastVerified === "" || lastVerified === "unverified") {
        add(
          "runbook-unverified",
          file,
          `${file} has never had its Verify step run (last_verified: ${lastVerified ?? "absent"}), so the procedure is unproven`,
          "run the runbook's Verify step, then set last_verified: <date> in its front-matter",
        );
        continue;
      }
      const changed = Array.isArray(runbook?.changedNamedFiles)
        ? runbook.changedNamedFiles.filter((path) => typeof path === "string" && path !== "")
        : [];
      if (changed.length > 0) {
        add(
          "runbook-stale",
          file,
          `${file} was verified ${lastVerified}, but ${changed.length === 1 ? "a file it names has" : `${changed.length} files it names have`} changed since (${changed.join(", ")}), so its steps may no longer match the code`,
          "re-run the runbook's Verify step and update last_verified, or fix the runbook to match the code",
        );
      }
    }
  }
  // 10. ROADMAP 46 / D62: the docs-ownership norm maps each artifact CLASS to a live
  //    owning seat, and a prose grid not enforced here goes stale. "Live" means NAMED IN
  //    THE RIG SPEC, not registered in the store: the spec is the machine-readable source
  //    for "the rig declares this seat", spec-vs-store drift is store-missing-seat /
  //    stray-seat's job, and a store read here would restyle that rule and break this
  //    module's purity. The block is OPTIONAL — absent means the rule is SKIPPED with its
  //    reason (a bare rig is legitimately silent about ownership), never a silent pass.
  //    Present means every named seat must be declared, else an error naming the seat(s)
  //    and class(es) (fix: declare the seat, or correct the block). Only owner COLUMNS are
  //    checked — a secondary/audit attribute is prose until its own rule is wanted.
  const ownership = spec?.ownership;
  if (ownership === undefined || ownership === null) {
    skipped.push({
      id: "ownership-seat-missing",
      why: "the rig declares no `ownership` block, so there are no owner seats to check against its declared seats",
    });
  } else if (typeof ownership !== "object" || Array.isArray(ownership)) {
    add(
      "ownership-seat-missing",
      "rig",
      "the rig's `ownership` block is not an object of class -> owner-seat(s)",
      "shape it as {\"<class>\": [\"<seat>\", ...]} keyed to the docs-ownership artifact classes",
    );
  } else {
    const ghosts = [];
    for (const [cls, owners] of Object.entries(ownership)) {
      for (const owner of Array.isArray(owners) ? owners : [owners]) {
        if (typeof owner !== "string" || !names.has(owner)) ghosts.push(`${owner} (class ${cls})`);
      }
    }
    if (ghosts.length > 0) {
      add(
        "ownership-seat-missing",
        ghosts.join(", "),
        `${ghosts.length === 1 ? "an ownership class names an owner seat" : `${ghosts.length} ownership classes name owner seats`} the rig does not declare: ${ghosts.join(", ")}`,
        `declare the seat(s) in ${rig} and run: node cli.mjs up ${rig}, or correct the ownership block`,
      );
    }
  }
  // 11. ROADMAP 48 / W2: a verifier that only acks is the sycophancy-collapse setup (peer
  //    agreement ~29.7% on a wrong peer). The completion must carry EVIDENCE a reader can
  //    re-run (a command + its exit code), not a claim. An item is a verification task when
  //    its subject carries the protocol marker (`VERIFY #N`); the rule fails when such a task
  //    is `done` with no evidence recorded. When the queue could not be read, the rule is
  //    SKIPPED with its reason, never passed — "could not check" is not "checked and fine".
  if (!Array.isArray(queueItems)) {
    skipped.push({
      id: "verification-without-evidence",
      why: "the queue could not be read, so completed verification tasks cannot be inspected",
    });
  } else {
    // #2547 (lead ruling A): a completion is only re-checkable if it names the ARTIFACT the
    // command ran against. A command + exit code with no artifact can be re-run against the
    // WRONG revision, so a VERIFY item that records evidence without a non-blank `artifact`
    // is as unaddressable as one with no evidence at all.
    const acked = queueItems.filter(
      (it) => it?.status === "done" && isVerificationItem(it) && (!hasEvidence(it) || !hasArtifact(it)),
    );
    if (acked.length > 0) {
      const ids = acked.map((it) => `#${it.id}`).join(", ");
      add(
        "verification-without-evidence",
        ids,
        `${acked.length === 1 ? "verification item" : `${acked.length} verification items`} ${ids} completed without re-runnable evidence — the completion is an ack (or names no artifact), not a re-run, so nothing can be re-checked`,
        "re-run the artifact and record it when completing a verification item: complete_work(<id>, <summary>, { command, exitCode, artifact }) — an ack alone is not a sign-off, and a command/exit code with no ARTIFACT cannot be re-checked (W2/#2547)",
      );
    }
  }
  // 13. #4075 (corrected #3460/#3459): SAME-INTENT duplicates, fired on a NON-TERMINAL item so a
  //    seat is stopped before it spends the effort, not told afterwards. The cause is a ~10s retry
  //    OUTSIDE durig, so #3192's originCallId dedup cannot catch a re-issue (a re-issue carries a
  //    NEW tool-call id), and two of five observed pairs are REWORDED, so byte equality would miss
  //    them. The test is same from/to/tier PLUS high subject overlap. When the queue could not be
  //    read the rule is SKIPPED with its reason, never passed.
  if (!Array.isArray(queueItems)) {
    skipped.push({
      id: "duplicate-item",
      why: "the queue could not be read, so duplicate items cannot be inspected",
    });
  } else {
    const terminal = queueItems.filter((it) => isTerminalStatus(it));
    const live = queueItems.filter((it) => it && !isTerminalStatus(it));
    for (const it of live) {
      // #4099: a live item that NAMES its terminal twin is a SUPERSESSION, not a duplicate.
      const twin = terminal.find((t) => sameIntent(t, it) && !namesPredecessor(it, t));
      if (twin) {
        add(
          "duplicate-item",
          `#${it.id}`,
          `#${it.id} is SAME-INTENT with the already-terminal #${twin.id} (same from/to/tier, subject overlap ${subjectOverlap(it.subject, twin.subject).toFixed(2)}) — the same request is in the queue twice, so working #${it.id} repeats work the terminal twin already settled`,
          `cancel #${it.id} as a duplicate of #${twin.id} (point at the completed original), or state in the body why it is a deliberate second attempt`,
        );
      }
    }
  }

  // 13b. STRANDED GATE — the cross-row rule `workable()` enforces and no audit ever reported. A
  //    dependent whose prerequisite was CANCELLED is permanently unclaimable; the only trace today is
  //    a broker-log SKIP line. Uses the SAME census the repair verb plans from (src/queueops.mjs), so
  //    the audit and the repair can never disagree about which rows are stranded.
  if (!Array.isArray(queueItems)) {
    skipped.push({
      id: "stranded-gate",
      why: "the queue could not be read, so terminal-gated items cannot be inspected",
    });
  } else {
    const stranded = strandedGates(queueItems);
    for (const row of stranded.rows) {
      add(
        "stranded-gate",
        `#${row.id}`,
        `#${row.id} (${row.status}, to ${row.to ?? "?"}) is gated on the CANCELLED #${row.gateId} — a cancelled gate can never be satisfied, so this row can never be claimed and nothing repairs the chain`,
        `release the dead gate: node intent.mjs queue --op queue --action repair-gates --id ${row.id} --apply  (propose first: drop --apply)`,
      );
    }
  }

  // 13c. HUMAN-DEFERRAL PAST CLOCK — the census behind the escalation wake (src/deferlease.mjs). A park on the
  //    operator is a lease now; a row past it is a decision nobody made, and `lead` is woken with this same
  //    count. One row per report rather than one per item: the operator reads a number and the oldest id.
  if (!Array.isArray(queueItems)) {
    skipped.push({
      id: "human-deferral-past-clock",
      why: "the queue could not be read, so parked deferrals cannot be inspected",
    });
  } else {
    const census = escalations(queueItems);
    if (census.count > 0) {
      add(
        "human-deferral-past-clock",
        `${census.count} deferral(s)`,
        escalationText(census),
        "lead decides: release one whose question is answerable from the standing rulings, re-route it to the seat that owns the decision, or answer it — and the park becomes bounded for every NEW deferral automatically",
      );
    }
  }

  // 13d. POOL DEAD GATE (N19 row 7) - the pool's version of the dead-gate rule. `workable()` refuses a row
  //      whose `requires` SET names a capability the seat does not list, so a capability nobody advertises makes
  //      the row unclaimable by EVERY seat: it is counted as queued work while no wake, no claim and no skip
  //      line ever surfaces it. Capabilities are read from the rig file's seat entries - the same declarations
  //      `up` writes into the roster - so the audit and the gate read one source.
  if (!Array.isArray(queueItems)) {
    skipped.push({
      id: "pool-dead-gate",
      why: "the queue could not be read, so pool rows cannot be inspected",
    });
  } else if (seats.length === 0) {
    skipped.push({
      id: "pool-dead-gate",
      why: "the rig file declares no seats, so capability coverage cannot be judged",
    });
  } else {
    const advertised = new Set();
    for (const s of seats) for (const cap of requiredCapabilities(s.capabilities)) advertised.add(cap);
    for (const it of queueItems) {
      if (!openPoolRow(it) || isTerminalStatus(it)) continue; // a DONE/CANCELLED row is history, not a live gate
      const needed = requiredCapabilities(it.requires);
      if (needed.length === 0) continue; // nothing required: any eligible seat may take it
      const missing = needed.filter((cap) => !advertised.has(cap));
      if (missing.length > 0) {
        add(
          "pool-dead-gate",
          `#${it.id}`,
          `#${it.id} (${it.status}, in the POOL) requires ${missing.join(", ")} and NO seat advertises it — roster: ${seats.map((s) => `${s.name}:[${requiredCapabilities(s.capabilities).join("|") || "none"}]`).join(" ")}; the row is queued, invisible to every claim, and no wake can fire for it`,
          `either advertise the capability in the rig file (seats[].capabilities) and run: node cli.mjs up ${rig}, or split the row into pieces an existing seat can take (send_work pool:true with the capability that seat has)`,
        );
      }
    }
  }

  // 13e. POOL CLAIM WITHOUT CAPABILITY (N19 row 7) - the gate's invariant, checked over the rows as they are
  //      now rather than reconstructed from history (P7: no side document). A pool row WITH an owner-of-record
  //      must be one that owner advertises. Two ways this can be true without the code being wrong: the roster
  //      changed after the claim, or the row was minted before the gate existed.
  if (!Array.isArray(queueItems)) {
    skipped.push({
      id: "pool-claim-without-capability",
      why: "the queue could not be read, so claimed pool rows cannot be inspected",
    });
  } else {
    const capBySeat = new Map(seats.map((s) => [s.name, requiredCapabilities(s.capabilities)]));
    for (const it of queueItems) {
      if (it.pool !== true || !it.to || isTerminalStatus(it)) continue;
      const needed = requiredCapabilities(it.requires);
      if (needed.length === 0) continue;
      const caps = capBySeat.get(it.to);
      if (caps === undefined) continue; // an owner the rig file does not declare is owned by store-missing-seat / dangling-edge
      const missing = needed.filter((cap) => !caps.includes(cap));
      if (missing.length > 0) {
        add(
          "pool-claim-without-capability",
          `#${it.id}`,
          `#${it.id} (${it.status}, taken from the POOL by ${it.to}) requires ${missing.join(", ")} which ${it.to} does not advertise — the seat holds work it is not eligible for, so no other seat can take it either`,
          `give the seat the capability in the rig file and run: node cli.mjs up ${rig} — or re-send the row to a seat that has it and cancel this one (a row is POOL-addressed only while its "to" is null)`,
        );
      }
    }
  }

  // 11b. #4153 EVIDENCE-TREE: a completion whose evidence names an artifact that names NO tree (and
  //    no store) cannot be re-checked - the reader cannot tell WHICH revision was checked, and a
  //    green depends on the tree it ran in. This is the SHARPENING of `hasArtifact` (a non-blank
  //    artifact) to "a NAMED subject": hasArtifact accepts "2148"; this does not. Scoped to items
  //    that HAVE evidence AND a non-blank artifact, so it never duplicates
  //    verification-without-evidence (which owns the MISSING artifact). Plain data, no subprocess.
  if (!Array.isArray(queueItems)) {
    skipped.push({
      id: "evidence-tree",
      why: "the queue could not be read, so completed items' artifacts cannot be inspected",
    });
  } else {
    const unnamed = queueItems.filter(
      (it) =>
        it?.status === "done" && hasEvidence(it) && hasArtifact(it) && !namesCheckSubject(it.evidence.artifact),
    );
    if (unnamed.length > 0) {
      const ids = unnamed.map((it) => `#${it.id}`).join(", ");
      add(
        "evidence-tree",
        ids,
        `${unnamed.length === 1 ? "completion" : `${unnamed.length} completions`} ${ids} name an artifact that names no tree (and no store) — a green depends on the tree it ran in, so an un-named artifact cannot be re-checked by a human later`,
        "name WHAT the check ran against: complete_work(<id>, <summary>, { command, exitCode, artifact: '<sha|branch|main>' }) — or the store/queue for a non-git check (e.g. 'selfdev.sqlite@read')",
      );
    }
  }
  // 12. ROADMAP 190: a cited commit must RESOLVE, or the row must not cite it. The queue cites
  //     MACHINE-LOCAL GIT OBJECTS as durable evidence, and a pointer into an object store that did
  //     not travel with the store is not evidence. Measured on the Windows->Linux move: 178 distinct
  //     shas cited, 90 resolving nowhere, on 240 terminal rows and 14 NON-TERMINAL ones. The rule
  //     deliberately does NOT claim to know whether a dead citation is a stale pointer (landing
  //     rewrote the branch commit) or lost work — only patch-equivalence can tell those apart — so
  //     it reports what it measured and its fix names the ladder. Non-terminal rows are one finding
  //     each because each is actionable; terminal rows collapse to ONE baseline count, because 240
  //     findings is a wall a reader skips, and amending history is not the point of a gate on new
  //     work. No data means SKIPPED with its reason (D25) — never a silent pass.
  if (!Array.isArray(citations)) {
    skipped.push({
      id: "citation-unresolvable",
      why: "the queue's citations were not resolved against this repository, so a dead citation cannot be told from an unchecked one",
    });
  } else {
    const dead = citations.filter((c) => c.resolves === false);
    const live = dead.filter((c) => !isTerminalStatus({ status: c.status }));
    const historical = dead.filter((c) => isTerminalStatus({ status: c.status }));
    for (const c of live) {
      add(
        "citation-unresolvable",
        `#${c.itemId}`,
        `${c.status} item cites \`${c.sha}\`, which this clone does not hold — whoever picks this up cannot re-check the evidence it names`,
        `resolve it before releasing the row: \`git log -S'<a distinctive line from the described change>'\` / \`git log --grep='#${c.itemId}'\` (patch-equivalence) — if the change is on main, amend the citation to the landing commit; if it is genuinely lost, say so in the row rather than leaving a pointer nobody can follow`,
      );
    }
    if (historical.length > 0) {
      const ids = historical.slice(0, 6).map((c) => `#${c.itemId}`).join(" ");
      add(
        "citation-unresolvable",
        "queue (history)",
        `${historical.length} terminal item(s) cite commits this clone does not hold (e.g. ${ids}) — their \`done\` cannot be re-checked from a clean clone`,
        "no action needed unless one is re-opened, then amend it to the landing commit; record the count as a known-red baseline rather than re-deriving it, and cite store-native ids (entries.id) on new work so this stops growing (ROADMAP 190)",
      );
    }
  }

  // 12. ROADMAP 46 (FEATURES-row half) / D62: a shipped capability carries its own doc
  //    acceptance — the docs/FEATURES.md row — or its item records an explicit "no feature
  //    surface" note. The merge gate (docs/runbooks/merge.md) enforces this by hand with a
  //    `git log --grep '^feat'` sweep; a prose gate goes stale, so it is checked here. The
  //    input is plain data the CALLER read from git (src/featuredocs.mjs) for the same reason
  //    the runbook rules take plain data: checkup never runs a subprocess. Absent input means
  //    the history was not read => SKIPPED with its reason, never a silent pass (D25).
  //    Severity is fix-now, not error: a missing doc row does not stop the rig working, so it
  //    must not fail a script — the merge gate is where it blocks. Stated limit (mirrors the
  //    block this replaces): only `feat` commits, and only a SAME-commit touch of the doc.
  if (!Array.isArray(featureDocs)) {
    skipped.push({
      id: "feature-row-missing",
      why: "no git-history data was supplied, so shipped capabilities cannot be checked against docs/FEATURES.md",
    });
  } else {
    const drifted = featureDocs.filter((c) => c && c.touchedFeatures !== true && c.noSurfaceNote !== true);
    if (drifted.length > 0) {
      const named = drifted
        .map((c) => `${String(c?.sha ?? "?").slice(0, 8)} ${firstLine(c?.subject ?? "(no subject)", 64)}`)
        .join("; ");
      add(
        "feature-row-missing",
        drifted.map((c) => String(c?.sha ?? "?").slice(0, 8)).join(", "),
        `${named} — a feat commit with no docs/FEATURES.md row and no "no feature surface" note, so a shipped capability has no doc entry (D62)`,
        "add the docs/FEATURES.md row for each, or record an explicit \"no feature surface\" note in its item",
      );
    }
  }

  // 13. The shared working tree must sit on its integration branch. A seat whose cwd fell back to
  //    the shared tree once switched it onto an item branch (2026-10-19, devtools #2412 -
  //    docs/incidents/2026-10-17-seat-root-fallback-commit.md): the landing basis breaks and
  //    "live" writes land on a feature branch. `auditRig` is a pure function, so the CALLER reads
  //    the branch (src/featuredocs.mjs) and passes it; no data means SKIPPED with a reason, never a
  //    silent pass (D25). A detached HEAD reads as "" and is a finding like any other branch.
  //
  //    LINKED worktrees are exempt: `scripts/land.mjs` runs the suite in a DETACHED scratch
  //    worktree, and every seat/item worktree is linked too. There the branch reads as "" (scratch)
  //    or names the item branch (seat), neither of which is the shared tree's branch - so the rule
  //    fired on EVERY landing and refused them all (#2679). The caller reports linked-ness
  //    (src/featuredocs.mjs `isLinkedWorktree`); a linked worktree is not the shared tree, so the
  //    rule is SKIPPED with its reason rather than passed (passing would claim a check never run).
  if (sharedTreeLinked === true) {
    skipped.push({
      id: "shared-tree-on-main",
      why: "this is a LINKED worktree (a landing scratch or a seat/item worktree), not the shared tree, so the shared tree's branch cannot be observed from here",
    });
  } else if (sharedTreeBranch === null || sharedTreeBranch === undefined) {
    skipped.push({
      id: "shared-tree-on-main",
      why: "the current git branch was not supplied, so the shared working tree's branch cannot be checked",
    });
  } else if (sharedTreeBranch !== sharedTreeExpected) {
    const on = sharedTreeBranch === "" ? "a detached HEAD" : `branch "${sharedTreeBranch}"`;
    add(
      "shared-tree-on-main",
      sharedTreeBranch || "detached",
      `the shared working tree is on ${on}, not "${sharedTreeExpected}" - a seat whose cwd falls back to the shared tree writes to a feature branch and the landing basis breaks`,
      `switch the shared tree back: git switch ${sharedTreeExpected}; land item branches through the landing helper`,
    );
  }

  // 14. A commit message must not carry a UTF-8 BOM (or a NUL / stray CR) - #4349. Four commits in
  //    one session carried a BOM because PowerShell's `Set-Content -Encoding utf8` writes one, and
  //    each was caught by hand; four catches is not a catch rate, it is a mechanism that does not
  //    exist. (A FIFTH — 30270c0 — was NOT amended and IS in history, recorded as a known-reds
  //    baseline in docs/STATUS.md; this rule's job is both to stop the next one and to keep finding
  //    this one until the operator deals with it.) A BOM is INVISIBLE IN EVERY NORMAL VIEW (`git log --oneline` renders it, `git show`
  //    renders it, the author sees a clean subject) and surfaces only in a byte read - which is
  //    exactly what a check is for. The WHOLE message is checked, not just the subject: a BODY BOM
  //    corrupts a `Co-authored-by` trailer or a `Fixes #N` line, where the parser is strict. The
  //    caller reads the messages (src/commitmsg.mjs) and passes PLAIN DATA, so this stays a linter
  //    over data; no data means SKIPPED with its reason, never a silent pass (D25).
  if (!Array.isArray(commitMessages)) {
    skipped.push({
      id: "commit-message-encoding",
      why: "the recent commit messages were not supplied, so their encoding cannot be inspected",
    });
  } else {
    const bad = commitMessages.map((m) => ({ m, defects: messageDefects(m) })).filter((x) => x.defects.length > 0);
    if (bad.length > 0) {
      const ids = bad.map((x) => String(x.m.sha ?? "").slice(0, 8)).join(", ");
      add(
        "commit-message-encoding",
        ids,
        `${bad.length === 1 ? "commit" : `${bad.length} commits`} ${ids} carry a UTF-8 BOM (or a NUL / stray CR) in the message — invisible in every normal view, so it surfaces only in a byte read, and a body BOM corrupts a trailer`,
        "rewrite the message through a writer that does NOT add a BOM (node's fs, or the write/edit tool) and amend the commit from that file. PowerShell's `Set-Content -Encoding utf8` writes one — do not use it for commit messages",
      );
    }
  }

  // 15. TEXT INTEGRITY (#4371, detector #4305): a tracked file whose newline structure COLLAPSED versus
  //    HEAD, or whose encoding is broken. `node --check` is STRUCTURALLY BLIND to this - the flattening
  //    turns the opening `//` into a comment that swallows the whole file, so it still parses and
  //    exports NOTHING, and the failure surfaces only at import time. ERROR severity because a broken
  //    tree stops every seat; the false-positive surface is handled by the CALLER, which passes only
  //    the files that DIFFER from HEAD, and by the detector, which exempts untracked files from the
  //    collapse comparison (no HEAD to compare against). No data means SKIPPED with its reason (D25).
  if (!Array.isArray(textIntegrity)) {
    skipped.push({
      id: "text-integrity",
      why: "the working tree's changed files were not supplied, so their text integrity cannot be inspected",
    });
  } else {
    for (const f of textIntegrity) {
      add(
        "text-integrity",
        f.path,
        describeFaults(f.path, f.faults),
        `restore from HEAD (git show HEAD:${f.path}) and re-apply the intended edit — do not patch bytes`,
      );
    }
  }

  // #5049 (ROADMAP 208): the context fraction is on the health snapshot and NOTHING scored it, so a seat
  // reading 9.96x its window was displayed and dropped. The rule scores the SAME map `status.context`
  // prints (produced by `seatContextMap`), never a second computation of it.
  //
  // WHY IT STARTS GREEN instead of red-with-caveats (#3539: a rule as specified can start hundreds-red and
  // be switched off): the two known false-alarm classes are excluded by the MEASURE's own state, not by a
  // name allowlist — a turn behind a `pi.compaction`/`pi.reset` boundary (a seat compacted after a long turn
  // legitimately prints a fraction over 1 until its NEXT turn, D199/D200) and a seat with no window in any
  // denominator state (there is no fraction to score). Measured on the live store 2026-11-04: 12
  // conversations carried entries, exactly one exceeded its declared 200,000 window, and that one sat behind a
  // boundary — so the rule finds nothing today. Scored against the WRONG denominator it would find 7 of 12,
  // which is what the denominator's state in the finding text exists to prevent. `fix-now`, not `error`: a
  // seat over its window does not make the rig unable to work, and nothing here stops a seat (#3271 — a cheap
  // signal may ACCEPT but never DECIDE; the stop actuator is #1781's row).
  if (contextBySeat === null || contextBySeat === undefined) {
    skipped.push({
      id: "context-over-window",
      why: "no per-seat context measure was supplied (the store could not be read, or the context read failed), so no fraction can be scored",
    });
  } else {
    for (const [seatName, measure] of Object.entries(contextBySeat)) {
      const over = contextOverWindow(measure);
      if (!over.fired) continue;
      add(
        "context-over-window",
        seatName,
        `one turn MOVED ${over.consumed} tokens = ${over.fraction.toFixed(2)}x the ${over.denominator} window of ${over.windowValue}; axis: tokens the provider MOVED in one turn (cacheRead ${over.cacheRead} of them), NOT the live head; nothing reset the head after entry ${over.head?.usageEntryId ?? "?"}`,
        `node cli.mjs compact ${seatName} "fold the early turns into a summary" — the gate is the accumulation budget (keepRecentTokens), NOT the window, so read the exit code: 0 cut, 1 failed, 2 no-op (docs/runbooks/compact-a-seat.md); the effective window and budget are printed by \`node cli.mjs config\`; the window itself is DURIG_<PROVIDER>_CONTEXT (a capacity ruling, not a seat edit)`,
      );
    }
  }

  // 12. #6155: a doc may state a COUNT only of a set the code DECLARES, and the declaration wins.
  //    "check (eight rules)" is authority without a source: it reads as fact, drifts as rules are
  //    added, and nothing can catch it - the same failure mode as a threshold nobody can reproduce.
  //    `docCounts` is plain data read by the caller (src/doccounts.mjs); auditRig still touches no fs.
  if (!Array.isArray(docCounts)) {
    skipped.push({
      id: "doc-count-drift",
      why: "no doc text was read by the caller, so no stated count can be judged",
      unknown: true,
    });
  } else {
    for (const claim of docCounts) {
      const declared = DECLARED_COUNTS[claim?.noun];
      const where = `${claim?.file ?? "(unnamed doc)"}:${claim?.line ?? "?"}`;
      if (declared === undefined) {
        add(
          "doc-count-drift",
          where,
          `${where} states ${claim?.claimedText ?? "a count"} for a set nothing declares, so the number cannot be re-checked`,
          "name the declaring file and export, or drop the number",
        );
        continue;
      }
      if (claim.claimed === null) {
        add(
          "doc-count-drift",
          where,
          `${where} states ${claim.claimedText} - a count that is not a number, so no tool can verify it against the ${claim.noun} declared in code (${declared})`,
          `write the number, or drop it and point at the declaration`,
        );
        continue;
      }
      if (claim.claimed !== declared) {
        add(
          "doc-count-drift",
          where,
          `${where} claims ${claim.set} has ${claim.claimed} ${claim.noun}; the code declares ${declared} (src/checkup.mjs RULES / src/metrics.mjs MEASURES)`,
          `set the number to ${declared} (the size of src/checkup.mjs RULES / src/metrics.mjs MEASURES), or drop the count and name the declaring export instead`,
        );
      }
    }
  }

  const summary = { error: 0, "fix-now": 0, total: findings.length };
  for (const f of findings) summary[f.severity] += 1;
  const checks = RULES.map((r) => {
    const skip = skipped.find((s) => s.id === r.id);
    const found = findings.filter((f) => f.id === r.id).length;
    // "unknown" is the could-not-judge state; "skipped" is the not-applicable state (#5767).
    const status = skip ? (skip.unknown ? "unknown" : "skipped") : found > 0 ? "fail" : "pass";
    return { id: r.id, status, found, ...(skip ? { why: skip.why } : {}) };
  });
  const pass = summary.error === 0;
  return { findings, checks, summary, pass, exitCode: pass ? 0 : 1 };
}

const GLYPH = { error: "✗", "fix-now": "!" };
const TONE = { error: "red", "fix-now": "yellow" };

/**
 * Render an audit result for a person. Same data as the JSON contract, shaped
 * for reading: findings grouped in rule order, each with its subject, why, and
 * the exact fix. `color` is opt-in so the function stays testable as plain text.
 */
export function formatCheck(result, { rigDisplay = "rig", color = false, width = 100, seats = 0, storeReason = "absent" } = {}) {
  const paint = (tone, text) => (color ? `${ANSI[tone] ?? ""}${text}${ANSI.reset}` : text);
  const rule = "─".repeat(Math.max(40, Math.min(width, 100)));
  const lines = [];
  lines.push(paint("dim", rule));
  lines.push(`rig check — ${rigDisplay}  (${seats} seat(s), store: ${storeReason})`);
  lines.push(paint("dim", rule));
  lines.push(
    paint("dim", `declared sets: ${DECLARED_COUNTS.rules} rules (src/checkup.mjs RULES) · ${DECLARED_COUNTS.measures} measures (src/metrics.mjs MEASURES)`),
  );
  if (result.findings.length === 0) {
    lines.push("");
    lines.push(`${paint("green", "✓")} no findings — every check the rig can answer passes`);
  }
  for (const f of result.findings) {
    lines.push("");
    lines.push(`  ${paint(TONE[f.severity], GLYPH[f.severity])} ${paint(TONE[f.severity], f.severity)}  ${f.id}`);
    lines.push(`      ${f.subject}: ${f.detail}`);
    lines.push(`      fix: ${f.fix}`);
  }
  lines.push("");
  const passed = result.checks.filter((c) => c.status === "pass").length;
  const skipped = result.checks.filter((c) => c.status === "skipped");
  const unknown = result.checks.filter((c) => c.status === "unknown");
  lines.push(
    `${result.pass ? paint("green", "PASS") : paint("red", "FAIL")}  ${result.summary.error} error · ${result.summary["fix-now"]} fix-now · ${passed} passed` +
      (unknown.length ? ` · ${unknown.length} UNKNOWN (not judged)` : "") +
      (skipped.length ? ` · ${skipped.length} skipped` : ""),
  );
  for (const c of unknown) lines.push(paint("yellow", `      · ${c.id} UNKNOWN: ${c.why}`));
  for (const c of skipped) lines.push(paint("dim", `      · ${c.id} skipped: ${c.why}`));
  lines.push(paint("dim", rule));
  return lines.join("\n");
}
