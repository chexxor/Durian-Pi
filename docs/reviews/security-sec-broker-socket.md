# security position — resident broker socket path (PIECE 3, item #411)

**Status: recorded 2026-10-15, BEFORE any socket/broker-session code (the gate item #411 requires
this to precede both the D-entry and the code).** Consult framing per docs/DECISIONS.md D30 (the
`security.sec` precedent) and this checkout's docs/PUSH-ARCHITECTURE.md §3.2, §5.4, §7. One concern
per the durable rule (corrected per item #411): the earlier "no socket, so no consult" reading
(D45/D46 boundary paragraphs) does NOT apply to the re-registered PIECE 3, whose corrected
architecture (`pi.open`, session-owner lifecycle, `waitForEmpty`/`sendMessage`) makes the socket
path live.

## Scope: what listens

The resident broker (`serve`) becomes a **separate resident process** that owns the session
lifecycle via `pi.open`; the CLI commands (and the wake surfaces) reach it through a narrow local
control endpoint instead of each becoming a second harness owner (two drivers = the double-wake
class F24/D42 already guard against in-process only). The endpoint carries:

1. **event/report delivery** — broker → client (queue transitions, escalations, broker state);
2. **wake injection** — client → broker → `conv.submit` into a session the broker OWNS
   (`waitForEmpty`/`sendMessage` per §3.4/piece-1 semantics: fixed, cache-safe wake strings,
   dedupe, never mid-turn outside the follow-up queue).

Nothing else. It is not a general data channel: no file reads, no transcript reads, no direct
storage access, no tool execution beyond the wake injection above.

## Controls (each falsifiable — a check must be able to run and fail)

| # | Control | Falsification probe |
|---|---------|---------------------|
| S1 | **Loopback-only bind.** The listener binds `127.0.0.1` (Windows loopback) and nothing else; a bind to `0.0.0.0`, `::`, or any non-loopback address fails broker start loudly. | Start the broker; attempt `TCP connect` to the port via a non-loopback interface address (e.g. the LAN IP): connect MUST be refused/timeout. `netstat`/`Get-NetTCPConnection` MUST show the port bound only to `127.0.0.1:<port>`. |
| S2 | **Per-database shared secret, user-only.** On start the broker writes a random ≥128-bit token to `<db>.broker.sock.token` with a Windows ACL granting only the current user; every client sends the token in its protocol greeting BEFORE any command is honored. A connection whose greeting fails or arrives token-less is closed before any harness interaction. Absent/empty/unreadable token file ⇒ the broker does not listen (fail closed). | Launch client from another user context (or corrupt/remove the token file): connect + bare greeting MUST be rejected; the broker MUST NOT open a session for an unauthenticated peer. |
| S3 | **Same-user continuity is not trusted as auth (D-ENV-AUTH).** All durig seats run as one Windows user; OS identity is therefore a norm, not a control (D30 verdict). S2 exists precisely because user identity proves nothing here. | Same probe as S2 — but from the SAME user WITHOUT the token (a confused local process): also rejected. |
| S4 | **Surface bound.** The protocol exposes exactly: `status` (read-only), `wake` (inject the fixed wake/event string into a session the broker owns), `subscribe` (receive the event feed). Any other verb ⇒ protocol error + connection close; broker diagnostics note the rejected verb. | Probe an undocumented verb over an authenticated connection: refused, no state change, no crash. |
| S5 | **No circumvention of seat confinement.** The broker only ever injects into sessions IT owns (`pi.open` handles it created) and only with the fixed wake strings. It must never accept a raw prompt body, file path, or tool call from the wire. | Authenticated client sends a `wake` whose payload is не the fixed wake-event string: refused. Client sends a `wake` naming another seat's conversation id: refused (ownership check). |
| S6 | **Lifecycle cleanup.** On `serve --stop`, broker exit, or crash-with-finally: listener socket closed, `<db>.broker.sock.token` and `<db>.broker.sock.json` deleted, no orphan process remains holding the port. The existing pidfile lifecycle (`<db>.broker.json`, D46) remains the liveness record. | After stop: `Test-NetConnection` to the port fails; token/socket files gone; second broker can start (stale holder is stale, per D46). |
| S7 | **Non-service hardening.** The socket is not registered as a service, not added to firewall allowlists, no auto-restart. If the broker dies, the rig is queue-driven by `run` as today, NOT by socket retry loops. | After a forced kill: port stays closed (no watcher re-binds it). |

## Explicit non-goals

- **NOT general remote access.** The endpoint exists so the CLI can reach the session owner on the
  same machine. It is never a remote-operating surface: no internet/LAN bind (S1), no protocol
  growth beyond the four verbs without a NEW `security.sec` consult.
- **Not a file or transcript channel.** Reads go through the existing read-only CLI surfaces
  (`log`/`events`/`watch`, D11 poll) — диrectly against storage, never through the socket.
- **Not a trust-boundary bypass.** D30's dissent on residual shell risk is unchanged; this endpoint
  adds no tool capability and executes no model prompts (it injects the FIXED wake strings only).
- **Not a replacement for the pidfile lease.** `<db>.broker.json` stays the one-writer record; the
  socket surfaces state, it does not broker ownership.

## Precedents and citations

- docs/PUSH-ARCHITECTURE.md §3.2: "If the broker exposes a local socket/pipe, that is a trust
  boundary and needs a `security` position before code (the security-consult rule)." — triggered.
- docs/PUSH-ARCHITECTURE.md §5.4: "The local socket/pipe trust boundary if the broker serves remote
  subscribers (`security`)." — scoped here to LOOPBACK ONLY (not "remote subscribers"; the wire is
  localhost, the subscribers are local CLI processes).
- docs/PUSH-ARCHITECTURE.md §7: piece 3 "needs a D-entry + lead ruling; security if a socket".
- docs/DECISIONS.md D30: same-Windows-user means OS identity is a norm, not a control (D-ENV-AUTH);
  app-layer token therefore required (S2, S3).
- docs/DECISIONS.md D46: pidfile lease + `serve --stop` reap; extended (not replaced) by S6.

## Consequence for PIECE 3 implementation

Code may proceed only against this position, with S1–S7 wired as auditable checks (the demo suite
will carry the falsification probes for S1/S2/S4/S6 at minimum — headless, loopback, no-flight).
Any deviation — bind widening, tokenless greeting acceptance, verb beyond S4, file/tool surface —
requires a NEW `security.sec` consult recorded before that code lands.

**This document is the gate item #411(a). The corrected D-entry (#411(b)) is written immediately
after and cites this position.**
