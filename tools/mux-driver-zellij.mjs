// tools/mux-driver-zellij.mjs — a DRIVER for Zellij: the ONLY place this backend's words may appear.
//
// WHY A DRIVER (contract (1), "SEAM NOT PORT"): `tools/mux-surface-core.mjs` decides verbs, selectors, panes,
// ownership, acts and NAMESPACES and names no backend (`grep -c -E 'tmux|screen|zellij|herdr'
// tools/mux-surface-core.mjs` -> 0, measured). This file spells ONE backend's argv for those decisions. It starts
// no process — the ONE out-of-process leg is `tools/mux-surface-owner.mjs` and only under `--run`.
//
// NOTHING IN THIS FILE HAS BEEN RUN. `zellij` is ABSENT on this rig's host (measured 2026-11-20/21: Linux /
// Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1; `zellij` not on PATH, no
// passwordless sudo). So the honest answer for this backend is NOT-RUN (contract (7)): the driver is REGISTERED
// and its gap is NAMED, and it is never green. The argv below is grounded from
// https://zellij.dev/documentation/cli-actions fetched 2026-11-20 (official); the SESSION-level lines (`-s`,
// `attach --create`, `list-sessions`, `kill-session`) are the WEAKER half of that grounding (x-cmd + lobehub
// mirrors) and are marked as such in docs/runbooks/pi-inside-tmux.md.
//
// WHAT ZELLJ'S MODEL DOES NOT HAVE, and what follows from it (contract (4)'s second-writer rule):
//   - Zellij assigns PANE IDS ITSELF (`terminal_1`), discoverable via `action list-panes -j` and `ZELLIJ_PANE_ID`.
//     So a driver must CAPTURE the id from a census/stdout rather than name it after the seat; the window NAME
//     (`--name`) is what carries the seat for a human reader. `plan.paneId` is where a census-learned id lands.
//   - There is no `has-session` equivalent: existence is answered by `list-sessions`.
//   - Zellij DOES have a real detach verb (`action detach` — "leaving it running in the background"), which is
//     tmux-like; GNU Screen's driver is where the semantics differ (see tools/mux-driver-screen.mjs).
//
// Cost (D213): pure composition — no model/key/network/process here. `node --check` 0.01 s; the pin that
// exercises it is `node demo/mux-drivers.test.mjs`.
import { dirname as dirOf, join } from "node:path";
// THE PANE COMMAND IS THE CORE'S DECISION, HANDED IN ON THE PLAN AS DATA (`plan.paneArgv`, built by the core's
// `muxPaneArgv` — see its note there). This driver imports NO sibling module: the seam passes the decision, so a
// driver can be loaded on its own and cannot half-register against a sibling it cannot see.

const workspace = (store) => (store ? dirOf(store) : null);
// A census-learned pane id when one exists; otherwise the NAME this driver gave the pane (a human-readable
// fallback, LOUD in the note so a reader cannot mistake it for Zellij's own id).
const paneId = (plan) => plan.paneId || plan.pane?.paneName || null;

export const MUX_DRIVER = {
  backend: "zellij",
  // THE SHIPPING ORDER is a driver fact, not a backend name in the core: the core picks the highest `rank` it
  // finds, so the default ACTIVE backend is a registration fact and never a word the core spells.
  rank: 80,
  // NOT-RUN on this host: `zellij version` is the probe, and the owner plane prints `NOT-RUN` when the binary is
  // absent — which is this host. Registered != runnable; the distinction is contract (7).
  version: ["zellij", "version"],
  probe: ["zellij", "version"],
  docs: "docs/runbooks/pi-inside-tmux.md", // this driver owns that runbook's Zellij section

  // THE PLATFORM TABLE — a DRIVER fact (the classes are defined in tools/mux-driver-tmux.mjs; the core's
  // `muxPlatformVerdict` reads it and never names an OS). Nothing in this driver has been RUN: the binary is
  // absent on this rig's Linux host, and this box has no Windows host either, so BOTH rows are the honest
  // class — one measured ABSENT, one advertised-elsewhere — and neither may be printed as observed.
  platform: {
    linux: {
      binary: "zellij",
      status: "absent",
      note: "MEASURED ABSENT on this rig's host (Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1): `zellij` is not on PATH and there is no passwordless sudo to install it, so the owner plane answers NOT-RUN at ms 0 and starts NOTHING. Registered != runnable (contract (7)); this backend is never green on this box.",
      route: null,
    },
    windows: {
      binary: "zellij",
      status: "advertised-elsewhere",
      route: "the official Windows build ships as a zip (`zellij-x86_64-pc-windows-msvc.zip`) holding `zellij.exe` and `zellij-terminal.exe`, plus an .msi installer route — https://zellij.dev/documentation/installation.html fetched 2026-11-22",
      note: "VERBATIM: \"The zip (`zellij-x86_64-pc-windows-msvc.zip`) holds `zellij.exe` and `zellij-terminal.exe`.\" https://zellij.dev/documentation/installation.html fetched 2026-11-22. The Windows binary's NAME is `zellij`; the `.exe` is the extension a Windows PATH resolves, so the probe argv below stays valid. NEVER RUN here: no Windows host on this rig and no zellij on this host at all, so every argv in this driver is UNVERIFIED on every platform.",
    },
  },

  capabilities: new Set(["list", "open", "attach", "detach", "kill", "capture", "halt", "act"]),

  // THE PRESET lives with its backend (a key style IS a backend word). Borrowed from Zellij's own verb names
  // where one exists (attach->j [Zellij's `j` tab], capture->b [`action dump-screen`'s buffer], kill->z [`kill-session`],
  // detach->y, halt->h [Zellij's own `h` help], list->n, open->m, send->t [`action paste`/type) — invented otherwise,
  // and none borrows a pi default (pi owns ctrl+shift+up/down, ctrl+shift+f/g/p and every single ctrl+a…ctrl+z,
  // pi 1.5.2 docs/extensions.md). Cross-preset collisions are ACCEPTED: the extension binds the ACTIVE preset's
  // shortcuts ONLY, and pi cannot put two handlers on one chord.
  preset: {
    style: "zellij",
    keys: {
      "mux.list": "ctrl+shift+n",
      "mux.open": "ctrl+shift+m",
      "mux.attach": "ctrl+shift+j",
      "mux.detach": "ctrl+shift+y",
      "mux.kill": "ctrl+shift+z",
      "mux.capture": "ctrl+shift+b",
      "mux.halt": "ctrl+shift+h",
      "mux.send": "ctrl+shift+t",
    },
  },

  // THE NAME IS THE CORE'S DECISION, spelled in Zellij's `-s` vocabulary. plugin namespace -> the derived tag;
  // user namespace -> the session the user named, VERBATIM (never renamed, despite `rename-session` existing).
  sessionName: ({ tag = null, namespace = "plugin" } = {}) => String(tag ?? ""),

  // PARSE of the census commands below. `action list-panes -j` is OFFICIAL (json carries `pane_command`, `pane_cwd`);
  // the session-level output shape is the WEAKER half of this driver's grounding, so unparsed lines are RETURNED,
  // not swallowed — a census that silently reports zero sessions is the fail-open's class.
  census: (output) => {
    const raw = String(output ?? "").trim();
    if (!raw) return { sessions: [], unparsed: [] };
    try {
      const doc = JSON.parse(raw);
      const rows = doc?.panes ?? doc?.sessions ?? (Array.isArray(doc) ? doc : []);
      const sessions = rows.map((r) => ({
        name: r?.session_name ?? r?.name ?? r?.PANE_ID ?? null,
        panes: r?.pane_count ?? null,
        pane_id: r?.pane_id ?? r?.PANE_ID ?? null,
        command: r?.pane_command ?? r?.command ?? null,
      }));
      return { sessions: sessions.filter((s) => s.name || s.pane_id), unparsed: [] };
    } catch { /* not json: fall through to the line parse */ }
    const sessions = [];
    const unparsed = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || /^currently:/.test(t)) continue;
      const p = /^(\S+)\s+(\S+)\s+(.*)$/.exec(t); // `PANE_ID TYPE TITLE` (official)
      if (p) {
        sessions.push({ name: null, pane_id: p[1], type: p[2], title: p[3] });
        continue;
      }
      const s = /^(\S+)\s.*\((Detached|Attached)\)/i.exec(t); // session-level shape: WEAKER source, guess
      if (s) {
        sessions.push({ name: s[1], panes: null, state: s[2] });
        continue;
      }
      unparsed.push(t);
    }
    return { sessions, unparsed };
  },

  commands: {
    list: (plan) => {
      if (plan.index === 0)
        return {
          argv: ["zellij", "list-sessions"],
          note: "sessions census — every Zellij session, which is what makes the user's own session reportable as PRESENT, NOT TOUCHED. No `has-session` equivalent exists, so existence is answered here. UNVERIFIED (zellij absent on this host).",
        };
      if (plan.index === 1)
        return {
          argv: ["zellij", "action", "list-panes", "-j"],
          note: "pane census for the CURRENT session (json carries pane_command/pane_cwd, which is how a pane is attributed to a SEAT: the pane command names `--select <seat>`). UNVERIFIED on this host. Zellij's pane ids are ITS OWN (`terminal_1`) — capture them here, do not invent them.",
        };
      return null;
    },

    open: (plan) => {
      if (!plan.pane || !plan.pane.seat) return null;
      const ws = workspace(plan.store);
      const cmd = plan.paneArgv; // the core's ONE pane argv, never restated here
      if (!cmd)
        return {
          note:
            "NAMED GAP: no pane argv could be built (no store, no seat, or the plugin's pane client is not on disk), " +
            "so NO argv is emitted — a pane that runs nothing is the fail-open this seam refuses.",
        };
      if (plan.index === 0)
        return {
          argv: ["zellij", "attach", "--create", String(plan.sessionName)],
          cwd: ws,
          note: "create the PLUGIN's OWN session (the session-level form is the WEAKER half of this driver's grounding). NAMED GAP: Zellij's initial pane runs the user's shell, so the seat's attach command is added as a PANE (below) rather than as the session's command. The rig's own session is the broker's (`DURIG_DB=<store> node cli.mjs serve`); this pane only ATTACHES to it. UNVERIFIED on this host.",
        };
      return {
        argv: ["zellij", "action", "new-pane", "--name", String(plan.pane.paneName), ...(ws ? ["--cwd", ws] : []), "--close-on-exit", "--", ...cmd],
        cwd: ws,
        note: "another PANE in the plugin's own session running the PLUGIN's OWN pane client (official form; `action new-pane` RETURNS the created pane id, which is Zellij's own — capture it). `--close-on-exit` keeps a finished pane's window from holding a client; the client itself defaults to FOREVER, so a normal pane does not finish. UNVERIFIED on this host (zellij is absent here).",
      };
    },

    attach: (plan) => {
      if (plan.index !== 0) return null;
      return {
        argv: ["zellij", "attach", String(plan.sessionName)],
        note: "ONE client per session (each seat is a PANE, not a client). UNVERIFIED on this host.",
      };
    },

    detach: (plan) => {
      if (plan.index !== 0) return null;
      return {
        argv: ["zellij", "action", "detach"],
        note: "Zellij HAS a real detach verb — 'detach from the current session, leaving it running in the background' — so closing the viewport never ends the session, the same guarantee tmux gives and GNU Screen does NOT. UNVERIFIED on this host.",
      };
    },

    kill: (plan) => {
      if (!plan.pane) return null;
      return {
        argv: ["zellij", "action", "close-pane", "--pane-id", String(paneId(plan))],
        note: "ONE pane, never the session. `--pane-id` wants Zellij's OWN id (`terminal_1`), which only a census gives — the fallback in this argv is the NAME the driver gave, LOUD so a reader sees it is not Zellij's id. UNVERIFIED on this host.",
      };
    },

    capture: (plan) => {
      if (!plan.pane) return null;
      const ws = workspace(plan.store);
      const file = ws ? join(ws, `.mux-capture-${plan.pane.paneName}.txt`) : null;
      return {
        argv: ["zellij", "action", "dump-screen", "--pane-id", String(paneId(plan)), ...(file ? ["--path", file] : [])],
        note: "CAPTURE is Zellij's `dump-screen` (official; `--full`/`--ansi` are the other knobs). UNVERIFIED on this host.",
      };
    },

    halt: (plan) => ({
      // THE STORE IS NAMED BY ENV, NOT BY A FLAG: `cli.mjs` HAS NO `--db` (MEASURED 2026-11-21 — an invented
      // `--db` is silently ignored and the verb acts on the CONFIGURED store).
      argv: ["node", "cli.mjs", "serve", "--stop"],
      env: { DURIG_DB: plan.store, DURIAN_PI_DB: plan.store },
      note: `stop the rig's OWN detached owner (its own serve --stop semantics, never a new lifecycle; the store is named by \`DURIG_DB=\`, NOT by a non-existent \`--db\`). The plugin's session-scoped Zellij teardown is \`zellij kill-session ${plan.sessionName}\`; \`zellij kill-all-sessions\` is NEVER emitted — it ends the sessions the USER started, which is the core's \`--every-session\` refusal BY NAME. UNVERIFIED on this host.`,
    }),

    // NO `act` HERE — deliberate: acts are the broker's spool ops (core `muxActRequest`), and Zellij's own input
    // verbs (`action write-chars`, `action paste`, `action send-keys`) would be a SECOND WRITER into a seat.
  },
};
