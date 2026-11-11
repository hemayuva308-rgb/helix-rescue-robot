# AgentX submission: what to paste

**Project name:** Helix Command
**One-line pitch:** The decision layer for rescue robots: every detection verified, every risky move gated, every lift approved by a human, shown in a simulation of fire, flood and collapse rescues.
**Problem statement:** PS-07 · Open track: build any agent
**User:** incident commanders, fire and rescue crews, medics.
**Why an agent, not a chatbot:** it plans a multi-step rescue, re-plans as the hazard changes, calls tools (sensing, routing, approvals, alerts, report) and asks a human before any lift.
**Tech stack:** Node.js (no runtime dependencies), vanilla JS canvas dashboard, deterministic safety gate, SHA-256 audit chain, node:test, optional Telegram and OpenAI-compatible endpoints.

## Links to fill in
- Presentation: [Google Slides or Drive link to the 6-slide deck]
- GitHub repository: [link]
- Live demo: [deployed link]
- Demo video: [YouTube or Drive link]

## Notes for judges (paste)
Helix Command is a SIMULATION prototype of a decision layer for rescue robots (fire, flood, building collapse). Nothing here controls a real robot.

What is real: four cooperating agents (Mission, Operator, Verification, Dispatch) plan and re-plan routes; a deterministic safety gate (plain code, no model) decides every action; lifts, dispatches and alerts wait for a human commander's approval; every decision is written to a SHA-256 hash-chained audit log. 19 automated tests and a reproducible evaluation (npm run eval, 100 randomised runs per scenario, failures included) are in the repo.

What is mocked: all physics, sensors, casualties and buildings are synthetic placeholders. Energy-harvest numbers are assumptions. Alerts go to Telegram only if credentials are set on the server; otherwise they are logged and the UI says so. The planner is rule-based; no language model is in the decision path.

Try it: open the live demo, pick a scenario, press Play, and approve the lift when asked. "Safety gate ON/OFF" shows what a robot without the gate does. "Inject poisoned report" shows text being treated as data. The Results page shows the evaluation.

Disclosure: [FILL IN HONESTLY: when the simulation code was written relative to the 24-hour window (it was developed on 10 to 11 Nov, with commit timestamps unmodified), and whether the organizers confirmed in writing that pre-built work is allowed.] Open-source dependencies: none at runtime.
