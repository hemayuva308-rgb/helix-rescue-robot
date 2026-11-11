# Optional AI assistant (advisory only)

The project works without any model. If you connect an OpenAI-compatible chat API, three optional things get better:

| Feature | What the model does | What it can NOT do |
| --- | --- | --- |
| Situation brief (operator page) | writes 3 to 4 plain sentences from the unit and alarm data | read by the safety gate, give orders |
| Free-speech commands (operator page) | maps a sentence such as "it is getting dangerous, pull everyone back" to one of four intents: come out, hold, resume, deploy | invent an action: anything else becomes "not understood". Come out and hold run at once; resume and deploy ask for a tap to confirm. They then pass through the same command grammar and safety gate as typed commands |
| Incident report summary (dashboard) | writes a short summary of a finished run | change the audit log or the outcome |

| Field reports (dashboard, well page, operator page) | writes the radio-style message that goes with a camera frame: "Found an unconscious adult (C3)…" | see or change anything: the frame is **simulated** (rendered from the simulation state as a thermal view with detection boxes), not a real photograph |
| Ask the unit (operator page) | answers a question such as "what do you see?" using only the live data | act: it is read-only, actions are only the four commands |

Prompts are fixed on the server (`src/llm.js`); the browser only sends data. Without a key, every feature falls back to a deterministic template or to the fixed command grammar, and says so on screen.

## Environment variables (names only; never put a key in the code, the repository or a chat)
```
LLM_BASE_URL   base URL of an OpenAI-compatible API, for example https://host/v1   (the app calls BASE_URL/chat/completions)
LLM_API_KEY    the key
LLM_MODEL      the model name
LLM2_BASE_URL, LLM2_API_KEY, LLM2_MODEL   optional second provider, used if the first one fails
```

## Baseten (Meta Muse Spark), the hackathon provider
```
LLM_BASE_URL = https://inference.baseten.co/v1
LLM_MODEL    = meta-models/muse-spark-open-1026     (use exactly this name: the hackathon key only works with it)
LLM_API_KEY  = <your key, set only in Vercel or your shell>
```

## On Vercel
Project, Settings, Environment Variables: add the names above (Production), then redeploy. The function is `api/llm.js`.

## Locally
```bash
LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... node local-server.js
```

## Tests
`test/llm.test.js` uses a mock provider: fallbacks, the key staying server-side, and unsafe answers being turned into "none".
