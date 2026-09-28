
**windows A–C** — 97.5 % bootstrap upper bound of the mean chase, bps (misses in brackets); max per row; the constant it implies

| side | T | cell | BTC | ETH | SOL | max over coins | → C* |
|---|---|---|---|---|---|---|---|
| entries (buy) | 15 | trend-4h | 34.82 (9) | 41.29 (2) | 109.97 (4) | 109.97 | 110 |
| entries (buy) | 15 | trend-1h | 49.35 (20) | 51.50 (9) | 72.72 (6) | 72.72 | 80 |
| entries (buy) | 15 | both rules, one event per minute (MX-1 unit) | 46.47 (25) | 49.13 (11) | 80.36 (10) | 80.36 | 90 |
| entries (buy) | 60 | trend-4h | 23.94 (1) | 123.59 (2) | 207.79 (2) | 207.79 | 210 |
| entries (buy) | 60 | trend-1h | 81.25 (11) | 97.55 (3) | 88.73 (2) | 97.55 | 100 |
| entries (buy) | 60 | both rules, one event per minute (MX-1 unit) | 79.18 (11) | 107.55 (5) | 178.03 (4) | 178.03 | 180 |
| exits (sell) | 60 | trend-4h | 32.04 (4) | 29.37 (1) | 89.35 (2) | 89.35 | 90 |
| exits (sell) | 60 | trend-1h | 63.67 (7) | 95.91 (5) | 58.38 (2) | 95.91 | 100 |
| exits (sell) | 60 | both rules, one event per minute (MX-1 unit) | 50.27 (11) | 84.92 (6) | 77.93 (4) | 84.92 | 90 |
| exits (sell) | 15 | trend-4h | 36.65 (5) | 18.31 (5) | 58.02 (3) | 58.02 | 60 |
| exits (sell) | 15 | trend-1h | 35.94 (12) | 75.77 (7) | 27.53 (6) | 75.77 | 80 |
| exits (sell) | 15 | both rules, one event per minute (MX-1 unit) | 31.82 (17) | 52.51 (12) | 38.45 (9) | 52.51 | 60 |


**windows A–D (D is outside the preferred span)** — 97.5 % bootstrap upper bound of the mean chase, bps (misses in brackets); max per row; the constant it implies

| side | T | cell | BTC | ETH | SOL | max over coins | → C* |
|---|---|---|---|---|---|---|---|
| entries (buy) | 15 | trend-4h | 34.67 (10) | 36.56 (4) | 109.97 (4) | 109.97 | 110 |
| entries (buy) | 15 | trend-1h | 52.08 (22) | 53.84 (17) | 68.50 (7) | 68.50 | 70 |
| entries (buy) | 15 | both rules, one event per minute (MX-1 unit) | 47.92 (28) | 48.98 (21) | 75.86 (11) | 75.86 | 80 |
| entries (buy) | 60 | trend-4h | 23.94 (1) | 123.59 (3) | 207.79 (2) | 207.79 | 210 |
| entries (buy) | 60 | trend-1h | 90.81 (12) | 151.62 (9) | 88.73 (2) | 151.62 | 160 |
| entries (buy) | 60 | both rules, one event per minute (MX-1 unit) | 89.82 (12) | 138.37 (12) | 178.03 (4) | 178.03 | 180 |
| exits (sell) | 60 | trend-4h | 29.10 (5) | 29.37 (2) | 89.35 (2) | 89.35 | 90 |
| exits (sell) | 60 | trend-1h | 195.47 (9) | 84.91 (6) | 58.38 (2) | 195.47 | 200 |
| exits (sell) | 60 | both rules, one event per minute (MX-1 unit) | 135.34 (14) | 72.78 (8) | 77.93 (4) | 135.34 | 140 |
| exits (sell) | 15 | trend-4h | 32.28 (6) | 24.44 (6) | 58.02 (3) | 58.02 | 60 |
| exits (sell) | 15 | trend-1h | 67.94 (15) | 64.60 (9) | 37.00 (7) | 67.94 | 70 |
| exits (sell) | 15 | both rules, one event per minute (MX-1 unit) | 54.02 (21) | 47.39 (15) | 41.86 (10) | 54.02 | 60 |


**Break-even miss rate s/(s + C*) with s = 11 bps, against the miss rates measured at the decision minutes (windows A–C, MX-1 unit)**

| C* | break-even miss rate |
|---|---|
| 60 | 15.49 % |
| 80 | 12.09 % |
| 90 | 10.89 % |
| 100 | 9.91 % |
| 110 | 9.09 % |
| 140 | 7.28 % |
| 180 | 5.76 % |
| 200 | 5.21 % |

| side | T | pooled | BTC | ETH | SOL |
|---|---|---|---|---|---|
| entries | 15 | 11.2 % (46/412) | 15.7 % (25/159) | 8.5 % (11/130) | 8.1 % (10/123) |
| entries | 60 | 4.9 % (20/412) | 6.9 % (11/159) | 3.8 % (5/130) | 3.3 % (4/123) |
| exits | 15 | 9.1 % (38/419) | 10.2 % (17/167) | 9.1 % (12/132) | 7.5 % (9/120) |
| exits | 60 | 5.0 % (21/419) | 6.6 % (11/167) | 4.5 % (6/132) | 3.3 % (4/120) |
