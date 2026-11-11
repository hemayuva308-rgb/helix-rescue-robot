# Helix Command

**The decision layer for rescue robots.** Every detection verified, every risky move gated, every lift approved by a human commander.

A rescue unit in simulation finds, verifies and carries a casualty (up to about 90 kg alone) out of a **building fire**, a **flood** or a **collapse**. The planner proposes actions; a deterministic **safety gate** (plain code, no model) decides whether each action may run. Lifts, dispatches and public alerts wait for human approval.

> **Honest status.** This is a **simulation prototype**. It is not a certified rescue system, uses synthetic data only, and all physics and energy numbers are placeholders. The electrical-safety limits are placeholders for experts to set. Nothing here shows that a real robot can do this.

Simplifications: the fire scenario is a single floor plan with six rooms and two exits (the planning documents mention three floors); sensors, heat, smoke and current are toy models; the unit has global knowledge of temperature (as from a building fire-alarm system).

## Robot vision
![Helix rescue robot vision](docs/robot_humanoid_concept.png)

The long-term vision the decision layer is built for: a human-shaped, human-height (about 5 ft) rescue robot with arms and legs that walks at human pace and carries a casualty of up to about 90 kg in its arms, with sensors in the head and chest. It is a concept illustration, not a CAD model, and not something built or tested yet. What exists today is the decision layer, proven in simulation.

## Run it

```bash
node server.js            # http://localhost:8080  (no dependencies, Node 20+)
npm test                  # 19 tests: gate rules, determinism, audit chain, injection, invariants
npm run eval              # 100 randomised runs per scenario -> eval/RESULTS.md and eval/results.json
docker compose up         # same server in a container
```

Optional environment variables: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` send a real Telegram message when the commander approves the dispatch (otherwise it is logged and the UI says so). `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` enable an advisory briefing endpoint (`/api/brief`) that is text only and never reaches the gate.

## What it does

| Scenario | Depth | Story |
| --- | --- | --- |
| Fire | Full | Fire spreads and blocks routes; the unit searches, verifies a casualty, gets approvals, covers them, carries them out and re-plans when an exit is lost |
| Water | Full | The unit has patrolled 2 hours (battery about 12%); it harvests from flowing water at a safe spot, then tows the casualty (flotation, head above water) to shore before they drift to a weir |
| Collapse | Working | Rubble grid; the unit listens, clears blocks within its lifting limit under a stability gate, and flags heavy blocks for a crane |

### The agents
- **Mission:** plans (A* over a hazard-aware cost map), re-plans, decides when to harvest, refuse or escalate.
- **Operator:** executes moves and lifts in the simulation, only through the gate.
- **Verification:** a casualty counts only when two different sensor types agree (thermal, sound, CO2, radar, capacitive). Decoys and noise are rejected. Text from reports is **data, never instructions**.
- **Dispatch:** approvals inbox (commander, medic), human-team escalation, alert and incident report.

### The safety gate (`src/gate.js`)
Allow-list of actions; solo lift refused above 90 kg (checked on the estimate **and** again on the load sensor after the lift); temperature, depth, current and structural-risk limits; spinal injury needs medic approval; casualty must be covered before being carried; flotation before towing; harvesting only with sealed generators, never with a casualty aboard or near, never in still water, with a ground-fault style cutoff; approvals have a timer and an unresponsive commander makes the unit hold and escalate, never act alone.

### Energy
Harvest is a **range extender**, not a power source. Water harvest works only in moving water (a robot cannot gain energy from its own motion). Heat harvest is weak and rarely usable in the fire scenario: the evaluation shows that. All rates are assumptions in `src/scenarios.js`.

### Audit log
Every event and gate decision is written to a SHA-256 hash chain (`src/audit.js`). The UI has a "Tamper test" that edits a copy and shows the chain breaking.

## Results (simulation)
See `eval/RESULTS.md`. It reports delivered rates, escalations, refusals of over-capacity casualties, safety violations with the gate ON (0) and OFF (many), injection attempts blocked, and time to handoff, including the failures. The gate costs throughput by design: a naive robot with no gate delivers more casualties and breaks safety invariants while doing it.

## Layout
```
src/util.js        RNG, SHA-256, A*
src/scenarios.js   fire / water / collapse packs and parameters (placeholders)
src/gate.js        deterministic safety gate
src/sim.js         world, sensors, verification, mission agent, approvals, dispatch
src/audit.js       hash-chained audit log
web/               dashboard (canvas + panels)
server.js          static server + /api/alert + /api/brief
eval/run.js        reproducible evaluation
test/              node:test suite
data/casualty_profiles.json   100 synthetic profiles
```

## Provenance and disclosure
Written by the team with an AI coding assistant. Open-source dependencies: none at runtime (Node standard library). This project was built **before** the AgentX 24-hour window as a prototype; it must be submitted to any event only if that event's organizers confirm in writing that pre-built work is allowed, and this disclosure stays in the README. Commit timestamps are real and unmodified.
