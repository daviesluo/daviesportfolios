# LS-FADE out of sample: it fails (fp5)

The pre-registration is unchanged. This file records the run.

The scorer reproduced the 2023 screen first: 60 trades, +$33.7632 at 10 bps a
side and no spread. It then scored entries from 2024-01-01 through 2026-09-24
at 10 bps plus the half-spread frozen in the pre-registration. Two runs wrote
the same file.

`docs/agents/backtests/fp5/ls_fade_oos.json`, sha256
`9fb9de3d7a6f7dcbe65e88e62feafc11133fa96fb12fa24029685f42a0617f82`.

| condition | result |
|---|---|
| both later windows positive | 2024 +$7.5296, 2025–26 −$2.4603, total +$5.0693 |
| mean above the null | +$0.034721 vs null p95 +$0.2157 |
| doubled costs positive | −$24.1117 |
| at least 30 trades | 146 |
| no month above 40%, and the rest positive | 2026-08 is +$11.1918; the rest is −$6.1225 |
| more than 4% a year on $100 | 1.854% over 998 days |

The 5th percentile arm is +$14.8156 on 94 trades and the 20th is +$22.4294 on
237. Both clear the veto. The veto cannot pass a rule that fails the bar.

One metric file is missing, 2026-09-24. A signal that day would enter on
2026-09-25, which the pre-registration does not score. Input hashes: out-of-sample
metrics `62fe5f5061499d7d6c023197fe48a565f16c2ca57bdfc319b27504e6f45c2681`,
out-of-sample daily bars `93edfc40ea971c0aa5acfc26550544a834f48617d55c7dfea0347a2511168759`,
screen metrics `94e0e0b605986769a0bde0ad4ecec585498871e06693b215f7013554e625310b`,
screen daily bars `11052871e94e2e0f308af12ddd904849117ca070b49e6e67584f285dcc014f1e`.

The rule is discarded. Nothing in it is retuned.
