// Shared type definitions for the portfolio app. JSDoc-style imports in the
// JS/JSX files reference these via `@typedef {import('./types').Foo}`. The
// shapes here mirror what's persisted in Supabase board_data and what flows
// through computeMetrics, the YTD chart and the modals.

// Globals + ambient module declarations are split into src/app/ambient.d.ts
// — they need to live in a NON-module .d.ts (no `export`) to land as
// true ambient, which this file isn't (it has `export type` below).

export type Currency = 'USD' | 'GBP' | 'CNY' | 'HKD' | 'EUR';

/** A single sale — shape persisted on Holding.sells. */
export interface Sell {
  date: string;
  shares: number;
  price: number;
  /** Epoch ms stamped when the row was added, so same-day rows keep
   *  their entry order in the transaction log. Absent on legacy rows. */
  ts?: number;
}

/** A single purchase batch — shape persisted on Holding.lots. */
export interface Lot {
  /** ISO date YYYY-MM-DD. */
  date: string;
  shares: number;
  /** Per-share cost in the holding's native currency. */
  cost: number;
  /** Epoch ms stamped when the row was added — orders same-day entries
   *  in the transaction log, which otherwise only has a date. Absent on
   *  legacy rows. */
  ts?: number;
}

export interface Holding {
  shares: number;
  /** Per-share weighted-average cost (native currency). */
  cost: number;
  /** Latest regular-hours price (native currency). */
  lastPrice: number;
  /** Pre/post-market price if available; falls back to lastPrice. */
  extPrice?: number | null;
  /** Previous regular-hours close (native currency). */
  prevClose?: number;
  /** Day percent change (regular hours). */
  dayPct?: number;
  /** Extended-hours percent change vs prevClose. */
  extDayPct?: number | null;
  /** Set when the doRefresh ext-AH verdict trusts `extPrice` as a real
   *  after-hours trade (vs a bogus OTC-ADR postMarketPrice); null when
   *  there's no intraday series to judge from. */
  extPriceTrusted?: boolean | null;
  /** Today's regular-session close, stamped during refresh for the
   *  "since 16:00 ET" ext-hours anchor. */
  todayRegularClose?: number;
  currency?: Currency;
  /** True for the GK / cash bucket; lastPrice doubles as the cash balance. */
  isCash?: boolean;
  lots?: Lot[];
  /** Sale rows — the other half of the transaction ledger. Present at
   *  runtime since the sell editor shipped; without it here `checkJs`
   *  couldn't type-check any of the accounting that reads them. */
  sells?: Sell[];
  /** Set when a full sale closes the position off the board. The
   *  holding row is deliberately RETAINED so its ledger survives, so
   *  this flag is what distinguishes "sold out" from "still held". */
  closed?: boolean;
}

export interface Position {
  label: string;
  subtitle?: string;
  role: 'GK' | 'DEF' | 'MID' | 'FWD';
  tickers: string[];
}

export interface Portfolio {
  positions: Record<string, Position>;
  holdings: Record<string, Holding>;
  snapshots?: PortfolioSnapshot[];
  /** Native→USD rate per non-USD currency, frozen the first time that
   *  currency is seen and never revalued. The Investment chart's deposit
   *  line is a sum of dated cash flows; re-converting a past purchase at
   *  today's FX makes it move on days no money changed hands. Live FX
   *  still drives the VALUE line, which is a mark-to-market. */
  depositFxRates?: Record<string, number>;
  /** Set by portfolio_remote.demoFallback() when the seed (not the
   *  user's saved book) is being shown — gates the demo banner + the
   *  save-skip so edit mode doesn't overwrite the empty server row. */
  _isDemo?: boolean;
}

/** Result of the auth gate held in App's `auth` state: a successful
 *  login (`isReadOnly`), a lockout (`locked` + `lockUntil`), or null
 *  (failed / cancelled). Flat optional fields rather than a discriminated
 *  union so the call sites can read `auth.locked` / `auth.isReadOnly`
 *  without a narrowing dance — the runtime objects only ever carry one
 *  variant's fields. */
export type AppAuth = {
  isReadOnly?: boolean;
  locked?: boolean;
  lockUntil?: number;
} | null;

export interface PortfolioSnapshot {
  /** ISO date stamp YYYY-MM-DD when the snapshot was taken. */
  date: string;
  /** Map of ticker → close price at snapshot time, native currency. */
  prices: Record<string, number>;
  /** Total market value in USD at snapshot time. */
  marketValue?: number;
}

/** Live quote shape used by Utils.refreshPrices and the chart fetch. */
export interface Quote {
  lastPrice: number;
  extPrice: number | null;
  prevClose: number;
  dayPct: number;
  extDayPct: number | null;
  currency: Currency | null;
}

export type MarketData = Record<string, Quote>;

/** Computed view of the portfolio used by Header / Sidebar / Pitch. */
export interface PortfolioMetrics {
  marketValue: number;
  dayChange: number;
  dayPct: number;
  unrlGL: number;
  unrlPct: number;
  tickerCount: number;
  positions: Record<string, PositionMetrics>;
}

export interface PositionMetrics {
  label: string;
  subtitle?: string;
  marketValue: number;
  unrlGL: number;
  unrlPct: number;
  dayChange: number;
  dayPct: number;
  players: PlayerMetrics[];
}

export interface PlayerMetrics {
  ticker: string;
  shares: number;
  cost: number;
  lastPrice: number;
  lastPriceUSD: number;
  marketValue: number;
  dayChange: number;
  dayPct: number;
  extDayPct: number | null;
  unrlGL: number;
  unrlPct: number;
  currency?: Currency;
  isCash?: boolean;
  /** Position label for the heatmap (GK, CB1, etc.). */
  pos?: string;
}

/** Persisted auth-rate-limit state under Storage.loadAuth(). */
export interface AuthState {
  lockoutUntil: number;
  attempts: number;
}

/** Per-ticker historical YTD cache entry. */
export interface YtdCacheEntry {
  ts: number;
  data: Array<{ date: string; close: number }>;
}
