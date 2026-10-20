"""GROKPM zero-trades study (2026-10-20), step 2: every candidate whose journal entry states the agent's p against the market.

Run from the repository root:  python3 -I docs/agents/backtests/grokpm_zero/scripts/near_misses.py

The table below is copied by hand from the agent's own full-scan decisions (`grokpm_decisions.reason`, quoted in the review,
its SQL in §8), one row per candidate where a p and a market price are both stated; a range is taken at its middle. The side
is the one the agent's p favours. Outcomes are Gamma's (public-search, read 2026-10-20 16:2x UTC): 1 or 0 where the market
has closed, "1*" / "0*" where it trades at 0.988 / 0.004 or beyond on a count that is all but final (Alberta's official count
is due 29 Oct), None where it is still open.

The gap is p minus the mid of the side bought, the server's D3 measure for a bid resting at or under the mid. Sizing is the
server's: a quarter Kelly of $100 at the mid, capped at $10. A post-only bid one tick under the mid is assumed filled when
the public price series trades at or under it within three days (checked keylessly for the four rows that clear an 8-point
bar; all four did, the losers within 9 to 84 minutes). Maker fees are 0.
"""

ROWS = [
    # (decision, market, side, p_yes, mid_yes, thin, outcome_yes)
    ("10-17 04:16", "China Q3 GDP 4.3-4.6 %", "YES", 0.775, 0.735, False, 1),
    ("10-17 04:16", "Vancouver mayor: Fry", "NO", 0.535, 0.59, False, 1),
    ("10-17 04:16", "Serbia PM: Vucic", "YES", 0.70, 0.665, False, None),
    ("10-17 08:14", "Vancouver mayor: Sim", "YES", 0.48, 0.415, False, 0),
    ("10-17 08:14", "Israel election as scheduled", "YES", 0.95, 0.885, False, None),
    ("10-17 12:11", "Alberta Remain margin 20-40", "YES", 0.295, 0.195, False, "0*"),
    ("10-17 12:11", "Alberta Remain margin 40-60", "YES", 0.60, 0.545, False, "1*"),
    ("10-17 12:11", "Street Fighter weekend 30-35 M", "NO", 0.475, 0.576, False, 1),
    ("10-17 12:11", "Street Fighter weekend 27-30 M", "YES", 0.40, 0.315, False, 0),
    ("10-17 12:11", "Sense and Sensibility weekend 5-6 M", "YES", 0.20, 0.09, True, 0),
    ("10-18 08:24", "GitHub longest critical incident 3-6 h", "YES", 0.74, 0.69, False, None),
    ("10-19 00:16", "Biggest earthquake 18 Oct under 5.3 (A)", "YES", 0.94, 0.90, True, 1),
    ("10-19 08:18", "Tocantins governor: Dorinha", "YES", 0.30, 0.225, False, None),
    ("10-19 08:18", "Rio Grande do Norte governor: Allyson", "YES", 0.62, 0.535, False, None),
    ("10-19 20:09", "Martin mayor: Uhercik", "YES", 0.475, 0.44, False, None),
    ("10-19 20:09", "Pickering mayor: Ashe", "YES", 0.80, 0.73, False, None),
    ("10-20 00:11", "Wildwood Rotten Tomatoes >= 96", "NO", 0.725, 0.88, True, None),
    ("10-20 08:19", "Alberta: Leave wins any division", "NO", 0.425, 0.57, True, None),
    ("10-20 12:12", "UMich October final 46.0-48.9", "YES", 0.55, 0.475, False, None),
]
BARS = [(12, "B 12 (frozen)"), (10, "B 10"), (8, "B 8")]


def main():
    print("decision     | market                                   | side | p     | mid   | gap  | thin | outcome | clears")
    resolved = []
    for d, name, side, p, m, thin, y in ROWS:
        ps, ms = (p, m) if side == "YES" else (1 - p, 1 - m)
        gap = round(100 * (ps - ms), 1)
        clears = [label for b, label in BARS if gap >= b - 1e-9 and not thin]
        yy = None if y is None else int(str(y)[0])
        print(f"{d} | {name:<40} | {side:<4} | {ps:.3f} | {ms:.3f} | {gap:>4} | {'thin' if thin else '    '} | {str(y):<7} | {', '.join(clears) or '-'}")
        if yy is not None:
            resolved.append((name, p, m, yy, side, ps, ms, thin, gap))
    n = len(resolved)
    ba = sum((p - y) ** 2 for _, p, _, y, *_ in resolved) / n
    bm = sum((m - y) ** 2 for _, _, m, y, *_ in resolved) / n
    right = sum(1 for _, _, _, y, side, *_ in resolved if (y == 1) == (side == "YES"))
    print(f"\nresolved ({n}): the agent's side won {right} of {n}; Brier, agent {ba:.4f} against market {bm:.4f} (lower is better)")
    for b, label in BARS + [(5, "B 5")]:
        pnl, k = 0.0, 0
        for name, p, m, y, side, ps, ms, thin, gap in resolved:
            if thin or gap < b - 1e-9:
                continue
            cost = min(10.0, 0.25 * (ps - ms) / (1 - ms) * 100)
            win = (y == 1) == (side == "YES")
            pnl += cost * (1 / ms - 1) if win else -cost
            k += 1
        print(f"  {label:<14} resolved trades {k}, P&L at a quarter Kelly of $100: {pnl:+.2f}")


if __name__ == "__main__":
    main()
