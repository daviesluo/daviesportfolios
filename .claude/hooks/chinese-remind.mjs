#!/usr/bin/env node
// The Chinese gate's first half (Davies, 2026-10-29: "怎么又有英文了，你之前设置的gate不行啊"). `chinese-reply.mjs` judges a
// turn only when it ends, after the English is already on his screen; this one puts the rule back in front of the model
// before it writes: when he sends a message (UserPromptSubmit) and after every tool call (PostToolUse), where the progress
// notes that slipped into English were written. It adds one short context line and never blocks.
import { readFileSync } from "node:fs";

export const REMINDER = "提醒：Davies 只读中文。这一轮写给他的每一句话，包括工具调用之间的进度说明，都只用中文；代码、命令、文件名除外；提交到仓库的内容照旧用英文。";

/** The hook's output for an event: the context line to add, in the shape Claude Code reads. */
export function remind(event) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: REMINDER } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let event = "PostToolUse";
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    if (typeof input.hook_event_name === "string") event = input.hook_event_name;
  } catch { /* no input: the default event */ }
  process.stdout.write(JSON.stringify(remind(event)));
}
