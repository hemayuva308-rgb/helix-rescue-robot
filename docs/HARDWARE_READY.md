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
