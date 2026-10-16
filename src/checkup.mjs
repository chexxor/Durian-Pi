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

// Terms that mark a seat as an independent verifier, matched as substrings of
// the seat's NAME and ROLE text. Deliberately excludes this rig's shared
// `peer-review` capability: `impl`/`impl2` advertise it too, so matching on
// capabilities would call the authors verifiers and report an all-clear on the
// exact gap the rule exists to catch. `audit` is excluded for the same reason —
// a security seat audits its own surface, not other seats' work.
export const VERIFIER_TERMS = ["verif", "qa", "review", "editor"];

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
    id: "ownership-seat-missing",
    severity: "error",
    what: "an ownership class names an owner seat the rig does not declare",
  },
];

const SEVERITY_OF = new Map(RULES.map((r) => [r.id, r.severity]));

/** First line of a possibly-multiline text, bounded for display. */
function firstLine(text, limit = 96) {
  const line = String(text ?? "").split("\n")[0].trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** A seat counts as a verifier when its name or role says so. Exported because
 * the config-derived metrics measure needs the same judgement `check`'s
 * no-verifier-seat rule makes, and two definitions would drift. */
export function seatsAreVerifier(seat) {
  const haystack = `${seat.name ?? ""} ${seat.role ?? ""}`.toLowerCase();
  return VERIFIER_TERMS.some((term) => haystack.includes(term));
}

/**
 * @param {object} input
 * @param {string} input.rig            rig file path, for display
 * @param {object} input.spec           parsed rig file
 * @param {string|undefined} input.specConstitution  resolved constitution text, if the spec declares one
 * @param {{reason:"read",text:string}|{reason:"absent"}|{reason:"unreadable",error:string}} input.stored
 * @param {string[]|null} [input.storedSeats]  seat names the store holds, or null when it was not read
 * @param {Record<string,string>} [input.modelsBySeat]  seat name -> "provider/modelId"
 * @returns {{findings:Array, checks:Array, summary:object, pass:boolean, exitCode:number}}
 */
export function auditRig({ rig, spec, specConstitution, stored, storedSeats = null, modelsBySeat = {} }) {
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
  //    something else. This is what let 13 seats run without the tutor-pi team
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
  //    directions were found live at once (2026-10-11: the tutor-pi store held a
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

  // 9. ROADMAP 46 / D62: the docs-ownership norm maps each artifact CLASS to a live
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

  const summary = { error: 0, "fix-now": 0, total: findings.length };
  for (const f of findings) summary[f.severity] += 1;
  const checks = RULES.map((r) => {
    const skip = skipped.find((s) => s.id === r.id);
    const found = findings.filter((f) => f.id === r.id).length;
    return { id: r.id, status: skip ? "skipped" : found > 0 ? "fail" : "pass", found, ...(skip ? { why: skip.why } : {}) };
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
  lines.push(
    `${result.pass ? paint("green", "PASS") : paint("red", "FAIL")}  ${result.summary.error} error · ${result.summary["fix-now"]} fix-now · ${passed} passed` +
      (skipped.length ? ` · ${skipped.length} skipped` : ""),
  );
  for (const c of skipped) lines.push(paint("dim", `      · ${c.id} skipped: ${c.why}`));
  lines.push(paint("dim", rule));
  return lines.join("\n");
}
