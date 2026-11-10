// Generates 100 synthetic casualty profiles (no real people). Run: node scripts/make_profiles.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeRng } from '../src/util.js';
import { randomProfile } from '../src/scenarios.js';
const rng = makeRng(2026);
const profiles = Array.from({ length: 100 }, (_, i) => ({ id: `P${String(i + 1).padStart(3, '0')}`, ...randomProfile(rng) }));
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/casualty_profiles.json', import.meta.url), JSON.stringify(profiles, null, 2));
console.log('wrote', profiles.length, 'synthetic profiles');
