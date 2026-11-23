// tools/mux-driver-screen.mjs — a DRIVER for GNU Screen: the ONLY place this backend's words may appear.
//
// WHY A DRIVER AT ALL (contract (1), "SEAM NOT PORT"): `tools/mux-surface-core.mjs` owns verbs, selectors,
// panes, ownership, acts and NAMESPACES and names no backend (`grep -c -E 'tmux|screen|zellij|herdr'
// tools/mux-surface-core.mjs` -> 0, measured 2026-11-21 at 544 lines). This file spells ONE backend's
// vocabulary for the decisions that core already made. It starts no process: the ONE out-of-process leg is
// `tools/mux-surface-owner.mjs`, and it runs a driver's argv only under an explicit `--run`.
//
// THIS IS THE BACKEND THAT ACTUALLY RUNS ON THIS RIG. `/usr/bin/screen` GNU Screen 5.0.2 is PRESENT here
// (measured 2026-11-20/21 in .spike/muxscreen/ on Linux / Fedora Linux 45 (Forty Five) / kernel
// 7.2.15-300.fc45.x86_64 / node v24.22.1), so unlike tools/mux-driver-tmux.mjs this file carries MEASURED
// lines: `MEASURED` means run against the binary on this host; `UNVERIFIED` means never run. Do not blur the
// two — contract (7) is exactly that distinction.
//
// MEASURED FACTS THIS FILE BUILDS ON (each run against GNU Screen 5.0.2 on this host, with `-c /dev/null` so a
// host ~/.screenrc cannot change the answer):
//   `screen -c /dev/null -dmS muxp sleep 120`                     rc 0 in 0.013 s, session DETACHED
//   `screen -c /dev/null -ls`                                      `There is a screen on:` + `\t<pid>.muxp\t(Detached)` + `1 Socket in /run/screen/S-<user>.`
//   `screen -c /dev/null -dmS muxp -t alpha sleep 120`             the window is NAMED `alpha` (census shows `0(alpha)`)
//   `screen -c /dev/null -Q -x -S <pid>.<name> -X info`            rc 0, screen's response on OUR stdout, session STILL DETACHED
//   `screen -c /dev/null -ls` with none                            `No Sockets found in /run/screen/S-<user>.` rc 1
//   `-S <bare name>`                                               does NOT match `<pid>.<name>` (`No screen session found.` rc 1) — and
//                                                                  worse, `-x -S muxp -X info` returned rc 0, printed NOTHING, and the
//                                                                  session was GONE. ALWAYS pass the FULL `<pid>.<name>`.
//   `screen -LS` (capital L)                                       `Must be connected to a terminal` — plain `-ls` works non-TTY
//   `screen -c /dev/null -wipe muxp`                               removed the socket but printed `No Sockets found…` with rc 1 — its rc LIES
//   `screen -c /dev/null -V`                                       `Error: Unknown option -V` rc 1 — screen spells it LOWERCASE `-v`
//   `screen -c /dev/null -v` / `--version`                          `Screen version 5.0.2 (build on 2026-07-17 00:00:00)` rc 0 (MEASURED 2026-11-21)
//   `screen -c /dev/null -Q -x -S <pid>.<name> -X quit`             `quit command cannot be queried.` rc 1 — screen CANNOT quit a session by
//                                                                  query. THE WHOLE CLASS, MEASURED 2026-11-21 against the `-Q -x -S` query
//                                                                  plane (the only non-TTY shape this rig has): EVERY session/window-CHANGING
//                                                                  command is refused — `kill` (rc 1 `kill command cannot be queried.`),
//                                                                  `hardcopy` (rc 1 same), `detach` (rc 1 same), `screen` (rc 1 same),
//                                                                  `windowlist` (rc 1 same). Only READ commands answer there: `info` (rc 0,
//                                                                  prints the current window's region + `0(<name>)`) and `windows` (rc 0, EMPTY
//                                                                  output). Worse: a MULTIWORD `-X "<cmd> <args>"` is parsed as ONE command
//                                                                  name and answers `-X: unknown command '<whole string>'` with **rc 0** —
//                                                                  the rc lies, so a driver must never build a multiword `-X` argv here.
//                                                                  CONSEQUENCE: on this binary, from a non-TTY plane, a screen session gets
//                                                                  EXACTLY ONE WINDOW, created at `-dmS` time, and the ONLY working session
//                                                                  teardown is `kill <pid>` with the census row's OWN pid half. A driver that
//                                                                  wanted more had to say so — see the note-only legs below.
//   `screen -c /dev/null -Q -x -S <pid>.<name> -X info`            the window list on OUR stdout, e.g. `(1,1)/(80,24)+1000 +(+)flow UTF-8 0(other-harness)`
//                                                                  — the window INDEX and NAME come as `0(<name>)` (no parentheses round the
//                                                                  index), which is the ONLY place an index is learnable here
//   generated-rc multi-window route                                MEASURED DEAD 2026-11-21: `screen -c <rc-with-two-`screen`-lines> -dmS muxpa -t alpha sleep 300`
//                                                                  answered rc 0 but the NEXT census showed NO `muxpa` socket at all (the
//                                                                  session ended at once), so an rc file cannot buy extra windows from a
//                                                                  non-TTY plane. Do not re-try it as a fix.
//
// SCREEN'S DETACH SEMANTICS DIFFER FROM TMUX'S, AND THAT DIFFERENCE IS THE D22 AMENDMENT'S WHOLE POINT. A
// detached screen session whose LAST window dies ENDS (screen's own semantics). The rig's session does not
// depend on it: the rig's ONE owner is the resident detached BROKER (`DURIG_DB=<store> node cli.mjs serve` —
// the store is named by ENV because `cli.mjs` has NO `--db`, MEASURED 2026-11-21; `tui.mjs --db` IS real), and a
// screen pane is only a viewport running the plugin's OWN pane client
// (`muxPaneArgv()` from `tools/mux-surface-core.mjs` -> `tools/mux-pane-client.mjs`, `src/multiplex.mjs` `multiplexAttach`
// with `readOnly`). It is NOT the rig's full TUI: `node tui.mjs --db <abs store> --attach --select <seat>` in a
// window was MEASURED 2026-11-22 to exit rc 1 ~1 s in with an uncaught `ReadOnlySession` throw from the vendor's
// upkeep job — and a detached screen session whose LAST window DIES ENDS, so that command would end the viewport
// session at once. The pane client stays resident (it defaults to FOREVER), so the window lives as long as the
// multiplexer should. Killing/losing every pane can end the VIEWPORT and must never end the SESSION. The notes
// below say so where a reader would otherwise assume tmux's behaviour.
//
// Cost (D213): pure composition — no model, no key, no network, no process started here. `node --check` 0.01 s;
// the pin that exercises it is `node demo/mux-drivers.test.mjs`; the REAL run is the screen section of
// docs/runbooks/pi-inside-tmux.md.
import { dirname as dirOf, join } from "node:path";
// THE PANE COMMAND IS THE CORE'S DECISION, HANDED IN ON THE PLAN AS DATA (`plan.paneArgv`, built by the core's
// `muxPaneArgv` — see its note there). This driver imports NO sibling module: the seam passes the decision, so a
// driver can be loaded on its own and cannot half-register against a sibling it cannot see.

const workspace = (store) => (store ? dirOf(store) : null);

// THE FULL SOCKET NAME, `<pid>.<name>`. `screen -S <bare name>` does NOT match it (MEASURED), and the
// consequence of aiming at the bare name is worse than an error — so a driver that cannot name the full
// sockname must SAY SO on every argv it returns, not quietly emit a plausible one.
const targetOf = (plan) => plan.sessionTag || plan.sessionName || null;
const targetNote = (plan) =>
  plan.sessionTag
    ? `the socket target \`${plan.sessionTag}\` came from a census (the ONLY form \`screen -S\` matches).`
    : `UNVERIFIED AIM: no census has run, so this is the bare name — \`screen -S\` MEASURED does not match \`<pid>.<name>\` from a bare name, and a mismatched \`-x -S <bare> -X …\` can act on the WRONG session. Re-run with the census's full \`<pid>.<name>\`.`;

export const MUX_DRIVER = {
  backend: "screen",
  // THE SHIPPING ORDER is a driver fact, not a backend name in the core (the core picks the highest `rank`).
  // GNU Screen ships after tmux but BEFORE the two backends that are absent on a stock host, because this is
  // the one non-tmux backend whose binary is MEASURED present on this rig's host.
  rank: 90,
  // MEASURED on this host: GNU Screen 5.0.2.
  version: ["screen", "--version"],
  probe: ["screen", "--version"],
  docs: "docs/runbooks/pi-inside-tmux.md", // this driver owns that runbook's GNU Screen section

  // THE PLATFORM TABLE — a DRIVER fact (see tools/mux-driver-tmux.mjs for what each `status` class means).
  // This driver is the one backend whose Windows verdict is NOT an install route: no native-Windows GNU Screen
  // build was found in the copies this seam fetched, and the routes that DO exist (wsl / cygwin / msys2) are
  // FORBIDDEN under D131 "native host OS only". So the row says `refused`, `binary: null`, and the core turns the
  // whole ask into a REFUSAL BY NAME with ZERO commands — not a shim, not a plausibly-wrong argv.
  platform: {
    linux: {
      binary: "screen",
      status: "measured",
      note: "MEASURED on this rig's host (Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1): GNU Screen 5.0.2 is PRESENT at /usr/bin/screen and this driver's argv was run against it (`screen -V` -> `Screen version 5.0.2 (build on 2026-07-17 00:00:00)` rc 0; docs/runbooks/pi-inside-tmux.md, real-screen census).",
      route: null,
    },
    windows: {
      binary: null,
      status: "refused",
      route: null,
      note: "WINDOWS IS REFUSED FOR THIS BACKEND, so this seam names NO argv for it on a Windows host. What was FOUND (kagi, fetched 2026-11-22): only Cygwin package routes (https://cygwin.com/cygwin/packages/summary/screen.html) and a blog running GNU screen UNDER WSL (drjohnstechtalk.com) plus Gnulib's generic native-Windows chapter — NO native Windows screen build in a fetched copy. That is OBSERVED ABSENCE in a fetched copy, and the verdict is therefore UNVERIFIED-AND-REFUSED, not proven-impossible. The routes that exist are FORBIDDEN under D131 (native host OS only — never wsl, cygwin, msys2, or docker), and this plugin will not quietly run screen under an emulation layer. What a Windows user does instead: pick a backend that has a declared Windows route (see the tmux driver's `psmux` row, the zellij driver's `.exe` row, the herdr driver's native row), or run the rig in a pi terminal with no multiplexer at all — the broker owns the session, so no presentation layer is required for the rig to run.",
    },
  },

  // DECLARED, NOT ASSUMED. Screen can NAME every action, so all are declared — but four of the argv below are
  // UNVERIFIED (never run here), which is why each carries the word in its note.
  capabilities: new Set(["list", "open", "attach", "detach", "kill", "capture", "halt", "act"]),

  // THE PRESET is per-backend because a key style IS a backend word. Letters borrowed from screen's own verb
  // names where one exists (list->i [screen's `info`], open->w [screen's `window`], attach->r [the `screen -r`
  // re-attach], detach->q [`-X quit`], kill->k, capture->c [`^c`, screen's own caption/capture], halt->e,
  // send->u) — invented otherwise. None borrows a pi default (pi owns ctrl+shift+up/down, ctrl+shift+f/g/p
  // and every single-key ctrl+a…ctrl+z, pi 1.5.2 docs/extensions.md). Screen's own `ctrl+c` PREFIX cannot be
  // expressed at all: pi has no two-key sequences, and that is said in the runbook and in `muxKeysText`.
  preset: {
    style: "screen",
    keys: {
      "mux.list": "ctrl+shift+i",
      "mux.open": "ctrl+shift+w",
      "mux.attach": "ctrl+shift+r",
      "mux.detach": "ctrl+shift+q",
      "mux.kill": "ctrl+shift+k",
      "mux.capture": "ctrl+shift+c",
      "mux.halt": "ctrl+shift+e",
      "mux.send": "ctrl+shift+u",
    },
  },

  // THE NAME IS THE CORE'S DECISION spelled in screen's vocabulary: screen's OWN namespace is a separate
  // socket/session, so the plugin's session is `screen -c /dev/null -dmS <tag> …` and the user's own session is
  // a DIFFERENT socket entry — two `-ls` rows, which is what makes the two-instance census possible.
  // (MEASURED: two detached sessions really do print two rows.)
  sessionName: ({ tag = null, namespace = "plugin" } = {}) => String(tag ?? ""),

  // PARSE of `screen -c /dev/null -ls`, MEASURED against GNU Screen 5.0.2 on this host. Returns the ONE shape
  // the owner plane feeds to `muxNamespace` as `present`, so the user's own session is reportable as
  // PRESENT, NOT TOUCHED. Deliberately hostname-free output; `<user>` in the socket line is a username, not a
  // hostname, and is dropped.
  census: (output) => {
    const sessions = [];
    const unparsed = [];
    for (const line of String(output ?? "").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      // PLURAL MATTERS: GNU Screen 5.0.2 prints `There is a screen on:` for ONE session and `There are screens on:`
      // for two (MEASURED 2026-11-21 in the two-namespace real leg). A header that lands in `unparsed` is not fatal,
      // but it makes a two-session census look half-parsed, which is the class this seam refuses.
      if (/^There (is|are) (a |)?screens? on:/.test(t)) continue;
      if (/^(No Sockets found|1 Socket|\d+ Sockets? in)/.test(t)) continue; // the count line is the census tail
      const m = /^(\d+)[._]([A-Za-z0-9-]+)\s+\((\w+)\)/.exec(t); // MEASURED form `<pid>.<name>`; `_` is the older screen form
      if (m) {
        sessions.push({ name: `${m[1]}.${m[2]}`, tag: m[2], pid: m[1], state: m[3], panes: null });
        continue;
      }
      // THE WINDOW LEG'S OUTPUT, MEASURED: `-X info` answers the current window's region and names it as
      // `0(<name>)` — index then name, NO parentheses round the index. `(1,1)` and `(80,24)` are REGIONS and must
      // not read as windows, which is why the match needs the digits right after a token edge, before `(`.
      const w = /(?:^|\s)(\d+)\(([^()]+)\)(?:\s|$)/.exec(t);
      if (w) {
        sessions.push({ pane_index: w[1], title: w[2], rest: t }); // a PANE row: the plane keeps `pane_index` rows
        continue;
      }
      unparsed.push(t);
    }
    return { sessions, unparsed };
  },

  commands: {
    // THE CENSUS. MEASURED. `-c /dev/null` is not decoration: without it a host ~/.screenrc silently changes
    // what the plugin believes it sees.
    list: (plan) => {
      if (plan.index === 0)
        return {
          argv: ["screen", "-c", "/dev/null", "-ls"],
          note: "MEASURED (GNU Screen 5.0.2, this host): lists EVERY socket/session the multiplexer manages — the plugin's own tag plus the user's own, which is then reported PRESENT, NOT TOUCHED. rc 1 with none.",
        };
      // THE WINDOW LEG, MEASURED. index 1 asks the RESOLVED session for its windows and gets them on OUR stdout
      // (`0(<name>)` is where the index and the seat name appear). It needs the CENSUS-LEARNED row label, not the
      // bare name: `-S <bare name>` MEASURED does not match `<pid>.<name>`, and a mismatched `-x -S <bare> -X …`
      // acted on the WRONG session and printed nothing. No census => no argv => the core refuses BY NAME.
      if (!/^(\d+)[._][A-Za-z0-9-]+$/.test(String(targetOf(plan) ?? "")))
        return { argv: null, note: "NO CENSUS LABEL TO AIM AT, so this leg names no argv: `screen -S <bare name>` MEASURED does not match the `<pid>.<name>` socket, and a mismatched `-x -S <bare> -X …` once acted on the WRONG session while printing nothing. Run the census (index 0) first and re-ask with its label in `plan.sessionTag`." };
      return {
        argv: ["screen", "-c", "/dev/null", "-Q", "-x", "-S", targetOf(plan), "-X", "info"],
        note: "MEASURED: the window list of ONE session on OUR stdout, e.g. `(1,1)/(80,24)+1000 +(+)flow UTF-8 0(<name>)`; the session stays DETACHED. Only READ commands answer in this mode (`info`, `windows`) — every window-changing one is refused.",
      };
    },

    open: (plan) => {
      if (!plan.pane || !plan.pane.seat) return null; // open names a seat; a seatless named pane starts nothing
      const ws = workspace(plan.store);
      const cmd = plan.paneArgv; // the core's ONE pane argv, never restated here
      if (!cmd)
        return {
          note:
            "NAMED GAP: no pane argv could be built (no store, no seat, or the plugin's pane client is not on disk), " +
            "so NO argv is emitted — a detached screen session whose window runs nothing ENDS, and a dead session " +
            "that reports nothing is the fail-open this seam refuses.",
        };
      if (plan.index === 0)
        return {
          argv: ["screen", "-c", "/dev/null", "-dmS", String(plan.sessionName), "-t", String(plan.pane.paneName), ...cmd],
          cwd: ws,
          note: "MEASURED leg (`-c /dev/null -dmS <tag> -t <name> <cmd>` -> rc 0 DETACHED in 0.013 s; `-t` really names the window, census shows `0(<name>)`): create the PLUGIN's OWN session detached, window named after the SEAT. The rig's own session is owned by the broker (`DURIG_DB=<store> node cli.mjs serve`), started by the owner plane; this pane only ATTACHES to it — no second writer. The `<cmd>` is the plugin's pane client, which stays FOREVER, so the window does not die (see the runbook's real-screen census for the measured window survival).",
        };
      // NO ARGV, DELIBERATE — MEASURED DEAD on GNU Screen 5.0.2 from a non-TTY plane (2026-11-21, .spike/muxscreen-cmds*.mjs):
      // `-X screen <cmd>`, `-X window <cmd>`, `-X windows` and a generated `-c <rc>` route all either answer
      // `cannot be queried.` (rc 1) or create nothing (rc 0 but the socket is gone at the next census). So screen
      // gets ONE window per session, made at `-dmS` time. The core turns a zero-argv pane into a refusal BY NAME
      // (`backend-cannot-name-ask`), which is the honest answer here — not a plausible command that does nothing.
      return {
        argv: null,
        note: `GNU Screen 5.0.2 CANNOT add a window to an existing session from a non-TTY plane (MEASURED: \`-X screen\`/\`-X window\`/\`-X windows\` answer \`cannot be queried.\` or create nothing; a generated rc file answers rc 0 and the NEXT census has no socket at all). A screen pane is therefore ONE window per session. What the user can do instead: give each seat its OWN plugin session (set DURIAN_PI_MUX_SESSION) or run the rig on a backend that can grow windows (tmux: "new-window"). Nothing was run for pane ${plan.pane?.paneName ?? "(unnamed)"}.`,
      };
    },

    attach: (plan) => {
      if (plan.index !== 0) return null; // one client per screen session; each seat is a WINDOW, not a client
      return {
        argv: ["screen", "-c", "/dev/null", "-x", "-S", targetOf(plan)],
        note: "MEASURED that the `-Q -x -S <pid>.<name> -X …` leg works non-TTY and leaves the session DETACHED; a bare interactive re-attach needs a terminal (it is what a user's pane does, and the per-seat pane command in `open` is the read-only attach surface). " + targetNote(plan),
      };
    },

    detach: (plan) => {
      if (plan.index !== 0) return null;
      // NO ARGV, DELIBERATE — MEASURED 2026-11-21: `-X detatch` is an UNKNOWN COMMAND (screen 5 dropped the
      // classic typo) and answers rc 0, which LIES; `-X detach` exists but answers `detach command cannot be
      // queried.` rc 1 from a query plane. And this plugin CREATES the session detached (`-dmS`), so there is
      // nothing to detach: the honest answer is "already detached", with no command to run.
      return {
        argv: null,
        note: `already detached — the PLUGIN created this session with \`-dmS\` (MEASURED rc 0, DETACHED), and GNU Screen 5.0.2 refuses \`-X detach\` from a query plane (\`detach command cannot be queried.\` rc 1) while \`-X detatch\` is an unknown command answering rc 0. SEMANTICS DIFFER FROM TMUX — a detached screen session whose LAST window dies ENDS. The rig's session does NOT live here: its owner is the resident detached broker, so closing this viewport can end the VIEWPORT and never ends the SESSION (docs/DECISIONS.md D22, amended 2026-11-20). Nothing was run. ` + targetNote(plan),
      };
    },

    kill: (plan) => {
      if (!plan.pane) return null;
      // NO ARGV, DELIBERATE — MEASURED 2026-11-21: `-p 0 -X kill` answers `kill command cannot be queried.` rc 1
      // and `-p 1 -X kill` on a one-window session answers `Could not find pre-select window.` rc 1. A window
      // kill is NOT reachable from a non-TTY plane on this binary, so the plugin refuses BY NAME (the core's
      // `backend-cannot-name-ask`) instead of printing a command that cannot run. The session-scoped teardown
      // that DOES work is `kill <pid>` with the CENSUS row's own pid half (MEASURED: session gone, next census
      // `No Sockets found in /run/screen/S-<user>.` rc 1).
      return {
        argv: null,
        note: `GNU Screen 5.0.2 cannot kill a window from a non-TTY query plane (MEASURED: \`-p <index> -X kill\` -> \`kill command cannot be queried.\` rc 1). The session-scoped teardown that works is \`kill ${plan.sessionTag ?? plan.sessionName}\` with the census row's OWN pid half — it ends the PLUGIN's session only; the rig's session stays owned by the resident broker. Never \`pkill -f\` (it matched this tool's own command line, exit 143) and never \`-wipe\` (its rc LIES). Nothing was killed. ` + targetNote(plan),
      };
    },

    capture: (plan) => {
      if (!plan.pane) return null;
      // NO ARGV, DELIBERATE — MEASURED 2026-11-21: `-X hardcopy` answers `hardcopy command cannot be queried.`
      // rc 1, and the multiword `-X "hardcopy <file>"` form is parsed as ONE command name (`unknown command`,
      // rc 0 — the rc lies). So this backend cannot capture a pane from a non-TTY plane at all. What the
      // plugin CAN say is that the seat's RECORD is the store, not the viewport: `src/multiplex.mjs`
      // `mergedInputStream` holds the seat's own stream, which is where a reader should look instead.
      return {
        argv: null,
        note: `GNU Screen 5.0.2 cannot capture a pane from a non-TTY query plane (MEASURED: \`-X hardcopy\` -> \`hardcopy command cannot be queried.\` rc 1). The seat's record is the STORE, not the viewport (\`src/multiplex.mjs\` \`mergedInputStream\`): read it through the queue surface instead of scraping a window. Nothing was captured. ` + targetNote(plan),
      };
    },

    halt: (plan) => ({
      // `halt` stops the rig's EXISTING resident detached owner — the multiplexer's own session-level teardown
      // is named in the note, session-scoped by construction.
      // THE STORE IS NAMED BY ENV, NOT BY A FLAG: `cli.mjs` HAS NO `--db` (MEASURED 2026-11-21 on THIS host:
      // an invented `--db` is silently IGNORED and the verb acts on the CONFIGURED store — the rig's own live
      // store. `tui.mjs --db` IS real; the two planes differ). The core carries `env` to the owner plane.
      argv: ["node", "cli.mjs", "serve", "--stop"],
      env: { DURIG_DB: plan.store, DURIAN_PI_DB: plan.store },
      note: `stop the rig's OWN detached owner (its own \`serve --stop\` semantics, never a new lifecycle; the store is named by \`DURIG_DB=\`, NOT by a non-existent \`--db\`). The plugin's session-scoped screen teardown is \`kill <pid>\` with the CENSUS row's OWN pid half (\`kill ${plan.sessionTag ?? plan.sessionName}\` once the census has named the row) — MEASURED 2026-11-21: \`kill <census pid>\` ended the session and the next census answered \`No Sockets found in /run/screen/S-<user>.\` rc 1; EVERY \`-X\` teardown (\`quit\`, \`kill\`, \`detach\`) is refused from a query plane, and \`screen -c /dev/null -wipe <name>\` removed the socket while printing \`No Sockets found…\` with rc 1 — its rc LIES, so never gate on it. screen has NO server-wide teardown, which is why the core's \`--every-session\` refusal has no argv here at all. Never \`pkill -f\`: it matched this tool's own command line (exit 143). Nothing outside the plugin's own session is ever named. ` + targetNote(plan),
    }),

    // NO `act` HERE — deliberate: an act is the broker's spool op (core `muxActRequest` -> `SPOOL_OPS`), never
    // a keystroke into a window. Screen's own input leg (`-X stuff`) would be a SECOND WRITER into a seat —
    // the class that corrupted this store twice — so the plugin names it nowhere.
  },
};
