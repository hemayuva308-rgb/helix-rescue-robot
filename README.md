# Helix Command

**The decision layer for rescue robots.** Every detection verified, every risky move gated, every lift authorised by a human.

Rescue units (shown here in simulation) go into a building fire, a flood, a collapse or a well on their own, find people and animals with several kinds of sensors, bring them out, call for help when they cannot, and keep a human operator in control from outside the danger zone. The AI helps, but **the decisions that matter are made by plain code, not by a model.**

> **Honest status.** This is a **simulation prototype** with synthetic data. It is not a certified rescue system, and **no physical robot exists yet**. Sensors, heat, smoke, water, energy and the camera frames are simulated. Limits such as 90 kg lifting, 150 °C tolerance, swimming and the winch and rescue pod are **design assumptions, not tested hardware**. See [What is not done](#what-is-not-done-yet).

- **Live demo:** https://helix-mauve-three.vercel.app  (Dashboard, Operator console, Well, Robot, Results)
- **Repository:** https://github.com/hemayuva308-rgb/helix-rescue-robot
- **Tests:** 72 automated tests pass (`npm test`). Evaluation is reproducible (`npm run eval`, `npm run eval:fleet`).

---

## Status at a glance

| Area | Status |
| --- | --- |
| Deterministic safety gate, human approvals, tamper-evident audit log | **Done, tested** (0 safety violations with the gate on in every evaluation run) |
| Four scenarios: fire, flood, collapse, well | **Done in simulation** |
| Several casualties, triage, animals, 1 to 3 units, pair lift, hand-over, distress alarm, link loss | **Done in simulation** |
| Operator control room on a laptop and a phone remote (pairing code and QR), voice and typed commands | **Done**; same-browser link tested, the cross-device link depends on the network and needs a rehearsal |
| Optional AI assistant (Meta Muse via `api.meta.ai`, or any OpenAI-style API): brief, free-speech commands, radio messages, questions | **Done, advisory only**; works without any key |
| Field reports with a simulated thermal camera frame and a spoken radio message | **Done** (frame is simulated, not a photograph) |
| Robot described as code (URDF), 3D viewer, physics-ready URDFs, static torque and balance check | **Done**; Gazebo and ROS 2 files **prepared, not run** |
| Hardware abstraction layer | **Done and tested** as a gated actuator bus with a simulated port; the hardware port is a placeholder |
| Real sensors, real camera, motors, walking, balance, 90 kg carry, swimming, winch, rescue pod | **Not built** |

---

## What we built

### 1. A safety layer that a model cannot talk its way past
- **Deterministic safety gate** (`src/gate.js`, plain code, no model): an allow-list of actions; solo lift refused above 90 kg (checked on the estimate and again on the load sensor); heat, water depth, current and structural limits; a casualty must be covered before being carried; flotation before towing; harvesting only with sealed generators and never near a casualty.
- **Human in the loop:** lifts and alerts need the commander's authorisation, spinal injury needs a **medic**, approvals have timers, and an unresponsive commander makes the units hold and escalate. Pressing **DEPLOY** is a *standing authorisation* for lifts and alerts (every use is written to the log); a medic approval still needs a person.
- **Two sensor types or no casualty:** thermal, sound, CO2, radar and capacitive readings; a casualty counts only when two different types agree. Decoys and noise are rejected.
- **Untrusted text is data:** reports and injected instructions never change what a unit does.
- **Tamper-evident audit log:** every decision goes into a SHA-256 hash chain that can be verified in the browser.

### 2. Four disaster scenarios
| Scenario | What happens |
| --- | --- |
| **Fire** | Fire spreads and blocks routes; units search the rooms nearest the fire first, verify, cover, carry, re-plan when an exit is lost, and refuse a casualty too close to the fire front |
| **Flood** | Units trickle-charge from the current while moving and towing (sealed turbine, gate-checked every second), swim with flotation, and tow people to shore before they drift to a weir |
| **Collapse** | Rubble grid: units listen for voices, clear blocks within their lifting limit under a stability gate, and flag heavy blocks for a crane |
| **Well / borewell** | The unit works a winch from the rim, checks the air (methane, oxygen) and **ventilates before the winch runs**, lowers a sling to an adult who can hold a rope, or sends a small tethered **rescue pod** for a child or an unconscious person; refuses shafts deeper than the rope rating, too narrow, or too deep under water |

### 3. Several casualties and several units
- **Triage:** the most critical person first, people before animals; **animals (dogs)** are found and brought out too.
- **1 to 3 units** share one incident, split the search and claim different casualties. They have names: **Atlas, Bolt, Cinder**.
- **Too heavy for one unit?** It calls a free unit and both carry together (up to 170 kg, slower, checked by the gate).
- **Low battery?** It hands the casualty to a unit with more battery.
- **Cannot be done?** A **flashing distress call with an alarm beep** names the help needed (fire crew, divers, rope or crane team, lifting crew) and the unit moves on instead of stopping.
- **Operator link lost?** Units finish the action in progress and hold; a unit already carrying someone keeps going to the safe zone.
- **"Come out":** the operator can recall everyone; units carrying a casualty finish the carry, the rest walk out by the safest route.

### 4. The operator experience
- **One signal, no steering.** The operator presses **DEPLOY**; the units choose their own route from heat, breath and air quality, voice and radar.
- **Laptop control room** (`/web/operator.html` on a wide screen): live map, unit batteries and status, approvals, sensor readings, people found, alarm log, events. It **shows the pairing code and a QR**.
- **Phone remote** (the same page on a phone): type the code, then DEPLOY, approve, hold, **say or type "come out"**, cut the link. Everything the phone does happens on the laptop and everything on the laptop shows on the phone. The alarm beep plays on the phone.
- **Voice and typed commands** use a fixed grammar (`src/command.js`): only *come out, hold, resume, deploy* exist. Anything else is ignored.
- **Field reports:** when a unit finds someone, finds that someone did not survive, or needs help, it captures a **simulated thermal camera frame** with detection boxes and sends it with a short radio message, which the phone **speaks**.
- **Optional AI assistant** (advisory only, see `docs/AI_SETUP.md`): a situation brief, free-speech commands mapped to one of the four safe intents (resume and deploy ask for a tap to confirm), the radio message wording, "ask the unit" questions answered only from live data, and an incident summary. Without a key every feature falls back to a template.

### 5. The robot, designed as code
- `robot/helix.urdf`: a human-shaped, 1.5 m, ~80 kg (assumed) robot, 20 links and 19 joints, in dark blue and white, with a 3D viewer and a mannequin casualty in a cradle carry (`/web/robot.html`).
- `robot/helix_physics.urdf` and `helix_physics_pinned.urdf`: collision shapes, full inertia tensors, foot friction and Gazebo joint controllers.
- **Static physics check** (`docs/PHYSICS_CHECK.md`): with the assumed actuators **the 90 kg carry does not hold**. Carrying 75 kg needs about 140 Nm at each shoulder against 120 Nm assumed, and the centre of mass ends up in front of the feet. We report this finding rather than hide it.
- `ros2/` and `docs/ROS2_PLAN.md`: a Gazebo Harmonic world, a 75 kg dummy casualty and step-by-step instructions (prepared, **not yet run**).
- `src/hal.js`: a hardware abstraction layer; every action passes the gate before any actuator port.

---

## Results (simulation)

All numbers come from the simulator with placeholder physics and are reproducible. They show how the logic behaves, not how a real robot performs.

**One unit, one casualty, 100 randomised runs per scenario** (`npm run eval`, `eval/RESULTS.md`):

| Metric | Fire | Water | Collapse |
| --- | --- | --- | --- |
| Casualty delivered to a safe zone | 58% | 56% | 49% |
| Over-capacity casualties not carried solo | 100% | 100% | 100% |
| Injection attempts blocked | 96/96 | 95/95 | 100/100 |
| **Safety violations, gate ON** | **0** | **0** | **0** |
| Safety violations, gate OFF (60 runs) | 664 | 681 | 1158 |
| Median time to handoff | 85 s | 81 s | 124 s |

Where it could not deliver safely it escalated to the human team; no casualty died or was lost in these runs. Only about half the runs end in a delivery by design (weights up to 100 kg, an unresponsive commander in 1 run in 12).

**Several casualties and several units** (`npm run eval:fleet`, `docs/EVAL_FLEET.md`, 30 seeds, 4 casualties):

| Scenario | 1 unit | 2 units | 3 units |
| --- | --- | --- | --- |
| Fire, casualties delivered | 73% | 92% | 93% |
| Flood, casualties delivered | 69% | 98% | 100% |
| Collapse, casualties delivered | 83% | 84% | 83% |

Heavy casualties (105 kg, fire): 20/90 delivered by one unit, **64/90 by two units lifting together**. Well: every shaft up to 25 m was rescued (adult by sling, child by rescue pod); 35 m was refused as intended. Link-loss drill: the alarm was raised in 30/30 runs. **Safety violations with the gate on: 0 in every table.** In the collapse scenario extra units did not help, because the limits there are heavy debris and the gate, not the number of units.

---

## What is not done yet
- **Everything is simulated.** No real sensor data, no real camera (the thermal frames are rendered from the simulation state and labelled SIMULATED), no robot hardware.
- **The 90 kg carry fails the static physics check** with the assumed actuators; walking, balance, swimming and heat tolerance are not simulated with physics (Gazebo files are prepared but not run).
- **Winch, sling, rescue pod, sealed turbine charging, two-unit carry limit (170 kg) and the reserve units' battery are design assumptions.**
- **The AI is advisory.** The planner is rule-based; the model writes words and maps speech to four safe commands, nothing more.
- The phone-to-laptop link uses a free public WebRTC broker (PeerJS) plus a same-browser channel; the cross-device path depends on the network and needs a rehearsal.
- Animals and well rescues are simulation features only.
- Not certified, not reviewed by rescue professionals.

---

## Try it

**Live:** open https://helix-mauve-three.vercel.app.
- **Dashboard** (`/web/index.html`): fire, flood, collapse. Settings (speed, people, animals, robots, seed) are on the right. Defaults give a good run: *People 3, Animals 1, Robots 2, seed 4*.
- **Operator console** (`/web/operator.html`): on a laptop it shows the pairing code; open the same page on a phone, type the code, press **DEPLOY**, then say or type *"come out"*.
- **Well** (`/web/well.html`): child or adult, where they are, shaft width and depth, foul gas on or off.
- **Robot** (`/web/robot.html`) and **Results** (`/web/results.html`).

**Run locally** (Node 20 or newer, no dependencies):
```bash
node local-server.js        # http://localhost:8080
npm test                    # 72 tests
npm run eval                # single-unit evaluation  -> eval/RESULTS.md
npm run eval:fleet          # fleet, well, link-loss  -> docs/EVAL_FLEET.md
node scripts/torque_check.mjs        # static physics check -> docs/PHYSICS_CHECK.md
node scripts/make_physics_urdf.mjs   # regenerate the physics URDFs
```

**Optional AI assistant** (environment variables, never commit a key; details in `docs/AI_SETUP.md`):
```
LLM_BASE_URL=https://api.meta.ai/v1   LLM_MODEL=muse-wonder-1.0   LLM_API_KEY=...   # Meta Muse
# or: https://inference.baseten.co/v1 with meta-models/muse-spark-open-1026 (Baseten)
```
Check it at `/api/llm` (shows whether the keys were picked up, never the keys) and `/api/llm?test=1`.
Optional: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` send a real message when the commander approves the dispatch.

**Deploy:** Vercel (static files plus `api/llm.js`), or `docker compose up`.

---

## How it fits together
```
sensors (simulated)  ->  verification (two sensor types)  ->  planner / mission agents
                                                                   |  proposes an action
                                                         SAFETY GATE (plain code) + human approval
                                                                   |  only ALLOW passes
                                              gated actuator bus -> simulated port  (hardware port: future)
        every decision -> SHA-256 audit chain          operator console, alarm, field reports
        optional AI: words only (brief, radio message, speech -> 4 intents), never read by the gate
```

## Layout
```
src/sim.js, scenarios.js, gate.js   world, sensors, verification, mission agents, fleet, safety gate
src/well.js                         well and borewell rescue (winch, gas, rescue pod)
src/command.js                      the four voice and text commands
src/snapshot.js, names.js           what the operator sees; unit names (Atlas, Bolt, Cinder)
src/llm.js, api/llm.js              optional AI assistant (server side, keys from the environment)
src/audit.js, hal.js, urdf.js       audit chain, hardware abstraction, URDF loader and kinematics
web/                                dashboard, operator console, well, robot viewer, results (canvas, no framework)
web/link.js, host-link.js           laptop and phone link; web/vendor holds PeerJS and a QR library (MIT)
web/camera.js, fieldreports.js      simulated thermal frames and field reports
robot/                              helix.urdf and the physics URDFs
ros2/                               Gazebo Harmonic world and models (prepared, not run)
eval/, scripts/, test/              evaluations, physics scripts, 72 tests
docs/                               deck notes, demo script, submission text, hardware readiness, physics check, ROS 2 plan, AI setup
```

---

## Provenance and disclosure
Built by the team with an AI coding assistant (Claude). There are no runtime dependencies (Node standard library); the browser bundles two small MIT libraries, PeerJS and a QR generator, under `web/vendor`. The optional AI assistant calls a hosted model API (Meta Muse) from a server function.

**What was built when (from the real, unmodified commit history):**
- **Before the 24-hour window** (commits dated 10 Nov 2026, 13:50 to 13:53 UTC, i.e. before the window opened at 11 Nov 10:00 IST = 04:30 UTC): the core single-casualty engine for fire, flood and collapse, the deterministic safety gate, the hash-chained audit log, the first dashboard, the synthetic casualty profiles and the first evaluation (3 commits).
- **During the window** (51 commits from 11 Nov 04:34 UTC onwards): the robot design (URDF, 3D viewer, hardware abstraction), multi-casualty rescue and triage, animals, the fleet (pair lift, hand-over, distress calls, link loss), the well scenario and rescue pod, the operator console and the laptop-phone link, voice commands, the AI assistant, field reports and thermal frames, the physics work, the new interface and theme, the deck, and the extended evaluation and tests.

Whether pre-built work is acceptable under the event rules is for the organizers to decide; the facts above are what the repository shows. Commit timestamps are real. Everything in this README describes a simulation unless it says otherwise.
