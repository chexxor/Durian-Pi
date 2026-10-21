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
$env:DURIAN_PI_PROVIDER = "faux"
```

Live (real model; needs the key in your environment):

```powershell
$env:DURIAN_PI_PROVIDER = "deepinfra"      # the default; omit if you prefer
$env:DEEPINFRA_API_KEY = "<your key>"  # or set it permanently in your profile
```

Model override (optional): `$env:DURIAN_PI_MODEL = "zai-org/GLM-5.3-Flash"`.

### Settings can live in a config file instead

Environment variables still win, but you can put any of these values in
`durian-pi.config.json` (gitignored; copy `durian-pi.config.example.json`):

```json
{
  "DURIAN_PI_DB": "./selfdev.sqlite",
  "DURIAN_PI_PROVIDER": "deepinfra",
  "DURIAN_PI_MODEL": "zai-org/GLM-5.3-Flash",
  "DEEPINFRA_API_KEY": "put-your-key-here"
}
```

Discovery order: `$DURIAN_PI_CONFIG`, then `./durian-pi.config.json`, then
`./.durian-pi/config.json`. Always confirm what is actually in effect:

> **Deprecated aliases (D103):** the old `DURIG_*` env vars and `durig.config.json` still load as
> deprecated aliases; the new `DURIAN_PI_*` name wins when both are set.

```powershell
node cli.mjs config     # source file + resolved DB/provider/model + key set/unset
```

This matters because a command run without `DURIAN_PI_DB` silently uses
`./rig.sqlite` — a different database than the rig you meant to steer.

durian-pi now defends against that: `ps`, `status`, `watch` and a failed write verb
print a note on stderr when the database holds no seats, naming the file they
actually used. Every one of those commands also reports the resolved `db` path
in its JSON. If you see "no seats in ..." you are pointed at the wrong rig —
nothing is broken.

Everything below uses a scratch database so you cannot touch a real rig:

```powershell
$env:DURIAN_PI_DB = "$PWD\scratch-quickstart.sqlite"
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
variables (`$env:DURIAN_PI_PROVIDER`, `$env:DURIAN_PI_DB`), then:

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
Remove-Item Env:DURIAN_PI_DB          # forget the scratch db for future sessions
Remove-Item .\scratch-quickstart.sqlite   # or keep it; it is just a file
```

Durability note: that file IS the rig. Kill any process mid-flight and every
command above reopens it where it left off (`demo/persistence.test.mjs`
proves restart survival mechanically).

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
