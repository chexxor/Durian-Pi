// src/reset.mjs — the shared reset-boundary mechanism (#402), lifted out of cli.mjs so
// the broker can apply a `reset` request with its OWN harness (ROADMAP 71 command spool).
//
// `cmdReset` (the operator verb) and the `up --refresh` model-change path both delegate
// here, and so does the broker's `op: "reset"` spool request — one mechanism, three
// callers, so the boundary a reset draws cannot drift between them. It writes the
// `pi.reset` boundary via `conversation.reset(handoff)` (prior turns leave the model
// CONTEXT; the durable transcript is kept) and returns the reset entry id it wrote.
//
// It never writes while the seat holds a LIVE generation lease — resetting a running
// seat out from under its own generation corrupts the very boundary we are trying to
// draw (same seatsWithLiveSlot guard the stranded notice and the resume verb compute).
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Seats } from "./rig.mjs";
import { readGenerationSlots } from "./genlock.mjs";

/** The max-concurrent-seats cap from the environment (the broker process reads no config
 * file). `Infinity` when unset/invalid, which disables the lease guard — the same rule
 * `cli.mjs maxSeats()` applies to its own CFG. */
export function maxSeatsFromEnv(env = process.env) {
  const n = Number(env.DURIG_MAX_CONCURRENT_SEATS ?? "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Infinity;
}

/** Seats holding a live generation lease. Consulted only when a finite cap is configured
 * (no slot files exist otherwise). */
export function seatsWithLiveSlot(dbPath, maxSeats) {
  if (!Number.isFinite(maxSeats)) return new Set();
  return new Set(readGenerationSlots(dbPath, maxSeats).filter((g) => g.generatingSeat).map((g) => g.generatingSeat));
}

/**
 * Draw a reset boundary for one seat.
 * Returns `{ refused, reason?, seatCount?, resetEntryId?, handoff? }`:
 *   - `{ refused: true, reason: "unknown-seat", seatCount }`  — no such seat (the caller
 *     reports it; the function never exits the process);
 *   - `{ refused: true, reason: "live-generation-lease" }`     — a running seat, not touched;
 *   - `{ refused: false, resetEntryId, handoff }`              — the boundary was written.
 * `dryRun` runs the SAME guards but skips the write (ROADMAP 84).
 */
export async function resetSeatContext(
  harness,
  seatName,
  handoff,
  dbPath,
  { dryRun = false, maxSeats = Infinity, context = BACKGROUND_CONTEXT } = {},
) {
  const seatsDoc = await harness.documentState(Seats, undefined, context);
  const seatsVal = seatsDoc?.value?.seats ?? {};
  const seat = seatsVal[seatName];
  if (!seat) {
    return { refused: true, reason: "unknown-seat", seatCount: Object.keys(seatsVal).length };
  }
  if (seatsWithLiveSlot(dbPath, maxSeats).has(seatName)) {
    return { refused: true, reason: "live-generation-lease" };
  }

  // An omitted or blank handoff means a plain reset (no new user message on the
  // boundary); only a non-blank handoff becomes the `pi.reset` user message.
  const resetHandoff = handoff !== undefined && handoff.trim() !== "" ? handoff : undefined;
  if (dryRun) {
    return { refused: false, dryRun: true, resetEntryId: null, handoff: resetHandoff ?? null };
  }
  const conv = await harness.conversation(seat.conversationId, context);
  // Identify the reset entry THIS invocation wrote: a watermark before, then the newest
  // pi.reset entry past it (the durable transcript keeps earlier resets too, so the
  // newest-past-watermark is precisely ours, not a prior one).
  const prior = await conv.entries({}, 20, undefined, context);
  const priorMaxId = prior.items.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
  await conv.reset(resetHandoff, context);

  const after = await conv.entries({ order: "descending" }, 50, undefined, context);
  const resetEntry = after.items.find((e) => e.kind === "pi.reset" && Number(e.id) > priorMaxId);
  return { refused: false, resetEntryId: resetEntry?.id ?? null, handoff: resetHandoff ?? null };
}
