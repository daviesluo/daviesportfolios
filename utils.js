// Utilities: price fetch, formatting, formation detection, position coords.

window.Utils = (function () {

  // -------- Formatting --------
  const fmtMoney = (n, opts = {}) => {
    if (n == null || isNaN(n)) return "—";
    const sign = opts.signed && n > 0 ? "+" : "";
    const abs = Math.abs(n);
    if (abs >= 1e9) return sign + "$" + (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + "$" + (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return sign + "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return sign + "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtPct = (n) => {
    if (n == null || isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + n.toFixed(2) + "%";
  };
  const fmtPrice = (n) => {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 10) return n.toFixed(2);
    return n.toFixed(2);
  };
  const pctColor = (n) => {
    if (n == null || isNaN(n) || Math.abs(n) < 0.005) return "var(--chalk-dim)";
    return n >= 0 ? "var(--gain)" : "var(--loss)";
  };

  // -------- London time + US market phase --------
  // Returns { hh, mm, ss } of Europe/London right now.
  function londonTimeParts(now = new Date()) {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const parts = {};
    for (const p of fmt.formatToParts(now)) {
      if (p.type === "hour")   parts.hh = p.value;
      if (p.type === "minute") parts.mm = p.value;
      if (p.type === "second") parts.ss = p.value;
    }
    return parts;
  }

  // US market phase, based on NY local time.
  // RTH: 09:30–16:00, Premarket: 04:00–09:30, Afterhours: 16:00–20:00, Overnight: 20:00–04:00.
  // Weekends → overnight.
  function usMarketPhase(now = new Date()) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
    });
    let hh = 0, mm = 0, wd = "Mon";
    for (const p of fmt.formatToParts(now)) {
      if (p.type === "hour")    hh = parseInt(p.value, 10) % 24;
      if (p.type === "minute")  mm = parseInt(p.value, 10);
      if (p.type === "weekday") wd = p.value;
    }
    const mins = hh * 60 + mm;
    if (wd === "Sat" || wd === "Sun") return "overnight";
    if (mins >= 570 && mins < 960) return "regular";      // 9:30–16:00
    if (mins >= 240 && mins < 570) return "premarket";    // 4:00–9:30
    if (mins >= 960 && mins < 1200) return "afterhours";  // 16:00–20:00
    return "overnight";                                     // 20:00–4:00
  }

  // e.g. 1m 24s / 12s / 1h 03m
  function formatAgo(ms) {
    if (ms == null || ms < 0) return "—";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), rs = s % 60;
    if (m < 60) return `${m}m ${String(rs).padStart(2, "0")}s`;
    const h = Math.floor(m / 60), rm = m % 60;
    return `${h}h ${String(rm).padStart(2, "0")}m`;
  }

  // -------- Portfolio math --------
  const computeMetrics = (portfolio) => {
    let marketValue = 0, totalCost = 0, dayChange = 0;
    const positionsOut = {};
    for (const [posKey, pos] of Object.entries(portfolio.positions)) {
      let posMV = 0, posPrev = 0, posCost = 0;
      const players = [];
      for (const t of pos.tickers) {
        const h = portfolio.holdings[t];
        if (!h) continue;
        // Cash entries: MV = lastPrice (held as dollar amount); no P/L, no day change.
        const isCash = !!h.isCash;
        const mv = isCash ? h.lastPrice : h.shares * h.lastPrice;
        const prevMV = isCash ? mv : h.shares * (h.prevClose ?? h.lastPrice);
        const cost = isCash ? mv : h.shares * h.cost;
        posMV += mv; posPrev += prevMV; posCost += cost;
        players.push({ ticker: t, ...h, marketValue: mv });
      }
      marketValue += posMV; totalCost += posCost;
      const dayDelta = posMV - posPrev;
      dayChange += dayDelta;
      positionsOut[posKey] = {
        ...pos,
        marketValue: posMV,
        dayChange: dayDelta,
        dayPct: posPrev > 0 ? (dayDelta / posPrev) * 100 : 0,
        unrlGL: posMV - posCost,
        unrlPct: posCost > 0 ? ((posMV - posCost) / posCost) * 100 : 0,
        players,
      };
    }
    return {
      marketValue,
      totalCost,
      dayChange,
      dayPct: (marketValue - dayChange) > 0 ? (dayChange / (marketValue - dayChange)) * 100 : 0,
      unrlGL: marketValue - totalCost,
      unrlPct: totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
      tickerCount: Object.keys(portfolio.holdings).filter(t => t !== "CASH" && !(portfolio.holdings[t] && portfolio.holdings[t].isCash)).length,
      positions: positionsOut,
    };
  };

  // -------- Formation detection --------
  const detectFormation = (portfolio) => {
    const counts = { DEF: 0, MID: 0, FWD: 0 };
    for (const pos of Object.values(portfolio.positions)) {
      if (pos.role !== "GK") {
        counts[pos.role] = (counts[pos.role] || 0) + 1;
      }
    }
    return `${counts.DEF}-${counts.MID}-${counts.FWD}`;
  };

  // -------- Live price fetch --------
  // Yahoo v8 chart endpoint via multiple CORS proxies. The v7 quote endpoint
  // is no longer public; v8 chart is still open and returns live prices.
  const PROXIES = [
    (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://cors.eu.org/${url}`,
  ];

  async function fetchOneYahooChart(symbol) {
    // v8 chart gives us current price + previousClose.
    // Add a nonce to defeat any aggressive proxy caches.
    const nonce = Date.now();
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false&_=${nonce}`;
    for (const makeProxy of PROXIES) {
      try {
        const res = await fetch(makeProxy(yahooUrl), { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        const meta = result?.meta;
        if (!meta) continue;
        const lastPrice = meta.regularMarketPrice;
        if (lastPrice == null) continue;
        // Best source of "real" previous close = last non-today daily close from the time series,
        // which reflects splits/dividends that meta.previousClose can lag.
        let prevClose = null;
        const ts = result.timestamp || [];
        const closes = result?.indicators?.quote?.[0]?.close || [];
        // Walk backwards, skip today's (last) bar, find the most recent non-null close.
        for (let i = closes.length - 2; i >= 0; i--) {
          if (closes[i] != null) { prevClose = closes[i]; break; }
        }
        // Fallbacks
        if (prevClose == null) prevClose = meta.chartPreviousClose ?? meta.previousClose ?? lastPrice;
        return {
          lastPrice,
          prevClose,
          dayPct: prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0,
        };
      } catch (e) { /* try next proxy */ }
    }
    return null;
  }

  async function fetchYahoo(tickers) {
    const liveTickers = tickers.filter(t => !t.endsWith(".PVT") && t !== "CASH");
    if (!liveTickers.length) return {};
    // Fire all in parallel to cut round-trip time
    const results = await Promise.all(liveTickers.map(async (t) => [t, await fetchOneYahooChart(t)]));
    const out = {};
    let anySuccess = false;
    for (const [t, r] of results) {
      if (r) { out[t] = r; anySuccess = true; }
    }
    return anySuccess ? out : null;
  }

  // Gentle random walk fallback
  function simulateTicks(holdings) {
    const out = {};
    for (const [t, h] of Object.entries(holdings)) {
      const vol = t === "BTC-USD" ? 0.003 : 0.0015;
      const drift = (Math.random() - 0.5) * 2 * vol;
      const newPrice = Math.max(0.01, h.lastPrice * (1 + drift));
      const prev = h.prevClose ?? h.lastPrice;
      out[t] = {
        lastPrice: newPrice,
        prevClose: prev,
        dayPct: ((newPrice - prev) / prev) * 100,
      };
    }
    return out;
  }

  async function refreshPrices(portfolio, mode = "live") {
    const tickers = Object.keys(portfolio.holdings);
    const result = await fetchYahoo(tickers);
    if (!result || Object.keys(result).length === 0) {
      // No live data — surface failure so caller can retry; no sim.
      return { updates: {}, source: "error" };
    }
    return { updates: result, source: "live" };
  }

  // -------- Position coordinates on 100x100 pitch (home team attacks UP; GK at bottom) --------
  const POSITION_COORDS = {
    GK:  { x: 50, y: 91 },
    CB1: { x: 36, y: 76 },
    CB2: { x: 64, y: 76 },
    LB:  { x: 15, y: 70 },
    RB:  { x: 85, y: 70 },
    CDM: { x: 50, y: 58 },
    CM:  { x: 30, y: 44 },
    CAM: { x: 70, y: 44 },
    LW:  { x: 15, y: 22 },
    ST:  { x: 50, y: 15 },
    RW:  { x: 85, y: 22 },
  };

  return {
    fmtMoney, fmtPct, fmtPrice, pctColor,
    londonTimeParts, usMarketPhase, formatAgo,
    computeMetrics, detectFormation,
    refreshPrices, POSITION_COORDS,
  };
})();
