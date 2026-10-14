// Smoke extension: on session_start, unconditionally inject one user message.
// Purpose: discover how far the Pi run loop gets headlessly (turn_start observed?)
// with no API key / no network. Not the deliverable; the deliverable is watcher.ts.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, _ctx) => {
		pi.sendUserMessage("SPIKE_WAKE_SMOKE_START");
	});
}
