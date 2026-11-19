// .pi/extensions/queue-surface.js — /queue: view and adjust the rig's shared work queue from inside a pi session.
//
// WHY THIS FILE EXISTS. The operator's ask is "view and manage the queue in a human-friendly way" on a pi-native
// landing screen. `src/queue-command.mjs` already holds the whole grammar of that ask — the flag table, the closed
// value vocabularies, the parse, the collisions, the decide step, the render — and `cli.mjs` adopted it, so the
// scripted verb and this command are TWO REGISTRATIONS OF ONE CORE (D334). A registration with its own flag table
// is a second grammar: the moment the two grow apart, one accepts what the other refuses, and an argument that is
// accepted and ignored reads as success (#5071) — the fail-open's defect class (ROADMAP 228). So this file holds
// only what the PI PLANE knows: how a session receives the request (one string, not argv), what it shows (the
// core's strings as notifications, since a command handler's return value is not printed — see
// `dist/core/extensions/types.d.ts` `handler: (args, ctx) => Promise<void>`), and which store it reads.
//
// WHAT IT NEVER DOES: it starts no process and shells out to nothing. The pi-durable library and pi's own
// extension API give it in-process access to the session, and `tools/queue-surface-core.mjs` imports the rig's
// read/act modules directly — the convention pi's `examples/extensions/commands.ts` shows (in-process, `ctx.ui`),
// while `examples/extensions/subagent/index.ts` reaches out-of-process only because a subagent has no in-process
// surface. Nothing here has that excuse.
//
// WHICH HARNESS AN ACT DRIVES, named. The durable-TUI plane's host shell is documented rendering-only, so a
// command on that plane must not become a store driver. An ACT therefore goes only through the broker's spool
// (`queueManageSpool`/`queueDiscussSpool`, requireBroker): with no live broker owning the store the act is REFUSED
// before the write (code `no-live-broker`), and when one is resident the broker applies it and answers with its own
// record. A session can therefore never print "applied" for something nothing applied.
//
// THE TRUST GATE, stated rather than assumed: a project `.pi/extensions/` file is loaded only when the project is
// trusted (pi's package manager gates project resources on that decision). On an untrusted landing session /queue
// simply is not there — which is why the docs say "where the project is trusted", never "always available".
//
// PLANE (D212): the extension plane, not the base. Tracked here in `tools/`; installed to `.pi/extensions/queue-surface.js`
// by `tools/queue-surface-install.mjs` (that dir is gitignored because it can hold machine-local keys). The core it
// imports is NOT copied — it lives only in `tools/`, so its own `../src/...` imports resolve from `tools/` on both
// planes, and one edited grammar stays one file.
//
// Cost (D213): no model, no key, no network, no process. Loading it costs the harness a file read; running
// /queue costs the rig's own store read. Measured Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64
// / node v24.22.1: the loop for a change here is `node demo/queue-pi-command.test.mjs`.

// Where the core lives, resolved from wherever the loader actually ran this file: from `.pi/extensions/` two
// levels up lands in the repo's `tools/`; from `tools/` (a gate loading the tracked source) the neighbour is it.
const rig = await import(new URL("./queue-surface-core.mjs", import.meta.url).href).catch(() => import("../../tools/queue-surface-core.mjs"));
const {
  QUEUE_COMMAND_NAME,
  QUEUE_SURFACE_DESCRIPTION,
  queueSurfaceCompletion,
  queueSurfaceInvoke,
} = rig;

export default function (pi) {
  pi.registerCommand(QUEUE_COMMAND_NAME, {
    description: QUEUE_SURFACE_DESCRIPTION,
    // The argument box is drawn from the core's own table — the same vocabulary that decides the argument.
    getArgumentCompletions: (prefix) => queueSurfaceCompletion(prefix),
    handler: async (args, ctx) => {
      // The session's cwd is the workspace; DURIG_DB (or the store the rig config names) selects the store,
      // so /queue reads the same database `cli.mjs status` reads — never a store of its own invention.
      const say = (body, level) => {
        const ui = ctx?.ui;
        if (ui?.notify) ui.notify(body, level);
        else process.stdout.write(String(body) + "\n");
      };
      try {
        const out = await queueSurfaceInvoke(args, { cwd: process.cwd() });
        for (const line of out.show) say(line.body, line.level);
      } catch (err) {
        // A command handler that throws turns into an extension error event; the session keeps its state.
        // Report the cause instead: the ask is a view, and a view that dies silently is worse than one that
        // says it could not read.
        say(`queue: the command failed: ${err?.message ?? err}\n  (the queue was NOT changed; see docs/runbooks/broker-down-or-stalled.md)`, "error");
      }
    },
  });
}
