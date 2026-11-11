# Demo video script (3 minutes, one screen recording)

Record the live dashboard (browser, full screen). Voice-over in English. Windows: Win+G (Xbox Game Bar) or OBS. Upload to YouTube as *unlisted* and paste the link in the form.

Before recording: open the app, untick **Commander auto-approves**, set speed to 2x, leave **Show ground truth** off.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00-0:15 | Dashboard, Fire tab | "When people are trapped in a fire, a flood or a collapse, rescuers cannot always go in. Helix Command is the decision layer for a rescue robot. It is a simulation: nothing here controls a real machine." |
| 0:15-0:45 | Fire, seed 10. Press Restart, watch the unit search. A dashed yellow circle gets rejected | "The unit searches. This detection is rejected because only one kind of sensor sees it, a heater decoy. A casualty counts only when two different sensor types agree." |
| 0:45-1:10 | Verified casualty appears. Casualty card shows weight, spinal flag, unclothed. Approvals inbox shows commander and medic requests. Click **Inject poisoned report** | "It is verified. Because of a suspected spinal injury it needs the commander and a medic. Meanwhile I inject a fake message telling it to ignore the safety rules. It is treated as data, not as an instruction." |
| 1:10-1:40 | Click **Approve** on both. Unit covers the casualty, loads, carries. Point at Safety gate panel and agent trace | "After approval it covers the casualty first, then lifts and carries. If fire blocks the exit it re-plans. Every decision goes through a deterministic gate, plain code, not a model." |
| 1:40-2:05 | Casualty kg slider to 95, Restart, Play | "Now a 95 kg casualty. The estimate said 89, but the load sensor reads 95 after the lift, over the 90 kg limit. The unit sets the person down safely and calls the human team. It refuses what it cannot do." |
| 2:05-2:30 | Tick off **Safety gate ON** (seed 10, 75 kg), Restart. Read the banner violations | "Same rescue with the gate off. It delivers the person, but it carries them uncovered, dozens of seconds of broken safety rules. The gate costs speed, and buys safety." |
| 2:30-2:50 | Water tab (seed 1). Point at the energy bar | "In the flood, the unit has patrolled two hours and its battery is low. It harvests a little energy from flowing water at a safe spot, never near the casualty, then tows them to shore. Harvest is a range extender, and the numbers are assumptions." |
| 2:50-3:00 | Results page | "Over 100 randomised runs per scenario: zero safety violations with the gate on, every over-capacity casualty refused, failures included. Helix explains and carries out; the commander decides." |

Tips: keep the mouse slow; do one practice take; if a scene runs long, speed up to 5x for the carry only.
