/**
 * Spike #209 (PIECE 1) — Pi extension subscriber: watch a durig change source and
 * wake the Pi session on a matching event.
 *
 * Contract (docs/PUSH-ARCHITECTURE.md §3.4 / §6):
 *   - open the change source from `session_start` (never the factory: some
 *     invocations load extensions without starting a session);
 *   - on a MATCHING durig event, call `pi.sendUserMessage(...)` to open a turn;
 *   - release the watcher from an idempotent `session_shutdown`.
 *
 * The change source is the EXISTING `durig watch --once --json` poll (no durig
 * product change). The matching event is a QUEUED queue item addressed to the
 * watched seat — the same condition `selectWakes` uses in src/driver.mjs
 * (`it.to === name && it.status === "queued"`).
 *
 * Wiring (env, so the spike is self-contained and does not touch the seat root):
 *   DURIG_SPIKE_CLI   absolute path to durig's cli.mjs (required)
 *   DURIG_DB          the rig db the watcher polls (required; the same db the
 *                     operator/enqueuer writes to)
 *   DURIG_SPIKE_SEAT  the seat whose queued work wakes this session (default "impl")
 *   DURIG_SPIKE_POLL_MS  poll interval in ms (default 500)
 *   DURIG_SPIKE_DISABLED  if "1", the watcher is NOT started (direction (b))
 *
 * The injected wake string is FIXED per event class, not interpolated with the
 * item id: a varying body changes the conversation prefix and zeroes the prompt
 * cache (ROADMAP 33). The seat learns which item from claim_work, not the wake.
 */
import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WAKE_CONTENT = "durig: queued work is waiting. Call claim_work to take the oldest item addressed to you.";

export default function (pi: ExtensionAPI) {
	// Resources start from session_start, never the factory.
	pi.on("session_start", async (_event, ctx) => {
		if (process.env.DURIG_SPIKE_DISABLED === "1") {
			// Direction (b): the watcher is disabled and the session receives nothing.
			console.error("[spike-watcher] disabled (DURIG_SPIKE_DISABLED=1); no change source opened");
			return;
		}

		const cli = process.env.DURIG_SPIKE_CLI;
		const db = process.env.DURIG_DB;
		const seat = process.env.DURIG_SPIKE_SEAT ?? "impl";
		const pollMs = Number(process.env.DURIG_SPIKE_POLL_MS ?? "500");
		if (!cli || !db) {
			console.error("[spike-watcher] DURIG_SPIKE_CLI and DURIG_DB must be set; watcher not started");
			return;
		}

		// Dedupe: wake once per queued item id, never repeatedly for the same one
		// (no wake storms, §3.3).
		const woken = new Set<number>();
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const pollOnce = () =>
			new Promise<string>((resolve) => {
				execFile(
					process.execPath,
					[cli, "watch", "--once", "--json"],
					{ env: { ...process.env, DURIG_DB: db, DURIG_PROVIDER: "faux" }, maxBuffer: 8 * 1024 * 1024 },
					(_err, stdout) => resolve(stdout ?? ""),
				);
			});

		const tick = async () => {
			if (stopped) return;
			try {
				const raw = (await pollOnce()).trim();
				const line = raw.split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
				if (line) {
					const snap = JSON.parse(line);
					const items: Array<{ id: number; to: string; status: string }> = snap.queueItems ?? [];
					for (const it of items) {
						if (it.to === seat && it.status === "queued" && !woken.has(it.id)) {
							woken.add(it.id);
							console.error(`[spike-watcher] matched queued item #${it.id} for seat ${seat}; injecting wake`);
							// sendUserMessage always opens a turn when idle; deliverAs
							// steers/queues when busy (send-user-message.ts example).
							pi.sendUserMessage(WAKE_CONTENT);
						}
					}
				}
			} catch (err) {
				console.error(`[spike-watcher] poll error: ${(err as Error).message}`);
			}
			if (!stopped) timer = setTimeout(tick, pollMs);
		};

		if (ctx.hasUI) ctx.ui.notify(`spike: watching durig db for seat ${seat}`, "info");
		console.error(`[spike-watcher] watching db=${db} seat=${seat} every ${pollMs}ms`);
		void tick();

		// Idempotent release.
		pi.on("session_shutdown", () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		});
	});
}
