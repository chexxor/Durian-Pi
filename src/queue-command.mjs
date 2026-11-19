// src/queue-command.mjs — THE ONE queue COMMAND core: argv -> (request | refusal BY NAME) -> decide -> render.
//
// WHY ONE MODULE HOLDS THE GRAMMAR (D334 "ONE core, TWO registrations"; operator architecture ruling D212).
// `cli.mjs queue` and the in-process pi command registered by `.pi/extensions/queue-surface.js` are TWO
// registrations of this core. A flag table per registration is two grammars that drift: the CLI's known set
// is pinned by `demo/queue-compat-args.test.mjs`, and a pi command carrying its own table starts accepting
// `--zork` the moment one of the two grows — the accepted-and-ignored class (#5071) and the fail-open's
// defect class (ROADMAP 228). So the table below is the ONLY one and both registrations import it.
//
// WHAT STAYS OUT OF THE CORE, and why that is the whole point of calling it "backend-agnostic": no store is
// opened here, nothing is printed, nothing is routed, and no seat is claimed. The caller supplies the row
// reader, the census reader, the seats value and the spool seam; the core returns STRINGS plus a machine
// document. A scripted CLI writes them to stdout/stderr and sets an exit code; a pi command hands the same
// strings to the session's own UI. D19 (human view on a terminal, one JSON document otherwise) therefore
// stays a per-plane decision — it is what the plane knows, not what the core decides.
//
// Cost: pure functions, no model, no network, no broker. The loop for a change here is
// `timeout 30 node demo/queue-pi-command.test.mjs` + the three pins that own the argv surface
// (`demo/queue-compat-args.test.mjs` 7.2 s, `demo/queue-list-sort.test.mjs` 4.1 s,
// `demo/queue-manage-surface.test.mjs` 2.2 s), measured Linux / Fedora Linux 45 (Forty Five) /
// kernel 7.2.15-300.fc45.x86_64 / node v24.22.1. Diagnose a slow one with docs/runbooks/slow-loop.md.
// THE VOCABULARIES the table below names are the rig's own — imported, never restated. A flag value set
// copied here is a second vocabulary that drifts the moment the core grows one state.
import { QUEUE_STATUSES, QUEUE_SORT_KEYS, QUEUE_SORT_DIRS, QUEUE_LIST_FIELDS, QUEUE_VIEW_ROW_CAP, queueListView, queueListViewText, filterQueueItems, queueCensusOf, workStrategyView } from "./readapi.mjs";
import { MANAGE_ACTIONS, MANAGE_PRIORITIES, queueManagePlan, queueManageRegisterText, queueDiscussDraft } from "./queue-manage.mjs";
import { GATE_VIEW_CAP } from "./queue-lifecycle.mjs";
import { DEFAULT_TIER_TOKENS } from "./config.mjs";

const QUEUE_FLAGS = {
  // An accepted NO-OP, not a invention: `out()` has ALWAYS printed JSON, so `--json` changes no bytes. Refusing a
  // documented form would be a new break; the pin asserts byte-identity, not merely exit 0.
  "--json": { kind: "noop", usage: "[--json]" },
  // One (or a few) rows by id (#4986). Payload-scoped: the queue is ONE document, so the STORAGE read is not
  // narrowed — what narrows is what the caller prints and therefore what a session pays for.
  "--id": { kind: "value", usage: "[--id <id> ...]", valueName: "id" },
  // Filters (#5016). Repeatable like `--id`; values inside a flag OR, flags AND. `--status` is validated against
  // the CLOSED state vocabulary (src/readapi.mjs QUEUE_STATUSES, measured off the live store): `--status done2`
  // would otherwise answer "no rows" to a typo, which is the same defect as an unknown flag — a mistake rendered
  // as an empty success.
  "--status": { kind: "value", usage: "[--status <state> ...]", valueName: "state", values: QUEUE_STATUSES },
  "--to": { kind: "value", usage: "[--to <seat> ...]", valueName: "seat" },
  // A VIEWER form (#5016): bodies out, everything else unchanged. It is NOT a quiet convenience — it prints a loud
  // header in its own payload and on stderr, because a truncated view that does not announce itself becomes the
  // record a later reader trusts, and acting on a subject without its body is a failure this rig has registered
  // repeatedly. The attention/count derivation still runs over the FULL rows: projection is after derivation.
  "--no-body": { kind: "flag", usage: "[--no-body]" },
  // #5770 — the BOUNDED park view. `--held` is shorthand for `--status held`; `--with-gates` projects each row
  // to ONLY the fields that answer "who parked it, on what, when do we look again" (no body, no subject); `--limit`
  // caps how many rows are emitted. Bounded by construction: bodies are dropped, the count is capped, and an
  // unbounded request (`--limit 0`, or above the cap) is REFUSED rather than silently dumping the store — the
  // unbounded version of this read reached 25 MB in a devtools scratch export.
  "--held": { kind: "flag", usage: "[--held]" },
  "--with-gates": { kind: "flag", usage: "[--with-gates]" },
  // #7113 — the PRIORITY LEASE readout for a human. It prints TEXT, not the JSON document, which is why the
  // byte contract of the default form survives: nothing derived is added to the dump, a second view is added.
  "--human": { kind: "flag", usage: "[--human]" },
  "--limit": { kind: "value", usage: "[--limit <n>]", valueName: "n" },
  // ROADMAP 381 — THE LIST VIEW. `--list` is a VIEW on the existing verb, NOT a new top-level verb: the scripted
  // audit path (`cli.mjs`) and the in-process pi command (task-4) are two registrations of ONE core
  // (`src/readapi.mjs` `queueListView` + `queueListViewText`), and a second verb would be a second core to keep
  // in step. The four flags below only make sense inside it, so using one without `--list` is REFUSED and names
  // `--list` — a flag that silently does nothing is the fail-open's defect class (ROADMAP 228).
  "--list": { kind: "flag", usage: "[--list]" },
  // The sort keys are the RIG'S OWN vocabulary — declared in the core, never free text or a comparator: an
  // arbitrary key gets a document nobody can explain, and `--status done2` already showed what a typo costs.
  "--sort": { kind: "value", usage: "[--sort <key> ...]", valueName: "sort key", valuesNoun: "keys", values: QUEUE_SORT_KEYS },
  "--dir": { kind: "value", usage: "[--dir <asc|desc>]", valueName: "direction", valuesNoun: "directions", values: QUEUE_SORT_DIRS },
  // A row's attributes, name-checked against `QUEUE_LIST_FIELDS` in the core; a comma-separated value and a
  // repeated flag mean the same set, so `--fields` is `listValue` rather than a second spelling.
  "--fields": { kind: "value", usage: "[--fields <field,...> ...]", valueName: "field", valuesNoun: "fields", values: QUEUE_LIST_FIELDS, listValue: true },
  // The EXPLICIT ask for every matched row: the cap (200) is what keeps a 7,742-row store from becoming a dump,
  // so lifting it is asked for, never defaulted.
  "--full-queue": { kind: "flag", usage: "[--full-queue]" },
  // ROADMAP 381 task-3 — THE MANAGE FAMILY (an ACT on the queue, not a view). Same D334/D212 reasoning as
  // `--list`: ONE core (`src/queue-manage.mjs`) decides, TWO thin registrations print — this CLI branch and
  // the in-process pi command of task-4. A second top-level verb would be a second core to keep in step.
  // PROPOSE is the default; `--apply` is what writes, and only through the broker's spool. `directive` and
  // `directive-clear` stay in the CORE (the broker applies them) but are REFUSED at this CLI, because their
  // scope is `--seat`/`--subject` and `intent.mjs` already spells that out — the CLI does not grow scope flags.
  "--manage": { kind: "value", usage: "[--manage <action>]", valueName: "action", valuesNoun: "actions", values: MANAGE_ACTIONS },
  "--priority": { kind: "value", usage: "[--priority <level>]", valueName: "priority", valuesNoun: "priorities", values: MANAGE_PRIORITIES },
  "--reason": { kind: "value", usage: "[--reason <text>]", valueName: "reason" },
  "--until": { kind: "value", usage: "[--until <ISO-8601>]", valueName: "instant" },
  "--apply": { kind: "flag", usage: "[--apply]" },
  "--confirm": { kind: "flag", usage: "[--confirm]" },
  // THE DISCUSS/REVISE HAND-OFF: it composes a sentence and spools ONE `message` into a REGISTERED seat's
  // conversation, where the seat's OWN authorized tools do the work. It takes no queue action of its own
  // (`queueActions: []`, asserted by the pin), so an affordance cannot quietly reorder what it handed over.
  "--discuss": { kind: "value", usage: "[--discuss <note>]", valueName: "note" },
  "--revise": { kind: "value", usage: "[--revise <note>]", valueName: "note" },
};

// The usage line and the "known flags" line are BUILT from the table, never written beside it, so a flag
// added to the grammar is immediately nameable by every refusal — which is what `demo/queue-compat-args.test.mjs`
// asserts (a bad argument costs the caller a correction, not a source read).
export const QUEUE_FLAG_NAMES = Object.keys(QUEUE_FLAGS);
export const QUEUE_USAGE = `node cli.mjs queue ${Object.values(QUEUE_FLAGS).map((f) => f.usage).join(" ")}`;

// THE ONE REFUSAL TEXT. The CLI writes this to stderr and then its JSON `ok:false` on stdout; a pi command
// shows the SAME string in the session. A refusal that reads differently on the two planes is a second
// grammar wearing a different mask — the caller corrects one and hits the other.
export function queueRefusalText(why) {
  const known = QUEUE_FLAG_NAMES.join(", ");
  return `queue: ${why}\n  known flags: ${known}\n  usage: ${QUEUE_USAGE}\n`;
}

export async function queueCommandStorePath({ env = process.env, readFile = null, cwd = process.cwd() } = {}) {
  const { loadConfig } = await import("./config.mjs");
  const { resolve } = await import("node:path");
  const { config } = await loadConfig({ env, readFile: readFile ?? undefined });
  const db = config.DURIG_DB ?? "./rig.sqlite";
  // Resolved absolutely, the same rule cli.mjs states (#4955): which database answered is reported, not
  // remembered, and a relative default means the tree that served the process.
  return resolve(cwd, db);
}

// A pi command receives ONE string (`/queue --list --sort priority`), the CLI receives argv. Tokenizing here
// keeps the two spellings of one request from drifting: quoted values survive spaces (a `--reason` sentence is
// the common case), and a quote that does not close is refused rather than silently swallowing the rest.
export function queueCommandArgv(text = "") {
  const out = [];
  let cur = null;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur ??= ""; continue; }
    if (ch === " " || ch === "\n" || ch === "\t") { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? "") + ch;
  }
  if (quote) return { ok: false, refusal: `an unterminated quote swallowed the rest of the command — close it (a --reason sentence needs both quotes)` };
  if (cur !== null) out.push(cur);
  return { ok: true, argv: out };
}

// PARSE: the table above decides known/unknown; the loop records every flag the caller actually used so a
// collision can be refused BY NAME. Returns the FIRST refusal only, exactly as the CLI's parser did — an
// `exit` inside a loop is not available here, so the caller decides how a refusal is shown.
export function queueCommandParse(args = [], { cap = GATE_VIEW_CAP } = {}) {
  const ids = [];
  const statuses = [];
  const to = [];
  const fields = [];
  const used = new Set();
  let noBody = false;
  let gates = false;
  let human = false;
  let limit = cap;
  let limitWasSet = false;
  let manage = null;
  let handoff = null;
  let handoffNote = null;
  let applyFlag = false;
  let confirmFlag = false;
  let reason = null;
  let until = null;
  let priority = null;
  let list = false;
  let fullQueue = false;
  let sort = null;
  let dir = null;
  let jsonRequested = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const spec = QUEUE_FLAGS[a];
    if (!spec) return { ok: false, refusal: `unknown argument ${a}` };
    used.add(a);
    if (spec.kind === "flag") {
      if (a === "--held") statuses.push("held");
      else if (a === "--with-gates") gates = true;
      else if (a === "--human") human = true;
      else if (a === "--list") list = true;
      else if (a === "--full-queue") fullQueue = true;
      else if (a === "--apply") applyFlag = true;
      else if (a === "--confirm") confirmFlag = true;
      else if (a === "--no-body") noBody = true;
      continue;
    }
    if (spec.kind === "value") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) return { ok: false, refusal: `${a} needs a value` };
      if (spec.values) {
        const toks = spec.listValue ? String(v).split(",") : [v];
        const bad = toks.filter((t) => t === "" || !spec.values.includes(t));
        if (bad.length)
          return { ok: false, refusal: `${a} takes a ${spec.valueName}, not ${JSON.stringify(String(bad[0]))} (${spec.valuesNoun}: ${spec.values.join(", ")})` };
      }
      if (a === "--id") ids.push(v);
      else if (a === "--status") statuses.push(v);
      else if (a === "--sort") sort = v;
      else if (a === "--dir") dir = v;
      else if (a === "--fields") fields.push(...String(v).split(","));
      else if (a === "--limit") {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) return { ok: false, refusal: `--limit must be a positive integer (1..${cap}); "all" is not a limit` };
        if (n > cap) return { ok: false, refusal: `--limit ${n} exceeds the bounded park view's cap of ${cap}` };
        limit = n;
        limitWasSet = true;
      } else if (a === "--manage") manage = v;
      else if (a === "--priority") priority = v;
      else if (a === "--until") until = v;
      else if (a === "--reason") reason = v;
      else if (a === "--discuss") { handoff = "discuss"; handoffNote = v; }
      else if (a === "--revise") { handoff = "revise"; handoffNote = v; }
      else to.push(v);
      i += 1;
      continue;
    }
    if (a === "--json") jsonRequested = true;
  }

  // THE LIST VIEW AND ITS NEIGHBOURS MUST NOT SILENTLY COLLIDE, and neither must the MANAGE family: every
  // refusal names the flag it refused AND the flag the caller must add. Returning the sentence (not printing
  // it) is what lets one parser serve a scripted caller and an in-process session.
  for (const f of ["--sort", "--dir", "--fields", "--full-queue"]) {
    if (used.has(f) && !list) return { ok: false, refusal: `${f} narrows the --list view only — add --list (or drop ${f}); it is not a filter on the whole-document form` };
  }
  if (list && gates)
    return { ok: false, refusal: "--list and --with-gates are two different views; the list view already carries `gate` state, --with-gates prints the recorded gate fields — pick one" };
  if (list && noBody)
    return { ok: false, refusal: "--no-body is a no-op beside --list: the list view never carries bodies, which is part of why it can carry 200 rows" };
  if (list && ids.length)
    return { ok: false, refusal: "--id is the row-scoped read (body included); --list is the bounded sorted view — pick one" };
  for (const f of ["--reason", "--until", "--priority", "--confirm"]) {
    if (used.has(f) && !manage) return { ok: false, refusal: `${f} belongs to the --manage family — add --manage <action> (or drop ${f}); it is not a filter on the read forms` };
  }
  if (used.has("--apply") && !manage && !handoff)
    return { ok: false, refusal: "--apply belongs to the --manage family — add --manage <action> --apply, or --discuss/--revise --apply (or drop --apply)" };
  if (used.has("--discuss") && used.has("--revise"))
    return { ok: false, refusal: "--discuss and --revise are the two hand-off verbs — pick one; a note cannot be both" };
  if (manage && handoff)
    return { ok: false, refusal: "--manage and --discuss/--revise are two different acts — pick one" };
  if (handoff && !to.length)
    return { ok: false, refusal: "a discuss/revise hand-off needs an audience: --to <registered seat> — the note is spooled into that seat's conversation" };
  if (handoff && (list || gates || noBody || limitWasSet || fullQueue)) {
    const collided = [(list || undefined) && "--list", gates && "--with-gates", noBody && "--no-body", limitWasSet && "--limit", fullQueue && "--full-queue"].filter(Boolean);
    return { ok: false, refusal: `--discuss/--revise is an act, not a view: it cannot carry ${collided.join(", ")} — a hand-off prints the note it sent and the broker's reply, never a row view` };
  }
  if (manage && (list || human || gates || noBody || limitWasSet || fullQueue)) {
    const collided = [(list || undefined) && "--list", (human || undefined) && "--human", gates && "--with-gates", noBody && "--no-body", limitWasSet && "--limit", fullQueue && "--full-queue"].filter(Boolean);
    return { ok: false, refusal: `--manage is an act, not a view: it cannot carry ${collided.join(", ")} — it prints a CHANGE REGISTER (what changed, who did it, what it stranded)` };
  }
  if (manage === "directive" || manage === "directive-clear")
    return { ok: false, refusal: `--manage ${manage} is in the core but not in this CLI yet: a directive is scoped by --seat and/or --subject, which this verb does not carry — use node intent.mjs queue --op queue --action ${manage} --seat <name> [--subject <substr>] --priority now --reason <text> --until <iso> [--apply]` };

  return {
    ok: true,
    state: {
      ids, statuses, to, fields, used,
      noBody, gates, human, limit, limitWasSet,
      manage, handoff, handoffNote, applyFlag, confirmFlag, reason, until, priority,
      list, fullQueue, sort, dir, jsonRequested,
    },
  };
}

// THE STORE-FREE GUARDS, decided in ONE place so a pi command cannot offer an act the CLI refuses (and the
// other way round). A row-scoped act with no selection names every row in the store; that is refused before
// a row is counted, which is also what makes `--manage park` cost the store nothing.
export function queueCommandGuards(state) {
  const { manage, handoff, ids, statuses, to } = state;
  const rowScoped = manage === "cancel" || manage === "priority" || manage === "release";
  if (rowScoped && !ids.length && !statuses.length && !to.length)
    return `--manage ${manage} is row-scoped and would select every row in the store: name the rows with --id (repeatable), or narrow with --status/--to`;
  if (handoff && state.to.length > 1)
    return `a hand-off has ONE audience: --to ${state.to.join(" ")} names ${state.to.length} seats — pick one (the note lands in one seat's conversation)`;
  return null;
}

// THE REQUEST IS BUILT ONCE. A PROPOSE and an APPLY must act on the same selection — planning one set and
// writing another is the record-goes-stale class — so the selection rule lives here, not in a caller.
export function queueCommandManageRequest(state, { scoped } = {}) {
  const { manage: action, ids, statuses, to, reason, until, priority, confirmFlag } = state;
  return {
    action,
    ...(ids.length ? { ids } : scoped.length ? { ids: scoped.map((it) => String(it.id)) } : {}),
    ...(reason ? { reason } : {}),
    ...(until ? { expiresAt: until } : {}),
    ...(priority ? { priority } : {}),
    ...(confirmFlag ? { confirm: true } : {}),
    ...(to.length ? { seats: to } : {}),
    from: "delegate",
  };
}

// A hand-off names ONE item; more than one match means the note would name one row of several. Decided over
// the rows the caller already read, so the same rows decide both planes.
export function queueCommandHandoffItems(state, all = []) {
  const { ids, statuses } = state;
  const wanted = ids.length ? ids.map(String) : null;
  const matches = wanted ? all.filter((it) => wanted.includes(String(it.id))) : statuses.length ? filterQueueItems(all, { statuses }) : [];
  if (wanted && !matches.length)
    return { ok: false, refusal: `--discuss/--revise named no such row: ${wanted.join(", ")} — the store has ${all.length} rows, none of them those ids` };
  if (matches.length > 1)
    return { ok: false, refusal: `a hand-off names ONE item: ${matches.length} rows match — narrow with --id <n> (or drop the filters to send a note about no item in particular)` };
  return { ok: true, item: matches[0] ?? null };
}

// THE COMPLETION VOCABULARY is the same table, so a session that can type a flag can be offered it; a
// `--manage`/`--sort`/`--dir`/`--status`/`--fields`/`--priority` value is offered from the closed sets the
// table already names. This is the pi half of "adjustable pi-natively": the argument box is drawn from the
// grammar that decides the argument, never from a second list.
export function queueCommandCompletion(prefix = "") {
  const items = [];
  for (const [flag, spec] of Object.entries(QUEUE_FLAGS)) {
    if (flag.startsWith(prefix)) items.push({ value: flag, label: flag });
    if (spec.values && (prefix.startsWith(flag + " ") || prefix.startsWith(flag + "="))) {
      const rest = prefix.slice(flag.length + 1);
      for (const v of spec.values) if (v.startsWith(rest)) items.push({ value: `${flag} ${v}`, label: `${flag} ${v}` });
    }
  }
  if (prefix === "" || prefix.startsWith("--")) for (const a of MANAGE_ACTIONS) if (a.startsWith(prefix)) items.push({ value: a, label: a });
  return items.length ? items.map((i) => ({ value: i.value, label: i.label })) : null;
}

// THE DECIDE + RENDER half, shared. Backend-agnostic in the literal sense: the caller hands the readers and
// the spool, and gets strings plus a machine document plus the stderr notes and the exit code to set.
// Key ORDER inside every document below is today's CLI byte order (`out()` is JSON.stringify with indent 2),
// so moving the branch did not move a key.
export async function queueCommandRun(state, {
  readQueue,
  readCensus = null,
  readSeats = null,
  spool = null,
  db = null,
  now = Date.now(),
  from = "delegate",
} = {}) {
  const { manage, handoff, list, ids, statuses, to, fields, limit, limitWasSet, fullQueue, sort, dir, noBody, human, jsonRequested, applyFlag, confirmFlag, reason, until, priority } = state;

  const guard = queueCommandGuards(state);
  // A guard is an ARGUMENT problem (a row-scoped act with no selection, a hand-off with two audiences): the
  // registration answers it the same way it answers a bad flag — the correction sentence plus a machine `ok:false`.
  // An ACT-level refusal (below, where the act's own rules or the broker say no) deliberately does NOT carry this
  // flag, because it is not about the argument and must not read as one on either plane.
  if (guard) return { ok: false, argRefusal: true, refusal: guard, exitCode: 1 };

  if (manage) {
    const all = await readQueue();
    const scoped = filterQueueItems(all, { statuses, to });
    const request = queueCommandManageRequest(state, { scoped });
    if (applyFlag) {
      if (!spool) return { ok: false, refusal: `--apply needs the broker's spool seam; this caller supplied none — the act is PROPOSED only`, exitCode: 1 };
      const res = await spool({ ...request, apply: true }, { from, requireBroker: true });
      const head = res.reply ?? res;
      return {
        ok: res.ok,
        view: "manage",
        mode: "apply",
        action: manage,
        text: queueManageRegisterText(head, { db }),
        json: {
          ok: res.ok,
          command: "queue",
          view: "manage",
          mode: "apply",
          action: manage,
          requestId: res.requestId ?? null,
          spool: res.spool ?? null,
          reply: res.reply ?? null,
          ...(res.ok ? {} : { code: res.code ?? null, refusal: res.refusal ?? null, spool_census: res.spool_census ?? null }),
        },
        notes: res.ok ? [] : [`queue: --manage ${manage} --apply refused: ${res.code ?? "refused"} — ${res.refusal ?? "no reason given"}${res.spool_census ? ` (spool: pending=${res.spool_census.count})` : ""}\n`],
        ...(res.ok ? {} : { exitCode: 1 }),
      };
    }
    const plan = queueManagePlan(all, request);
    return {
      ok: plan.ok,
      view: "manage",
      mode: "propose",
      action: manage,
      text: queueManageRegisterText(plan, { db }),
      json: {
        ok: plan.ok,
        command: "queue",
        view: "manage",
        mode: "propose",
        action: manage,
        ...(plan.ok
          ? {
              verb: plan.verb,
              proposed: plan.proposed,
              changes: plan.changes,
              transitions: plan.transitions,
              strands: plan.strands,
              ...(plan.census ? { census: plan.census } : {}),
              ...(plan.lease ? { lease: plan.lease } : {}),
              by: plan.by,
              authority: plan.authority,
              note: "propose — nothing written",
            }
          : { refusal: plan.refusal }),
      },
      notes: plan.ok ? [] : [`queue: --manage ${manage} refused: ${plan.refusal}\n`],
      ...(plan.ok ? {} : { exitCode: 1 }),
    };
  }

  if (handoff) {
    const all = await readQueue();
    const resolved = queueCommandHandoffItems(state, all);
    // Which row the note is ABOUT is an argument problem: the caller named no row, or several. Refused with the
    // correction, not with an act's reason.
    if (!resolved.ok) return { ok: false, argRefusal: true, refusal: resolved.refusal, exitCode: 1 };
    const draft = queueDiscussDraft({ item: resolved.item, to: to[0], note: state.handoffNote ?? "", action: handoff });
    // The act's OWN rules said no — a sentence, not a correction: no `argRefusal`, and the note carries today's
    // CLI wording so a scripted caller sees the same bytes it does today.
    if (!draft.ok)
      return { ok: false, refusal: `${handoff} hand-off refused: ${draft.refusal}`, notes: [`queue: ${handoff} hand-off refused: ${draft.refusal}\n`], exitCode: 1 };
    if (!applyFlag)
      return {
        ok: true,
        view: "handoff",
        mode: "propose",
        action: handoff,
        text: `${draft.content}\n`,
        json: { ok: true, command: "queue", view: "handoff", mode: "propose", action: handoff, to: draft.to, item: draft.item, content: draft.content, queueActions: draft.queueActions, note: "propose — nothing sent; add --apply to spool the message" },
        notes: [`queue: hand-off ${handoff} -> ${draft.to} — PROPOSED, nothing sent (add --apply to spool it)\n`],
      };
    if (!spool) return { ok: false, refusal: `--apply needs the broker's spool seam; this caller supplied none — the hand-off stays PROPOSED`, exitCode: 1 };
    const res = await spool(draft, { from, requireBroker: true });
    return {
      ok: res.ok,
      view: "handoff",
      mode: "apply",
      action: handoff,
      text: `${draft.content}\n`,
      json: { ok: res.ok, command: "queue", view: "handoff", mode: "apply", action: handoff, to: draft.to, item: draft.item, content: draft.content, queueActions: res.queueActions ?? draft.queueActions, requestId: res.requestId ?? null, spool: res.spool ?? null, reply: res.reply ?? null, ...(res.ok ? {} : { code: res.code ?? null, refusal: res.refusal ?? null }) },
      notes: res.ok ? [`queue: hand-off ${handoff} -> ${draft.to} spooled (requestId ${res.requestId}); the seat's own tools do the work — this surface wrote NO queue action.\n`] : [`queue: ${handoff} hand-off refused: ${res.code ?? "refused"} — ${res.refusal ?? "no reason given"}\n`],
      ...(res.ok ? {} : { exitCode: 1 }),
    };
  }

  if (list) {
    const all = await readQueue();
    const census = readCensus ? await readCensus() : queueCensusOf(all);
    const seatsValue = readSeats ? await readSeats() : {};
    const scoped = filterQueueItems(all, { statuses, to });
    const view = queueListView(
      scoped,
      {
        sort: sort ?? "age",
        dir: dir ?? "asc",
        limit,
        cap: QUEUE_VIEW_ROW_CAP,
        fullQueue,
        fields: fields.length ? fields : null,
        dropTerminal: statuses.length === 0,
        now,
        tierTokens: seatsValue.tierTokens ?? DEFAULT_TIER_TOKENS,
        seatStrategies: workStrategyView(seatsValue).seats,
      },
    );
    return {
      ok: true,
      view: "list",
      mode: null,
      text: queueListViewText(view, { db }),
      json: {
        ok: true,
        command: "queue",
        view: "list",
        header: view.header,
        rows: census.rows,
        counts: census.counts,
        pool: census.pool ?? null,
        attention: census.attention,
        mintRefusals: census.mintRefusals ?? null,
        ...(statuses.length || to.length ? { filter: { ...(statuses.length ? { statuses } : {}), ...(to.length ? { to } : {}) } } : {}),
        narrowed: "payload",
        items: view.items,
      },
      notes: [
        ...(fullQueue && limitWasSet ? [`queue: --full-queue supersedes --limit ${limit}; every matched row is printed.\n`] : []),
        ...(view.header.truncated
          ? [`queue: --list printed ${view.header.shown} of ${view.header.matched} matched row(s) (--limit ${view.header.limit}, cap ${view.header.cap}${view.header.capApplied ? `, cap applied over ${view.header.matched} rows` : ""}); the rows/counts above are over all ${view.header.storeRows} rows in the store.\n`]
          : []),
      ],
    };
  }

  // Everything else (the whole-document dump, `--id` row reads, `--human`, `--with-gates`) stays in the CLI
  // branch: it is not part of this surface, and inventing a second copy of it for the pi command would be a
  // second implementation to keep in step. A pi command that meets these says so and names the verb.
  return { ok: false, unsupported: true };
}

// WHAT A PI PLANE MAY OFFER, derived from the same state, so the session can say "this form is the scripted
// verb's" instead of inventing a rendering for it.
export function queueCommandSurfaceForms(state) {
  return { list: Boolean(state.list), manage: state.manage ?? null, handoff: state.handoff ?? null };
}
