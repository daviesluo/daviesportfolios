# Pre-registration TIRED: last start's pitch count (fp5, test TIRED)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`tired_test.py` is the rule. It does not read a bookmaker price.

## Why this is not REST

REST is a day off. TIRED buys the club whose starter threw fewer pitches in
his last start, and only when the gap is at least 15 and both of those starts
were within six days. A start older than six days does not trade. A ten-pitch
gap does not trade.

## Rule

The decision is one hour before first pitch. The fair value is how often the
side this rule would have named then won, with eight such games. The contract
is the full-time win.

## Pin

`tired_test.py --self-check` prints `HOT 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1.
