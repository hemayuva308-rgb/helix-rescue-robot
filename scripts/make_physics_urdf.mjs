// Generates physics-ready URDFs from robot/helix.urdf (the viewer model stays unchanged):
//   robot/helix_physics.urdf         free-floating robot (root = base_link): for a fall and balance test
//   robot/helix_physics_pinned.urdf  pelvis pinned 0.77 m above the world: for arm and lifting torque tests
// It adds collision geometry (copy of the visual), full inertia tensors computed from each primitive and its
// mass, foot friction, and Gazebo joint position controllers (untuned). Masses and sizes are the design assumptions.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../robot/helix.urdf', import.meta.url), 'utf8');
const f = (n) => Number(n.toPrecision(6)).toString();

function inertiaFor(geomXml, m) {
  const g = (re) => { const x = geomXml.match(re); return x ? Number(x[1]) : NaN; };
  if (/<box/.test(geomXml)) { const [x, y, z] = geomXml.match(/size="([^"]+)"/)[1].trim().split(/\s+/).map(Number); return [m / 12 * (y * y + z * z), m / 12 * (x * x + z * z), m / 12 * (x * x + y * y)]; }
  if (/<cylinder/.test(geomXml)) { const r = g(/radius="([^"]+)"/), h = g(/length="([^"]+)"/); return [m / 12 * (3 * r * r + h * h), m / 12 * (3 * r * r + h * h), m * r * r / 2]; }
  if (/<sphere/.test(geomXml)) { const r = g(/radius="([^"]+)"/); const i = 0.4 * m * r * r; return [i, i, i]; }
  throw new Error('unsupported geometry ' + geomXml);
}

let nLinks = 0;
let body = src.replace(/<link name="([^"]+)">([\s\S]*?)<\/link>/g, (all, name, inner) => {
  const vis = inner.match(/<visual>([\s\S]*?)<\/visual>/); const inert = inner.match(/<inertial>[\s\S]*?<\/inertial>/);
  if (!vis || !inert) return all;
  const geom = vis[1].match(/<geometry>[\s\S]*?<\/geometry>/)[0];
  const visOrigin = (vis[1].match(/<origin[^>]*\/>/) ?? [''])[0];
  const mass = Number(inert[0].match(/<mass value="([^"]+)"/)[1]);
  const comOrigin = (inert[0].match(/<origin[^>]*\/>/) ?? ['<origin xyz="0 0 0"/>'])[0];
  const [ixx, iyy, izz] = inertiaFor(geom, mass);
  const newInert = `<inertial><mass value="${mass}"/>${comOrigin}<inertia ixx="${f(ixx)}" ixy="0" ixz="0" iyy="${f(iyy)}" iyz="0" izz="${f(izz)}"/></inertial>`;
  const collision = `<collision>${visOrigin}${geom}</collision>`;
  nLinks++;
  const visualXml = vis[0];
  const comment = (inner.match(/<!--[\s\S]*?-->/) ?? [''])[0];
  return `<link name="${name}">${comment}\n    ${visualXml}\n    ${collision}\n    ${newInert}\n  </link>`;
});

const revolutes = [...src.matchAll(/<joint name="([^"]+)" type="revolute">[\s\S]*?effort="([^"]+)"/g)].map((m) => ({ name: m[1], effort: Number(m[2]) }));
const gz = [
  '  <!-- Gazebo (gz sim, Harmonic): joint state publisher, one position controller per revolute joint (gains are NOT tuned), foot friction -->',
  '  <gazebo><plugin filename="gz-sim-joint-state-publisher-system" name="gz::sim::systems::JointStatePublisher"/></gazebo>',
  ...revolutes.map((j) => `  <gazebo><plugin filename="gz-sim-joint-position-controller-system" name="gz::sim::systems::JointPositionController"><joint_name>${j.name}</joint_name><p_gain>${f(j.effort * 4)}</p_gain><i_gain>0</i_gain><d_gain>${f(j.effort * 0.4)}</d_gain><cmd_max>${j.effort}</cmd_max><cmd_min>${-j.effort}</cmd_min></plugin></gazebo>`),
  '  <gazebo reference="l_foot"><mu1>1.0</mu1><mu2>1.0</mu2><kp>100000</kp><kd>100</kd></gazebo>',
  '  <gazebo reference="r_foot"><mu1>1.0</mu1><mu2>1.0</mu2><kp>100000</kp><kd>100</kd></gazebo>',
].join('\n');

const pinned = body.replace('</robot>', gz + '\n</robot>');
// free-floating variant: no world link and no joint pinning the pelvis
const free = body.replace('<link name="world"/>\n', '').replace(/\s*<joint name="base_joint"[^\n]*\n/, '\n').replace('</robot>', gz + '\n</robot>').replace('<robot name="helix_rescue_robot">', '<robot name="helix">');
const pinnedNamed = pinned.replace('<robot name="helix_rescue_robot">', '<robot name="helix_pinned">');
writeFileSync(new URL('../robot/helix_physics.urdf', import.meta.url), free);
writeFileSync(new URL('../robot/helix_physics_pinned.urdf', import.meta.url), pinnedNamed);
console.log(`links processed: ${nLinks}, revolute joints with controllers: ${revolutes.length}`);
