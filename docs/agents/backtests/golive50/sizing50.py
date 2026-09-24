"""S2(c) — trend-4h-live at $50: four $12.50 slots against Revolut X's public pair rules, the book, the fee and the caps.

Reads only the committed public snapshot in inputs/ (pulled keylessly 2026-09-24 00:12 UTC by pull_public.py) and
mirrors the loop's own arithmetic: `sizeBase` (floor to base_step, both minimums), `ceilToStep` for a marketable buy's
limit, the 10 bps entry / 50 bps exit allowance (tick.ts MARKETABLE_*_SLIP_BPS), 9 bps taker, the 8 % floor, and
`slotUsdOf` = capital / coins. Writes sizing50.json. usage: python3 sizing50.py
"""
import gzip, json, math, os
from decimal import Decimal, ROUND_FLOOR, ROUND_CEILING

HERE = os.path.dirname(os.path.abspath(__file__))
IN = os.path.join(HERE, "inputs")
load = lambda n: json.load(gzip.open(os.path.join(IN, n + ".json.gz"), "rt"))
pairs = load("revx_pairs")["pairs"]
tick = {t["symbol"]: t for t in load("revx_tickers")["tickers"]["data"]}
books = load("revx_books")["books"]
meta = load("revx_pairs")["meta"]

CAPITAL, COINS = 50.0, ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD"]
SLOT = CAPITAL / len(COINS)                 # slotUsdOf
TAKER, FLOOR = 0.0009, 0.08
ENTRY_SLIP, EXIT_SLIP = 0.0010, 0.0050      # tick.ts MARKETABLE_ENTRY_SLIP_BPS / MARKETABLE_EXIT_SLIP_BPS
ORDER_SLOT_TOLERANCE = 1.1


def floor_step(x, step):
    s = Decimal(step)
    return (Decimal(repr(x)) / s).to_integral_value(rounding=ROUND_FLOOR) * s


def ceil_step(x, step):
    s = Decimal(step)
    return (Decimal(repr(x)) / s).to_integral_value(rounding=ROUND_CEILING) * s


out = {"pulledAt": meta["pulled_at"], "capitalUsd": CAPITAL, "slotUsd": SLOT, "perOrderLimitUsd": round(SLOT * ORDER_SLOT_TOLERANCE, 4), "coins": {}}
tot_rt = 0.0
for sym in COINS:
    cfg = pairs[sym]
    t = tick[sym]
    bid, ask = float(t["bid"]), float(t["ask"])
    mid = (bid + ask) / 2
    spread_bps = (ask - bid) / mid * 1e4
    ob = books[sym.replace("/", "-")]["book"]["data"]
    ask_usd_at_touch = float(ob["asks"][0]["price"]) * float(ob["asks"][0]["quantity"])
    bid_usd_at_touch = float(ob["bids"][0]["price"]) * float(ob["bids"][0]["quantity"])
    # the entry: sizeBase(slot, ask) and the IOC limit at ask × (1 + 10 bps) rounded UP to the price grid
    base = floor_step(SLOT / ask, cfg["base_step"])
    notional = float(base) * ask
    ok_min = base >= Decimal(cfg["min_order_size"]) and notional >= float(cfg["min_order_size_quote"])
    limit = ceil_step(ask * (1 + ENTRY_SLIP), cfg["quote_step"])
    tick_bps = float(cfg["quote_step"]) / mid * 1e4
    # the fee taken in the coin (D4): 9 bps of the gross base; whether it lands on the base grid is the venue's rounding
    fee_base = float(base) * TAKER
    fee_steps = fee_base / float(cfg["base_step"])
    dust_bound_usd = float(cfg["base_step"]) * mid        # the most a sell floored to base_step can leave behind
    net_base_if_fee_rounded_to_step = float(base) - float(floor_step(fee_base, cfg["base_step"])) - float(cfg["base_step"])
    # a round trip at the slot: two taker fees plus the full spread
    rt_usd = SLOT * (2 * TAKER + spread_bps / 1e4)
    tot_rt += rt_usd
    # the floor: 8 % under cost, sold at the bid with 9 bps; worst case the IOC fills at its 50 bps allowance
    floor_loss = SLOT * FLOOR + SLOT * (1 - FLOOR) * (TAKER + spread_bps / 2e4)
    floor_loss_worst = SLOT * FLOOR + SLOT * (1 - FLOOR) * (TAKER + EXIT_SLIP)
    out["coins"][sym] = {
        "pair": {k: cfg[k] for k in ("base_step", "quote_step", "min_order_size", "min_order_size_quote", "status")},
        "bid": bid, "ask": ask, "spreadBps": round(spread_bps, 2),
        "touchDepthUsd": {"ask": round(ask_usd_at_touch, 2), "bid": round(bid_usd_at_touch, 2)},
        "entry": {"base": str(base), "notionalUsd": round(notional, 6), "roundingResidueUsd": round(SLOT - notional, 6),
                  "passesVenueMinimums": ok_min, "timesTheQuoteMinimum": round(notional / float(cfg["min_order_size_quote"]), 1),
                  "iocLimit": str(limit), "priceTickBps": round(tick_bps, 3)},
        "feeInCoin": {"feeBase": f"{fee_base:.12f}", "feeInBaseSteps": round(fee_steps, 3), "feeUsd": round(fee_base * ask, 5),
                      "onTheBaseGrid": abs(fee_steps - round(fee_steps)) < 1e-9,
                      "dustBoundUsd": round(dust_bound_usd, 8),
                      "note": "if the venue reports the fee to more decimals than base_step, the net base is off the grid, the exit sells floor(net) and the book keeps < 1 step: see the review's dust finding"},
        "roundTripUsd": round(rt_usd, 5), "roundTripBps": round((2 * TAKER * 1e4 + spread_bps), 2),
        "floorLossUsd": {"atTheTouch": round(floor_loss, 4), "worstCaseAtTheExitAllowance": round(floor_loss_worst, 4)},
    }
out["book"] = {
    "roundTripAllFourUsd": round(tot_rt, 4),
    "allFourFloorsOneDayUsd": round(sum(v["floorLossUsd"]["atTheTouch"] for v in out["coins"].values()), 4),
    "allFourFloorsOneDayWorstUsd": round(sum(v["floorLossUsd"]["worstCaseAtTheExitAllowance"] for v in out["coins"].values()), 4),
    "exposureCapToAdmitOneSlot": "any value in [12.50, 25.00): the cap is marked to market (riskGate: exposure + order > cap refuses), so 15 admits one entry from flat and refuses a second unless the first has fallen 80 %, which the 8 % floor never allows",
    "exposureCapForAllFourWithRoom": round(1.5 * CAPITAL, 2),
}
json.dump(out, open(os.path.join(HERE, "sizing50.json"), "w"), indent=1, sort_keys=True)
for s, v in out["coins"].items():
    print(s, v["ask"], "spread", v["spreadBps"], "base", v["entry"]["base"], "notional", v["entry"]["notionalUsd"], "resid", v["entry"]["roundingResidueUsd"],
          "x min", v["entry"]["timesTheQuoteMinimum"], "limit", v["entry"]["iocLimit"], "tick bps", v["entry"]["priceTickBps"], "touch $", v["touchDepthUsd"],
          "fee base", v["feeInCoin"]["feeBase"], "steps", v["feeInCoin"]["feeInBaseSteps"], "dust<=$", v["feeInCoin"]["dustBoundUsd"],
          "rt $", v["roundTripUsd"], "floor $", v["floorLossUsd"])
print(out["book"])
