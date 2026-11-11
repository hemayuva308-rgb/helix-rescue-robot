# Extended evaluation (simulation only)

Seeds 1 to 30, commander answers after 4 s, casualty weight 75 kg (the others a little lighter). Placeholder physics: these numbers show how the logic behaves, not how a real robot performs.

## Several casualties, 1 to 3 units (4 casualties)

| Scenario | Units | Casualties delivered | Runs with everyone delivered | Mean time (s) | Unit-to-unit helps | Distress calls | Safety violations (gate ON) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fire | 1 | 87/120 (73%) | 1/30 | 246 | 0 | 10 | 0 |
| fire | 2 | 110/120 (92%) | 20/30 | 187 | 0 | 5 | 0 |
| fire | 3 | 112/120 (93%) | 22/30 | 165 | 0 | 1 | 0 |
| water | 1 | 83/120 (69%) | 1/30 | 355 | 0 | 18 | 0 |
| water | 2 | 118/120 (98%) | 28/30 | 211 | 0 | 0 | 0 |
| water | 3 | 120/120 (100%) | 30/30 | 162 | 0 | 0 | 0 |
| collapse | 1 | 99/120 (83%) | 13/30 | 428 | 0 | 0 | 0 |
| collapse | 2 | 101/120 (84%) | 15/30 | 262 | 0 | 0 | 0 |
| collapse | 3 | 100/120 (83%) | 16/30 | 240 | 0 | 0 | 0 |

## Heavy casualties (105 kg), 3 casualties

| Scenario | Units | Casualties delivered | Unit-to-unit helps | Safety violations |
| --- | --- | --- | --- | --- |
| fire | 1 | 20/90 | 0 | 0 |
| fire | 2 | 64/90 | 51 | 0 |
| collapse | 1 | 12/90 | 0 | 0 |
| collapse | 2 | 58/90 | 43 | 0 |

## Well rescue (one casualty at the water surface, foul gas present)

| Who | Shaft depth (m) | Outcome | Mean time (s) | Safety violations (gate ON) |
| --- | --- | --- | --- | --- |
| adult (sling) | 8 | delivered 30/30 | 143 | 0 |
| adult (sling) | 14 | delivered 30/30 | 166 | 0 |
| adult (sling) | 25 | delivered 30/30 | 206 | 0 |
| adult (sling) | 35 | escalated 30/30 | - | 0 |
| child (rescue pod) | 8 | delivered 30/30 | 151 | 0 |
| child (rescue pod) | 14 | delivered 30/30 | 179 | 0 |
| child (rescue pod) | 25 | delivered 30/30 | 228 | 0 |
| child (rescue pod) | 35 | escalated 30/30 | - | 0 |

Beyond the 30 m rope rating the well gate refuses and calls a rope rescue team (that is the intended outcome). With the gate OFF a naive winch breaks gas and speed rules (see `test/well.test.js`).

## Link-loss drill (fire, 4 casualties, 2 units, link cut for 40 s at t=60)

Link-loss alarm raised in 30/30 runs; casualties delivered after the link returned: 104/120; safety violations: 0.
