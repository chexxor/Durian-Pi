// Live seat view: render a running generation to the terminal as it streams.
//
// Why the provider seam: durig drives a seat's run inside the `send` process,
// and pi-durable exposes no token-level feed to observers (watch/status read
// committed state only, D11). The one place tokens exist is the provider
// stream, so the view taps it there - the same seam the generation slots use.
//
// Everything renders to stderr on purpose: stdout stays the single-JSON
// document every command promises to LLM operators, so `send > out.json`
// still parses while a human watches the live view.
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

const COLORS = {
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	reset: "\x1b[0m",
};

/**
 * Build a renderer that turns assistant stream events into a labelled,
 * line-oriented transcript. Exported separately from the provider wrapper so
 * the exact console behaviour is unit-testable without a model.
 *
 * @param {{write?: (s: string) => void, color?: boolean}} [opts]
 */
export function createLiveRenderer({ write = (s) => process.stderr.write(s), color = false } = {}) {
	const c = color ? COLORS : Object.fromEntries(Object.keys(COLORS).map((k) => [k, ""]));
	const paint = (name, text) => `${c[name]}${text}${c.reset}`;

	// A stream's mutable console state: what colour is open and whether the
	// cursor sits mid-line (so headers/footers never glue onto prior text).
	function newContext(seat) {
		return { seat, color: null, lineOpen: false };
	}
	function setColor(ctx, name) {
		if (ctx.color === name) return;
		if (ctx.color) write(c.reset);
		if (name) write(c[name]);
		ctx.color = name;
	}
	function text(ctx, s) {
		write(s);
		ctx.lineOpen = true;
	}
	function newline(ctx) {
		if (ctx.lineOpen) {
			if (ctx.color) write(c.reset);
			write("\n");
			ctx.lineOpen = false;
			if (ctx.color) write(c[ctx.color]);
		}
	}
	function finishLine(ctx) {
		if (ctx.color) {
			write(c.reset);
			ctx.color = null;
		}
		if (ctx.lineOpen) {
			write("\n");
			ctx.lineOpen = false;
		}
	}

	return {
		/** Open a labelled block for one generation. */
		begin(seat) {
			const ctx = newContext(seat ?? "seat");
			write(`\n${paint("cyan", `── ${ctx.seat} `)}${paint("dim", "─".repeat(Math.max(1, 40 - ctx.seat.length)))}\n`);
			return ctx;
		},

		/** Render one AssistantMessageEvent. Unknown types are ignored. */
		event(ctx, ev) {
			switch (ev.type) {
				case "text_start":
					finishLine(ctx);
					break;
				case "text_delta":
					setColor(ctx, null);
					text(ctx, ev.delta);
					break;
				case "text_end":
					newline(ctx);
					break;
				case "thinking_start":
					finishLine(ctx);
					setColor(ctx, "dim");
					break;
				case "thinking_delta":
					setColor(ctx, "dim");
					text(ctx, ev.delta);
					break;
				case "thinking_end":
					newline(ctx);
					setColor(ctx, null);
					break;
				case "toolcall_start":
					finishLine(ctx);
					break;
				case "toolcall_end": {
					finishLine(ctx);
					const name = ev.toolCall?.name ?? "tool";
					const args = JSON.stringify(ev.toolCall?.arguments ?? {});
					write(`  ${paint("yellow", `⚙ ${name}`)} ${paint("dim", args.length > 200 ? `${args.slice(0, 200)}…` : args)}\n`);
					break;
				}
				case "error":
					finishLine(ctx);
					write(`  ${paint("red", `✖ error (${ev.reason})`)}\n`);
					break;
				default:
					// start/done and any future event type carry no new line text.
					break;
			}
		},

		/** Close the block with the run's outcome. */
		end(ctx, ev) {
			finishLine(ctx);
			const label = ev?.type === "error" ? `error (${ev.reason})` : `done (${ev.reason ?? "stop"})`;
			write(`${paint("dim", `── ${ctx.seat} ${label} `)}${paint("dim", "─".repeat(Math.max(1, 38 - ctx.seat.length - label.length)))}\n`);
		},

		/** Report a transport failure that happened outside the event stream. */
		failure(ctx, err) {
			finishLine(ctx);
			write(`  ${paint("red", `✖ ${String(err?.message ?? err)}`)}\n`);
		},
	};
}

/**
 * Wrap a provider so every generation is mirrored to a live renderer while
 * still being forwarded verbatim to its consumer. The seat label is read at
 * call time, because the CLI stamps DURIG_ACTIVE_SEAT only around a send.
 *
 * @param {import("@earendil-works/pi-ai").Provider} provider
 * @param {{renderer: ReturnType<typeof createLiveRenderer>, getSeat?: () => (string|null)}} options
 */
export function wrapProviderWithLiveView(provider, options) {
	const { renderer } = options;
	const tapped = (call) => (model, context, opts) => {
		const out = new AssistantMessageEventStream();
		const ctx = renderer.begin(options.getSeat ? options.getSeat() : null);
		(async () => {
			try {
				const inner = call(model, context, opts);
				let last = null;
				for await (const ev of inner) {
					last = ev;
					renderer.event(ctx, ev);
					out.push(ev);
				}
				renderer.end(ctx, last);
				// Mirror the terminal result when the source exposes one, so a
				// consumer awaiting result() never hangs (same contract as the
				// generation-slot wrapper in genlock.mjs).
				if (typeof inner.result === "function") {
					try {
						const res = await inner.result();
						if (res) out.end(res);
					} catch (err) {
						renderer.failure(ctx, err);
						console.error(`LIVE VIEW WARNING: inner result unavailable: ${err?.message ?? err}`);
					}
				}
			} catch (err) {
				renderer.failure(ctx, err);
				out.push({
					type: "error",
					reason: "error",
					error: { role: "assistant", content: [], stopReason: "error" },
				});
			}
		})();
		return out;
	};
	return {
		...provider,
		stream: tapped(provider.stream.bind(provider)),
		streamSimple: tapped(provider.streamSimple.bind(provider)),
	};
}
