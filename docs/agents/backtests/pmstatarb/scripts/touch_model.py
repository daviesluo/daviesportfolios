"""Driftless one-touch probability for TOUCH-CAL.

The contract pays 1 at settlement if the barrier is touched, else 0. With
r = q = 0 the price is the touch probability. Log-drift is −σ²/2.

Continuous barrier: the Brownian hitting formula. Discrete 1-minute candles:
the same formula on a Broadie–Glasserman–Kou shifted barrier
(β = 0.5826). The study's verdict uses the shifted figure; both are returned.

This is spot, vol and time left until the settlement end. It does not look at
whether the barrier was touched earlier. A non-positive distance (spot already
through the barrier) returns 1, because the path is on the barrier now.

usage: python3 -I docs/agents/backtests/pmstatarb/scripts/touch_model.py
"""
import math

BETA = 0.5826
# Vol is annualised on a 365-day year (stdev of daily log closes × √365).
YEAR_MINUTES = 365 * 24 * 60
MINUTE = 1.0 / YEAR_MINUTES


def _phi(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _hit_upper(distance, nu, sigma, years):
    """P(a Brownian motion with drift nu hits +distance > 0 by years)."""
    if distance <= 0:
        return 1.0
    if years <= 0 or sigma <= 0:
        return 0.0
    s = sigma * math.sqrt(years)
    expo = math.exp(2.0 * nu * distance / (sigma * sigma))
    p = _phi((nu * years - distance) / s) + expo * _phi((-nu * years - distance) / s)
    if p < 0.0:
        return 0.0
    if p > 1.0:
        return 1.0
    return p


def one_touch(spot, barrier, sigma, years, side, discrete=False, beta=BETA, dt=MINUTE):
    """side is 'up' or 'down'. sigma is annualised. years is time left.

    Returns the touch probability, or None when the inputs are not a price.
    """
    if spot <= 0 or barrier <= 0 or sigma < 0 or years < 0:
        return None
    # Down is the reflected process, so its drift sign flips. Leaving both
    # on ν = −σ²/2 makes an equal log-distance up and down the same price.
    if side == "up":
        distance = math.log(barrier / spot)
        nu = -0.5 * sigma * sigma
    elif side == "down":
        distance = math.log(spot / barrier)
        nu = 0.5 * sigma * sigma
    else:
        raise ValueError(side)
    if discrete and distance > 0 and sigma > 0:
        distance += beta * sigma * math.sqrt(dt)
    return _hit_upper(distance, nu, sigma, years)


def self_test():
    # Infinite-horizon upper touch under this drift is spot/barrier.
    # The normal terms only die once |ν|√T/σ is large, so the horizon is long.
    far = one_touch(100.0, 125.0, 0.50, 2000.0, "up")
    assert abs(far - 100.0 / 125.0) < 1e-6, far
    # A lower barrier is hit almost surely over a long horizon (drift pulls down).
    down_far = one_touch(100.0, 80.0, 0.50, 500.0, "down")
    assert down_far > 0.999, down_far
    # Same log-distance: the downward one is the likelier, because log-drift is negative.
    up_week = one_touch(100.0, 125.0, 0.50, 7.0 / 365.0, "up")
    down_week = one_touch(100.0, 80.0, 0.50, 7.0 / 365.0, "down")
    assert down_week > up_week, (down_week, up_week)
    # Already through.
    assert one_touch(110.0, 100.0, 0.50, 1.0, "up") == 1.0
    assert one_touch(90.0, 100.0, 0.50, 1.0, "down") == 1.0
    # Discrete monitoring is the continuous formula on a farther barrier.
    spot, barrier, sigma, years = 100.0, 110.0, 0.60, 2.0 / 365.0
    cont = one_touch(spot, barrier, sigma, years, "up", discrete=False)
    disc = one_touch(spot, barrier, sigma, years, "up", discrete=True)
    assert 0.0 < disc < cont < 1.0, (disc, cont)
    # Monte Carlo of the continuous barrier, minute steps, one day.
    import numpy as np
    rng = np.random.default_rng(20261014)
    s0, h, sig, t_minutes = 100.0, 105.0, 0.80, 24 * 60
    nu = -0.5 * sig * sig
    z = rng.standard_normal((8000, t_minutes))
    log_step = nu * MINUTE + sig * math.sqrt(MINUTE) * z
    path = np.cumsum(log_step, axis=1)
    hit = (path.max(axis=1) >= math.log(h / s0)).mean()
    closed = one_touch(s0, h, sig, t_minutes * MINUTE, "up")
    # 8,000 paths: three standard errors is about 1.5 points here.
    assert abs(hit - closed) < 0.02, (hit, closed)
    print(
        f"touch_model self-test ok "
        f"mc {hit:.4f} closed {closed:.4f} "
        f"shift {disc:.4f} < {cont:.4f}")


if __name__ == "__main__":
    self_test()
