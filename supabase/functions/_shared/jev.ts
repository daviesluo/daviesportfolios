// TypeSafe Jev 1.13 — the decision model behind the agents feature.
//
// Jev is a System One model: it does not generate text. It takes a `state`
// (text, object or array) plus a map of typed `questions`, and returns a
// typed answer per question with probabilities. It cannot emit a value
// outside the schema, which is the point of using it. The wire format,
// limits and the vendor's own list of weaknesses are in
// docs/agents/reference.md — read §1.4 before changing what is asked.
//
// Two transports, tried in order:
//   1. OpenRouter  POST https://openrouter.ai/api/alpha/decisions
//                  model "typesafe/jev-1.13", Bearer OPENROUTER_API_KEY
//   2. TypeSafe    POST https://api.typesafe.ai/v1/systemone
//                  model "jev-1.13.0",        Bearer TYPESAFE_API_KEY
// If both fail the result is `provider: "none"` and the caller MUST treat
// that as "no opinion" — hold, never act. A decision model that is down
// is not a reason to trade.
//
// The two transports differ in one documented way: OpenRouter requires a
// noul's `criteria` to carry BOTH `true` and `false` when present, where
// TypeSafe lets either be omitted. `toWireQuestions` normalises for the
// stricter side so one question map serves both. Answer shapes are
// parsed defensively (`noul` / `choice` / `score` fields natively; one
// public example shows an `answer` field on OpenRouter) and verified
// live by the `probe` action before anything depends on them.
//
// Pricing, from both listings: $0.042 per million input tokens, output
// free. `costUsd` is that arithmetic; OpenRouter also returns its own
// `usage.cost`, which wins when present.

export type Entry = string | Record<string, unknown> | unknown[];

export type NoulQuestion = {
  type: "noul";
  instructions?: Entry;
  criteria?: { true?: Entry; false?: Entry } | null;
};
export type ChoiceQuestion = {
  type: "choice";
  instructions?: Entry;
  criteria: Record<string, Entry | null>;
};
export type ScoreQuestion = {
  type: "score";
  instructions?: Entry;
  criteria: string[];
};
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export type Answer =
  | { type: "noul"; probability: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number; legend?: Record<string, string> };

export type JevProvider = "openrouter" | "typesafe" | "none";

export type JevResult = {
  provider: JevProvider;
  model: string | null;
  answers: Record<string, Answer>;
  inputTokens: number;
  costUsd: number;
  latencyMs: number;
  /** Why a provider was skipped or failed, oldest first. Empty on a clean hit. */
  errors: string[];
};

export const JEV_OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_OPENROUTER_MODEL = "typesafe/jev-1.13";
export const JEV_TYPESAFE_MODEL = "jev-1.13.0";
/** $0.042 per million input tokens (both listings, 2026-09-20). */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export function costUsd(inputTokens: number): number {
  return Math.max(0, inputTokens) * JEV_USD_PER_INPUT_TOKEN;
}

/**
 * The same question map, in the shape both transports accept: a noul with
 * criteria always carries both keys (OpenRouter rejects one without the
 * other), and a noul with an empty criteria object carries none.
 */
export function toWireQuestions(questions: Questions): Questions {
  const out: Questions = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type !== "noul" || !q.criteria) { out[name] = q; continue; }
    const t = q.criteria.true, f = q.criteria.false;
    if (t == null && f == null) { out[name] = { type: "noul", instructions: q.instructions }; continue; }
    out[name] = {
      type: "noul",
      instructions: q.instructions,
      criteria: { true: t ?? "Yes — the statement holds.", false: f ?? "No — the statement does not hold." },
    };
  }
  return out;
}

/**
 * One raw answer → the normalised shape the strategy reads. Accepts the
 * native field names (`noul`, `choice`, `score`) and the `answer` alias
 * seen on OpenRouter examples. Returns null for anything it cannot read,
 * and the caller treats a missing answer exactly like a missing provider.
 */
export function parseAnswer(raw: unknown): Answer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const probs = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (v && typeof v === "object") {
      for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
        const n = num(p); if (n != null) out[k] = n;
      }
    }
    return out;
  };
  const type = r.type;
  if (type === "noul") {
    const p = num(r.noul) ?? num(r.answer) ?? num(r.probability);
    return p == null ? null : { type: "noul", probability: Math.min(1, Math.max(0, p)) };
  }
  if (type === "choice") {
    const choice = typeof r.choice === "string" ? r.choice : typeof r.answer === "string" ? r.answer : null;
    if (!choice) return null;
    return { type: "choice", choice, probabilities: probs(r.probabilities), confidence: num(r.confidence) ?? 0 };
  }
  if (type === "score") {
    const s = num(r.score) ?? num(r.answer);
    if (s == null) return null;
    const legend = r.legend && typeof r.legend === "object"
      ? Object.fromEntries(Object.entries(r.legend as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : undefined;
    return { type: "score", score: s, probabilities: probs(r.probabilities), confidence: num(r.confidence) ?? 0, legend };
  }
  return null;
}

export function parseAnswers(raw: unknown): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, a] of Object.entries(raw as Record<string, unknown>)) {
    const p = parseAnswer(a);
    if (p) out[name] = p;
  }
  return out;
}

type Transport = {
  provider: Exclude<JevProvider, "none">;
  url: string;
  model: string;
  key: string;
};

export type JevEnv = { openrouterKey?: string; typesafeKey?: string };

/**
 * Ask Jev. Tries OpenRouter, then TypeSafe; returns `provider: "none"` with
 * the errors when neither answers. Never throws — a decision model outage
 * is a normal state the caller has to handle by holding.
 */
export async function askJev(
  state: Entry,
  questions: Questions,
  env: JevEnv,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<JevResult> {
  const wire = toWireQuestions(questions);
  const transports: Transport[] = [];
  if (env.openrouterKey) transports.push({ provider: "openrouter", url: JEV_OPENROUTER_URL, model: JEV_OPENROUTER_MODEL, key: env.openrouterKey });
  if (env.typesafeKey) transports.push({ provider: "typesafe", url: JEV_TYPESAFE_URL, model: JEV_TYPESAFE_MODEL, key: env.typesafeKey });
  const errors: string[] = [];
  if (!transports.length) errors.push("no Jev API key configured");

  for (const t of transports) {
    const started = Date.now();
    try {
      const res = await fetchImpl(t.url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${t.key}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          // OpenRouter attributes usage to an app by these; harmless for TypeSafe.
          "HTTP-Referer": "https://daviesportfolios.pages.dev",
          "X-Title": "daviesportfolios agents",
        },
        body: JSON.stringify({ model: t.model, state, questions: wire }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) {
        errors.push(`${t.provider} ${res.status}: ${text.slice(0, 200)}`);
        continue;
      }
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { errors.push(`${t.provider}: non-JSON body`); continue; }
      const answers = parseAnswers(body.answers);
      const asked = Object.keys(wire);
      const missing = asked.filter((k) => !(k in answers));
      if (missing.length) {
        errors.push(`${t.provider}: unreadable answers for ${missing.join(",")}`);
        continue;
      }
      const usage = (body.usage ?? {}) as Record<string, unknown>;
      const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens
        : typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
      const reported = typeof usage.cost === "number" ? usage.cost : null;
      return {
        provider: t.provider,
        model: typeof body.model === "string" ? body.model : t.model,
        answers,
        inputTokens,
        costUsd: reported ?? costUsd(inputTokens),
        latencyMs: Date.now() - started,
        errors,
      };
    } catch (e) {
      errors.push(`${t.provider}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { provider: "none", model: null, answers: {}, inputTokens: 0, costUsd: 0, latencyMs: 0, errors };
}
