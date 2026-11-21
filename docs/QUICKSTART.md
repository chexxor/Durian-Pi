# durian-pi quickstart — boot a 2-seat rig in 5 minutes

Follow this top to bottom, verbatim. Every command should behave exactly as
described; if anything trips, that is a durian-pi bug — report the step number.

Prerequisites: Node.js ≥ 24 (type-stripping imports `.ts` directly), npm,
and EITHER a DeepInfra API key OR nothing at all (offline mode works fully).

## Step 0 — install (once)

```powershell
cd durian-pi
npm install --ignore-scripts
```

## Step 1 — choose your mode

Offline (no key, no network; seats answer from a canned script):

```powershell
$env:DURIG_PROVIDER = "faux"
```

Live (real model; needs the key in your environment):

```powershell
$env:DURIG_PROVIDER = "deepinfra"      # the default; omit if you prefer
$env:DEEPINFRA_API_KEY = "<your key>"  # or set it permanently in your profile
```

Model override (optional): `$env:DURIG_MODEL = "zai-org/GLM-5.3-Flash"`.

**Why the `DURIG_` spelling:** the loader reads `DURIG_*` names only. Measured on `main 35001c3a`,
`DURIAN_PI_PROVIDER=faux node cli.mjs config` reports `"DURIG_PROVIDER": "deepinfra"` (exit 0 - the variable was
ignored), while `DURIG_PROVIDER=faux node cli.mjs config` reports `"faux"` (exit 0). The store selector behaves the
same way: `DURIAN_PI_DB=…` is inert for `cli.mjs` and resolves `./rig.sqlite`. See "Settings can live in a config
file instead" below.

### Settings can live in a config file instead

Environment variables still win, but you can put any of these values in
`durig.config.json` (gitignored, `.gitignore:12`; copy `durig.config.example.json`):

```json
{
  "DURIG_DB": "./selfdev.sqlite",
  "DURIG_PROVIDER": "deepinfra",
  "DURIG_MODEL": "zai-org/GLM-5.3-Flash",
  "DEEPINFRA_API_KEY": "put-your-key-here"
}
```

Discovery order, first existing file wins: `$DURIG_CONFIG`, then `./durig.config.json`, then
`./.durig/config.json` (`src/config.mjs:6-8`, `DEFAULT_CONFIG_PATHS` at `src/config.mjs:19`). Always confirm
what is actually in effect:

> **The vocabulary the code reads is `DURIG_*`.** D103 intended `DURIAN_PI_*` as the new spelling, but the loader
> implements `DURIG_*` only. Measured on `main 35001c3a`: `CONFIG_KEYS` (`src/config.mjs:116-219`) lists `DURIG_*`
> names and `src/config.mjs` has no alias resolver, so `DURIAN_PI_DB=./nope-a.sqlite node cli.mjs status` resolves
> `./rig.sqlite` (exit 1, `cause: no_store`) while `DURIG_DB=./nope-b.sqlite …` resolves the path given (exit 1,
> `cause: no_store`). A config file carrying a `DURIAN_PI_*` key is not quietly ignored either: a `durig.config.json`
> holding `DURIAN_PI_DB`/`DURIAN_PI_PROVIDER` makes `node cli.mjs config` **exit 1** with `unknown config-file
> key(s): DURIAN_PI_DB, DURIAN_PI_PROVIDER … no code reads these, so they are silently ignored (the #5071
> accepted-and-ignored class)`. The one entry point that still accepts `DURIAN_PI_DB` is `scripts/clockin.mjs:468`,
> and it takes it **first** (`DURIAN_PI_DB` → `DURIG_DB` → `./selfdev.sqlite`). ROADMAP 191 is the un-built single
> alias resolver that would remove the discrepancy at the source.

```powershell
node cli.mjs config     # source file + resolved DB/provider/model + key set/unset
```

This matters because a command run without `DURIG_DB` silently uses
`./rig.sqlite` — a different database than the rig you meant to steer.

durian-pi now defends against that: `ps`, `status`, `watch` and a failed write verb
print a note on stderr when the database holds no seats, naming the file they
actually used. Every one of those commands also reports the resolved `db` path
in its JSON. If you see "no seats in ..." you are pointed at the wrong rig —
nothing is broken.

Everything below uses a scratch database so you cannot touch a real rig:

```powershell
$env:DURIG_DB = "$PWD\scratch-quickstart.sqlite"   # the CLI reads DURIG_DB; DURIAN_PI_DB is inert for cli.mjs (#6335)
$env:DURIG_DB = "$PWD\scratch-quickstart.sqlite"
```

## Step 2 — bootstrap the rig

```powershell
node cli.mjs up rig.v2.json
```

Expected: JSON with `"ok": true` and `"created": ["pm", "worker"]`. Running
it again reports both seats under `"existing"` instead — `up` is idempotent.

The spec declares two seats (a program manager and an implementation
engineer), org edges allowing pm↔worker mail, and a constitution file that
is injected into both seats' system prompts.

> **Building your own rig? Start from `rig.starter.json` instead.** It is the
> hardened version of the same thing — four seats (`pm`, `impl`, `qa`, `lead`),
> an inline constitution, a verifier seat on a *different model family*, and an
> outgoing edge on every seat — so `node cli.mjs check rig.starter.json` reports no
> findings on a fresh copy. `rig.v2.json` stays the two-seat spec this walkthrough
> uses, because four seats make the output longer to read and the loop is the same.
> `demo/starter.test.mjs` proves the starter clears every rule, and that each rule
> fails when the starter is broken.

## Step 3 — look around

```powershell
node cli.mjs ps          # roster: seat name, conversation id, role
node cli.mjs queue       # the work queue: empty right now
node cli.mjs status      # per-seat health; "attention": [] means nobody is blocked
```

## Step 4 — delegate some work

The resident broker must be running to deliver input (it is started by `up` on an
interactive terminal; if it is not, start it in a terminal with `node cli.mjs serve`
and leave it running). Operator input goes through the **intent spool**, which the
broker delivers without stopping:

```powershell
"Please route a task to build the login widget to worker." | node intent.mjs pm --body-file -
```

`intent` writes one message to the broker's inbox and returns **immediately** — it
spools; the broker delivers it to pm on its next pass. The reply shows up in the
read verbs, not on the `intent` command:

```powershell
node cli.mjs log pm      # pm's conversation (newest turns below)
node cli.mjs status      # per-seat health; pm shows the new work it is handling
```

The next two commands depend on your mode:

- **Live mode:** the pm calls `send_work` targeting worker, so:
  ```powershell
  node cli.mjs queue       # an item addressed to worker, status "queued"
  node cli.mjs status      # worker shows attention: idle_with_queued_work
  ```
- **Faux mode:** the reply is canned and tool orchestration does not fire
  (it is scripted only inside `demo/`), so the queue stays empty — that is
  expected offline behavior, not a bug. To see the full delegation loop
  without keys:
  ```powershell
  node demo/offline-v2.mjs   # enqueue -> claim -> complete -> DONE notice
  ```

That attention notice (live mode) is the product working: work exists that
nobody has picked up, and durian-pi says so instead of hiding it.

## Step 5 — watch it live (second terminal)

Open a second terminal in the same directory with the SAME environment
variables (`$env:DURIG_PROVIDER`, `$env:DURIG_DB`), then:

```powershell
node cli.mjs watch
```

At a terminal you get a live dashboard, redrawn whenever anything commits: one
row per seat with its role, what it is currently working on, and the last thing
it said.

```
durian-pi · 2 seats · db ./scratch-quickstart.sqlite · watch #3 · 12:03:10
──────────────────────────────────────────────────────────────────────
● pm      program manager       sent #1: Build login widget
      ↳ The send_work succeeded, queued item #1 for worker.
! worker  implementation eng.   has #1 queued: Build login widget
      ↳ (nothing said yet)
──────────────────────────────────────────────────────────────────────
queue 1 queued · 0 claimed · 0 done  |  attention: worker idle_with_queued_work
```

Leave it running; go back to the first terminal and repeat step 4 — the panel
updates as the work moves. Ctrl+C stops it.

`watch` writes JSON instead of the dashboard whenever its output is not a
terminal, so scripts and log files keep a machine-readable stream. Force either
form with `--json` or `--human`:

**Tip:** environment variables do not follow you into a new terminal, and that
is the single easiest way to end up watching (or steering) the wrong rig. If you
will use more than one terminal, put the values in `durian-pi.config.json` once
instead — every terminal then agrees without any setup.

## Step 5b — see the queue and the team as one screen (both planes)

The SAME command core runs as a shell verb and as an in-process pi command — the
landing screen is a regular pi coding-agent session, so the operator's own session
types `/queue` in the SAME grammar:

```powershell
node cli.mjs queue --list --sort age --limit 20    # attributed, bounded, stable-ordered view
node cli.mjs queue --list --sort zork              # REFUSED BY NAME, exit 1, no partial document
```

In a pi session: `/queue --list --sort priority --limit 20` — one core
(`src/queue-manage.mjs`), two registrations, no spawn (**D336**). Proof it is one
grammar: `node demo/queue-pi-command.test.mjs` → exit 0 in **3.2 s**, 9 refusal
classes byte-identical pi-plane-vs-CLI, both loaders 0 errors.

The TUI does not own a session — it **ATTACHES** to the one the broker already
owns, read-only, so N terminals never fight over one store:

```powershell
node tui.mjs --attach --db ./selfdev.sqlite   # read-only Harness on the broker's session
```

Today that attach **refuses** (exit 1) because no broker owns the store, and a
seat turn today also dies at auth — both are the operator's grants, not this
verb's:

```powershell
node tools/broker-serve.mjs --status   # 2.0 s exit 0 — "broker: down (no broker state)"
node tools/keycheck.mjs --level=auth   # 0.25 s exit 1 — local ok; verifier + deepinfra NOT-OK
```

The multiplexer itself is proven hermetically, no key and no broker:
`node demo/tui-multiplex-attach.test.mjs` → **exit 0 in 1.3 s, 50 ok / 0 FAIL**
(the four `pi.inbox` admission legs, ONE ID-ordered merged stream across both
clients, ONE identical broadcast to both, an attached act routed or refused by name).

And an ATTACHED pane can now **speak**: `tui.mjs --attach --db <store>` ROUTES its
words into the broker's inbox spool — one session-level `input` member of `src/broker.mjs`
`SPOOL_OPS` (`:708`), applied by the BROKER'S own harness into that conversation's built-in
`pi.inbox` (`:777`) — so N panes merge into one ID-ordered stream and the acts that would
DRIVE a foreign Session (`abort`, `abortCompaction`, `steer`, `followUp`, `compact`,
`waitForIdle`) still refuse by name. Proven hermetically, no key and no broker:
`node demo/tui-attach-surface.test.mjs` → **exit 0 in 1.98 s, 44 ok / 0 FAIL**, `.err` 0 B
(two ATTACHED panes' words in ONE `pi.inbox` stream, BOTH panes render it, the rig store's
mtime+size unchanged) — measured on the host line below.

Every cost above was measured on **Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0** — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## Step 6 — let the worker pick it up

```powershell
"Check your queue." | node intent.mjs worker --body-file -
```

(Live mode:) The worker claims the item (`claim_work`) and reports completion
back to pm, which enqueues a DONE notice addressed to pm. Verify:

```powershell
node cli.mjs queue       # original item status "done"; DONE notice for pm enqueued
node cli.mjs status      # attention MOVES to pm, which now holds that notice
node cli.mjs log pm 5    # read any seat's conversation (oldest first)
```

Rows are grouped into turns — an operator message, an agent message, or a tool
call with its output — and each turn starts with a timestamp and the time since
the previous one. Tool output is collapsed to its first line; `--full` expands it,
and `--tool-bg` adds the tinted tool background pi uses (`--theme light` if your
terminal is light).

To watch a seat's conversation in a second terminal as it happens, add
`--follow` — it prints the recent history, then streams each new turn:

```powershell
node cli.mjs log worker --follow
```

`log` reads the same database `watch` does, so it works in any second
terminal, with no multiplexer and no extra setup. `--json` gives the machine
form (each entry with its `text`, `kind` and raw provider message).

Attention does not simply clear here: the DONE notice is real work addressed to
pm, and durian-pi reports it as `idle_with_queued_work` on pm. That is the product
working, not a leftover.

(Faux mode:) this step returns a canned acknowledgement; run
`node demo/offline-v2.mjs` for the real claim/complete loop without keys.

## Step 7 — tear down

```powershell
Remove-Item Env:DURIG_DB              # forget the scratch db for future sessions
Remove-Item Env:DURIG_DB          # forget the scratch db for future sessions
Remove-Item .\scratch-quickstart.sqlite   # or keep it; it is just a file
```

Durability note: that file IS the rig. Kill any process mid-flight and every
command above reopens it where it left off (`demo/persistence.test.mjs`
proves restart survival mechanically).

## Step 5c — put the rig in a multiplexer WITHOUT cluttering your own session (optional)

Nothing here is required to run the rig — **D22** still holds (`docs/DECISIONS.md:327`,
AMENDED not reversed): a seat is a conversation row, there is no PTY and no per-seat
process, and no multiplexer is on the path to any capability. This step is the
PRESENTATION layer for an operator who already runs tmux / GNU Screen with several
other LLM harnesses in it and does not want a Durian-Pi instance's panes in the
session they are typing in (**ROADMAP 382, D340**).

Where the project is TRUSTED (pi's project-trust gate — not "always available"), the
plugin registers `/mux` and `/mux-keys` in the session you are already in. Type:

```text
/mux list                                # attributed census: sessions + panes, namespaces named
/mux open --all                          # attach the session this store has, or create one on --create
/mux act impl --op message --text "..."  # the broker's spool, never a terminal input primitive
/mux-keys                                # the active preset's keys, plus all four styles
```

The default is TWO namespaces and it NEVER touches yours: the plugin's panes live in
its OWN multiplexer session, named by the core from the store — `durian-<workspace>`
(`tools/mux-surface-core.mjs:88` `MUX_NAMESPACE_TAG_PREFIX = "durian-"`), created
DETACHED from inside your pane, so closing the pane never ends the session. Your own
session — the one that may hold other harnesses — is reported
`PRESENT, NOT TOUCHED` with its pane count and `touched:false`.

Four preset styles — `tmux`, `screen`, `zellij`, `herdr` — 32 keys total, every combo
`ctrl+shift+<letter>`, none of pi's own `ctrl+shift+f/g/p` borrowed, rendered with pi's
`keyHint()`/`keyText()`. The ACTIVE preset is the ACTIVE backend's own; `DURIAN_PI_MUX_BACKEND`
moves backend and preset together.

If you WANT the panes in your own session, the override is a LOUD explicit ask:

```text
/mux open --all --into 4242.user-watching --namespace user
```

That census prints `namespace user` plus `NAMESPACE OVERRIDE` and says the plugin's own
session was NOT used. The persistent form is two knobs (verbatim core lines:
`export const MUX_NAMESPACE_ENV = "DURIAN_PI_MUX_NAMESPACE";` and
`export const MUX_NAMESPACE_SESSION_ENV = "DURIAN_PI_MUX_SESSION";`):

```powershell
$env:DURIAN_PI_MUX_NAMESPACE = "user"              # core: MUX_NAMESPACE_ENV
$env:DURIAN_PI_MUX_SESSION   = "4242.user-watching" # core: MUX_NAMESPACE_SESSION_ENV
$env:DURIAN_PI_MUX_BACKEND   = "screen"             # core: MUX_BACKEND_ENV
$env:DURIAN_PI_MUX_PRESET    = "screen"             # core: MUX_PRESET_ENV
```

An override only PLACES panes; it never grants the right to END a session you started —
a session-level `kill`/`halt` on a session that does not carry the plugin's tag refuses
`teardown-foreign` in EITHER namespace, and `--every-session` refuses
`teardown-every-session`. Seven leak classes (a bare `--into` a foreign session, an
unregistered `--preset`, an undeclared selector, a knob outside the closed vocabulary,
a flag contradicting a knob, and more) refuse **BY NAME** with the legal ask printed
and **NO partial census**.

Measured on **Linux / Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`,
node v24.22.1** (2026-11-21): the multiplexer binary census answers `tmux` ABSENT,
`/usr/bin/screen` **GNU Screen 5.0.2 PRESENT**, `zellij`/`herdr` ABSENT — so only the
GNU Screen leg is proven against a real binary on this box; tmux, Zellij and herdr are
registered-but-NOT-RUN. Pane-LEVEL isolation is NOT implemented (SESSION level only).
Proof: `node tools/mux-surface-install.mjs --check` → `UP TO DATE` in 29.97 ms, and the
six pins `node demo/mux-{surface,ownership,interact,keybinds,drivers,namespace}.test.mjs`
exit 0 / 0 FAIL at 0.27/1.31/0.01/0.01/0.33/0.14 s, all six in the `tui` area →
`node scripts/test.mjs --area tui --jobs 4` **58/58 in 18.4 s**. Runbook:
`docs/runbooks/pi-inside-tmux.md`.

## Where to go next

- `docs/MVP.md` — what is guaranteed today and what is next on the list.
- `docs/DECISIONS.md` — why it is built this way (D1–D11).
- `demo/*.test.mjs` — each guarantee has a runnable proof.

## Optional — run against pi's main branch

durian-pi defaults to the released `@earendil-works/*` packages. To run the same
code against upstream `main` (pinned, built locally):

```powershell
node scripts/sync-pi.mjs --sync --link   # ~40 s; builds vendor/pi-main at the pin
node scripts/sync-pi.mjs                 # confirm the pin vs upstream tip
node scripts/sync-pi.mjs --unlink        # back to released packages
```

After a later `--sync`, re-run `--link` to refresh `node_modules`.
