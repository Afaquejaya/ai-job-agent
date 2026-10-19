# Phase 2C addendum — free local AI model (Ollama)

> Status: **APPROVED 2026-10-19** with the recommended decisions (bonsai-2:9b, keep Anthropic,
> keep consent, 10 min / 8 min limits). Implemented; live check pending until Ollama is installed.
> User decision: use a free local model instead of a paid API key.

## 1. What you will get

The same Agent and Jobs pages you have now, powered by an AI model that runs **on your own
laptop**, at no cost, with your CV never leaving your machine. The Anthropic option stays
available (you can switch with one line in `.env`). Completing this also counts as the Phase 2C
live run.

**Honest expectations for your laptop** (16 GB RAM, i7-1255U, NVIDIA MX570 with 2 GB):

- The graphics card is too small for these models, so they run on the processor. Expect roughly
  **2–5 minutes per job** (I will measure the real number and report it).
- Small open models are weaker than Claude. They will quote less precisely and miss more, so
  you will see more factors marked "unknown". The evidence check stays exactly the same, so a
  weaker model can make the analysis _less complete_ but cannot make it _invent_ facts about
  you.
- While the model runs it uses about 4–6 GB of RAM.

## 2. What you install (once)

1. **Ollama for Windows** from <https://ollama.com/download> (free; you install it yourself).
2. In a terminal: `ollama pull bonsai-2:9b` (a 3.2 GB download; see decision 1).
3. In `.env`: `AI_PROVIDER=ollama` and `OLLAMA_MODEL=bonsai-2:9b`, then restart `pnpm dev`.

## 3. How it works

- **New adapter** `createOllamaProvider` in `packages/ai-providers`, implementing the same
  `ModelProvider` interface as Anthropic, so the agent loop, tools, evidence check and UI are
  unchanged. It calls Ollama's local API (`POST /api/chat`):
  - chat steps: streamed (`stream: true`), with `tools`, and `think: true` when the model
    supports it (thinking shows in the step list like today);
  - match analysis: one call with `format` set to the JSON Schema of the analysis (structured
    output), then the same server-side quote check and scoring;
  - `options.num_ctx` set to 16,384 tokens. **Important:** Ollama's default context is small and
    it silently cuts long input, which would drop parts of your CV.
- **Local only:** `OLLAMA_BASE_URL` must point to this machine (`localhost`/`127.0.0.1`,
  default `http://127.0.0.1:11434`). Any other host is refused, so data can't be sent elsewhere
  by a configuration mistake.
- **Cost:** recorded as $0 per call (tokens are still recorded). The monthly budget becomes
  optional when the provider is local.
- **Time limits per provider:** local models get a 10-minute turn limit and an 8-minute
  analysis limit (Anthropic keeps 120 s / 90 s). The step limit stays 8.
- **Clear errors:** "Ollama is not running — start it from the Start menu" (connection refused)
  and "Model not downloaded — run `ollama pull bonsai-2:9b`" (model missing), shown on the Agent
  page instead of a generic failure.
- **UI wording:** the consent text names the provider actually configured ("the AI model
  running on this computer (Ollama); nothing leaves your machine" vs Anthropic). The Agent page
  shows "Running on your computer: this can take a few minutes" while it works.
- **Most reliable path with small models:** the **Analyse match** button on the Jobs page is a
  single structured call, which small models handle better than multi-step tool use. If the
  chat agent struggles, that path still gives you real results.

## 4. Changes (files)

| Area                                       | Change                                                          |
| ------------------------------------------ | --------------------------------------------------------------- |
| `packages/ai-providers/src/ollama.ts`      | New adapter (+ unit tests with a fake `fetch`)                  |
| `packages/ai-providers/src/pricing.ts`     | Local models priced at $0                                       |
| `apps/web/src/server/env.ts`, `ai.ts`      | `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, limits |
| Agent, Jobs, consent components            | Provider-aware wording, longer-wait hint, clearer errors        |
| `.env.example`, README, decisions, roadmap | Setup steps and decisions D-037+                                |

No database changes.

## 5. Tests

- **Unit:** stream parsing (text, thinking, tool calls), structured output, `num_ctx` sent, tool
  results sent back correctly, error mapping (Ollama not running, model missing, timeout,
  cancel), local-only URL check.
- **Integration and e2e:** unchanged (they keep using the fake model, so CI needs no Ollama).
- **Live check on your laptop** after you install Ollama: one synthetic job through the chat
  and through the Analyse button. I report the time taken, the score, and how many factors had
  verified quotes vs "unknown", honestly, even if the result is poor.

## 6. Acceptance criteria

1. With Ollama running and the model pulled, a pasted job produces a streamed agent run, a
   saved job and a stored, evidence-checked analysis.
2. No network call leaves the machine (base URL restricted to localhost; tested).
3. Clear messages when Ollama is off or the model is missing (tested).
4. All existing checks stay green; CI needs no Ollama.
5. Timing and quality from the live check are reported.

## 7. Decisions needed

| #   | Decision                                    | My recommendation                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Which model                                 | **`bonsai-2:9b`** (Prism ML, Apache 2.0, 3.2 GB, tools + thinking, built to be small and fast). Alternatives: `bonsai-2:4b` (1.6 GB, faster, weaker) or `ornith:9b` (5.6 GB, MIT, tuned for coding agents). These are new models I cannot vouch for yet; the live check decides, and switching is one `.env` line. |
| 2   | Keep the Anthropic option                   | **Yes**: one `.env` line to switch if you ever add a key.                                                                                                                                                                                                                                                          |
| 3   | Still ask for AI consent with a local model | **Yes**, with wording that says the data stays on your computer. One consistent rule is simpler to trust.                                                                                                                                                                                                          |
| 4   | Time limits for local models                | **10 minutes per turn, 8 minutes per analysis.**                                                                                                                                                                                                                                                                   |
