#!/usr/bin/env node
// The Chinese gate's middle (Davies, 2026-10-29: "还是英文，这个问题还是没解决，请真正彻底解决"). The reminder
// (`chinese-remind.mjs`) did not stop it and the Stop gate (`chinese-reply.mjs`) acts only once the turn is over, so the
// English progress notes written between tool calls kept reaching his screen, one after another. This runs before every
// tool call and refuses it while the latest note reads as English, telling the model to say it again in Chinese first.
// A tool call's own note is not yet in the transcript when the hook runs (measured 2026-10-29), so the note judged is
// the previous step's: an English note can appear once, and the next call is refused until it is said again in Chinese.
import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isEnglish } from "./chinese-reply.mjs";

/**
 * The main thread's latest note: the assistant text written since the last tool result or, when there is none yet,
 * the text of the step before it. A message from Davies starts afresh.
 */
export function latestNote(lines) {
  let current = [];
  let previous = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.isSidechain) continue;
    if (e.type === "user") {
      const content = e.message?.content;
      const toolOnly = Array.isArray(content) && content.length > 0 && content.every((c) => c?.type === "tool_result");
      previous = toolOnly && current.length ? current : toolOnly ? previous : [];
      current = [];
    } else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) if (c?.type === "text" && typeof c.text === "string" && c.text.trim()) current.push(c.text);
    }
  }
  return current.length ? current : previous;
}

/** The hook's answer: null to let the call run, or the refusal to return. */
export function decide(lines) {
  const bad = latestNote(lines).filter(isEnglish);
  if (!bad.length) return null;
  const first = bad[0].trim().slice(0, 60).replace(/\s+/g, " ");
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `刚才写给 Davies 的说明是英文（"${first}…"）。先用中文把这段说明重写一遍，再重新调用这个工具。`,
    },
  };
}

/**
 * Each English note is refused once, never again: the transcript can lag the conversation, and on 2026-10-29 a note the
 * hook had already refused kept being judged the latest, refusing every call after it, the rewrite's included. The
 * notes already refused are kept, as hashes, in a file beside the transcript.
 */
export function onceOnly(out, lines, seen) {
  if (!out) return { out: null, key: null };
  const key = createHash("sha256").update(latestNote(lines).join("\n")).digest("hex");
  return seen.has(key) ? { out: null, key: null } : { out, key };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* nothing to judge */ }
  // A sub-agent's own notes are not read by Davies (they come back as a hand-back the main thread retells in Chinese).
  if (input.agent_id) process.exit(0);
  let lines = [];
  try { lines = readFileSync(input.transcript_path ?? "", "utf8").split("\n"); } catch { process.exit(0); }
  const store = `${input.transcript_path}.chinese-refused`;
  let seen = new Set();
  try { seen = new Set(readFileSync(store, "utf8").split("\n").filter(Boolean)); } catch { /* none refused yet */ }
  const { out, key } = onceOnly(decide(lines), lines, seen);
  if (out && key) {
    try { appendFileSync(store, key + "\n"); } catch { /* cannot remember: refuse anyway, once */ }
    process.stdout.write(JSON.stringify(out));
  }
  process.exit(0);
}
