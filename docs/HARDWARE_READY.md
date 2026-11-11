# Hardware-ready architecture

"Hardware-ready" here means the interfaces are designed and tested so a real robot can be attached without rewriting the decision layer. It does **not** mean a physical robot exists.

```
Mission / decision layer   detection, verification, planning, rescue workflow      (src/sim.js)
        |  proposes actions
Safety gate                deterministic rules, human approvals, no model          (src/gate.js)
        |  only ALLOW reaches the next layer
Gated actuator bus         the single path to any actuator                         (src/hal.js)
        |
ActuatorPort               one interface, two adapters
   SimulatedPort   records the motor commands in simulation (exists, tested)
   HardwarePort    placeholder that fails loudly until real drivers exist
```

Rules enforced by code and tests (`test/hal.test.js`):
- An unknown action never reaches an actuator.
- A move into a cell above the temperature limit is not forwarded.
- A lift is forwarded only after the commander (and, for a suspected spinal injury, the medic) approved.
- With no hardware connected, even an approved action fails loudly instead of pretending to succeed.

The robot itself is described in `robot/helix.urdf` (links, joints, limits, masses, sensor mounts), the format ROS 2 and Gazebo read.

## What is still needed before any physical robot
- Motor and sensor drivers that implement `ActuatorPort` and the sensor interfaces.
- Calibration procedures and joint-limit verification on the real machine.
- A hardware safety controller with a physical emergency stop, independent of the software.
- Locomotion and balance control (walking, carrying a load) developed and validated in physics simulation first.
- A validation plan and certification with fire and rescue experts.

## Readiness assessment (honest)

| Area | Status |
| --- | --- |
| Decision layer, safety gate, approvals, audit log, triage, fleet, distress calls, operator console, 4 scenarios | Working in simulation, 46 automated tests, reproducible evaluation (single unit, single casualty) |
| Hardware abstraction (`src/hal.js`) | Designed and tested for the fire, flood and collapse gate. The well gate, fleet and operator console are not yet routed through it |
| Robot body (`robot/helix.urdf`) | Kinematic description only. Masses, torques, joint limits are assumptions. Walking is an animation, not physics |
| Sensors | Simulated readings. No real sensor data has been used or validated |
| Locomotion, balance, carrying 90 kg, swimming, heat tolerance | Not built, not simulated with physics, not tested |
| Energy harvesting, winch, tether, rescue pod | Design concepts |
| Operator link | The handheld screen runs on the same simulation. No radio, no latency, no link-loss behaviour yet |
| Certification, emergency stop, explosion-proof and waterproof rating | Not started |

Verdict: **the software architecture is ready to be attached to hardware; a robot is not ready to be built from this yet.**

## Suggested path
1. ROS 2: publish `robot/helix.urdf` with `robot_state_publisher`, check the joints in RViz2.
2. Wrap the decision layer as a ROS 2 node: sensor topics in, action requests out through the gate node, then the controller.
3. Gazebo physics: start with a simplified body (a tracked or wheeled base with one arm) and a dummy load, then test balance, carrying and water.
4. Cheapest real hardware first: a sensing payload (thermal camera, microphone array, CO2 and gas sensor, radar) on a small rover to validate detection with real data, plus a real operator screen and alarm over Wi-Fi or radio.
5. Only then a lift mechanism with a dummy load, and the winch and rescue pod as a bench model.
6. Add link-loss behaviour (units hold and raise an alarm if the operator link drops) before any field test.
