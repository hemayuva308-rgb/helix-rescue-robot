import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadUrdf } from '../src/urdf.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('physics URDFs: every link has collision geometry and a positive inertia tensor, masses unchanged', () => {
  const base = loadUrdf(read('robot/helix.urdf'));
  const baseMass = [...base.links.values()].reduce((a, l) => a + l.mass, 0);
  for (const f of ['robot/helix_physics.urdf', 'robot/helix_physics_pinned.urdf']) {
    const t = read(f), model = loadUrdf(t);
    assert.equal((t.match(/<collision>/g) ?? []).length, 19, f);
    const inertias = [...t.matchAll(/<inertia ixx="([^"]+)"[^>]* iyy="([^"]+)"[^>]* izz="([^"]+)"/g)];
    assert.equal(inertias.length, 19, f);
    for (const m of inertias) for (const k of [1, 2, 3]) assert.ok(Number(m[k]) > 0, `${f} inertia ${m[0]}`);
    assert.equal((t.match(/gz::sim::systems::JointPositionController/g) ?? []).length, 12, `${f} joint controllers`);
    assert.equal([...model.links.values()].reduce((a, l) => a + l.mass, 0), baseMass);
  }
  assert.equal(loadUrdf(read('robot/helix_physics.urdf')).root, 'base_link', 'the free-standing robot has no world pin');
  assert.equal(loadUrdf(read('robot/helix_physics_pinned.urdf')).root, 'world');
});

test('the viewer model is unchanged by the physics work', () => {
  const m = loadUrdf(read('robot/helix.urdf'));
  assert.equal(m.links.size, 20); assert.equal(m.joints.length, 19);
});
