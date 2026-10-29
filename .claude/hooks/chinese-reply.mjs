#!/usr/bin/env node
// Stop hook: Davies reads every reply in Chinese (.claude/CLAUDE.md, "Reply to Davies in Chinese"). English came back
// after compactions and under sub-agent reports at least eight times; on 2026-10-29 he asked for a gate on the replies
// themselves ("你可以给你发出的消息加gate吗"). This reads the turn's own text from the transcript and, when the prose is
// mostly English, blocks the stop so the reply is written again in Chinese.
//
// What counts: the main thread's text blocks since the last message that was not a tool result (sub-agents' own
// transcripts are not read). Code fences, inline code, URLs and paths are removed first, so commands and file names do
// not count. A block is English when it has at least 20 Latin letters and fewer CJK characters than half its Latin
// letters. On a second stop (`stop_hook_active`) only the final block is judged, so earlier progress notes that cannot be
// rewritten do not loop the gate.
import { readFileSync } from "node:fs";

export const MIN_LATIN = 20;

/** The prose of a text block: code, URLs and paths taken out. */
export function prose(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:[\w.-]+\/)+[\w.-]+/g, " ");
}

/** True when the block reads as English rather than Chinese. */
export function isEnglish(text) {
  const p = prose(text);
  const cjk = (p.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const latin = (p.match(/[A-Za-z]/g) ?? []).length;
  return latin >= MIN_LATIN && cjk * 2 < latin;
}

/** The main thread's assistant text blocks of the current turn, oldest first, from transcript JSONL lines. */
export function turnTexts(lines) {
  const texts = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.isSidechain) continue;
    const content = e.message?.content;
    if (e.type === "user") {
      const toolOnly = Array.isArray(content) && content.length > 0 && content.every((c) => c?.type === "tool_result");
      if (!toolOnly) texts.length = 0;
    } else if (e.type === "assistant" && Array.isArray(content)) {
      for (const c of content) if (c?.type === "text" && typeof c.text === "string" && c.text.trim()) texts.push(c.text);
    }
  }
  return texts;
}

/** The hook's verdict for one input: null to let the stop happen, or the reason to block it. */
export function verdict(input, lines) {
  const texts = turnTexts(lines);
  const judged = input?.stop_hook_active ? texts.slice(-1) : texts;
  const bad = judged.filter(isEnglish);
  if (!bad.length) return null;
  const first = bad[0].trim().slice(0, 80).replace(/\s+/g, " ");
  return `这一轮有 ${bad.length} 段文字是英文（例如："${first}…"）。Davies 要求这个会话只用中文：请把要告诉他的内容用中文重新写一遍再结束。`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no input: nothing to judge */ }
  let lines = [];
  try { lines = readFileSync(input.transcript_path ?? "", "utf8").split("\n"); } catch { process.exit(0); }
  const reason = verdict(input, lines);
  if (reason) process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}
