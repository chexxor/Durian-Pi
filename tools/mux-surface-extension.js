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
// WHAT THIS FILE NEVER DOES: it starts no process, shells out to nothing, and holds no `child_process`. The ONE
// out-of-process leg in this plugin is `tools/mux-surface-owner.mjs`, and it runs a driver's argv only under an
// explicit `--run`. A pane is an ATTACHED CLIENT: its acts are the broker's spool ops, never bytes typed into a
// window (a second writer into a seat is what corrupted this store twice — docs/runbooks/README.md).
//
// THE TRUST GATE, stated not assumed: a project `.pi/extensions/` file loads only where the project is TRUSTED.
// On an untrusted landing session /mux simply is not there, which is why docs say "where the project is trusted".
//
// PLANE (D212): the extension plane, never the base. Tracked in `tools/`, installed to `.pi/extensions/mux-surface.js`
// by `tools/mux-surface-install.mjs`. The CORE and the DRIVERS are not copied — their `../src/...` imports only
// resolve from the repo's `tools/`, so one edited grammar stays one file on both planes (measured for the same
// reason under `tools/queue-surface-install.mjs`).
//
// Cost (D213): no model, no key, no network, no process started here. Loading costs a file read; `/mux list` costs
// the rig's store read plus (under --run) one multiplexer census. Measured Linux / Fedora Linux 45 (Forty Five) /
// kernel 7.2.15-300.fc45.x86_64 / node v24.22.1: the loop for a change here is
// `node demo/mux-surface.test.mjs` (hermetic, fauxProvider plane).

// Where the core lives, from wherever the loader ran this file: from `.pi/extensions/` two levels up lands in
// `tools/`; from `tools/` (a gate loading the tracked source) the neighbour is it.
// THE OWNER PLANE IS NOT IMPORTED HERE, deliberately: it is the plugin's only `child_process` module, and a
// presentation command must not be able to reach it. `cli.mjs mux` is the plane that may pass `--run`.
const rig = await import(new URL("./mux-surface-core.mjs", import.meta.url).href).catch(() => import("../../tools/mux-surface-core.mjs"));
const {
  MUX_COMMAND_NAME,
  MUX_SURFACE_DESCRIPTION,
  muxSurfaceCompletion,
  muxSurfaceInvoke,
  muxSurfaceSeams,
  muxKeysText,
} = rig;

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
        // The session's cwd is the workspace; DURIG_DB/DURIAN_PI_DB (or the store the rig config names) selects
        // the store, so /mux reads exactly what `cli.mjs status` reads — never a store of its own invention.
        const out = await muxSurfaceInvoke(args, { cwd: process.cwd() });
        for (const line of out.show) say(line.body, line.level);
      } catch (err) {
        // A handler that throws becomes an extension error event; say the cause instead. The ask is a VIEW of a
        // session that other processes own — a view that dies silently is worse than one that says it could not read.
        say(`mux: the command failed: ${err?.message ?? err}\n  (no pane was created, no session was started; see docs/runbooks/pi-inside-tmux.md)`, "error");
      }
    },
  });

  // THE SHORTCUTS ARE THE ACTIVE PRESET'S ONLY. A key style is a backend word (tmux-style and screen-style
  // disagree), so registering every driver's preset would put four key tables on one session; the ACTIVE backend
  // — the highest-ranked driver whose binary answered, chosen by the core from a driver `rank` fact — owns them.
  // pi owns ctrl+shift+up/down, ctrl+shift+f/g/p and every single ctrl+a…ctrl+z (pi 1.5.2 docs/extensions.md), so
  // a preset that borrows one is a conflict pi reports, not one this plugin resolves silently.
  try {
    const loaded = await rig.muxSurfaceDrivers({ env: process.env });
    const active = loaded.drivers.get(loaded.active)?.driver;
    const keys = active?.preset?.keys ?? {};
    for (const [name, combo] of Object.entries(keys)) {
      const verb = String(name).startsWith("mux.") ? String(name).slice(4) : name;
      if (!combo || !verb) continue;
      pi.registerShortcut(combo, {
        description: `mux ${verb} (${active.backend} preset)`,
        handler: async (ctx) => {
          const out = await muxSurfaceInvoke(verb, { cwd: process.cwd() });
          const ui = ctx?.ui;
          for (const line of out.show) {
            if (ui?.notify) ui.notify(line.body, line.level);
            else process.stdout.write(String(line.body) + "\n");
          }
        },
      });
    }
    // The KEY TABLE itself is rendered with the core's own text (which uses pi's key vocabulary), so a reader
    // sees which preset is active and which actions the ACTIVE backend refuses to name.
    pi.registerCommand(`${MUX_COMMAND_NAME}-keys`, {
      description: "Print the active mux preset's keys and the actions its backend refuses to name",
      handler: async (_args, ctx) => {
        const ui = ctx?.ui;
        const text = muxKeysText(loaded, {});
        if (ui?.notify) ui.notify(text, "info");
        else process.stdout.write(text + "\n");
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
