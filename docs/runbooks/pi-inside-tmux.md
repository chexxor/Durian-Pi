---
runbook: pi-inside-tmux
symptom: "the user runs a multiplexer (tmux, GNU Screen, Zellij, herdr) that already holds several LLM harnesses in its windows, runs a Durian-Pi instance in one of those windows, and wants the panes the plugin makes to live in a DIFFERENT multiplexer session than the one the user is watching (or wants them put in the user's own session on purpose)"
writes: true
precondition: "broker-stopped"   # only for starting/stopping the rig's resident owner; the census and the plan reads need nothing stopped
last_verified: 2026-11-22        # set only after the Verify step below actually ran (it did — see evidence; the 2026-11-22 addendum below RUNS the tmux 3.5a legs)
verified_by: delegate
evidence: "Verify step RUN 2026-11-21 on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 / git 2.56.0: `demo/runbook-diagnose.test.mjs` (71.9 s, exit 0) RAN `DURIG_DB=./selfdev.sqlite node cli.mjs ps` and `... status` from pi-inside-tmux.md at exit 0, and REPORTED the `screen -c /dev/null -ls` and `tmux ls -F ...` legs as GAP (`screen`/`tmux` are not in the harness's read-only allowlist) — the multiplexer census itself was instead MEASURED directly against GNU Screen 5.0.2 on this host (`screen -c /dev/null -ls` rc 0, and `-Q -x -S <pid>.durian-w1 -X info` rc 0 printing 41 bytes `(1,1)/(80,24)+1000 +(+)flow UTF-8 0(impl)`), and the seam's real two-namespace leg is pinned green by `demo/mux-namespace.test.mjs` (0.318 s, exit 0, real-screen leg included); tmux, Zellij and herdr command lines remain UNVERIFIED (no binary on this host, no passwordless sudo — superseded by the 2026-11-22 addendum below, which RUNS tmux 3.5a self-built). ADDENDUM 2026-11-21, same host: the *Terminal keys and the Enter collision* section above was added from pi's OWN doc, read not run — `vendor/pi-main/packages/coding-agent/docs/tmux.md` (63 lines) lines 3/8/11/13/18/19/24/26/28/31/39/40/41/43/45/47/50/53/55/57/61 and `vendor/pi-main/packages/coding-agent/src/core/extensions/runner.ts:98-117` (the reserved list), `:697`/`:699` (the skip and its message), `vendor/pi-main/packages/coding-agent/src/core/keybindings.ts:67-68` (`app.message.followUp` default `alt+enter`, `ctrl+q` on Windows keybindings). `grep -c tmux docs/runbooks/pi-inside-tmux.md` after the edit → 45 (the runbook is now tmux-literate, not
tmux-silent). ADDENDUM 2026-11-22, same host (Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1): tmux IS now RUN here — `tmux` 3.5a SELF-BUILT FROM SOURCE (`.spike/build-tmux.sh`: codeload tarball + autogen + configure + `make -j4`; `tmux -V` -> `tmux 3.5a`) reached through the absolute symlink `.spike/bin/tmux`; the distro census is unchanged (`tmux` NOT in PATH, `/usr/bin/tmux` absent, no passwordless sudo). Measured through the plugin's OWN driver argv (`tools/mux-driver-tmux.mjs` run by `tools/mux-surface-owner.mjs` `muxRunPlan`/`muxSessions`, gitignored probe `.spike/muxlive-2.mjs` -> `.spike/muxlive3.out` `MUXLIVE 0 FAIL` in 15.995 s): `tmux ls` at baseline rc 1 `no tmux server running on /tmp/tmux-1000/default` (the driver carries no `-S`, so the default socket sees the user's sessions and reports them PRESENT, NOT TOUCHED); `new-session -d -s durian-w1 -n impl -c <ws> -- node tui.mjs --db <store> --attach --select impl` rc 0 4 ms and `new-window -t durian-w1 -n impl-2` rc 0 3 ms; the census answers `durian-w1 2 pane(s) detached | user-own 2 pane(s) detached` with window rows `#0 title=impl node | #1 title=impl-2 node`, 0 unparsed; `kill-pane -t durian-w1:impl` rc 0 and the broker stays resident; `detach-client -s durian-w1` answers rc 1 `no current client` (created with `-d`, so it never had a client — that IS the detach semantics); `capture-pane -p -t durian-w1:impl` resolves rc 0 but prints EMPTY text because tmux destroys a window whose own command exited; `tmux show-options -g extended-keys-format` -> `extended-keys-format xterm` and `-g extended-keys` -> `off` (`.spike/tmux-build/tmux-3.5a/options-table.c:96-98` choices `{"csi-u", "xterm", NULL}`, `:320-326` `.default_num = 1`, so csi-u is OPT-IN, never "on by default"). Zellij and herdr remain registered-but-NOT-RUN (no binary on this host)."
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
tmux -V
```

`tmux -V` is part of the census, not decoration: the keys the pane can carry depend on the multiplexer
**version** (see *Terminal keys and the Enter collision* below), and tmux's version rules differ at 3.2
and 3.5. A multiplexer binary is on PATH or it is not — `tmux -V` failing is the honest `NOT-RUN`, not a
bug. Run this from the shared root; a relative store path resolves against the cwd, and an item worktree
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

   ### tmux (MEASURED 2026-11-22 on tmux 3.5a SELF-BUILT FROM SOURCE — `tmux` is NOT on the distro PATH and `/usr/bin/tmux` is absent)

   ```bash
   tmux new-session -d -s durian-w1 -n impl -c /abs/workspace -- node tui.mjs --db /abs/workspace/selfdev.sqlite --attach --select impl
   tmux new-window -t durian-w1 -n dev -c /abs/workspace -- node tui.mjs --db /abs/workspace/selfdev.sqlite --attach --select dev
   tmux ls -F '#{session_name} #{session_windows} #{?session_attached,attached,detached}'
   tmux list-windows -t durian-w1 -F '#{window_index} #{pane_pid} #{window_name} #{pane_current_command}'
   tmux capture-pane -p -t durian-w1:impl
   tmux kill-pane -t durian-w1:impl
   tmux detach-client -s durian-w1
   ```

   `-d` makes the session detached from birth, and `detach-client` keeps it running with no client:
   closing the window never ends the rig's session. `tmux kill-server` is NEVER emitted — it ends the
   user's sessions too (the core refuses `--every-session` BY NAME). tmux session names may not contain
   `.` or `:`: a user-namespace session named `4242.user-watching` gets **no argv and a named gap**, not
   a renamed aim at another session.

   Measured on 3.5a (2026-11-22, self-built binary on the PATH shim, the plugin's own driver argv — not
   a hand-written tmux line):

   - `tmux ls` before anything ran answers rc 1 `no tmux server running on /tmp/tmux-1000/default` — the
     driver's argv carries **no `-S`**, so it uses the DEFAULT socket. That is why one census sees both
     namespaces: the user's own session is visible and is reported `PRESENT, NOT TOUCHED`, and only the
     plugin's tag is ever acted on.
   - `new-session -d -s durian-w1 -n impl -c <ws> -- node tui.mjs --db <store> --attach --select impl` ->
     rc 0 in 4 ms; `new-window -t durian-w1 -n impl-2` -> rc 0 in 3 ms. The census then answers
     `durian-w1 2 pane(s) detached | user-own 2 pane(s) detached` with window rows `#0 title=impl node` and
     `#1 title=impl-2 node`, 0 unparsed lines — every window is named after its seat and carries its own
     `pane_pid`.
   - **`-t` in `list-panes` names a TARGET pane, not a session selector**: `list-panes -t <session>` answers
     ONE row on 3.5a, so it cannot census a session. The census uses
     `list-windows -t <session> -F '#{window_index} #{pane_pid} #{window_name} #{pane_current_command}'`.
   - **The 3-part dotted pane target `durian-w1.impl.0` is REJECTED by 3.5a** (`can't find pane: impl.0`);
     `session:<window-name>` (`durian-w1:impl`) and `session:<index>` (`durian-w1:0`) address the window, so
     `kill`/`capture` emit `durian-w1:impl`.
   - `kill-pane -t durian-w1:impl-2` -> rc 0, the session keeps its other window, and the RIG's owner is
     still resident (`owned true pid <p>`) — killing a pane never ends the session; `kill-session -t durian-w1`
     -> rc 0 also leaves the broker resident. The multiplexer's teardown never ends the rig's session.
   - `detach-client -s durian-w1` answers rc 1 `no current client` because the plugin created the session
     with `-d`, so it never had a client. That IS tmux's detach semantics; the next census still names the
     session.
   - `capture-pane -p -t durian-w1:impl` RESOLVES (rc 0) but prints EMPTY text when the window's OWN command
     has exited — tmux destroys a window whose command exited. An empty capture is NOT a capture failure;
     pane attribution is the census rows above, and a window whose command is still running captures its
     own text.
   - `tmux show-options -g extended-keys-format` -> `extended-keys-format xterm` and `-g extended-keys` ->
     `off`: `.spike/tmux-build/tmux-3.5a/options-table.c:96-98` lists choices `{"csi-u", "xterm", NULL}` and
     `:320-326` sets `.default_num = 1`, so **CSI-U is OPT-IN** — to get it the user must ask
     `tmux set -g extended-keys-format csi-u`, and no doc may call it "on by default".
   - The pane's own attach command printed pi's ATTACHED banner (read-only viewer of the broker-driven
     session, input routed to `<store>.broker.inbox`) and then exited rc 1 with an uncaught
     `ReadOnlySession: Read-only Harness: a commit with writes refused` from
     `vendor/pi-main/packages/durable/dist/session/session.js:823`. That is a measured gap in the
     attach VIEWER on a store with no seat rows, not in this seam: the pane resolved, was censused and
     addressed correctly, and the rig's session lives in the broker, not in the pane.

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

## Terminal keys and the Enter collision (tmux)

A multiplexer sits between the terminal and pi, and it can collapse three different Enter keys into one
byte stream before pi ever sees a difference. tmux's own doc says so: tmux "can report `Shift+Enter`,
`Ctrl+Enter`, and plain `Enter` as the same key" (vendor/pi-main/packages/coding-agent/docs/tmux.md:3).
Pi's shortcuts depend on that distinction, and so does the rig's `/mux act` surface — the three keys are:

1. `Shift+Enter` inserts a new line in the editor.
2. `Enter` submits the prompt.
3. `Alt+Enter` queues a follow-up (tmux.md:39/40/41). That is pi's `app.message.followUp`, whose default
   is `alt+enter` on macOS/Linux and `ctrl+q` on Windows keybindings
   (vendor/pi-main/packages/coding-agent/src/core/keybindings.ts:67-68 — the file picks the default from
   `useWindowsKeybindings()`; that helper is also true on Linux under a WSL-flavoured environment,
   keybindings.ts:16-23).

If the multiplexer swallows the modifier, all three land as plain `Enter`: the follow-up silently becomes
a submitted prompt. Check the version before changing any config — `tmux -V`, then apply the rule that
matches it. All of the following is pi's documented rule for tmux, read from
vendor/pi-main/packages/coding-agent/docs/tmux.md on 2026-11-21; **tmux is NOT on this host, so none of it
is a measurement here** (see the Evidence section for what IS measured):

| tmux version | Extended-key config | Source line |
|---|---|---|
| **≥ 3.5** | `set -g extended-keys on` **and** `set -g extended-keys-format csi-u` in `~/.tmux.conf`; CSI-u is the most reliable format for forwarding modified keys through tmux, and pi requests extended-key reporting when the terminal does not provide the Kitty protocol directly | tmux.md:13/18/19 |
| **3.2 – 3.4** | `set -g extended-keys on` ONLY — these versions support extended keys but NOT `extended-keys-format csi-u`; pi supports the xterm `modifyOtherKeys` format these versions emit | tmux.md:45/47/50/53 |
| **older than 3.2** | upgrade tmux, or run Pi **outside** tmux rather than relying on modified Enter shortcuts | tmux.md:55 |
| **3.6** | known issue: text such as `c0c/0c0c/0c0c` appears in the editor at startup ([tmux#4749](https://github.com/tmux/tmux/issues/4749)); remedy is upgrade tmux — changing pi's theme does not help | tmux.md:57/61 |

Then **verify in the pane**, because this config is server-wide and prints nothing when it is wrong: start
Pi inside the session and check the three keys above behave as three different keys. If they still all
behave like plain `Enter`, the terminal **outside** tmux cannot report modified keys either — fix that
first (tmux.md:43 points at `terminal-setup.md`). GNU Screen, Zellij and herdr have no equivalent of
`extended-keys` in this seam's tables, so on those backends the three-keys check is the only evidence that
modified Enter keys survive at all: run the check, report the result, never assume it.

### The server restart, and what it ends

The config applies to the tmux **server**, and the documented way to guarantee it is active is to close
the sessions and start a new server (tmux.md:24/26/28, with `tmux kill-server` at tmux.md:31). The command line that does that from a shell
is:

```bash
tmux kill-server   # TERMINATES EVERY SESSION MANAGED BY THAT SERVER — the user's included
```

On a rig this is the one command that destroys namespace A: it ends every session the server manages,
which is exactly the panes holding the user's other harnesses. tmux.md:28 says save your work first; on
this rig the sessions it ends also hold the user's own panes. **The plugin never emits it.** The core
refuses the ask by name — `--every-session` returns `teardown-every-session` (tools/mux-surface-core.mjs:373)
— and the tmux driver's `kill` leg names the two scopes it may act on (tools/mux-driver-tmux.mjs:181):
`tmux kill-pane -t durian-<workspace>.<pane>.0` for one pane, and the session-scoped teardown of **its own
session** is `tmux kill-session -t durian-<workspace>`. Name the session you are tearing down; a teardown
that omits it is a teardown of the server.

### The key-preset collision trap

The plugin's presets (tmux-style and screen-style) bind keys of their own, and pi **drops** an extension
shortcut that collides with a reserved built-in: `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS` is a
closed list (vendor/pi-main/packages/coding-agent/src/core/extensions/runner.ts:98-117 — includes
`app.message.followUp`, `tui.input.submit`, `app.editor.external`, `app.tools.expand`, …) and runner.ts:697
skips the plugin's shortcut, printing `Extension shortcut '<key>' from <path> conflicts with built-in
shortcut. Skipping.`. So a preset key equal to a resolved reserved shortcut is **dead, not rebound** —
`ctrl+q` on Windows keybindings, or `alt+enter`, is not a mux key at all. A preset that needs such a key
is a naming defect in the preset table, fixed there, not a fight with pi.

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
`NOT-RUN` on a host without those binaries; a green there is a lie. **On THIS box tmux is no longer NOT-RUN**
(a self-built tmux 3.5a is on the PATH shim, see the tmux block above), so the honest census sentence here is:
GNU Screen 5.0.2 is the only **distro** multiplexer, tmux 3.5a is present **built-from-source**, and Zellij
and herdr remain registered-but-NOT-RUN.

```bash
node tools/mux-surface-install.mjs --check   # after ANY tools/mux-surface-extension.js edit
node demo/mux-surface.test.mjs
node demo/mux-ownership.test.mjs
node demo/mux-interact.test.mjs
node demo/mux-keybinds.test.mjs
node demo/mux-drivers.test.mjs
node demo/mux-namespace.test.mjs
```

Expected: `UP TO DATE`, then six `MUX-* PASS` lines, each exit 0. The pins' own PASS lines carry the
measured seconds; do not quote stale ones from this doc — re-run and quote what printed.

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
