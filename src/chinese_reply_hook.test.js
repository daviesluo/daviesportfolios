// The Stop hook that keeps replies to Davies in Chinese (.claude/hooks/chinese-reply.mjs; Davies, 2026-10-29:
// "你可以给你发出的消息加gate吗").
import { describe, expect, it } from 'vitest';
import { isEnglish, turnTexts, verdict } from '../.claude/hooks/chinese-reply.mjs';

const user = (text) => JSON.stringify({ type: 'user', message: { content: text } });
const tool = () => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });
const said = (text, extra = {}) => JSON.stringify({ type: 'assistant', ...extra, message: { content: [{ type: 'text', text }] } });

describe('chinese-reply hook', () => {
  it('calls English prose English and Chinese prose Chinese', () => {
    expect(isEnglish('The committed bundle does not match what the build produces, so I rebuild it.')).toBe(true);
    expect(isEnglish('提交里的打包文件和构建结果不一致，我重新构建后再跑检查。')).toBe(false);
  });
  it('lets Chinese with English terms, code, paths and links through', () => {
    expect(isEnglish('IGBOT 的 sync 在 00:16 被拒，`igbot_requests` 里有 6 条 401。')).toBe(false);
    expect(isEnglish('改动在 supabase/functions/ig/client.ts，见 https://github.com/daviesluo/daviesportfolios 。\n```sh\nsh bin/gates.sh --quick && git push origin HEAD:main\n```')).toBe(false);
    expect(isEnglish('ok')).toBe(false);
  });
  it('reads only the current turn, across tool results, and skips sub-agents', () => {
    const lines = [user('第一轮'), said('An English note from an earlier turn that is long enough.'), user('新问题'),
      said('先看代码。'), tool(), said('A sub-agent wrote this in English, long enough to count.', { isSidechain: true }), said('看完了。')];
    expect(turnTexts(lines)).toEqual(['先看代码。', '看完了。']);
    expect(verdict({}, lines)).toBeNull();
  });
  it('blocks a turn with an English block, and on the second stop judges only the final block', () => {
    const lines = [user('问题'), said('I have started the work and will report back when it is done.'), tool(), said('已经用中文重写：工作已开始，完成后告诉你。')];
    expect(verdict({}, lines)).toMatch(/英文/);
    expect(verdict({ stop_hook_active: true }, lines)).toBeNull();
    expect(verdict({ stop_hook_active: true }, [...lines, said('Still English at the end of the turn, which must not pass.')])).toMatch(/英文/);
  });
});

describe('chinese-remind hook', async () => {
  const { REMINDER, remind } = await import('../.claude/hooks/chinese-remind.mjs');
  it('puts the rule in front of the model when Davies writes and after every tool call', () => {
    for (const event of ['UserPromptSubmit', 'PostToolUse']) {
      expect(remind(event)).toEqual({ hookSpecificOutput: { hookEventName: event, additionalContext: REMINDER } });
    }
    expect(REMINDER).toMatch(/只用中文/);
    expect(isEnglish(REMINDER)).toBe(false);
  });
});
