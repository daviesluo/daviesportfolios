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
    return meta?.regularMarketPrice ?? null;
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

    // Fetch closing prices in parallel
    const pairs = await Promise.all(
      tickers.map(t => fetchClosePrice(t).then(p => [t, p] as const))
    );
    const prices: Record<string, number> = {};
    for (const [t, p] of pairs) if (p != null) prices[t] = p;

    if (!Object.keys(prices).length) throw new Error("all price fetches failed");

    // Total portfolio value
    let totalValue = 0;
    for (const [t, h] of Object.entries(holdings)) {
      if (h.isCash || t === "CASH") { totalValue += h.lastPrice ?? 0; continue; }
      totalValue += (h.shares ?? 0) * (prices[t] ?? h.lastPrice ?? 0);
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
