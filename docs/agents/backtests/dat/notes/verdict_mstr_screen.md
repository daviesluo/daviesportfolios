# MSTR screen verdict, written down before BMNR or any 2025-2026 event was looked at

Written 2026-10-01 04:23:01 UTC. design.md sha256 4b298c90bdecc88e3e01a16462a3f13f584d74d8ad8811dc3da1abfe77ad4276.
results/screen.json sha256 70c0d6034543c618c34f070243cc1f0ee5d4ec8ebcb025a4021000d7064de02f.
results/power.json sha256 d15dddf2a8a750192c3f0fb5e2bb3989eba1c10a4292a6d6b0483fecd4dc097e.

No candidate survives design.md §4:
1. H1 fails: bias-corrected slopes +0.022 (20 d) and +0.205 (60 d) on log mNAV simple, bootstrap p 0.51 and 0.78; on
   the EV measure -0.021 and +0.080, p 0.36 and 0.53. Holm: neither clears. Same with the press-release lag and from 2021.
2. H2 fails: the switch loses to its own static mix (-13.3 % a year at 30 bps, t -0.81); timing skill -17.0 bp a day
   (t -0.65). H3 fails: -5.8 % a year per unit notional with close-outs (t -0.42), -17.2 % without (t -0.83).
3. Power: the held-out test would have 0.09 power at a LARGE effect (h = 20 and 60); 0.8 needs about 20 years forward.

So no pre-registration is drafted (design.md §8 item 6), and the BMNR and event work that follows may describe
returns after a predictor without contaminating any planned test.
