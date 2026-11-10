// src/heldgate.mjs — classify PARKED (held) queue rows by what their gates actually say (#6071).
//
// WHY THIS EXISTS. `cli.mjs queue --held --with-gates` (#5770) answers "was a gate RECORDED?". It cannot
// answer "is the gate still CLOSED?" - so hundreds of held rows sit on gates that finished weeks ago and
// nothing in status/attention says so. Hand-auditing 459 rows is a 40-minute read, so the classification
// has to be a function that both the tool and a demo can pin.
//
// PURE. No store, no git, no fs: the caller supplies the facts (row statuses, whether a named item has a
// landing commit on main, whether an asked-for artifact is satisfied in the tree). That is what makes the
// rules testable without a 610 MB store, and it keeps one source of truth for the tool and the test.
//
// IT PROPOSES, IT NEVER ACTS. Release, cancel and routing are `pm`'s ActiveRecord transitions
// (docs/runbooks/stale-held-backlog.md §Do). Every class here is a recommendation plus the evidence the
// class rests on, so a human can check it before acting.

import { gateView } from "./queue-lifecycle.mjs";

/** A gate is closed when the row it names can never be worked on again. */
export const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

/** The five classes a held row can land in. The names are stable: the demo pins them. */
export const CLASSES = ["release-candidate", "cancel-candidate", "standing-rule", "gate-open", "unattributed"];

/** Prose that says "this row waits for an EVENT, not for a queue row to finish": a quiet window, an
 * operator ruling, a branch that has to land. A terminal gate id next to such a row proves nothing, so
 * these rows are never release candidates. Each marker is a phrase this rig's own rows actually write. */
const TRIGGER_MARKERS = [
  /do NOT start/i,
  /must NOT be started/i,
  /DO NOT START/,
  /trigger[- ]gated/i,
  /quiet window/i,
  /operator-declared/i,
  /await(s)? (the )?operator/i,
  /standing rule/i,
  /not yet[:;]/i,
  /backlog row/i,
  /register(?:ing|ation) only/i,
  /parked registration/i,
  /registered \(parked/i,
  /until\b[^.]{0,120}\b(lands|landed|merges|merged|drains|clears|resolves)\b/i,
  /after\b[^.]{0,120}\b(lands|landed|merges|drains)\b/i,
];

/** A gate whose closure is a GIT fact ("until #5211's branch lands"), not a queue status. */
const LANDING_GATE = /(?:until|after|once|when)\b[^.]{0,120}#(\d{1,5})[^.]{0,60}\b(branch|lands|landed|merges|merged|main)\b/ig;

/** A path the row names as the thing it wants. */
const ARTIFACT = /\b(?:tools|src|demo|docs)\/[\w./-]+\.(?:mjs|md|json)\b/g;

/** Verbs that mean "this file must be MADE". "extend/port/add into an existing file" is NOT satisfaction
 * by existence - the file is there and the content is not, which is the false positive a naive
 * "the file exists, so cancel it" rule produces. */
const CREATE = /\b(add|create|write|build|mint|author|spin|promote|mirror|make|implement)\b/i;
const EXTEND = /\b(port|extend|append|into|copy|surface|register)\b/i;

/** The thing a row asks to put INTO a file, quoted or named: "the S1-S11 state table", "INV-1". */
const MARKER = /["']([^"']{6,80})["']|\b([A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+){1,3})\b(?=\s+(table|rule|section|entry|clause|state))/g;

function askedArtifacts(item) {
  const out = new Set();
  for (const m of String(item?.subject ?? "").matchAll(ARTIFACT)) out.add(m[0]);
  for (const sentence of String(item?.body ?? "").split(/[.\n]/)) {
    const hits = [...sentence.matchAll(ARTIFACT)];
    if (hits.length && (CREATE.test(sentence) || EXTEND.test(sentence))) for (const h of hits) out.add(h[0]);
  }
  return [...out];
}

function markers(item) {
  const hay = `${item?.subject ?? ""}\n${item?.body ?? ""}`;
  return [...new Set([...hay.matchAll(MARKER)].map((m) => (m[1] ?? m[2]).trim()))].filter((s) => s.length >= 6);
}

/** Name the condition a parked row is waiting on, in the row's own words where possible. */
function namedCondition(item, refs) {
  const block = item?.block ?? null;
  if (block?.reviewBy) {
    const review = new Date(block.reviewBy);
    const open = !Number.isNaN(review.getTime()) && review.getTime() > Date.now();
    return { kind: "review-window", detail: `reviewBy ${block.reviewBy}${open ? " (not yet due)" : " (overdue)"}` };
  }
  const trigger = TRIGGER_MARKERS.find((re) => re.test(refs.hay));
  if (trigger) return { kind: "trigger", detail: (refs.hay.match(trigger) ?? ["unspecified trigger"])[0].slice(0, 120) };
  if (block?.reason) return { kind: block.reason, detail: `${block.reason} parked on ${block.resolver ?? "unspecified resolver"}` };
  return { kind: "none-named", detail: "no condition recorded beyond the held status" };
}

/**
 * Classify ONE held row.
 * facts: {
 *   statusOf(id)        -> the status of row id ("absent" if it never existed)
 *   landedOnMain(id)    -> the sha of the "merge: land item-<id>" commit on main, or null
 *   artifactSatisfied(p, markers) -> is the artifact at path p present AND does it contain what the row
 *                                   asks to put in it (any of the markers, when the row names any)?
 * }
 */
export function classifyHeldRow(item, facts) {
  const refs = collectGateRefs(item);
  const view = gateView(item);
  const evidence = [];
  const queueGates = [...new Set([...refs.structured, ...refs.prose, ...refs.landing])];
  const closed = queueGates.filter((id) => TERMINAL_STATUSES.has(facts.statusOf(id)));
  const open = queueGates.filter((id) => !TERMINAL_STATUSES.has(facts.statusOf(id)));

  // 1. A row whose own text names a trigger is parked ON PURPOSE. This is checked before anything else,
  //    because #3075 proves the failure mode: a standing rule with NO recorded gate looks, to a
  //    status-only audit, like a row nobody released.
  const isTrigger = TRIGGER_MARKERS.some((re) => re.test(refs.hay));
  const reason = item?.block?.reason;
  const isStanding = isTrigger || reason === "schedule" || reason === "manual" || reason === "roadmap-gate";

  // 2. Its own work has a landing commit on main while the row is still held: the landing was never
  //    reconciled with the queue. That is a close, not a release.
  const ownLanding = facts.landedOnMain(item.id) ?? null;
  if (ownLanding && !isStanding) {
    evidence.push(`git log refs/heads/main | "land item-${item.id}" -> ${ownLanding}`);
    return { id: item.id, to: item.to, class: "cancel-candidate", condition: `its own work already landed on main (${ownLanding}) while the row is still held`, evidence, gateIds: queueGates };
  }

  if (isStanding) {
    const condition = namedCondition(item, refs);
    const landing = refs.landing.map((id) => ({ id, landedOnMain: facts.landedOnMain(id) ?? null }));
    if (landing.length) {
      const landed = landing.filter((l) => l.landedOnMain);
      evidence.push(`landing gate #${landing.map((l) => l.id).join(", #")}: ${landed.length}/${landing.length} landed on main`);
      for (const l of landing) if (l.landedOnMain) evidence.push(`git log refs/heads/main | "land item-${l.id}" -> ${l.landedOnMain}`);
      return {
        id: item.id,
        to: item.to,
        class: "standing-rule",
        condition: landed.length === landing.length
          ? `the branch gate is closed (${landed[0].landedOnMain}); the row's own work is still outstanding - release it only after a human confirms the acceptance check`
          : `waiting for ${landing.filter((l) => !l.landedOnMain).map((l) => `#${l.id}`).join(", ")} to land on main: no "merge: land item-<id>" commit for it in refs/heads/main`,
        evidence,
        gateIds: queueGates,
      };
    }
    if (refs.constraints.some((c) => c.kind !== "queue" && c.ref))
      evidence.push(`constraint this instrument cannot evaluate: ${refs.constraints.filter((c) => c.kind !== "queue" && c.ref).map((c) => `${c.kind}:${c.ref}`).join(", ")}`);
    return { id: item.id, to: item.to, class: "standing-rule", condition: condition.detail, evidence, gateIds: queueGates };
  }

  // 3. Nothing was ever written about why this row is parked - the row #5770 made visible. It cannot be
  //    called stale, because there is no gate to be stale.
  if (!view.recorded) {
    return { id: item.id, to: item.to, class: "unattributed", condition: "no gate, no block, no reason recorded", evidence, gateIds: [] };
  }

  // 4. The artifact the row asks for is satisfied in the tree: the acceptance is already met on main.
  const satisfied = refs.artifacts.filter((p) => facts.artifactSatisfied(p, markers(item)));
  if (refs.artifacts.length && satisfied.length === refs.artifacts.length) {
    evidence.push(`asked-for artifact(s) already satisfied: ${satisfied.join(", ")}`);
    return { id: item.id, to: item.to, class: "cancel-candidate", condition: "the artifact the row asks for is already in the tree and contains what it names", evidence, gateIds: queueGates };
  }

  // 5. An ordinary dependency gate: stale only when EVERY gate it names is closed.
  if (queueGates.length === 0)
    return { id: item.id, to: item.to, class: "unattributed", condition: view.reason ? `parked with reason ${view.reason}, no gate id` : "parked with no gate id", evidence, gateIds: [] };
  if (open.length > 0) {
    evidence.push(`still open: #${open.join(", #")} (${open.map((id) => facts.statusOf(id)).join(", ")})`);
    return { id: item.id, to: item.to, class: "gate-open", condition: `waiting on #${open.join(", #")}`, evidence, gateIds: queueGates };
  }
  evidence.push(`all named gates terminal: #${closed.join(", #")}`);
  return { id: item.id, to: item.to, class: "release-candidate", condition: "every gate it names is done or cancelled; nothing else parks it", evidence, gateIds: queueGates };
}

export function collectGateRefs(item) {
  const structured = gateView(item).blockedBy ?? [];
  const constraints = (item?.block?.constraints ?? [])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({ kind: String(c.kind ?? ""), ref: String(c.ref ?? "") }));
  const hay = [item?.subject, item?.body, item?.heldReason, item?.block?.reason, item?.block?.resolver]
    .filter(Boolean)
    .join("\n");
  const prose = [...new Set([...hay.matchAll(/#(\d{1,5})/g)].map((m) => Number(m[1])))].filter((id) => id !== item?.id);
  const landing = [...new Set([...hay.matchAll(LANDING_GATE)].map((m) => Number(m[1])))];
  return { structured, prose, landing, constraints, artifacts: askedArtifacts(item), hay };
}

/** Audit every held row and summarise it bounded: counts per class, per seat, and the rows. */
export function auditHeldRows(items, facts) {
  const held = items.filter((i) => i.status === "held");
  const rows = held.map((i) => classifyHeldRow(i, facts));
  const byClass = {};
  const bySeat = {};
  for (const row of rows) {
    byClass[row.class] = (byClass[row.class] ?? 0) + 1;
    const seat = bySeat[row.to] ?? (bySeat[row.to] = {});
    seat[row.class] = (seat[row.class] ?? 0) + 1;
  }
  return { held: held.length, totalRows: items.length, byClass, bySeat, rows };
}
