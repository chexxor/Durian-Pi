// src/signals.mjs — the ONE place a Ctrl-C becomes an exit.
//
// WHY THIS EXISTS. Every read verb ends in `awaitIntentResult(...)`, a poll that can run for
// 120 s (src/readclient.mjs). A verb that only sets `stopping = true` in its SIGINT handler is
// not stopped by a signal: the handler fires, the flag flips, and the process keeps sitting on
// the await it is already inside. That is the operator-visible bug — Ctrl-C on
// `cli.mjs watch --once` against a broker that is not answering does nothing until the wait
// expires. A daemon cannot be "resident" in a way the operator cannot interrupt.
//
// THE SEAM. One AbortController per process, installed once at CLI startup. Every await that
// can outlast a signal takes the signal and returns; every resident loop checks `isStopping()`.
// The handler ALSO arms a hard exit timer, so a verb wedged inside a call that never returns
// still dies. The timer is `unref()`'d: it does not keep a healthy process alive, it only
// fires while the loop is still turning (docs/research/daemon-harness-architecture-followup.md
// Q6: a bounded graceful stop needs an UNCONDITIONAL force fallback — the fallback must not
// depend on the wedge it is escaping).
//
// EXIT CODE. 130 (128 + SIGINT), the shell convention for "the user interrupted this".
const controller = new AbortController();
let installed = false;
let stopping = false;
let signalName = null;

/** Install the process-wide signal seam. Idempotent: safe to call from every entry point. */
export function installSignalHandlers({ gracefulMs = 1500, onSignal = null } = {}) {
  if (installed) return;
  installed = true;
  const handle = (sig) => {
    if (stopping) return;
    stopping = true;
    signalName = sig;
    controller.abort(sig);
    try {
      onSignal?.(sig);
    } catch {
      /* a diagnostic hook must never be the reason a signal is lost */
    }
    if (gracefulMs > 0) {
      const hard = setTimeout(() => process.exit(130), gracefulMs);
      if (typeof hard.unref === "function") hard.unref();
    }
  };
  process.on("SIGINT", handle);
  process.on("SIGTERM", handle);
}

/** True once a signal has been received: the check every resident loop must consult. */
export function isStopping() {
  return stopping;
}

/** Which signal arrived, for a report line. */
export function stopSignalName() {
  return signalName;
}

/** The signal to hand to any await that must return when the operator presses Ctrl-C. */
export function stopSignal() {
  return controller.signal;
}

/** Why we are leaving, for a report line. */
export function stopReason() {
  return controller.signal.reason ?? signalName ?? "signal";
}

/**
 * A bounded sleep that returns early when the operator interrupts. Every poll loop in the CLI
 * uses this instead of a bare `setTimeout`, so a resident verb stops within its own cadence
 * rather than at the end of the wait it already started.
 */
export function stoppableSleep(ms) {
  return new Promise((resolve) => {
    // NOT unref'd: a sleep is the reason the process is still alive. Unref'ing it lets Node
    // drain the event loop and exit with the await unsettled (measured: `up --serve` died with
    // "unsettled top-level await", exit 13). Only the force-exit timer in installSignalHandlers
    // is unref'd, because it is a fallback that must not keep a healthy process alive.
    const t = setTimeout(() => resolve(false), ms);
    controller.signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve(true);
    }, { once: true });
  });
}
