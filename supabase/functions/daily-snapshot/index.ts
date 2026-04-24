// Supabase Edge Function: daily-snapshot
// Triggered by pg_cron at 21:10 UTC (4:10 PM ET) Mon–Fri.
// Fetches closing prices for all portfolio tickers, computes total value,
// and upserts a { date, value, prices } snapshot into board_data.snapshots.

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "https://flmvxigozjuizpckllvk.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DB_HEADERS = {
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function fetchClosePrice(symbol: string): Promise<number | null> {
  // 6-digit numeric → Chinese mutual fund (eastmoney 天天基金)
  if (/^\d{6}$/.test(symbol)) {
    const url = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(symbol)}.js?rt=${Date.now()}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://fund.eastmoney.com/",
          "Accept": "*/*",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const text = (await res.text()).trim();
      const m = text.match(/^jsonpgz\((.+?)\)\s*;?\s*$/s);
      if (!m) return null;
      const obj = JSON.parse(m[1]);
      // dwjz = the most recently published official daily NAV — that *is* the close.
      const dwjz = parseFloat(obj.dwjz);
      return isFinite(dwjz) && dwjz > 0 ? dwjz : null;
    } catch {
      return null;
    }
  }

  // Otherwise → Yahoo Finance daily candle
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&range=5d&_=${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json,*/*",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const px = meta?.regularMarketPrice;
    if (px == null) return null;
    // London-listed securities are quoted in pence — normalize to pounds so the
    // snapshot stores the same units the live `prices` Edge Function returns.
    if (meta.currency === "GBp" || meta.currency === "GBX") return px / 100;
    return px;
  } catch {
    return null;
  }
}

Deno.serve(async (_req: Request) => {
  try {
    // Load portfolio
    const loadRes = await fetch(`${SB_URL}/rest/v1/board_data?id=eq.1&select=data`, {
      headers: DB_HEADERS,
    });
    if (!loadRes.ok) throw new Error(`load failed: ${loadRes.status}`);
    const rows = await loadRes.json();
    if (!rows?.length || !rows[0]?.data) throw new Error("no portfolio row");

    const portfolio = rows[0].data as Record<string, any>;
    const holdings: Record<string, any> = portfolio.holdings ?? {};

    // Only live, non-private tickers
    const tickers = Object.keys(holdings).filter(
      t => t !== "CASH" && !holdings[t]?.isCash && !t.endsWith(".PVT")
    );
    if (!tickers.length) throw new Error("no live tickers");

    // FX rates for non-USD holdings — fetched alongside ticker prices.
    // GBPUSD=X is GBP→USD direct; USDCNY=X is USD→CNY (we invert to get CNY→USD).
    const fxTickers = ["GBPUSD=X", "USDCNY=X"];
    const allTickers = [...tickers, ...fxTickers];

    // Fetch closing prices in parallel
    const pairs = await Promise.all(
      allTickers.map(t => fetchClosePrice(t).then(p => [t, p] as const))
    );
    const allPrices: Record<string, number> = {};
    for (const [t, p] of pairs) if (p != null) allPrices[t] = p;

    // Snapshot only stores the holding-ticker prices (FX rates aren't a holding).
    const prices: Record<string, number> = {};
    for (const t of tickers) if (allPrices[t] != null) prices[t] = allPrices[t];
    if (!Object.keys(prices).length) throw new Error("all price fetches failed");

    const gbpUsd = allPrices["GBPUSD=X"] || 1;
    const usdCny = allPrices["USDCNY=X"] || 0;
    const fxToUSD = (cur: string | undefined): number => {
      if (!cur || cur === "USD") return 1;
      if (cur === "GBP") return gbpUsd;
      if (cur === "CNY") return usdCny > 0 ? 1 / usdCny : 1;
      return 1;
    };

    // Total portfolio value (USD) — converts native-currency prices via live FX
    let totalValue = 0;
    for (const [t, h] of Object.entries(holdings)) {
      if (h.isCash || t === "CASH") { totalValue += h.lastPrice ?? 0; continue; }
      const native = prices[t] ?? h.lastPrice ?? 0;
      totalValue += (h.shares ?? 0) * native * fxToUSD(h.currency);
    }
    if (totalValue <= 0) return new Response(JSON.stringify({ skipped: "zero value" }), {
      headers: { "Content-Type": "application/json" },
    });

    const today = new Date().toISOString().slice(0, 10);
    const snapshot = { date: today, value: Math.round(totalValue * 100) / 100, prices };

    // Upsert: replace today's snapshot if it already exists, keep last 60 days
    const existing: any[] = portfolio.snapshots ?? [];
    const snapshots = [
      ...existing.filter((s: any) => s.date !== today),
      snapshot,
    ].sort((a: any, b: any) => a.date.localeCompare(b.date)).slice(-60);

    const saveRes = await fetch(`${SB_URL}/rest/v1/board_data`, {
      method: "POST",
      headers: { ...DB_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: 1, data: { ...portfolio, snapshots } }),
    });
    if (!saveRes.ok) throw new Error(`save failed: ${saveRes.status}`);

    console.log(`[daily-snapshot] saved ${today}: ${Object.keys(prices).length} tickers, $${totalValue.toFixed(2)}`);
    return new Response(
      JSON.stringify({ ok: true, date: today, tickers: Object.keys(prices).length, value: totalValue }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[daily-snapshot]", String(e));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
