# ROS 2 and Gazebo plan (not built yet)

Goal for the next hackathon: show the same decision layer running as ROS 2 nodes with the robot model in RViz2. Nothing here has been run yet; the topic names are a design proposal.

## Nodes
| Node | Role | Talks to |
| --- | --- | --- |
| `robot_state_publisher` | publishes the robot from `robot/helix.urdf` | RViz2 |
| `helix_sensors` | wraps real or simulated sensors (heat camera, microphone array, CO2 and gas, radar) | `/helix/sensors/*` |
| `helix_decision` | the decision layer (verification, triage, planning) | reads sensors, proposes actions on `/helix/proposed_action` |
| `helix_gate` | the deterministic safety gate and approval checks (`src/gate.js` logic) | `/helix/proposed_action` in, `/helix/allowed_action` out |
| `helix_controller` | turns allowed actions into motion (ros2_control, Nav2) | `/helix/allowed_action` |
| `operator_bridge` | operator screen, voice command grammar (`src/command.js`), alarms | `/helix/operator/command`, `/helix/alarm` |

## Voice commands
Speech to text on the operator device, then the fixed grammar, then `std_msgs/String` on `/helix/operator/command` with one of `recall`, `hold`, `resume`, `deploy`. The gate always allows `recall` ("come out"). Unknown text is dropped at the bridge. If the link is lost the units hold, and a unit that carries a casualty keeps going to the safe zone.

## Order of work
1. `ros2 launch` a file that shows `helix.urdf` in RViz2 with joint sliders.
2. Port the gate and the command grammar to a ROS 2 node (Python or C++) with the same test cases as `test/`.
3. Gazebo (the version that matches the installed ROS 2 distribution): a simplified body, a dummy load, a flowing-water test and a heat zone.
4. Replace simulated sensor readings with recorded or live data and measure detection accuracy.
5. Only then plan hardware (see `HARDWARE_READY.md`).
