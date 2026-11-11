import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadUrdf, forwardKinematics, modelStats, revoluteJoints, gaitPose, CARRY_POSE, apply } from '../src/urdf.js';

const model = loadUrdf(readFileSync(new URL('../robot/helix.urdf', import.meta.url), 'utf8'));

test('urdf: the robot has the expected structure', () => {
  assert.equal(model.name, 'helix_rescue_robot');
  assert.equal(model.root, 'world');
  assert.equal(model.joints.length, 19);
  assert.equal(revoluteJoints(model).length, 12);
  for (const n of ['l_hip_pitch', 'r_knee_pitch', 'l_shoulder_pitch', 'neck_yaw']) assert.ok(model.joints.some((j) => j.name === n), n);
});

test('urdf: standing height is about 1.5 m (5 ft) and the feet touch the ground', () => {
  const s = modelStats(model, {});
  assert.ok(s.height > 1.45 && s.height < 1.56, `height ${s.height}`);
  assert.ok(Math.abs(s.zmin) < 0.02, `zmin ${s.zmin}`);
});

test('urdf: total mass is the sum of the link masses (design assumption)', () => {
  const s = modelStats(model, {});
  const sum = [...model.links.values()].reduce((a, l) => a + l.mass, 0);
  assert.equal(s.mass, sum);
  assert.ok(s.mass > 60 && s.mass < 100);
});

test('urdf: centre of mass is over the middle of the body, above the knees', () => {
  const s = modelStats(model, {});
  assert.ok(s.com[2] > 0.6 && s.com[2] < 1.0, `com z ${s.com[2]}`);
  assert.ok(Math.abs(s.com[1]) < 0.01, 'left-right symmetric');
});

test('urdf: forward kinematics moves the hand forward when the shoulder pitches forward', () => {
  const rest = forwardKinematics(model, {});
  const carry = forwardKinematics(model, CARRY_POSE);
  const hand0 = apply(rest.get('l_hand'), [0, 0, 0]), hand1 = apply(carry.get('l_hand'), [0, 0, 0]);
  assert.ok(hand1[0] > hand0[0] + 0.3, 'hand reaches forward');
  assert.ok(hand1[2] > hand0[2] + 0.2, 'hand rises');
});

test('urdf: joint limits are respected', () => {
  const T = forwardKinematics(model, { l_knee_pitch: -5 });
  const rest = forwardKinematics(model, { l_knee_pitch: 0 });
  assert.deepEqual(T.get('l_foot'), rest.get('l_foot'));
});

test('gait preview keeps the feet at or above the ground plane within tolerance', () => {
  for (let i = 0; i < 24; i++) {
    const s = modelStats(model, gaitPose((2 * Math.PI * i) / 24));
    assert.ok(s.zmin > -0.12, `foot below ground by ${s.zmin} at step ${i}`);
    assert.ok(s.height > 1.2);
  }
});
