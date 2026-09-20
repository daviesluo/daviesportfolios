// Pin tests for the Jev client (`_shared/jev.ts`): the wire normalisation
// both transports accept, the defensive answer parsing, the fallback
// chain, and the cost arithmetic. `fetch` is stubbed — no test here ever
// spends a token.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  askJev, costUsd, JEV_OPENROUTER_MODEL, JEV_OPENROUTER_URL, JEV_TYPESAFE_MODEL, JEV_TYPESAFE_URL,
  parseAnswer, parseAnswers, toWireQuestions, type Questions,
} from "../_shared/jev.ts";

const Q: Questions = {
  ok: { type: "noul", instructions: "Is it fine?", criteria: { true: "fine" } },
  none: { type: "noul", instructions: "Plain." },
  pick: { type: "choice", instructions: "Which?", criteria: { a: null, b: "the b" } },
  lvl: { type: "score", instructions: "How much?", criteria: ["low", "high"] },
};

Deno.test("toWireQuestions — a noul with one criterion gets both keys; without any, none", () => {
  const w = toWireQuestions(Q);
  assertEquals((w.ok as { criteria: unknown }).criteria, { true: "fine", false: "No — the statement does not hold." });
  assertEquals("criteria" in (w.none as object), false);
  assertEquals(w.pick, Q.pick);
  assertEquals(w.lvl, Q.lvl);
});

Deno.test("parseAnswer — native fields, the `answer` alias, and junk", () => {
  assertEquals(parseAnswer({ type: "noul", noul: 0.93 }), { type: "noul", probability: 0.93 });
  assertEquals(parseAnswer({ type: "noul", answer: 1.2 }), { type: "noul", probability: 1 }); // clamped
  assertEquals(parseAnswer({ type: "choice", choice: "a", probabilities: { a: 0.7, b: 0.3 }, confidence: 0.4 }),
    { type: "choice", choice: "a", probabilities: { a: 0.7, b: 0.3 }, confidence: 0.4 });
  assertEquals(parseAnswer({ type: "choice", answer: "b" }), { type: "choice", choice: "b", probabilities: {}, confidence: 0 });
  const s = parseAnswer({ type: "score", score: 1.05, legend: { "0": "low", "1": "high" }, probabilities: { "0": 0.1, "1": 0.9 }, confidence: 0.8 });
  assertEquals(s?.type, "score");
  assertEquals((s as { score: number }).score, 1.05);
  assertEquals(parseAnswer({ type: "noul" }), null);
  assertEquals(parseAnswer({ type: "sonnet", text: "no" }), null);
  assertEquals(parseAnswer(null), null);
  assertEquals(Object.keys(parseAnswers({ a: { type: "noul", noul: 0.5 }, b: {} })), ["a"]);
});

Deno.test("costUsd — $0.042 per million input tokens", () => {
  assertAlmostEquals(costUsd(1_000_000), 0.042, 1e-12);
  assertAlmostEquals(costUsd(1_000), 0.000042, 1e-12);
  assertEquals(costUsd(-5), 0);
});

type Call = { url: string; body: Record<string, unknown>; auth: string };
function stub(handlers: Record<string, (call: Call) => Response>, calls: Call[] = []) {
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url,
      body: JSON.parse(String(init?.body ?? "{}")),
      auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
    };
    calls.push(call);
    const h = handlers[url];
    if (!h) return new Response("no handler", { status: 599 });
    return h(call);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const okBody = (model: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  model,
  answers: {
    ok: { type: "noul", noul: 0.8 }, none: { type: "noul", noul: 0.5 },
    pick: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9 },
    lvl: { type: "score", score: 0.3, probabilities: { "0": 0.7, "1": 0.3 }, confidence: 0.4, legend: { "0": "low", "1": "high" } },
  },
  usage: { input_tokens: 500, output_tokens: 0, ...extra },
});

Deno.test("askJev — OpenRouter first: right URL, model, bearer and body; cost from tokens", async () => {
  const { f, calls } = stub({ [JEV_OPENROUTER_URL]: () => new Response(okBody("typesafe/jev-1.13"), { status: 200 }) });
  const r = await askJev({ s: 1 }, Q, { openrouterKey: "or-key", typesafeKey: "ts-key" }, f);
  assertEquals(r.provider, "openrouter");
  assertEquals(r.model, "typesafe/jev-1.13");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].auth, "Bearer or-key");
  assertEquals(calls[0].body.model, JEV_OPENROUTER_MODEL);
  assertEquals(calls[0].body.state, { s: 1 });
  assertEquals((calls[0].body.questions as Questions).ok, toWireQuestions(Q).ok);
  assertEquals(r.inputTokens, 500);
  assertEquals(r.costUsd, costUsd(500));
  assertEquals(r.answers.ok, { type: "noul", probability: 0.8 });
  assertEquals(r.errors, []);
});

Deno.test("askJev — OpenRouter's own usage.cost wins over the arithmetic", async () => {
  const { f } = stub({ [JEV_OPENROUTER_URL]: () => new Response(okBody("typesafe/jev-1.13", { cost: 0.000018 }), { status: 200 }) });
  const r = await askJev("x", Q, { openrouterKey: "k" }, f);
  assertAlmostEquals(r.costUsd, 0.000018, 1e-12);
});

Deno.test("askJev — 429 on OpenRouter falls through to TypeSafe and records why", async () => {
  const { f, calls } = stub({
    [JEV_OPENROUTER_URL]: () => new Response('{"error":"rate limited"}', { status: 429 }),
    [JEV_TYPESAFE_URL]: () => new Response(okBody("jev-1.13.0"), { status: 200 }),
  });
  const r = await askJev("x", Q, { openrouterKey: "or", typesafeKey: "ts" }, f);
  assertEquals(r.provider, "typesafe");
  assertEquals(calls[1].body.model, JEV_TYPESAFE_MODEL);
  assertEquals(calls[1].auth, "Bearer ts");
  assertEquals(r.errors.length, 1);
  assert(r.errors[0].startsWith("openrouter 429"));
});

Deno.test("askJev — a 200 that does not answer every question is a failure, not an answer", async () => {
  const partial = JSON.stringify({ model: "m", answers: { ok: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 10 } });
  const { f } = stub({
    [JEV_OPENROUTER_URL]: () => new Response(partial, { status: 200 }),
    [JEV_TYPESAFE_URL]: () => new Response(okBody("jev-1.13.0"), { status: 200 }),
  });
  const r = await askJev("x", Q, { openrouterKey: "or", typesafeKey: "ts" }, f);
  assertEquals(r.provider, "typesafe");
  assert(r.errors[0].includes("unreadable answers for none,pick,lvl"));
});

Deno.test("askJev — both down → provider none, no answers, both errors kept; never throws", async () => {
  const { f } = stub({
    [JEV_OPENROUTER_URL]: () => { throw new Error("boom"); },
    [JEV_TYPESAFE_URL]: () => new Response("<html>", { status: 200 }),
  });
  const r = await askJev("x", Q, { openrouterKey: "or", typesafeKey: "ts" }, f);
  assertEquals(r.provider, "none");
  assertEquals(r.answers, {});
  assertEquals(r.errors, ["openrouter: boom", "typesafe: non-JSON body"]);
  const none = await askJev("x", Q, {}, f);
  assertEquals(none.provider, "none");
  assertEquals(none.errors, ["no Jev API key configured"]);
});
