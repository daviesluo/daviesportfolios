// Which IG epic plays which part (a "role") in the verification, chosen from IG's own search answers.
//
// The epics are not written down anywhere public that this repository trusts, and a spread-bet account and a CFD account
// list different epics for the same market (`G1` in the spec). So `facts` searches each account, scores every answer
// against the role's name rule, keeps every candidate it saw, and picks one. A person reading the stored row can see the
// candidates and pin another (`?pin=role:EPIC`), which the next `facts` row then carries; the recorder and the history
// pulls read the newest row's choice.

/** The search terms `facts` sends on every account, in order (one request each). */
export const SEARCH_TERMS = ["AUD/USD", "US 500", "Wall Street", "US Tech 100", "FTSE 100", "Germany 40", "Weekend"] as const;

/** A role's rule: the name must start with `name`, must not match `not`, and the expiry kind it wants. */
type RoleRule = { name: RegExp; not: RegExp; expiry: "cash" | "dated"; type?: string; fallback: string };
const OPTIONS = /\b(call|put|option|binary|barrier|knock|turbo|sprint|bungee)\b|\d{4,}/i;
export const ROLES: Record<string, RoleRule> = {
  fx_audusd: { name: /^AUD\/USD\b/i, not: /weekend|mini|forward|\bfwd\b/i, expiry: "cash", type: "CURRENCIES", fallback: "AUD/USD" },
  us500: { name: /^US 500\b/i, not: /weekend|vix|mini/i, expiry: "cash", fallback: "US 500" },
  us500_fut: { name: /^US 500\b/i, not: /weekend|vix|mini/i, expiry: "dated", fallback: "US 500" },
  wallst: { name: /^Wall Street\b/i, not: /weekend|mini/i, expiry: "cash", fallback: "Wall Street" },
  ustech: { name: /^US Tech 100\b/i, not: /weekend|mini/i, expiry: "cash", fallback: "US Tech 100" },
  uk100: { name: /^(FTSE 100|UK 100)\b/i, not: /weekend|mini/i, expiry: "cash", fallback: "UK 100" },
  de40: { name: /^Germany 40\b/i, not: /weekend|mini/i, expiry: "cash", fallback: "Germany 40" },
  wknd_wallst: { name: /^Weekend Wall Street\b/i, not: /mini/i, expiry: "cash", fallback: "Weekend Wall Street" },
  wknd_ustech: { name: /^Weekend US Tech 100\b/i, not: /mini/i, expiry: "cash", fallback: "Weekend US Tech 100" },
  wknd_uk100: { name: /^Weekend (UK 100|FTSE 100)\b/i, not: /mini/i, expiry: "cash", fallback: "Weekend UK 100" },
  wknd_de40: { name: /^Weekend Germany 40\b/i, not: /mini/i, expiry: "cash", fallback: "Weekend Germany 40" },
  wknd_gbpusd: { name: /^Weekend GBP\/USD\b/i, not: /mini/i, expiry: "cash", fallback: "Weekend GBP/USD" },
  wknd_eurusd: { name: /^Weekend EUR\/USD\b/i, not: /mini/i, expiry: "cash", fallback: "Weekend EUR/USD" },
  wknd_usdjpy: { name: /^Weekend USD\/JPY\b/i, not: /mini/i, expiry: "cash", fallback: "Weekend USD/JPY" },
};
export const ROLE_IDS = Object.keys(ROLES);

/** A market as `/markets?searchTerm=` lists it, the fields kept. */
export type SearchMarket = {
  epic: string; instrumentName: string; instrumentType: string; expiry: string;
  marketStatus?: string; bid?: number | null; offer?: number | null; streamingPricesAvailable?: boolean;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** A dated expiry (`DEC-26`) as a sortable number, or null when it is not one. */
export function expiryOrder(expiry: string): number | null {
  const m = /^([A-Z]{3})-(\d{2})$/.exec(expiry ?? "");
  if (!m || !MONTHS.includes(m[1])) return null;
  return 2000 * 12 + Number(m[2]) * 12 + MONTHS.indexOf(m[1]);
}
/** A rolling (undated) market: the spread bet's daily funded bet `DFB`, or a CFD's `-`. */
export const isCash = (expiry: string) => expiry === "DFB" || expiry === "-";

/** The answers that fit a role, best first: the shortest name (fewest qualifiers), then the nearest dated expiry. */
export function candidates(role: string, markets: readonly SearchMarket[]): SearchMarket[] {
  const r = ROLES[role];
  if (!r) return [];
  const seen = new Set<string>();
  const fit = markets.filter((m) => {
    if (!m?.epic || seen.has(m.epic)) return false;
    const name = (m.instrumentName ?? "").trim();
    if (!r.name.test(name) || r.not.test(name) || OPTIONS.test(name)) return false;
    if (r.type && m.instrumentType !== r.type) return false;
    if (r.expiry === "cash" ? !isCash(m.expiry) : expiryOrder(m.expiry) === null) return false;
    seen.add(m.epic);
    return true;
  });
  return fit.sort((a, b) => {
    if (r.expiry === "dated") return (expiryOrder(a.expiry)! - expiryOrder(b.expiry)!) || a.instrumentName.length - b.instrumentName.length;
    return a.instrumentName.length - b.instrumentName.length || a.epic.localeCompare(b.epic);
  });
}

const EPIC_RE = /^[A-Za-z0-9._]{6,30}$/;
/** `?pin=role:EPIC,role:EPIC`, each checked: a known role and an epic IG's own rule allows. Unknown parts are refused. */
export function parsePins(s: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const part of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [role, epic] = part.split(":");
    if (!ROLES[role] || !EPIC_RE.test(epic ?? "")) throw new Error(`pin '${part.slice(0, 60)}' is not role:EPIC with a known role`);
    out[role] = epic;
  }
  return out;
}

/** Each role's pick (a pin wins) and every candidate seen, at most eight a role. */
export function pickEpics(markets: readonly SearchMarket[], pins: Record<string, string> = {}): {
  selected: Record<string, string>; candidates: Record<string, SearchMarket[]>; missing: string[];
} {
  const selected: Record<string, string> = {};
  const cands: Record<string, SearchMarket[]> = {};
  const missing: string[] = [];
  for (const role of ROLE_IDS) {
    const c = candidates(role, markets);
    cands[role] = c.slice(0, 8);
    if (pins[role]) selected[role] = pins[role];
    else if (c.length) selected[role] = c[0].epic;
    else missing.push(role);
  }
  return { selected, candidates: cands, missing };
}

/** The fields of a search answer that are kept. */
export function keepSearch(body: unknown): SearchMarket[] {
  const list = (body as { markets?: unknown })?.markets;
  if (!Array.isArray(list)) return [];
  return list.map((m: Record<string, unknown>) => ({
    epic: String(m.epic ?? ""), instrumentName: String(m.instrumentName ?? ""), instrumentType: String(m.instrumentType ?? ""),
    expiry: String(m.expiry ?? ""), marketStatus: m.marketStatus as string | undefined,
    bid: (m.bid ?? null) as number | null, offer: (m.offer ?? null) as number | null,
    streamingPricesAvailable: m.streamingPricesAvailable as boolean | undefined,
  })).filter((m) => m.epic);
}
