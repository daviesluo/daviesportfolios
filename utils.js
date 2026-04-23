// Utilities: price fetch, formatting, formation detection, position coords.

window.Utils = (function () {

  // -------- Formatting --------
  const fmtMoney = (n, opts = {}) => {
    if (n == null || isNaN(n)) return "—";
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : (opts.signed && n > 0 ? "+" : "");
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return sign + "$" + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return sign + "$" + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const computeMetrics = (portfolio, opts = {}) => {
    const ext = !!opts.extended;
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
        // In extended mode use the extended price if available; cash always uses lastPrice.
        const price = isCash ? h.lastPrice : ((ext && h.extPrice != null) ? h.extPrice : h.lastPrice);
        const pct   = (ext && h.extDayPct != null) ? h.extDayPct : (h.dayPct ?? 0);
        const mv = isCash ? h.lastPrice : h.shares * price;
        // In extended-hours mode the baseline is today's RTH close (lastPrice), not yesterday's close.
        // This makes position + scoreboard day change reflect the after-hours move since 16:00 ET.
        const baselinePrice = ext ? (h.lastPrice ?? h.prevClose ?? price) : (h.prevClose ?? price);
        const prevMV = isCash ? mv : h.shares * baselinePrice;
        const cost = isCash ? mv : h.shares * h.cost;
        posMV += mv; posPrev += prevMV; posCost += cost;
        // Override lastPrice/dayPct in the player object so modals show the right price.
        players.push({ ticker: t, ...h, marketValue: mv, lastPrice: price, dayPct: pct });
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
  // Primary path: Supabase Edge Function (server-side direct Yahoo fetch — no CORS proxy).
  // Fallback: CORS proxies for when the edge function is not yet deployed.
  const EDGE_PRICES_URL = "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/prices";
  const EDGE_ANON_KEY   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsbXZ4aWdvemp1aXpwY2tsbHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODM3MjgsImV4cCI6MjA5MjM1OTcyOH0.vFqe6PNsPbVkg7NJmQJBsVECX1S58vAvv5MOjf63Xck";

  const PROXIES = [
    (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://cors.eu.org/${url}`,
  ];

  async function fetchOneYahooChart(symbol) {
    const nonce = Date.now();
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=true&_=${nonce}`;
    for (const makeProxy of PROXIES) {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(makeProxy(yahooUrl), { cache: "no-store", signal: controller.signal });
        clearTimeout(tid);
        if (!res.ok) continue;
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        const meta = result?.meta;
        if (!meta) continue;
        const lastPrice = meta.regularMarketPrice;
        if (lastPrice == null) continue;
        const prevClose = meta.regularMarketPreviousClose ?? meta.previousClose ?? meta.chartPreviousClose ?? lastPrice;
        // Extended hours price: pre-market or after-hours (null if not available).
        const extPrice  = meta.preMarketPrice ?? meta.postMarketPrice ?? null;
        const volume    = meta.regularMarketVolume ?? null;
        const extVolume = meta.preMarketVolume ?? meta.postMarketVolume ?? null;
        return {
          lastPrice,
          extPrice,
          prevClose,
          dayPct: prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0,
          extDayPct: (extPrice != null && lastPrice > 0) ? ((extPrice - lastPrice) / lastPrice) * 100 : null,
          volume,
          extVolume,
        };
      } catch (e) {
        clearTimeout(tid);
      }
    }
    return null;
  }

  async function fetchViaEdge(liveTickers) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(
        `${EDGE_PRICES_URL}?tickers=${liveTickers.map(encodeURIComponent).join(",")}`,
        {
          headers: {
            "Authorization": `Bearer ${EDGE_ANON_KEY}`,
            "apikey": EDGE_ANON_KEY,
          },
          cache: "no-store",
          signal: controller.signal,
        }
      );
      clearTimeout(tid);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && typeof data === "object" && !data.error && Object.keys(data).length > 0) {
        return data;
      }
      return null;
    } catch (e) {
      clearTimeout(tid);
      return null;
    }
  }

  async function fetchYahoo(tickers) {
    const liveTickers = tickers.filter(t => !t.endsWith(".PVT") && t !== "CASH");
    if (!liveTickers.length) return {};

    // Race edge function (batch, fast) vs CORS proxy (per-ticker, fallback).
    // Both start immediately; whichever returns valid data first wins.
    const edgeP = fetchViaEdge(liveTickers);
    const proxyP = Promise.all(liveTickers.map(async (t) => [t, await fetchOneYahooChart(t)]))
      .then(pairs => {
        const out = {};
        for (const [t, r] of pairs) if (r) out[t] = r;
        return Object.keys(out).length > 0 ? out : null;
      });

    const result = await Promise.any(
      [edgeP, proxyP].map(p => p.then(r => {
        if (r && Object.keys(r).length > 0) return r;
        return Promise.reject(new Error("no data"));
      }))
    ).catch(() => null);

    return result;
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
      return { updates: {}, source: "error" };
    }
    return { updates: result, source: "live" };
  }

  async function fetchTickers(tickers) {
    return fetchYahoo(tickers.filter(Boolean));
  }

  // Like fetchTickers but always uses CORS proxies (skips edge function) so
  // volume fields are always populated in the result.
  async function fetchTickersWithVolume(tickers) {
    const filtered = tickers.filter(Boolean);
    if (!filtered.length) return {};
    const pairs = await Promise.all(filtered.map(async (t) => [t, await fetchOneYahooChart(t)]));
    const out = {};
    for (const [t, r] of pairs) if (r) out[t] = r;
    return out;
  }

  // -------- Position coordinates on 100x100 pitch (home team attacks UP; GK at bottom) --------
  const POSITION_COORDS = {
    GK:  { x: 50, y: 91 },
    CB1: { x: 38, y: 76 },
    CB2: { x: 62, y: 76 },
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
    refreshPrices, fetchTickers, fetchTickersWithVolume, POSITION_COORDS,
  };
})();
