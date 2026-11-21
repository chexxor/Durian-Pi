// tools/mux-driver-herdr.mjs — a DRIVER for herdr: the ONLY place this backend's words may appear.
//
// WHY A DRIVER (contract (1), "SEAM NOT PORT"): `tools/mux-surface-core.mjs` decides verbs, selectors, panes,
// ownership, acts and NAMESPACES and names no backend (`grep -c -E 'tmux|screen|zellij|herdr'
// tools/mux-surface-core.mjs` -> 0, measured). This file spells ONE backend's argv for those decisions, and it
// starts no process (the ONE process leg is `tools/mux-surface-owner.mjs`, only under `--run`).
//
// NOT-RUN ON THIS HOST, and that is the honest answer (contract (7)). `herdr` is ABSENT on this rig's host
// (measured 2026-11-20/21: Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1;
// not on PATH, no passwordless sudo). The driver is REGISTERED and its gap is NAMED; it is never green.
// Grounded from https://herdr.dev/tui/docs/cli-reference/ fetched 2026-11-20 (official). Most of herdr's
// commands PRINT JSON and usage errors exit 2 — so its census parse is JSON, unlike tmux/screen's text.
//
// HERDR'S OWN NAMESPACE IS THE INFERRED HALF of this driver (say so, do not blur it): the `--session <name>`
// mapping came from that page's wording (`herdr [--session <name>]`, and `HERDR_SESSION` selects a named session)
// — never observed on a binary. If herdr's session vocabulary differs, only THIS file changes; the core's
// namespace decision (which session may be touched at all) does not.
//
// HERDR CANNOT DO ONE OF THIS PLUGIN'S VERBS, and that is a refusal, not a workaround:
//   NAMED GAP — there is NO verb that closes the display while keeping the session running, other than
//   `session stop`/`server stop`, which stop the SERVER (a teardown, not a detach). So `detach` is NOT declared
//   in `capabilities`, and `muxCapability` refuses `/mux detach` / the preset's detach key BY NAME rather than
//   forwarding herdr's own `ctrl+b q` (which would also be a key the plugin does not own). Same for the plugin's
//   `mux.send`: herdr's `pane send-text` / `pane send-keys` would be a SECOND WRITER into a seat, so they are
//   named nowhere in this file, and `act` is the broker's spool op.
//
// Cost (D213): pure composition — no model/key/network/process here. `node --check` 0.01 s; the pin that
// exercises it is `node demo/mux-drivers.test.mjs`.
import { dirname as dirOf } from "node:path";

const workspace = (store) => (store ? dirOf(store) : null);
// herdr addresses panes by ITS OWN ids, learned from `pane list`; the new id arrives at `.result.pane.pane_id`.
const paneId = (plan) => plan.paneId || plan.pane?.paneName || null;

export const MUX_DRIVER = {
  backend: "herdr",
  // THE SHIPPING ORDER is a driver fact, not a backend name in the core: the core picks the highest `rank`.
  rank: 70,
  // NOT-RUN on this host: absent binary => the owner plane prints `NOT-RUN`, which is this host.
  version: ["herdr", "--version"],
  probe: ["herdr", "--version"],
  docs: "docs/runbooks/pi-inside-tmux.md", // this driver owns that runbook's herdr section

  // NOTE THE MISSING `detach` — deliberate (see the header). A capability the backend has no word for is
  // REFUSED BY NAME by `muxCapability`; it is never forwarded to the multiplexer's own key.
  capabilities: new Set(["list", "open", "attach", "kill", "capture", "halt", "act"]),

  // THE PRESET is per-backend because a key style IS a backend word. Borrowed from herdr's own verb names where
  // one exists (attach->a, capture->r [`pane read`], kill->z, halt->s [`server stop`], list->n, open->v, send->t
  // [`pane send-text`'s name — the ACTION it maps to is the spool, not herdr's input], detach->q [herdr's own
  // `ctrl+b q`, kept here as a NAME only because the key exists but the verb does NOT, so it is refused]).
  // None borrows a pi default (pi owns ctrl+shift+up/down, ctrl+shift+f/g/p and every single ctrl+a…ctrl+z,
  // pi 1.5.2 docs/extensions.md).
  preset: {
    style: "herdr",
    keys: {
      "mux.list": "ctrl+shift+n",
      "mux.open": "ctrl+shift+v",
      "mux.attach": "ctrl+shift+a",
      "mux.detach": "ctrl+shift+q",
      "mux.kill": "ctrl+shift+z",
      "mux.capture": "ctrl+shift+r",
      "mux.halt": "ctrl+shift+s",
      "mux.send": "ctrl+shift+t",
    },
  },

  // THE NAME IS THE CORE'S DECISION, spelled in herdr's own session vocabulary (INFERRED mapping, see header):
  // plugin namespace -> the derived tag; user namespace -> the session the user named, VERBATIM.
  sessionName: ({ tag = null, namespace = "plugin" } = {}) => String(tag ?? ""),

  // PARSE of herdr's JSON census. SHAPE UNVERIFIED (the binary is absent): an unparseable document yields
  // `unparsed`, never an empty success — an empty census would read as "the user has no sessions".
  census: (output) => {
    const raw = String(output ?? "").trim();
    if (!raw) return { sessions: [], unparsed: [] };
    let doc = null;
    try {
      doc = JSON.parse(raw);
    } catch {
      return { sessions: [], unparsed: [raw] };
    }
    const rows = doc?.result?.sessions ?? doc?.sessions ?? doc?.result?.panes ?? doc?.panes ?? (Array.isArray(doc) ? doc : []);
    const sessions = rows.map((r) => ({
      name: r?.name ?? r?.session ?? r?.session_id ?? null,
      panes: r?.pane_count ?? r?.pane_count ?? null,
      pane_id: r?.pane_id ?? r?.id ?? null,
      command: r?.command ?? r?.current_command ?? null,
    }));
    return { sessions: sessions.filter((s) => s.name || s.pane_id), unparsed: [] };
  },

  commands: {
    list: (plan) => {
      if (plan.index === 0)
        return {
          argv: ["herdr", "session", "list", "--json"],
          note: "sessions census — every herdr session, so the user's own session is reportable PRESENT, NOT TOUCHED. The session vocabulary is INFERRED, never observed. UNVERIFIED on this host.",
        };
      if (plan.index === 1)
        return {
          argv: ["herdr", "pane", "list", "--json"],
          note: "pane census — herdr's OWN pane ids (a pane is attributed to a SEAT by the command it runs, which names `--select <seat>`). UNVERIFIED on this host.",
        };
      return null;
    },

    open: (plan) => {
      const ws = workspace(plan.store);
      if (plan.index === 0)
        return {
          // ensure the plugin's OWN session exists before any pane is split into it. `herdr --session <name>` is
          // the launch/attach form; `HERDR_SESSION` is the env alternative.
          argv: ["herdr", "--session", String(plan.sessionName)],
          cwd: ws,
          note: "create/enter the PLUGIN's OWN named session. NAMED GAP: herdr has no verb that creates a pane running an ARBITRARY command at session start — a new pane runs the shell, and `pane run <id> <cmd>` then types it. The namespace mapping here is INFERRED from the CLI-reference page's wording. UNVERIFIED on this host.",
        };
      if (!plan.pane) return null;
      return {
        argv: ["herdr", "pane", "split", "--direction", "right", "--cwd", ws ?? process.cwd(), "--no-focus"],
        cwd: ws,
        note: "another PANE in the plugin's own session; the new id arrives at `.result.pane.pane_id` and must be CAPTURED, not assumed. The pane then runs the rig's OWN attach surface via `herdr pane run <id> node tui.mjs --db <abs store> --attach --select <seat>` — `pane run` TYPES that command into the pane's SHELL to start the pane, which is legitimate; the same verb aimed at a SEAT afterwards would be a second writer and the plugin names it nowhere. UNVERIFIED on this host.",
      };
    },

    attach: (plan) => {
      if (plan.index !== 0) return null;
      return {
        argv: ["herdr", "session", "attach", String(plan.sessionName)],
        note: "ONE client per session; each seat is a PANE. `herdr terminal attach <id> [--takeover]` is the per-terminal form and `terminal session observe <target>` is the READ-ONLY live view, which is the shape this plugin's read-only pane wants. UNVERIFIED on this host.",
      };
    },

    // NO `detach` HERE — deliberate. herdr has no verb that closes the display while keeping the session running,
    // other than stopping the server (a teardown). `muxCapability` therefore refuses the verb and the preset's
    // detach key BY NAME (`capability-not-declared`), and the plugin never forwards herdr's own `ctrl+b q`.

    kill: (plan) => {
      if (!plan.pane) return null;
      return {
        argv: ["herdr", "pane", "close", String(paneId(plan))],
        note: "ONE pane, never the session. `close` wants herdr's OWN pane id, which only `pane list` gives; the fallback here is the pane NAME the driver used, LOUD so a reader sees it is not herdr's id. UNVERIFIED on this host.",
      };
    },

    capture: (plan) => {
      if (!plan.pane) return null;
      return {
        argv: ["herdr", "pane", "read", String(paneId(plan)), "--source", "visible", "--format", "text"],
        note: "CAPTURE is `pane read` (sources: visible | recent | recent-unwrapped | detection). A pane's text is viewport evidence; the seat's record is the store (`src/multiplex.mjs` `mergedInputStream`). UNVERIFIED on this host.",
      };
    },

    halt: (plan) => ({
      // THE STORE IS NAMED BY ENV, NOT BY A FLAG: `cli.mjs` HAS NO `--db` (MEASURED 2026-11-21 — an invented
      // `--db` is silently ignored and the verb acts on the CONFIGURED store).
      argv: ["node", "cli.mjs", "serve", "--stop"],
      env: { DURIG_DB: plan.store, DURIAN_PI_DB: plan.store },
      note: `stop the rig's OWN detached owner (its own serve --stop semantics, never a new lifecycle; the store is named by \`DURIG_DB=\`, NOT by a non-existent \`--db\`). The plugin's session-scoped herdr teardown is \`herdr session stop ${plan.sessionName}\`; \`herdr server stop\` is NEVER emitted — it stops EVERY session the server manages, including the user's namespace, which is the core's \`--every-session\` refusal BY NAME. UNVERIFIED on this host.`,
    }),

    // NO `act` HERE — deliberate: acts are the broker's spool ops (core `muxActRequest`), and herdr's `pane send-text`
    // / `pane send-keys` / `agent prompt` would be a SECOND WRITER into a seat. (`agent start --kind pi` starts PI,
    // not this rig's `tui.mjs` attach surface — a named difference, not a shortcut to take.)
  },
};
