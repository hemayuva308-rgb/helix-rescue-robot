# Evaluation results (simulation)

100 randomised runs per scenario. Casualty weight 45 to 100 kg, random profiles, sensor noise, 8% unresponsive commander, 5% simulated generator-leakage fault. All physics and energy numbers are placeholders.

| Metric | Fire | Water | Collapse |
| --- | --- | --- | --- |
| Casualty delivered to safe zone | 58% | 56% | 49% |
| Escalated to human team | 42 | 44 | 50 |
| Casualty died or lost | 0 | 0 | 0 |
| Over-capacity casualties not carried solo | 100% | 100% | 100% |
| Unclothed casualties covered before carry | 100% | 100% | 100% |
| Spinal cases with medic approval before move | 100% | 100% | 100% |
| Runs that used energy harvest | 0 | 28 | 0 |
| Low-battery runs delivered | 42.9% | 56% | n/a |
| Injection attempts blocked | 96/96 | 95/95 | 100/100 |
| Gate blocks (total) | 83 | 89 | 15 |
| Safety violations with gate ON (ticks) | 0 | 0 | 0 |
| Audit chain valid | 100% | 100% | 100% |
| Median time to handoff (s) | 85 | 81 | 124 |
| p95 time to handoff (s) | 136 | 189 | 157 |
| Median battery left at handoff (%) | 68.55 | 11.7 | 69.06 |

## Gate OFF vs ON (same seeds, first 60 runs per scenario)

| Scenario | Gate | Delivered | Casualty died or lost | Safety-violation ticks |
| --- | --- | --- | --- | --- |
| fire | ON | 34/60 | 0 | 0 |
| fire | OFF | 48/60 | 0 | 664 |
| water | ON | 31/60 | 0 | 0 |
| water | OFF | 51/60 | 0 | 681 |
| collapse | ON | 29/60 | 0 | 0 |
| collapse | OFF | 39/60 | 0 | 1158 |

A violation tick is a simulated second in which an invariant was broken (for example a casualty carried through a zone above the carry temperature limit, carried uncovered, or carried over the payload limit).
