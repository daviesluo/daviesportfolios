// Demo portfolio — shown only when the real board cannot be loaded, and the
// source of the default position labels `migrate()` restores. Positions map
// to football roles; each holding has ticker + shares + avg cost. The share
// counts and costs are FICTIONAL round numbers (ten shares, cost at 80 % of
// the listed price), not anyone's holdings: this file ships inside the
// public bundle.
export const INITIAL_PORTFOLIO = {
  positions: {
    GK:   { label: "GK",  subtitle: "Cash",          role: "GK",  tickers: ["CASH"] },
    CB1:  { label: "CB",  subtitle: "",              role: "DEF", tickers: [] },
    CB2:  { label: "CB",  subtitle: "BRK.B",          role: "DEF", tickers: ["BRK-B"] },
    LB:   { label: "LB",  subtitle: "Entertainment", role: "DEF", tickers: ["NFLX"] },
    RB:   { label: "RB",  subtitle: "Finance",       role: "DEF", tickers: ["BX"] },
    CDM:  { label: "CDM", subtitle: "Electric Power",role: "MID", tickers: ["CEG", "VST"] },
    CM:   { label: "CM",  subtitle: "BIG 7",         role: "MID", tickers: ["NVDA","GOOG","META","AAPL","MSFT","AMZN","TSLA"] },
    CAM:  { label: "CM",  subtitle: "AI Infra",      role: "MID", tickers: ["AVGO","TEM","TSM","SOUN","NVTS","MU","UBER","NET","ANET","VRT"] },
    LW:   { label: "LW",  subtitle: "BTC",           role: "FWD", tickers: ["MSTR","BTC-USD","HOOD","BMNR"] },
    ST:   { label: "ST",  subtitle: "Neocloud",      role: "FWD", tickers: ["APLD","NBIS","ORCL","CRWV","IREN"] },
    RW:   { label: "RW",  subtitle: "Space",         role: "FWD", tickers: ["SPAX.PVT","RKLB","SATS"] },
  },
  holdings: {
    "CASH":     { shares: 1,    cost: 0,        lastPrice: 0,        dayPct: 0,      prevClose: 0, isCash: true },
    "BRK-B":    { shares: 10,   cost: 375.94,   lastPrice: 469.92,   dayPct: -0.01,  prevClose: 469.99 },
    "NVDA":     { shares: 10,   cost: 161.30,   lastPrice: 201.63,   dayPct: -0.20,  prevClose: 202.03 },
    "AVGO":     { shares: 10,   cost: 322.39,   lastPrice: 402.99,   dayPct: +0.84,  prevClose: 399.64 },
    "APLD":     { shares: 10,   cost: 25.78,    lastPrice: 32.22,    dayPct: +0.14,  prevClose: 32.18 },
    "NBIS":     { shares: 10,   cost: 129.14,   lastPrice: 161.42,   dayPct: +1.42,  prevClose: 159.16 },
    "GOOG":     { shares: 10,   cost: 268.17,   lastPrice: 335.21,   dayPct: -0.06,  prevClose: 335.41 },
    "SPAX.PVT": { shares: 10,   cost: 488.54,   lastPrice: 610.67,   dayPct: 0.00,   prevClose: 610.66 },
    "ORCL":     { shares: 10,   cost: 146.70,   lastPrice: 183.37,   dayPct: +3.23,  prevClose: 177.63 },
    "META":     { shares: 10,   cost: 538.36,   lastPrice: 672.95,   dayPct: +0.30,  prevClose: 670.91 },
    "AAPL":     { shares: 10,   cost: 214.42,   lastPrice: 268.03,   dayPct: -1.83,  prevClose: 273.03 },
    "NFLX":     { shares: 10,   cost: 74.78,    lastPrice: 93.47,    dayPct: -1.43,  prevClose: 94.83 },
    "CEG":      { shares: 10,   cost: 222.66,   lastPrice: 278.32,   dayPct: -3.21,  prevClose: 287.56 },
    "MSFT":     { shares: 10,   cost: 340.63,   lastPrice: 425.79,   dayPct: +1.85,  prevClose: 418.05 },
    "MSTR":     { shares: 10,   cost: 136.08,   lastPrice: 170.10,   dayPct: -0.42,  prevClose: 170.82 },
    "AMZN":     { shares: 10,   cost: 202.06,   lastPrice: 252.57,   dayPct: +1.75,  prevClose: 248.23 },
    "BX":       { shares: 10,   cost: 104.70,   lastPrice: 130.87,   dayPct: +1.46,  prevClose: 128.99 },
    "RKLB":     { shares: 10,   cost: 71.68,    lastPrice: 89.60,    dayPct: +0.16,  prevClose: 89.46 },
    "SATS":     { shares: 10,   cost: 104.27,   lastPrice: 130.34,   dayPct: -3.53,  prevClose: 135.11 },
    "BTC-USD":  { shares: 0.1,  cost: 60742.41, lastPrice: 75928.01, dayPct: +0.24,  prevClose: 75746.90 },
    "CRWV":     { shares: 10,   cost: 94.24,    lastPrice: 117.80,   dayPct: +0.32,  prevClose: 117.43 },
    "TEM":      { shares: 10,   cost: 44.85,    lastPrice: 56.06,    dayPct: -1.27,  prevClose: 56.78 },
    "HOOD":     { shares: 10,   cost: 70.59,    lastPrice: 88.24,    dayPct: -3.33,  prevClose: 91.28 },
    "TSM":      { shares: 10,   cost: 294.75,   lastPrice: 368.44,   dayPct: +0.60,  prevClose: 366.24 },
    "SOUN":     { shares: 10,   cost: 6.47,     lastPrice: 8.09,     dayPct: -2.78,  prevClose: 8.32 },
    "NVTS":     { shares: 10,   cost: 12.78,    lastPrice: 15.98,    dayPct: +21.06, prevClose: 13.20 },
    "MU":       { shares: 10,   cost: 356.34,   lastPrice: 445.42,   dayPct: -0.68,  prevClose: 448.47 },
    "UBER":     { shares: 10,   cost: 62.10,    lastPrice: 77.63,    dayPct: +0.18,  prevClose: 77.49 },
    "NET":      { shares: 10,   cost: 167.78,   lastPrice: 209.73,   dayPct: +2.40,  prevClose: 204.81 },
    "IREN":     { shares: 10,   cost: 37.56,    lastPrice: 46.95,    dayPct: -3.63,  prevClose: 48.72 },
    "ANET":     { shares: 10,   cost: 138.03,   lastPrice: 172.54,   dayPct: +3.41,  prevClose: 166.85 },
    "TSLA":     { shares: 10,   cost: 313.76,   lastPrice: 392.20,   dayPct: -0.08,  prevClose: 392.51 },
    "BMNR":     { shares: 10,   cost: 18.07,    lastPrice: 22.59,    dayPct: +0.27,  prevClose: 22.53 },
    "VRT":      { shares: 10,   cost: 254.94,   lastPrice: 318.67,   dayPct: +1.36,  prevClose: 314.40 },
    "VST":      { shares: 10,   cost: 124.09,   lastPrice: 155.11,   dayPct: -2.81,  prevClose: 159.59 },
  },
};

