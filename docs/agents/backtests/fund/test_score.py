"""Pins for FUND's scorer: the position rule, the shift, the cost, the p-value, Holm and the signals.

    python3 docs/agents/backtests/fund/test_score.py
"""

from __future__ import annotations

import sys
import unittest
from datetime import date
from fractions import Fraction
from pathlib import Path

sys.dont_write_bytecode = True  # leave no __pycache__ beside the study
sys.path.insert(0, str(Path(__file__).resolve().parent))

import score as s  # noqa: E402

H8 = 8 * 3_600_000


class PositionRule(unittest.TestCase):
    def test_one_signal_holds_two_days(self):
        self.assertEqual(s.trades_of([1, 0, 0, 0, 0]), [(0, 2)])

    def test_a_signal_while_holding_moves_the_exit(self):
        self.assertEqual(s.trades_of([1, 1, 0, 0, 0]), [(0, 3)])
        self.assertEqual(s.trades_of([1, 1, 1]), [(0, 4)])

    def test_one_quiet_day_does_not_close_the_trade(self):
        # the exit day (2) is itself a signal day, so the exit moves to 4 and nothing is sold
        self.assertEqual(s.trades_of([1, 0, 1, 0, 0, 0]), [(0, 4)])

    def test_two_quiet_days_close_it(self):
        self.assertEqual(s.trades_of([1, 0, 0, 1, 0, 0]), [(0, 2), (3, 5)])

    def test_the_last_entry_day_exits_on_the_last_open(self):
        self.assertEqual(s.trades_of([0, 0, 1]), [(2, 4)])

    def test_no_signal_no_trade(self):
        self.assertEqual(s.trades_of([0, 0, 0]), [])


class Shift(unittest.TestCase):
    def test_day_i_takes_the_signal_of_day_i_minus_k(self):
        sig = [1, 0, 0, 0, 0]
        self.assertEqual(s.rotate(sig, 1), [0, 1, 0, 0, 0])
        self.assertEqual(s.rotate(sig, 4), [0, 0, 0, 0, 1])
        self.assertEqual(s.rotate(sig, 0), sig)
        self.assertEqual(s.rotate(sig, 5), sig)

    def test_a_shift_keeps_the_count(self):
        sig = [1, 1, 0, 1, 0, 0, 0, 1]
        for k in range(len(sig)):
            self.assertEqual(sum(s.rotate(sig, k)), sum(sig))


class CostAndResult(unittest.TestCase):
    def test_net_return_charges_both_sides(self):
        got = s.net_return(100.0, 101.0, 0.00105)
        self.assertAlmostEqual(got, 101.0 * (1 - 0.00105) / (100.0 * (1 + 0.00105)) - 1, places=15)
        self.assertAlmostEqual(s.net_return(100.0, 100.0, 0.00105), -0.0020978, places=6)

    def test_s_is_dollars_on_100_a_trade_not_compounded(self):
        opens = [100.0, 110.0, 121.0, 100.0, 100.0]
        got = s.total_s([(0, 2), (2, 4)], opens, 0.0)
        self.assertAlmostEqual(got, 100.0 * ((121 / 100 - 1) + (100 / 121 - 1)), places=12)


class NullAndHolm(unittest.TestCase):
    def test_p_counts_ties_against_the_rule(self):
        self.assertEqual(s.count_ge(5.0, [1.0, 5.0, 6.0]), 2)
        self.assertEqual(s.p_value(5.0, [1.0, 5.0, 6.0]), Fraction(3, 4))

    def test_holm_first_at_0025_second_at_005(self):
        self.assertEqual(s.holm({"UZERO": Fraction(1, 100), "USOFR": Fraction(4, 100)}),
                         {"UZERO": True, "USOFR": True})
        self.assertEqual(s.holm({"UZERO": Fraction(2, 100), "USOFR": Fraction(6, 100)}),
                         {"UZERO": True, "USOFR": False})
        self.assertEqual(s.holm({"UZERO": Fraction(3, 100), "USOFR": Fraction(4, 100)}),
                         {"UZERO": False, "USOFR": False})
        self.assertEqual(s.holm({"UZERO": Fraction(25, 1000), "USOFR": Fraction(5, 100)}),
                         {"UZERO": True, "USOFR": True})

    def test_holm_ties_are_treated_alike(self):
        self.assertEqual(s.holm({"UZERO": Fraction(1, 50), "USOFR": Fraction(1, 50)}),
                         {"UZERO": True, "USOFR": True})
        self.assertEqual(s.holm({"UZERO": Fraction(3, 100), "USOFR": Fraction(3, 100)}),
                         {"UZERO": False, "USOFR": False})

    def test_percentile_rule(self):
        vals = [float(x) for x in range(1, 11)]
        self.assertEqual(s.percentile(vals, 0.5), 5.0)
        self.assertEqual(s.percentile(vals, 0.95), 9.0)


class Signals(unittest.TestCase):
    D = s.ms(date(2024, 3, 11))

    def test_latest_is_strictly_before(self):
        self.assertEqual(s.latest([10, 20, 30], 20), 0)
        self.assertEqual(s.latest([10, 20, 30], 21), 1)
        self.assertIsNone(s.latest([10, 20, 30], 10))

    def test_the_settlement_stamped_just_after_the_open_is_not_used(self):
        fund = ([self.D - H8 + 3, self.D + 2], [-0.0001, 0.0005])
        self.assertTrue(s.signal_on("UZERO", self.D, fund, ([], [])))

    def test_uzero_is_strictly_below_zero(self):
        self.assertTrue(s.signal_on("UZERO", self.D, ([self.D - H8], [-0.00000001]), ([], [])))
        self.assertFalse(s.signal_on("UZERO", self.D, ([self.D - H8], [0.0]), ([], [])))

    def test_usofr_compares_with_the_eight_hour_carry(self):
        sofr = ([self.D - 11 * 3_600_000], ["5.00"])  # 5 % a year: 0.0000463 for eight hours
        self.assertTrue(s.signal_on("USOFR", self.D, ([self.D - H8], [0.0]), sofr))
        self.assertTrue(s.signal_on("USOFR", self.D, ([self.D - H8], [0.000046]), sofr))
        self.assertFalse(s.signal_on("USOFR", self.D, ([self.D - H8], [0.00005]), sofr))
        self.assertAlmostEqual(s.sofr_eight("5.00"), 0.05 / 3 / 360, places=18)

    def test_a_friday_print_is_not_available_on_monday_at_midnight(self):
        pubs, pcts = s.pair_sofr([["2024-03-08", "5.31"], ["2024-03-11", "5.32"], ["2024-03-12", "5.33"]])
        self.assertEqual(pubs[0], s.ms(date(2024, 3, 11)) + 13 * 3_600_000)
        self.assertEqual(pcts, ["5.31", "5.32"])
        self.assertIsNone(s.latest(pubs, s.ms(date(2024, 3, 11))))
        self.assertEqual(s.latest(pubs, s.ms(date(2024, 3, 12))), 0)


if __name__ == "__main__":
    unittest.main()
