deepinfra api cache how to discover cache duration options of the provider?

**DeepInfra's prompt cache retention supports two fixed durations: 5 minutes or 1 hour.** There is no dynamic "list available TTLs" endpoint; the options are a fixed, documented set.

**Where to discover them:**

- **API docs:** [DeepInfra Prompt Cache Retention](https://docs.deepinfra.com/chat/prompt-cache-retention) — lists the exact `cache_retention` parameter values you can pass and their billing impact.
- **Announcement post:** [DeepInfra blog – Prompt Cache Retention](https://deepinfra.com/blog/prompt-cache-retention) — explains the feature, the two windows, and the cost model (small write premium upfront, discounted read rate while retained).

**How it works in a request:**

You add a one-line field to your API call specifying the retention window (e.g., 5 min or 60 min). While the window is active, every subsequent request whose prefix matches skips prefill and is billed at the cache-read rate; after the window expires, the cache is evicted normally.

If you need the exact JSON key/value syntax, the docs page above shows the current request shape—no other discovery mechanism (schema endpoint, `OPTIONS` call, etc.) is provided.

How does this compare with other providers? Do they offer more or less cache period? Or controllable cache duration?

I'll research how other major providers handle prompt caching durations and whether they're controllable.Let me fill in a few remaining providers (Groq, DeepSeek, Mistral) for a complete comparison.Here's how DeepInfra stacks up. Short version: DeepInfra's 5-min/1-hour choice puts it in the same league as Anthropic and Bedrock, and ahead of OpenAI/DeepSeek/Groq on controllability — but behind Google Gemini, which lets you set an arbitrary TTL.

## Comparison table

| Provider | Default cache duration | Controllable? | Options / notes |
|---|---|---|---|
| **DeepInfra** | 5 min or 1 hour | ✅ Yes | Explicit `cache_retention` param; two fixed windows |
| **Anthropic** | 5 min (default) | ✅ Yes | Two tiers: 5 min, or 1 hour via `cache_control: {"ttl": 3600}`; 1-hr writes cost ~2× input (vs 1.25× for 5-min) [^14][^5][^6] |
| **Google Gemini** | 60 min | ✅ Yes (most flexible) | Explicit caches accept an arbitrary `ttl` or `expire_time`; you're billed for the TTL you set even if you delete early [^13][^1][^15] |
| **Amazon Bedrock** | 5 min | ✅ Yes | 1-hour TTL option added Jan 2026 for select Claude models; `"5m"`/`"1h"` values [^7][^16] |
| **OpenAI** | ~5–10 min inactivity | ❌ Mostly automatic | Cleared after 5–10 min idle, always removed within 1 hr of last use; GPT‑6 adds explicit breakpoints/controls and up to ~24 hr "extended retention" [^2][^17][^10] |
| **Azure OpenAI** | ~5–10 min inactivity | ❌ Automatic | Same behavior as OpenAI: cleared in 5–10 min idle, removed within 1 hr of last use [^11] |
| **DeepSeek** | Hours to days | ❌ Automatic | Disk-based, on by default; unused entries cleared "within a few hours to days" [^4][^8] |
| **Groq** | Volatile / auto-expiring | ❌ Automatic | Automatic prefix reuse, "volatile-only storage that expires automatically" [^12] |
| **Mistral** | Undocumented | ⚠️ Partial | `prompt_cache_key` "increases the chance of a hit" but no published TTL guarantee [^3][^9] |

## Key takeaways

**DeepInfra is mid-pack on duration, strong on control.** Its two options (5 min / 1 hr) exactly mirror Anthropic's two tiers and Bedrock's 5-min-default-plus-1-hr-option model. So if "controllable cache duration" is what you care about, DeepInfra is at parity with the two biggest caching-focused players.

**Who offers more:**
- **Google Gemini** is the most flexible — it's the only major provider where you can specify an *arbitrary* TTL (not just two presets), with a 60-minute default [^13][^1]. The trade-off: you pay for the storage duration you set, even if you don't use it [^15].
- **DeepSeek** and **OpenAI (extended retention)** can keep caches alive much longer in practice (hours to days / up to ~24 hr), but you don't choose it — it's automatic and best-effort.

**Who offers less / no control:**
- **OpenAI, Azure, DeepSeek, and Groq** are automatic with no user-set TTL. Their caches expire on inactivity windows (typically 5–10 min, hard-capped around 1 hr for OpenAI) [^2][^11][^4][^12].

**Practical framing:**
- Need **predictable, cost-modeled retention** you control → DeepInfra, Anthropic, Bedrock, or Gemini.
- Need **the longest single window** → Gemini (custom) or DeepSeek/OpenAI-extended (automatic).
- Need **zero config** → OpenAI, DeepSeek, Groq.

One caveat worth flagging: DeepInfra's two values are fixed, whereas Gemini lets you pick any duration — so if you specifically want "more than 1 hour," DeepInfra won't do it; Gemini (or DeepSeek's automatic disk cache) will.

**References**

[^1]: [Context caching - generateContent API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/generate-content/caching) (12%)
[^2]: [Prompt Caching in the API | OpenAI](https://openai.com/index/api-prompt-caching/) (12%)
[^3]: [Prompt caching | Mistral Docs](https://docs.mistral.ai/studio/conversations/advanced/prompt-caching) (12%)
[^4]: [Context Caching | DeepSeek API Docs](https://api-docs.deepseek.com/guides/kv_cache) (10%)
[^5]: [Choosing Between the 5-Minute and 1-Hour Prompt Cache Tiers](https://www.romainlespinasse.dev/posts/choosing-prompt-cache-tier/) (8%)
[^6]: [Claude Prompt Caching: Pricing, 5-Min vs 1-Hour TTL (2026) | Respan](https://www.respan.ai/articles/claude-prompt-caching) (8%)
[^7]: [Amazon Bedrock now supports 1-hour duration for prompt ...](https://aws.amazon.com/about-aws/whats-new/2026/01/amazon-bedrock-one-hour-duration-prompt-caching/) (6%)
[^8]: [DeepSeek API introduces Context Caching on Disk, cutting ...](https://api-docs.deepseek.com/news/news0802/) (5%)
[^9]: [audit-prompt-caching/audit-prompt-caching/references/mistral ... - GitHub](https://github.com/sernote/audit-prompt-caching/blob/main/audit-prompt-caching/references/mistral.md) (5%)
[^10]: [LLM Prompt Caching: 90% Cost Cut, All 3 Providers | TECHSY](https://techsy.io/en/blog/llm-prompt-caching-guide) (4%)
[^11]: [Prompt caching with Azure OpenAI in ...](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching) (4%)
[^12]: [Prompt Caching - GroqDocs - console.groq.com](https://console.groq.com/docs/prompt-caching) (4%)
[^13]: [Create a context cache | Gemini Enterprise Agent Platform | Google ...](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-create) (3%)
[^14]: [Prompt caching - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) (2%)
[^15]: [Clarification on Context Cache Storage Billing (TTL vs. Actual ...](https://discuss.ai.google.dev/t/clarification-on-context-cache-storage-billing-ttl-vs-actual-time/81267) (2%)
[^16]: [Support AWS Bedrock Prompt Caching TTL Parameter ...](https://github.com/BerriAI/litellm/issues/19848) (2%)
[^17]: [Better prompt caching for GPT‑6 - OpenAI](https://openai.com/index/better-prompt-caching-for-gpt-6/) (2%)