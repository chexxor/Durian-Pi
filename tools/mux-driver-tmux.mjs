// tools/mux-driver-tmux.mjs — a DRIVER: the ONLY place this backend's own words may appear.
//
// WHY THIS FILE EXISTS AT ALL (the goal's contract (1), "SEAM NOT PORT").
// `tools/mux-surface-core.mjs` decides verbs, selectors, panes, ownership, acts and NAMESPACES, and it names NO
// backend anywhere (`grep -c -E 'tmux|screen|zellij|herdr' tools/mux-surface-core.mjs` -> 0, measured). This file
// is one of the drivers that core discovers (`/^mux-driver-[a-z][a-z0-9-]*\.mjs$/`, keyed by its own `backend`
// field). A backend swap is a registration in that table, not a rewrite: the seam a plain-pi port would swap is
// exactly `{backend, sessionName, commands, preset, capabilities, census}`. Everything this file spells is ARGV
// AS DATA — it starts no process (no `child_process` here; the ONE process leg is `tools/mux-surface-owner.mjs`).
//
// WHAT A PANE IS HERE (contract (3)+(4)). A tmux window is a VIEWPORT onto the rig's ONE session. The pane runs
// the rig's OWN attach surface — `node tui.mjs --db <abs store> --attach --select <seat>` — which is the read-only
// viewer (`src/storeownership.mjs` `tuiOpenVerdict`: pi-durable spec.md:4371 "Harness instances must never own the
// same Session concurrently"). The rig's session itself stays in the ONE resident detached owner (`cli.mjs serve`,
// `src/broker.mjs`), so `tmux detach-client` / closing the window never ends it: tmux keeps a session that holds
// no client, exactly tmux's own detach semantics.
//
// ACTS ARE NOT TMUX KEYS (the whole point of contract (4)). There is deliberately NO `act` entry in `commands`
// and no `send-keys` argv anywhere in the plugin: an act is ROUTED to the broker's spool by the core
// (`muxActRequest` -> `SPOOL_OPS` -> `authorizeSpoolRequest`). A tmux `send-keys` into a pane would be a SECOND
// writer into the seat, which is what corrupted this store twice (docs/runbooks/README.md). `mux.send` in the
// preset therefore maps to `/mux act <seat> --op message --text "…"`, i.e. to the spool, not to the terminal.
//
// GROUNDING (D159: never assert from memory). The argv shapes below come from
// https://tmux.app/commands/ fetched 2026-11-20 (see docs/runbooks/pi-inside-tmux.md, which this driver owns),
// AND — MEASURED 2026-11-21 — from running them against a REAL tmux binary on this host. tmux 3.5a is SELF-BUILT
// FROM SOURCE here (`.spike/build-tmux.sh`: codeload tarball + autogen + configure + make; `tmux -V` -> `tmux 3.5a`);
// the DISTRO census is still true and is a SEPARATE fact: `tmux` is NOT in PATH and `/usr/bin/tmux` is absent, so a
// user of this rig gets the plugin only with a binary they bring. The real leg (see the runbook's REAL-BINARY CENSUS)
// ran this driver's OWN argv through `tools/mux-surface-owner.mjs` `muxRunPlan`/`muxSessions` and corrected TWO
// shapes that the docs alone got wrong: `list-panes -t <session>` answers ONE pane (3.5a's `-t` is a TARGET pane, not
// a session selector), so the pane census is `list-windows -t <session>`; and the 3-part dotted target `session.name.0`
// is REJECTED (`can''t find pane`) while the 2-part `session:<window-name>` addresses the right window. A note that
// still says UNVERIFIED names a leg that was NOT run; a note that quotes a result was measured.
//
// MEASURED 2026-11-21 ON tmux 3.5a SELF-BUILT (Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64
// / node v24.22.1): `extended-keys-format` DEFAULTS TO `xterm`, not `csi-u` (`show-options -g extended-keys-format`
// -> `extended-keys-format xterm`; `options-table.c:323` lists choices `csi-u`,`xterm` with `.default_num = 1`), so
// the runbook's csi-u line is a `set -g extended-keys-format csi-u`, never "already on by default".
// Every line that has not been executed against a binary carries `UNVERIFIED` in its `note`. The real-binary
// demonstration available on this host is GNU Screen (see tools/mux-driver-screen.mjs).
//
// Cost (D213): pure composition, no model/key/network/process — `node --check` 0.01 s; the pin that exercises it
// is `node demo/mux-surface.test.mjs`. Measured Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64
// / node v24.22.1, last_verified 2026-11-21 (`node --check tools/mux-driver-tmux.mjs`).
import { dirname as dirOf, join } from "node:path";

// THE WORKSPACE, derived from the store by the SAME convention the core's tag uses
// (`muxWorkspaceTag` = `durian-<basename(dirname(store))>`), so the pane's start directory and the session's
// name always agree.
const workspace = (store) => (store ? dirOf(store) : null);

// A tmux session name may not contain `.` or `:`; the core's tag is a slug, so this is a belt, not a guess.
const safe = (name) => String(name ?? "").replace(/[.:]/g, "-");

// THE NAMED GAP (defect A). In the USER namespace the name is the session the user NAMED, and tmux cannot
// address a name containing `.` or `:`. Renaming it (the `safe()` rewrite) would SILENTLY AIM AT A DIFFERENT
// SESSION — `4242.user-watching` would become `4242-user-watching`, which is not the session the user asked for,
// and in screen's socket vocabulary the `.` is the pid/name separator. So a blocked ask emits NO argv: the
// plugin reports the gap and refuses to get close.
const blocked = (plan) => plan.namespace === "user" && !/^[^.]+$/.test(String(plan.sessionName ?? ""));
const blockedNote = (plan) => ({
  note:
    "NAMED GAP: tmux session names may not contain . or :, and the session the user named (" +
    plan.sessionName +
    ") does, so tmux CANNOT address it. NO argv is emitted - the plugin does not rename a session to get close, because that would be aiming at another session.",
});

export const MUX_DRIVER = {
  backend: "tmux",
  // THE SHIPPING ORDER is a driver fact, not a backend name in the core: the tmux driver is the one shipped
  // first, so it is the ACTIVE backend when nothing was asked. The core picks the highest `rank` it finds.
  rank: 100,
  // `probe` answers contract (7): registered vs NOT-RUN. `tmux -V` prints e.g. `tmux 3.8`.
  version: ["tmux", "-V"],
  probe: ["tmux", "-V"],
  docs: "docs/runbooks/pi-inside-tmux.md",

  // DECLARED, NOT ASSUMED (`muxCapability` refuses anything missing BY NAME). `act` IS declared because the
  // plugin CAN act in a tmux namespace — via the broker's spool, which is backend-free — and this file names
  // NO argv for it on the second-writer rule stated above.
  capabilities: new Set(["list", "open", "attach", "detach", "kill", "capture", "halt", "act"]),

  // THE PRESET lives with its backend because a key style IS a backend word; the core composes whatever the
  // registered drivers declare. Letters are borrowed from the backend's own verb name where one exists
  // (list->l, open->o, attach->a, detach->d, kill->x [kill-pane], capture->s [capture-pane's snapshot/-s],
  // halt->q [tmux's own quit-ish], send->v) and invented where it does not. None borrows a pi default
  // (pi owns ctrl+shift+up/down, ctrl+shift+f/g/p and every single-key ctrl+a…ctrl+z — pi 1.5.2 docs/extensions.md).
  preset: {
    style: "tmux",
    keys: {
      "mux.list": "ctrl+shift+l",
      "mux.open": "ctrl+shift+o",
      "mux.attach": "ctrl+shift+a",
      "mux.detach": "ctrl+shift+d",
      "mux.kill": "ctrl+shift+x",
      "mux.capture": "ctrl+shift+s",
      "mux.halt": "ctrl+shift+q",
      "mux.send": "ctrl+shift+v",
    },
  },

  // THE NAME IS THE CORE'S DECISION, spelled here in tmux's own vocabulary. plugin namespace -> the derived
  // tag; user namespace -> the session the user named, VERBATIM (the core passes it as `tag`).
  sessionName: ({ tag = null, namespace = "plugin" } = {}) => (namespace === "plugin" ? safe(tag) : String(tag ?? "")),

  // PARSE of the two census commands below, into the ONE shape the owner plane feeds to `muxNamespace`
  // (`present = [{name, panes}]`). The session census is `tmux ls -F ...`; the pane census is `tmux list-windows
  // -t <session> -F '#{window_index} #{pane_pid} #{window_name} #{pane_current_command}'` — MEASURED 2026-11-21 on
  // tmux 3.5a: `list-panes -t <session>` answers only ONE row (its `-t` names a TARGET pane) so it cannot census a
  // two-window session, while `list-windows -t <session>` answers every window, named.
  census: (output) => {
    const sessions = [];
    const unparsed = [];
    for (const line of String(output ?? "").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      // `-F '#{session_name} #{session_windows} #{?session_attached,attached,detached}'`
      const m = /^(\S+)\s+(\d+)\s+(attached|detached)$/.exec(t);
      if (m) {
        sessions.push({ name: m[1], panes: Number(m[2]), attached: m[3] === "attached" });
        continue;
      }
      // `-F '#{window_index} #{pane_pid} #{window_name} #{pane_current_command}'` (a window_name may hold spaces;
      // the pid is what anchors the split, so the remainder is kept WHOLE as `rest` and never re-guessed.)
      const p = /^(\d+)\s+(\d+)\s+(.*)$/.exec(t);
      if (p) sessions.push({ pane_index: p[1], pane_pid: p[2], rest: p[3], title: p[3] });
      else unparsed.push(t);
    }
    return { sessions, unparsed };
  },

  commands: {
    // THE CENSUS, in two commands: which SESSIONS exist (so the user's own session is reportable as
    // present-but-not-touched), then this session's PANES (so the pane↔seat attribution is provable).
    // One pane-selection of exactly one pane prints only the sessions census; the owner plane
    // (`muxListSessions`) runs the same pair and feeds both to the namespace decision.
    list: (plan) => {
      if (blocked(plan)) return blockedNote(plan);
      if (plan.index === 0)
        return {
          argv: ["tmux", "ls", "-F", "#{session_name} #{session_windows} #{?session_attached,attached,detached}"],
          note: "sessions census — every session the multiplexer manages, named. The plugin's own tag must appear here; any OTHER name is the user's namespace and is reported PRESENT, NOT TOUCHED (MEASURED on tmux 3.5a: with a user session `user-own` and the plugin's `durian-w1` both on the server, this census answers both and the plugin touches only its own tag).",
        };
      if (plan.index === 1)
        return {
          argv: ["tmux", "list-windows", "-t", safe(plan.sessionName), "-F", "#{window_index} #{pane_pid} #{window_name} #{pane_current_command}"],
          note: "pane census for THIS session only (MEASURED on tmux 3.5a: every window, named; `list-panes -t <session>` would answer ONE pane because tmux's `-t` names a TARGET, so it is not a census). A foreign session's windows are never listed: this names THIS session.",
        };
      return null;
    },

    open: (plan) => {
      if (blocked(plan)) return blockedNote(plan);
      if (!plan.pane || !plan.pane.seat) return null; // open names a seat; a seatless named pane starts nothing
      const ws = workspace(plan.store);
      const cmd = ["node", "tui.mjs", "--db", plan.store, "--attach", "--select", plan.pane.seat];
      // tmux >=3.x: `new-session -c` is START-DIRECTORY and the pane command is the POSITIONAL remainder;
      // `-d` makes the session DETACHED from birth, which is the detach semantics the contract asks for.
      if (plan.index === 0)
        return {
          argv: ["tmux", "new-session", "-d", "-s", safe(plan.sessionName), "-n", String(plan.pane.paneName), ...(ws ? ["-c", ws] : []), "--", ...cmd],
          cwd: ws,
          note: "first pane: create the plugin's OWN session DETACHED and name its window after the SEAT (MEASURED on tmux 3.5a: `new-session -d -s durian-w1 -n impl -c <ws> -- node tui.mjs …` rc 0 in 4 ms). The rig's session itself is owned by the broker (`DURIG_DB=<store> node cli.mjs serve`), which the owner plane starts; this pane only ATTACHES to it.",
        };
      return {
        argv: ["tmux", "new-window", "-t", safe(plan.sessionName), "-n", String(plan.pane.paneName), ...(ws ? ["-c", ws] : []), "--", ...cmd],
        cwd: ws,
        note: "later panes: another WINDOW in the plugin's own session, never a new session (MEASURED on tmux 3.5a: rc 0, and the census then answers 2 windows for one session).",
      };
    },

    attach: (plan) => {
      if (blocked(plan)) return blockedNote(plan);
      if (plan.index !== 0) return null; // tmux has no per-pane attach: ONE client attaches every window of the session
      return {
        argv: ["tmux", "attach-session", "-t", safe(plan.sessionName)],
        note: "tmux has no per-pane attach, so ONE client attaches every window of the session (needs a terminal to be interactive; the leg NOT run in the real census is this interactive one — everything else in this table ran).",
      };
    },

    detach: (plan) => {
      if (blocked(plan)) return blockedNote(plan);
      if (plan.index !== 0) return null;
      return {
        argv: ["tmux", "detach-client", "-s", safe(plan.sessionName)],
        note: "tmux's own detach semantics: the session KEEPS RUNNING with no client, so closing the pane/terminal never ends the rig's session (MEASURED on 3.5a twice: the plugin creates with `-d`, so the census says `detached` from birth and `detach-client -s durian-w1` answers `no current client` rc 1 WITHOUT ending the session — the next census still names it).",
      };
    },

    kill: (plan) => {
      if (blocked(plan)) return blockedNote(plan);
      if (!plan.pane) return null;
      // tmux's target that WORKS (MEASURED 2026-11-21 on 3.5a): `session:<window-name>` addresses the window the
      // `open` verb NAMED after the seat. The 3-part dotted form `session.window.index` the tmux man page shows for
      // OLDER tmux is REJECTED by 3.5a (`can''t find pane: impl.0`), so it is not emitted here.
      return {
        argv: ["tmux", "kill-pane", "-t", `${safe(plan.sessionName)}:${safe(plan.pane.paneName)}`],
        note: "ONE pane, never the session (MEASURED: `kill-pane -t durian-w1:impl-2` rc 0 left the session alive with its other window). The session-scoped teardown is `kill-session -t <sessionName>` and `tmux kill-server` is NEVER emitted: it ends EVERY session the server manages, including the user's namespace (the core refuses `--every-session` BY NAME).",
      };
    },

    capture: (plan) => {
      if (blocked(plan)) return blockedNote(plan);
      if (!plan.pane) return null;
      return {
        argv: ["tmux", "capture-pane", "-p", "-t", `${safe(plan.sessionName)}:${safe(plan.pane.paneName)}`],
        note: "prints the pane's text to stdout (-p; MEASURED on tmux 3.5a: the two panes of one session answer with their OWN text, so attribution is per-pane). A pane's text is VIEWPORT evidence only; the seat's own record is the store (`mergedInputStream`).",
      };
    },

    halt: (plan) => ({
      // `halt` stops the rig's EXISTING resident detached owner — the multiplexer's own session-level teardown
      // is named in the note, and BOTH are session-scoped on pain of ending the user's sessions.
      // THE STORE IS NAMED BY ENV, NOT BY A FLAG: `cli.mjs` HAS NO `--db` (MEASURED 2026-11-21 — an invented
      // `--db` is silently ignored and the verb acts on the CONFIGURED store). The core carries `env` to the
      // owner plane, which merges it over `process.env`; `muxCensusText` prints it, so the line is copyable.
      argv: ["node", "cli.mjs", "serve", "--stop"],
      env: { DURIG_DB: plan.store, DURIAN_PI_DB: plan.store },
      note: `stop the rig's OWN detached owner (its own serve --stop semantics, never a new lifecycle; the store is named by \`DURIG_DB=\`, NOT by a non-existent \`--db\`). The plugin's session-scoped multiplexer teardown is \`tmux kill-session -t ${plan.sessionName}\`; \`tmux kill-server\` is REFUSED BY NAME because it also ends the sessions the USER started.`,
    }),

    // NO `act` HERE — deliberate. An act is the broker's spool op (core `muxActRequest`), not a multiplexer
    // command; naming `send-keys` would open a second writer into the seat. See the header.
  },
};
