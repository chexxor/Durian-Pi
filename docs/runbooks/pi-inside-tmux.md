---
runbook: pi-inside-tmux
symptom: "the user runs a multiplexer (tmux, GNU Screen, Zellij, herdr) that already holds several LLM harnesses in its windows, runs a Durian-Pi instance in one of those windows, and wants the panes the plugin makes to live in a DIFFERENT multiplexer session than the one the user is watching (or wants them put in the user's own session on purpose)"
writes: true
precondition: "broker-stopped"   # only for starting/stopping the rig's resident owner; the census and the plan reads need nothing stopped
last_verified: 2026-11-21        # set only after the Verify step below actually ran (it did — see evidence)
verified_by: delegate
evidence: "Verify step RUN 2026-11-21 on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 / git 2.56.0: `demo/runbook-diagnose.test.mjs` (71.9 s, exit 0) RAN `DURIG_DB=./selfdev.sqlite node cli.mjs ps` and `... status` from pi-inside-tmux.md at exit 0, and REPORTED the `screen -c /dev/null -ls` and `tmux ls -F ...` legs as GAP (`screen`/`tmux` are not in the harness's read-only allowlist) — the multiplexer census itself was instead MEASURED directly against GNU Screen 5.0.2 on this host (`screen -c /dev/null -ls` rc 0, and `-Q -x -S <pid>.durian-w1 -X info` rc 0 printing 41 bytes `(1,1)/(80,24)+1000 +(+)flow UTF-8 0(impl)`), and the seam's real two-namespace leg is pinned green by `demo/mux-namespace.test.mjs` (0.318 s, exit 0, real-screen leg included); tmux, Zellij and herdr command lines remain UNVERIFIED (no binary on this host, no passwordless sudo)"
check_rule: "demo/runbook-diagnose.test.mjs"
---

# A harness inside a multiplexer, and its panes in a session of its own

## When to use

The user is inside tmux / GNU Screen / Zellij / herdr and that session holds more than one
harness. A Durian-Pi instance is running in one of those windows. The plugin would normally
pane into "the multiplexer I am in", which is **the user's session** — the panes the plugin makes
would clutter the windows the user made. Use this when you want the plugin's panes in the plugin's
**own** session (`durian-<workspace>`), or when you want the opposite: a deliberate, loud opt-in to
the user's session.

## Impact

Two namespaces, and the plugin owns one of them:

- **namespace A — the user's own sessions.** Panes the user made explicitly. The plugin never
  enumerates, panes, captures, detaches or kills one of these **by default**. A census reports such
  a session `PRESENT, NOT TOUCHED`.
- **namespace B — the plugin's own session**, named by `muxWorkspaceTag` in `tools/mux-surface-core.mjs`:
  `durian-<slug of the store's directory>`, created **detached from inside the user's pane**, so a rig
  running in one window of the user's session never adds a window to it.

Get this wrong in either direction: pane into the user's session by default and their other harnesses
lose windows; or refuse the override and the user cannot put a rig's panes where they want them.
`muxNamespace` decides which session may be touched at all, in the core, not in a driver — a backend
swap cannot move the plugin's panes into the user's session by accident.

## Preconditions

The **rig's** session is not the multiplexer's. One store, one resident detached owner (`cli.mjs serve`,
`src/broker.mjs`); a multiplexer window is a viewport onto it, never a second owner. A pane runs the
rig's own read-only attach surface (`node tui.mjs --db <abs store> --attach --select <seat>`,
readOnly — `src/storeownership.mjs` refuses two harnesses owning the same session).

- Census, plan, print: **read-only**, nothing must be stopped.
- Start the owner, or tear a session down: the broker must be **stopped and confirmed exited** first
  (`muxStartOwner` refuses with `owner-already-resident` rather than double-starting; a second owner
  would be a second writer, which is what corrupted this store twice — see docs/runbooks/README.md).
- **The store is named by ENV, never by a flag.** `cli.mjs` HAS NO `--db` (measured 2026-11-21: an
  invented `--db` is silently ignored and the verb acts on the CONFIGURED store, i.e. the rig's live
  store). `tui.mjs --db` IS a real flag — the two planes differ. Every owner command below carries
  `DURIG_DB=<abs store>` (and `DURIAN_PI_DB` is the half-applied rename alias, `cli.mjs` reads `DURIG_DB`).

## Diagnose (read-only)

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs ps
DURIG_DB=./selfdev.sqlite node cli.mjs status
screen -c /dev/null -ls
tmux ls -F '#{session_name} #{session_windows} #{?session_attached,attached,detached}'
```

Run this from the shared root; a relative store path resolves against the cwd, and an item worktree
holds no store at all. `screen -c /dev/null -ls` is the census in GNU Screen's own vocabulary; the
`tmux` line is the same census in tmux's. Both list **every** session the multiplexer manages, which
is what makes the user's own session reportable as `PRESENT, NOT TOUCHED`. `-c /dev/null` is not
decoration: without it a host `~/.screenrc` silently changes what the plugin believes it sees.

## Do

1. [judgement] Decide the namespace before anything runs. Default is `plugin` (the derived tag). The
   user's session is entered only on an explicit, loud ask: `--into <session> --namespace user`, or
   the persistent knobs `DURIAN_PI_MUX_SESSION=<session>` + `DURIAN_PI_MUX_NAMESPACE=user`. Every
   census then prints which namespace it is in and which session it used.
2. Install the command on the extension plane (never into the base):

   ```bash
   node tools/mux-surface-install.mjs
   node tools/mux-surface-install.mjs --check
   ```

   One file is installed (`.pi/extensions/mux-surface.js`); the core and the drivers stay in `tools/`
   because their `../src/...` imports resolve from there. Where the project is not trusted the
   extension does not load — say so rather than assuming `/mux` is available.
3. Stop the owner and confirm it exited before any lifecycle step (see `broker-down-or-stopped.md`).
4. Start the rig's ONE detached owner, once, from the user's pane:

   ```bash
   DURIG_DB=/abs/path/to/selfdev.sqlite node cli.mjs serve --max-duration 3600
   ```

5. Make each pane an ATTACHED client of its seat — never a second writer, never a keystroke into a
   window. One command per pane, in the multiplexer's own vocabulary:

   ### tmux (UNVERIFIED here — `tmux` is not on this host)

   ```bash
   tmux new-session -d -s durian-w1 -n impl -c /abs/workspace -- node tui.mjs --db /abs/workspace/selfdev.sqlite --attach --select impl
   tmux new-window -t durian-w1 -n dev -c /abs/workspace -- node tui.mjs --db /abs/workspace/selfdev.sqlite --attach --select dev
   tmux ls -F '#{session_name} #{session_windows} #{?session_attached,attached,detached}'
   tmux list-panes -F '#{pane_index} #{pane_pid} #{pane_title} #{pane_current_command}' -t durian-w1
   tmux detach-client -s durian-w1
   ```

   `-d` makes the session detached from birth, and `detach-client` keeps it running with no client:
   closing the window never ends the rig's session. `tmux kill-server` is NEVER emitted — it ends the
   user's sessions too (the core refuses `--every-session` BY NAME). tmux session names may not contain
   `.` or `:`: a user-namespace session named `4242.user-watching` gets **no argv and a named gap**, not
   a renamed aim at another session.

   ### GNU Screen (MEASURED on GNU Screen 5.0.2 on this host)

   ```bash
   screen -c /dev/null -dmS durian-w1 -t impl node tui.mjs --db /abs/workspace/selfdev.sqlite --attach --select impl
   screen -c /dev/null -ls
   screen -c /dev/null -Q -x -S 99097.durian-w1 -X info
   kill 99097
   ```

   Measured: `-dmS` creates it DETACHED (rc 0, 0.013 s) and `-t` really names the window (`0(impl)`).
   Two detached sessions really do print two `-ls` rows. **Always pass the full `<pid>.<name>` socket
   name** — `-S <bare name>` does NOT match, and a mismatched `-x -S <bare> -X …` once acted on the
   WRONG session while printing nothing. Screen CANNOT add a window, kill a window, capture, detach or
   quit from a non-TTY query plane: each of those emits **no argv and a named gap**, so a screen pane is
   ONE window per session (give each seat its own session via `DURIAN_PI_MUX_SESSION`, or use a backend
   that can grow windows). **Screen's detach semantics differ from tmux's**: a detached screen session
   whose last window dies ENDS — the rig's session does not live there, its owner is the resident broker,
   so losing the viewport never ends the session. The only working session teardown is `kill <pid>` with
   the census row's OWN pid half; never `pkill -f` (it matched this tool's own command line, exit 143)
   and never `screen -wipe` (its rc LIES — it removed the socket while printing `No Sockets found…` rc 1).

   ### Zellij (UNVERIFIED here — no binary)

   ```bash
   zellij attach --create durian-w1
   zellij action new-pane --name impl --cwd /abs/workspace --close-on-exit -- node tui.mjs --db /abs/workspace/selfdev.sqlite --attach --select impl
   zellij list-sessions
   zellij action list-panes -j
   zellij action detach
   zellij kill-session durian-w1
   ```

   `kill-all-sessions` is never emitted. Zellij assigns its OWN pane ids (`terminal_1`) — capture them
   from `list-panes -j`, do not invent one; the session-level forms above are the weaker half of this
   driver's grounding.

   ### herdr (UNVERIFIED here — no binary)

   ```bash
   herdr --session durian-w1
   herdr pane split --direction right --cwd /abs/workspace --no-focus
   herdr pane run <pane-id> node tui.mjs --db /abs/workspace/selfdev.sqlite --attach --select impl
   herdr session list --json
   herdr pane list --json
   herdr session stop durian-w1
   ```

   `server stop` is never emitted. herdr declares NO `detach`: `muxCapability` refuses `/mux detach` and
   the preset's detach key BY NAME (`capability-not-declared`) rather than forwarding herdr's own key.
   The `--session` namespace mapping is INFERRED from the CLI reference's wording, never observed.

6. Act on a seat from a pane — this is the broker's spool, backend-free, never a terminal input
   primitive (`send-keys`, `send-text`, `write-chars`, `paste`, `stuff` appear nowhere in the plugin):

   ```text
   /mux act impl --op message --text "…"
   ```

7. Opt in to the user's session, loudly, only when the operator asked for it:

   ```text
   /mux open --all --into 4242.user-watching --namespace user
   ```

   A bare `--into` that names a session the plugin does not own is REFUSED BY NAME in the default
   namespace. `--namespace user` with no session named is refused by name too.

## Verify

```bash
node tools/mux-surface-install.mjs --check
node demo/mux-drivers.test.mjs
node demo/mux-namespace.test.mjs
```

Expected: `UP TO DATE`, then `MUX-DRIVERS PASS (…)`, then `MUX-NAMESPACE PASS (…)`, each exit 0. The
namespace pin's real leg (GNU Screen, the only multiplexer binary on this host) must show BOTH rows in
one census — the plugin's session and the user's — with the user's row byte-identical before and after,
and must end with both sessions removed and the rig's store unmoved. tmux, Zellij and herdr stay
`NOT-RUN` on a host without those binaries; a green there is a lie.

## If it fails

- `NOT-RUN (binary NOT on PATH)` for the backend you expected: the binary is not here — that is the
  honest answer (registered ≠ runnable), not a bug. Choose a backend that is here, or install one
  natively (never `wsl`/`docker`).
- `namespace-foreign-asked`: you aimed at the user's session without the override. Add `--namespace user`
  only if opting in really is wanted.
- `backend-cannot-name-ask` with a note: the backend cannot spell that ask (see the per-backend gaps
  above). Do not hand-build an argv around it.
- A census that printed zero rows: not evidence of an empty truth — `muxListSessions` returns `unparsed`
  lines and `muxCensusText` prints them. A parse drift is a driver fix, in that driver only.

## Escalate to

The seat that owns the operator surface (`lead`/`scribe`) when a driver's argv table drifts from its
binary's own docs; the **operator** when the namespace SCOPE itself is the decision — whether the
plugin may enter the user's session at all, and which capacity grants (a real tmux/Zellij/herdr binary,
an API key) make the live demonstration runnable.

## Evidence

`tools/mux-driver-{tmux,screen,zellij,herdr}.mjs` carry the argv tables with `MEASURED`/`UNVERIFIED`
per line; the GNU Screen lines were run against `/usr/bin/screen` GNU Screen 5.0.2 on
Linux / Fedora Linux 45 (Forty Five) / kernel `7.2.15-300.fc45.x86_64` / node v24.22.1, 2026-11-20/21.
The tmux/Zellij/herdr tables were fetched from their official docs on 2026-11-20 and have never been
run on this host. Goal mwpeepwa-spmy34; last verified: see front matter.
