# ROS 2 Jazzy and Gazebo Harmonic: next step (not yet run)

Everything here is prepared but **has not been run**: ROS 2 and Gazebo are not available in the development sandbox. Run each step on the WSL2 Ubuntu 24.04 machine and note what breaks. A Gazebo result is the output of a physics model, not proof that a real robot can do the same.

## 0. What the files are
| File | Purpose |
| --- | --- |
| `robot/helix.urdf` | the viewer model (RViz2, the web 3D viewer). Visual shapes and masses only |
| `robot/helix_physics.urdf` | physics version, free standing: collision shapes, full inertia tensors, foot friction, one Gazebo joint position controller per joint (gains not tuned) |
| `robot/helix_physics_pinned.urdf` | same, but the pelvis is pinned 0.77 m above the ground: for arm and lifting tests without balance |
| `ros2/worlds/rescue_test.sdf` | ground, gravity, a 10 cm step, a debris block |
| `ros2/models/dummy_casualty.sdf` | 75 kg dummy that lies across the forearms |
| `scripts/make_physics_urdf.mjs` | regenerates the two physics URDFs from `helix.urdf` (`node scripts/make_physics_urdf.mjs`) |
| `scripts/torque_check.mjs` | static torque and balance check, already run: see `docs/PHYSICS_CHECK.md` |

## 1. RViz2 (no Gazebo needed)
```bash
sudo apt install -y ros-jazzy-urdf-tutorial
```
```bash
ros2 launch urdf_tutorial display.launch.py model:=$PWD/robot/helix.urdf
```
Check: the robot appears, every joint slider moves the right limb.

## 2. Gazebo Harmonic
```bash
sudo apt install -y ros-jazzy-ros-gz
```
```bash
gz sim -r ros2/worlds/rescue_test.sdf
```
In a second terminal, drop the pinned robot in:
```bash
ros2 run ros_gz_sim create -file robot/helix_physics_pinned.urdf -name helix_pinned -z 0.0
```
Move a joint:
```bash
gz topic -t /model/helix_pinned/joint/l_shoulder_pitch/cmd_pos -m gz.msgs.Double -p "data: -1.35"
```
(The topic name may differ: list them with `gz topic -l`.) Do the same for `r_shoulder_pitch`, `l_elbow_pitch`, `r_elbow_pitch` (-0.5), then lay the dummy on the forearms:
```bash
ros2 run ros_gz_sim create -file ros2/models/dummy_casualty.sdf -name dummy -x 0.36 -y 0 -z 1.33
```
Watch whether the arms hold. `docs/PHYSICS_CHECK.md` predicts the shoulders need about 140 Nm for 75 kg against the 120 Nm assumed, so they should sag or fail: that is the expected first result.

## 3. Free standing robot
```bash
ros2 run ros_gz_sim create -file robot/helix_physics.urdf -name helix -z 0.9
```
With no balance controller it will fall over. That is correct: writing a balance and walking controller is the real work of the next phase.

## 4. Then
Decision layer as ROS 2 nodes (see `docs/ROS2_PLAN.md`), a simpler body first (a wheeled or tracked base with one arm), water and heat tests last.
