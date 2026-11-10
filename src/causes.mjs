// src/causes.mjs — the rig's CAUSE VOCABULARY (#5047).
//
// WHY A MODULE FOR TWO STRINGS. A cause is named by the code that RAISES it and acted on by code far away: the
// provider seam stops the call, `src/attention.mjs` makes it visible, `src/supervisor.mjs` parks the item, the
// runbook points the operator at the ledger. If each of them spells the literal, the join breaks the day one of
// them reword, and the breakage is silent — the notice simply stops matching, and the seat retries something that
// costs money.
//
// The other reason is layering: the modules that ACT on a cause must not import the module that RAISES it just to
// read a name. `src/providers/spend.mjs` pulls pi-ai, `node:fs` and the ledger instrument; a pure notice
// computation over stored entries should not inherit any of that. So the name lives here, and BOTH sides import
// it.
//
// A cause is NOT a status. The submission still settles as `model_error` in the store (the run genuinely ended
// unanswered); what the cause adds is WHICH stop it was, so the retry policy, the notice and the escalation can
// branch on it instead of guessing from prose.

/** The rig's own cap stopped this call. Raised at the provider seam; parked, never retried. */
export const SPEND_CAUSE = "spend_cap_exceeded";

/** The cap keys, so a notice can name the one that fired instead of "a cap". */
export const SPEND_CAP_KEYS = ["DURIG_SPEND_CAP_CALL_USD", "DURIG_SPEND_CAP_RUN_USD", "DURIG_SPEND_CAP_STORE_USD"];

/**
 * A READ was asked about a store that does not exist (#4955). Raised by the read seam
 * (`src/readclient.mjs`), acted on far away: `cli.mjs` renders it as `{ok:false, cause, db}` plus the
 * wrong-rig note, `src/tui/durable/enter.mjs` must NOT read it as "held by a writer" and retry, and
 * `check` records it as a skip reason. The name exists so none of them pattern-matches prose, and so
 * "no data" can never be printed as "nothing wrong".
 */
export const NO_STORE_CAUSE = "no_store";

/**
 * Is this error message a MONEY stop from the rig's own cap (rather than a provider limit or a transport
 * failure)? Both tests are kept: the cause name, and the phrase the message carries so pi-ai's retry classifier
 * treats it as non-retryable (`pi-ai/utils/retry.js` NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN). A message can
 * reach a seat entry after pi-ai has wrapped it, so matching is substring-based, never anchored.
 */
export function isSpendStopMessage(text) {
	if (typeof text !== "string") return false;
	return text.includes(SPEND_CAUSE) || text.includes("out of budget under it");
}

/** Which cap the message names (null when it names none) — for operator-facing detail, never for a decision. */
export function spendCapNamed(text) {
	return SPEND_CAP_KEYS.find((key) => String(text ?? "").includes(key)) ?? null;
}

/**
 * The provider refused the CREDENTIAL (#6081). Raised by the wire - a 401/403 whose body talks about the key -
 * and acted on by `src/attention.mjs` and `src/supervisor.mjs`.
 *
 * Why it needs its own class rather than a word in the prose: on 2026-11-10 the broker process was started
 * without `DURIG_LOCAL_API_KEY`, every seat generation answered 401, the store filed each run as the bare
 * category `model_error`, and the supervisor's repeated-failure guard escalated 171 queue rows to the human.
 * A missing environment variable is not a seat that cannot make progress: the operator sets the variable, and
 * a human has nothing to decide. Classifying it as `repeated_failure` converted an environment fault into 171
 * parked items and a fleet that reported nothing to claim.
 *
 * Matching is substring-based and never anchored, for the same reason the spend matcher is: pi-ai can wrap the
 * provider's response before it reaches a seat entry.
 */
export const PROVIDER_AUTH_CAUSE = "provider_auth";

/** Phrases that mean "the credential was absent or wrong", in the provider bodies this rig has actually seen. */
const PROVIDER_AUTH_MARKERS = [
	"missing or wrong api key",
	"invalid api key",
	"invalid apikey",
	"authentication_error",
	"api key is required",
	"no credential",
	"unauthorized",
	"forbidden",
];

/** Is this error message the provider refusing the credential? A spend stop is never one - the rig's own cap
 * decision is checked first so a message naming both can only read as the money stop. */
export function isProviderAuthStopMessage(text) {
	if (typeof text !== "string") return false;
	const lower = text.toLowerCase();
	if (isSpendStopMessage(lower)) return false;
	if (PROVIDER_AUTH_MARKERS.some((marker) => lower.includes(marker))) return true;
	// The status code alone, bounded so "1401 tokens" is not a 401.
	return /(^|[^0-9])(401|403)([^0-9]|$)/.test(lower);
}

/**
 * One turn MOVED more tokens than the seat's window allows (#5049, ROADMAP 208).
 *
 * This is a NOTICE, not a stop. Nothing parks, retries or escalates on it, and `src/supervisor.mjs`
 * must not start to: a cheap signal may ACCEPT but never DECIDE (#3271/#3575), and the actuator that
 * would halt a seat is a separate, unbuilt row (#1781). The name lives here for the same reason
 * `SPEND_CAUSE` does — the module that RAISES it (`src/attention.mjs`, `src/checkup.mjs` reading a
 * context measure) and any module that later ACTS on it must agree on one spelling, so a reword
 * cannot silently un-pair the notice from its rule (#5047's finding).
 *
 * What the notice must carry, because the number without them is a false alarm: the denominator's
 * STATE (`measured | declared | advertised`, `src/context.mjs`) and the axis — one turn's moved
 * tokens including `cacheRead`, not the live context head.
 */
export const CONTEXT_OVER_WINDOW_CAUSE = "context_over_window";
