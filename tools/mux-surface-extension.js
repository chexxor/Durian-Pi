// .pi/extensions/mux-surface.js — /mux: the user's chosen terminal multiplexer as the rig's PRESENTATION layer.
//
// WHY THIS FILE EXISTS (and why it is thin). `tools/mux-surface-core.mjs` already holds the whole grammar of the
// ask — the verb table, the flag table, the selector grammar, the OWNERSHIP decision, the NAMESPACE decision,
// the plan, and the census render — and it names NO backend (measured 2026-11-21: `grep -c -E 'tmux|screen|zellij|herdr'
// tools/mux-surface-core.mjs` -> 0). A driver file (`tools/mux-driver-<backend>.mjs`) spells ONE backend's argv
// as DATA. So this file holds only what the PI PLANE knows: a session hands a command ONE string (not argv), a
// command handler's return value is NOT printed (`dist/core/extensions/types.d.ts`: `handler: (args, ctx) =>
// Promise<void>`) so the core's strings go out through `ctx.ui.notify`, and the shortcut table is the ACTIVE
// backend's preset — a key style IS a backend word, so it is per-driver and only the active one is registered.
//
// WHAT THIS FILE DOES, and through which door (rewritten 2026-11-21: the earlier version claimed a presentation
// command must not reach the owner plane, and that was FALSE of what actually works — a /mux ask that could name
// argv but never run it was a `/mux open` that opened nothing. The gate is the ASK, not the import.):
//
//   1. A CENSUS of which multiplexer sessions exist right now, so the NAMESPACE decision can report the user's
//      OWN session as PRESENT, NOT TOUCHED. That read goes through `tools/mux-surface-owner.mjs` `muxSessions`
//      (the owner plane is the plugin's only `child_process` module) and is read-only enumeration only.
//   2. A PLAN RUN, and only under the explicit `--run` ask: `muxRunPlan` runs the driver's argv and reports
//      each step's argv, rc and ms. Without `--run` the core prints the argv and this file runs nothing, so the
//      census says "PRINTED ONLY (nothing was run)". `--run` is the door; the import is not.
//   3. THE OWNER START, only under `--run` and only when the ownership decision said CREATE (`muxOwnershipPlan`
//      `action:"create"`) and the ask is `open`/`attach`: the rig's OWN resident detached broker
//      (`DURIG_DB=<store> node cli.mjs serve`), via `muxStartOwner`. It refuses rather than double-starts.
//   4. AN ACT (a pane steering ITS OWN seat) delivered as the broker's spool ops — `writeIntent` into the
//      store's own inbox, then the broker's own answer read back with `awaitIntentResult`/`readIntentResult`.
//      This file never types bytes into a window: a second writer into a seat is what corrupted this store twice
//      (docs/runbooks/README.md). The broker, not this file, decides whether a request is admitted — `muxActRequest`
//      applies the spool's OWN `authorizeSpoolRequest` first (so a pane is refused BY NAME for a control-plane op),
//      and if a request still reaches the spool unadmitted the broker's OWN dead-letter record is what prints back.
//   5. `halt` is the same door as (2): the plan's halt argv IS `node cli.mjs serve --stop` with the store in its
//      env, so `--run` runs the rig's own off switch and without it the line is printed for a reader to copy.
//
// THE TRUST GATE, stated not assumed: a project `.pi/extensions/` file loads only where the project is TRUSTED.
// On an untrusted landing session /mux simply is not there, which is why docs say "where the project is trusted".
//
// Cost (D213), measured Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1:
// loading costs a file read; `/mux list` with no `--run` costs the rig's store reads only (no census, no spawn);
// with `--run` it costs one multiplexer census (a PRESENT binary: `screen --version` 0.015 s) plus the plan's argv,
// each bounded at 10 s by the owner plane and reported in ms. An owner start plus its `serve --stop` measured
// 14.60 s end to end for the pin that does it (`.spike/muxlive-1.mjs`, 2026-11-21). Hermetic loop for a change
// here: `node demo/mux-surface.test.mjs` (fauxProvider plane, no store opened, no process started).

// Where the core lives, from wherever the loader ran this file: from `.pi/extensions/` two levels up lands in
// `tools/`; from `tools/` (a gate loading the tracked source) the neighbour is it. THE OWNER PLANE IS IMPORTED
// HERE, and this says why that is safe rather than pretending it is unreachable: the owner plane is the ONE
// module that can run a process, and every door from here into it is an ASK — a census read, `muxRunPlan` under
// `--run`, `muxStartOwner` under `--run` AND an ownership decision of CREATE. The guard that makes that execution
// safe is `muxNamespace`'s refusals (namespace-foreign-asked, teardown-foreign, teardown-every-session) and
// `muxOwnershipPlan`'s start-refusal, both of which run BEFORE any argv is named, plus `muxActRequest`'s import of
// the spool's own `authorizeSpoolRequest`. Nothing here grows a process primitive of its own: this file still
// holds zero `child_process`, zero spawn, zero exec — the only argv-runner is the owner plane's own.
const rig = await import(new URL("./mux-surface-core.mjs", import.meta.url).href).catch(() => import("../../tools/mux-surface-core.mjs"));
const owner = await import(new URL("./mux-surface-owner.mjs", import.meta.url).href).catch(() => import("../../tools/mux-surface-owner.mjs"));
const {
  MUX_COMMAND_NAME,
  MUX_SURFACE_DESCRIPTION,
  muxSurfaceCompletion,
  muxSurfaceInvoke,
  muxSurfaceSeams,
  muxSurfaceDrivers,
  muxKeysText,
  muxKeysRender,
  MUX_RESERVED_PI_IDS,
} = rig;
const { muxSessions, muxRunPlan, muxStartOwner, muxStopOwner } = owner;

// The broker's spool is reached LAZILY, on the one leg that needs it, so loading /mux pays no store access.
const spoolPlane = async () => {
  try {
    return await import(new URL("../src/broker.mjs", import.meta.url).href);
  } catch {
    return await import("../../src/broker.mjs");
  }
};

// The one resident-owner bound this plugin asks for, and the one bound every argv step carries. Both are stated
// here rather than defaulted silently, because a reader who sees a started broker must be able to find its bound.
const OWNER_MAX_DURATION_SEC = 3600;
const STEP_TIMEOUT_MS = 10_000;
const SPOOL_ANSWER_MS = 30_000;

export default async function (pi) {
  pi.registerCommand(MUX_COMMAND_NAME, {
    description: MUX_SURFACE_DESCRIPTION,
    // The argument box is drawn from the core's own table — the SAME vocabulary that decides the argument, so a
    // flag can never be offered here and refused there (the #5071 fail-open class).
    getArgumentCompletions: (prefix) => muxSurfaceCompletion(prefix),
    handler: async (args, ctx) => {
      const say = (body, level) => {
        const ui = ctx?.ui;
        if (ui?.notify) ui.notify(body, level);
        else process.stdout.write(String(body) + "\n");
      };
      try {
        // Which multiplexer session exists RIGHT NOW is a census, and the census needs the registry, so the
        // registry is resolved once here and handed to the core as an ASYNC GETTER — the shape that proves the
        // core normalizes both shapes (a getter read as if it were the registry produced an empty driver table).
        const cwd = process.cwd();
        let registry = null;
        const registryOf = async () => registry ??= await muxSurfaceDrivers({ env: process.env });
        const census = { ran: false, reason: "(no census asked)", notes: [] };
        const seams = await muxSurfaceSeams({
          env: process.env,
          cwd,
          drivers: registryOf,
          // THE CENSUS SEAM: the active backend's own `list` argv, run read-only by the owner plane. `present`
          // rows are what `muxNamespace` matches its own name against; a foreign session that appears here is
          // reported PRESENT, NOT TOUCHED and never enumerated into.
          sessions: async () => {
            const reg = await registryOf();
            const asked = String(args ?? "").toLowerCase();
            const backend = reg.names.find((b) => asked.includes(`--backend ${b}`)) ?? reg.active;
            const c = await muxSessions({ drivers: reg, backend, cwd });
            census.ran = c.ran;
            census.reason = c.reason ?? null;
            census.notes = c.notes ?? [];
            return c.present;
          },
          // THE ACT SEAM: deliver the spool request the core built, through the BROKER'S OWN write path, and
          // read the broker's own answer. This file writes an inbox file and reads a record; it never types
          // into a window and never opens the store's writer plane.
          run: async (request) => {
            const store = seams.db;
            if (!store) return { ok: false, reason: "no store named by DURIG_DB/DURIAN_PI_DB, so nothing was spooled" };
            const broker = await spoolPlane();
            const rid = request.requestId ?? (() => {
              const c = broker?.randomUUID;
              return typeof c === "function" ? c() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            })();
            const written = broker.writeIntent(store, { ...request, requestId: rid, createdAt: new Date().toISOString() });
            const wait = await broker.awaitIntentResult(store, rid, { timeoutMs: SPOOL_ANSWER_MS, intervalMs: 200 });
            const refusal = wait?.ok ? null : broker.readIntentError(store, rid);
            return {
              requestId: rid,
              spooled: written,
              answered: Boolean(wait?.ok),
              result: wait?.result ?? null,
              ...(refusal ? { refused_by_broker: refusal } : {}),
            };
          },
        });
        const out = await muxSurfaceInvoke(args, { env: process.env, cwd, seams });
        for (const line of out.show) say(line.body, line.level);
        const asked = Boolean(out.state?.run) && !out.state?.dryRun;
        const verb = out.state?.verb;
        // (3) THE OWNER START — under the ask, and only where the ownership decision said CREATE. The rig's own
        // resident detached broker is the session; the multiplexer window is only its viewport, which is what
        // makes tmux's detach semantics true here: closing the pane never ends the session because the session
        // never lived in the pane.
        if (asked && out.ownership?.action === "create" && (verb === "open" || verb === "attach") && out.ok) {
          const started = await muxStartOwner(out.db, { maxDurationSec: OWNER_MAX_DURATION_SEC });
          say(started.ok
            ? `mux owner — STARTED the rig's resident broker: pid ${started.pid}, state ${started.statePath}, logs ${started.logs?.out ?? "(see state)"}, bound --max-duration ${OWNER_MAX_DURATION_SEC}s (closing the pane does not end it)`
            : `mux owner — NOT started: ${started.reason} (pid ${started.command ? "(see state file)" : "-"}; state ${started.statePath})`, started.ok ? "info" : "error");
          out.owner = started;
        }
        // (2)/(5) THE PLAN RUN — the same door the census already printed its argv under. Each step reports its own
        // argv, rc and ms so a reader sees which pane the backend actually made.
        if (asked && out.plan?.commands?.length) {
          const stepped = await muxRunPlan(out.plan, { run: true, cwd, timeoutMs: STEP_TIMEOUT_MS });
          for (const step of stepped.steps) {
            say(`mux ran — ${step.action} pane ${step.pane} \u2192 ${step.argv.join(" ")} rc ${step.rc ?? "(no rc)"} in ${step.ms} ms${step.stdout ? ` | ${step.stdout}` : ""}${step.stderr ? ` | stderr ${step.stderr}` : ""}`, step.ran && step.rc === 0 ? "info" : "error");
          }
          if (!stepped.ok) say(`mux plan stopped — ${stepped.reason} (steps run so far: ${stepped.steps.length}; half a pane set is not a state)`, "error");
          else say(`mux plan ran — ${stepped.steps.length} step(s), all rc 0`, "info");
          out.stepped = stepped;
        }
        // A census the seam could not run is said, not swallowed: "0 foreign sessions" and "I could not ask"
        // are different answers, and only the first one is evidence about the user's own session.
        if (!census.ran && verb !== "keys")
          say(`mux census — NO multiplexer census ran (${census.reason}); the census prints "foreign sessions: none present" as what THIS plane could see, not as what exists. ${census.notes.join(" ")}`, "info");
        else if (census.notes?.length) say(`mux census — ${census.notes.join(" ")}`, "info");
        return out;
      } catch (err) {
        // A handler that throws becomes an extension error event; say the cause instead. The ask is a VIEW of a
        // session that other processes own — a view that dies silently is worse than one that says it could not read.
        say(`mux: the command failed: ${err?.message ?? err}\n  (no further pane was created and no further session was started; see docs/runbooks/pi-inside-tmux.md)`, "error");
      }
    },
  });

  // THE SHORTCUTS ARE THE ACTIVE PRESET'S ONLY. A key style is a backend word (tmux-style and screen-style
  // disagree), so registering every driver's preset would put four key tables on one session; the ACTIVE backend
  // — the highest-ranked driver whose binary answered, chosen by the core from a driver `rank` fact — owns them.
  // pi owns ctrl+shift+up/down, ctrl+shift+f/g/p and every single ctrl+a…ctrl+z (pi 1.5.2 docs/extensions.md), so
  // a preset that borrows one is a conflict pi reports, not one this plugin resolves silently.
  // HONESTY NOTE, corrected 2026-11-21: these shortcuts are registered with pi's `registerShortcut`, which is the
  // LITERAL-key API. They are NOT pi keybinding ids and pi has no `registerKeybinding` API and `KeybindingsManager.rebuild`
  // skips ids absent from its `definitions` — so a user who wants these keys elsewhere edits pi's OWN keybindings.json
  // for pi's own ids, and this plugin's mux keys are fixed while its preset is chosen. `demo/mux-keybinds.test.mjs`
  // measures that rule; docs say it the same way (see docs/runbooks/pi-inside-tmux.md).
  try {
    const loaded = await muxSurfaceDrivers({ env: process.env });
    const active = loaded.drivers.get(loaded.active)?.driver;
    const keys = active?.preset?.keys ?? {};
    for (const [name, combo] of Object.entries(keys)) {
      const verb = String(name).startsWith("mux.") ? String(name).slice(4) : name;
      if (!combo || !verb) continue;
      pi.registerShortcut(combo, {
        description: `mux ${verb} (${active.backend} preset)`,
        handler: async (ctx) => {
          const ui = ctx?.ui;
          const out = await muxSurfaceInvoke(verb, { env: process.env, cwd: process.cwd() });
          for (const line of out.show) {
            if (ui?.notify) ui.notify(line.body, line.level);
            else process.stdout.write(String(line.body) + "\n");
          }
        },
      });
    }
    // THE HINT ROUTE (contract (5)) — pi's own keyHint()/keyText() are CALLED, not claimed. They are not
    // reachable from a command handler: ExtensionContext and ExtensionCommandContext carry no KeybindingHints,
    // and the ONE render context that does is `EntryRenderOptions extends KeybindingHints`
    // (node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:73-77 declares the two fns,
    // :1208 mixes them in, :1299 hands them to registerEntryRenderer, :1317 is appendEntry). So `/mux-keys`
    // does BOTH: prints the preset table a handler CAN print (no host keys asked), and APPENDS an entry whose
    // renderer receives pi's fns and prints pi's OWN keys for pi's OWN ids. The renderer body lives in the core
    // (`muxKeysRender`), so the core's table and the rendered entry are the SAME document, and the line that
    // says which hint fn answered is the core's, never this file's guess.
    const tui = await import("@earendil-works/pi-tui").catch(() => null);
    const TuiText = tui?.Text ?? null;
    const keyRenderer = (entry, options, theme) => muxKeysRender(entry, options, theme, { Text: TuiText });
    // `?.` because a mock api in a pin may not implement the entry-renderer plane; a real pi always does.
    pi.registerEntryRenderer?.("mux-keys", keyRenderer);
    pi.registerCommand(`${MUX_COMMAND_NAME}-keys`, {
      description: "Print the active mux preset's keys, pi's own rendering of its keys, and the actions its backend refuses to name",
      handler: async (args, ctx) => {
        const ui = ctx?.ui;
        const state = { presets: String(args ?? "").split(/[,\s]+/).filter((s) => loaded?.names?.includes(s)) };
        const text = muxKeysText(loaded, state);
        if (ui?.notify) ui.notify(text, "info");
        else process.stdout.write(text + "\n");
        // The entry below is where pi's keyHint()/keyText() actually run; saying so keeps the two documents
        // from reading as one claim.
        if (ui?.notify) ui.notify("mux keys \u2014 an entry follows, rendered by pi with pi's own KeybindingHints (keyHint/keyText)", "info");
        pi.appendEntry?.("mux-keys", { loaded, state });
      },
    });
  } catch (err) {
    // The command above is already registered; a preset table that failed to load must not eat it. Say so.
    pi.registerCommand(`${MUX_COMMAND_NAME}-preset-problem`, {
      description: "Report why no mux preset could be loaded",
      handler: async (_args, ctx) => ctx?.ui?.notify(`mux: no preset loaded: ${err?.message ?? err} (the /mux command still works; keybinds are not registered)`, "error"),
    });
  }
}

// THE LAST LINE — a marker, not code. Nothing below this comment is executable. The only out-of-process legs here
// are the owner plane's own (a census, `--run` argv, a `--create` owner start), and the only store write is the
// broker's own spool inbox through `writeIntent`. `muxStopOwner` is imported for the reader's benefit: `halt`'s
// argv already names it, so `muxRunPlan` is what runs it and nothing here spells a second off switch.
