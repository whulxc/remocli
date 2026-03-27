import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatConversationDetailDisplayText,
  formatConversationSummaryDisplayText,
} from '../src/shared/summary-display.js';

test('summary display formatting unwraps hard-wrapped Chinese paragraphs for mobile reading', () => {
  assert.equal(
    formatConversationSummaryDisplayText([
      '已经把早期记录这类错乱一起修了。根因是 Codex 历史里 Ran ... / └ ...',
      '下面那些缩进的 > ... 输出行，被旧规则当成了用户提示符，所以才会拆出错误的蓝色用户消息。',
    ].join('\n')),
    '已经把早期记录这类错乱一起修了。根因是 Codex 历史里 Ran ... / └ ...下面那些缩进的 > ... 输出行，被旧规则当成了用户提示符，所以才会拆出错误的蓝色用户消息。',
  );
});

test('summary display formatting keeps bullet lists while joining wrapped continuation lines', () => {
  assert.equal(
    formatConversationSummaryDisplayText([
      '- 现在聊天型会话改成了 summary-first：默认打开时先读本地 IndexedDB 缓存，只渲染用户消息和助手总结；运行',
      '  中的会话只补一条“运行中，等待新的总结…”占位',
      '- 点某一条总结时，前端会先查本地详情缓存，未命中才去请求那一条消息的完整内容。',
    ].join('\n')),
    [
      '- 现在聊天型会话改成了 summary-first：默认打开时先读本地 IndexedDB 缓存，只渲染用户消息和助手总结；运行中的会话只补一条“运行中，等待新的总结…”占位',
      '- 点某一条总结时，前端会先查本地详情缓存，未命中才去请求那一条消息的完整内容。',
    ].join('\n'),
  );
});

test('summary display formatting preserves paragraph spacing around list sections', () => {
  assert.equal(
    formatConversationSummaryDisplayText([
      '这次改动已经完成。',
      '',
      '这次变更后：',
      '- 网页需要刷新',
      '- APP 需要重载当前页面',
    ].join('\n')),
    [
      '这次改动已经完成。',
      '',
      '这次变更后：',
      '- 网页需要刷新',
      '- APP 需要重载当前页面',
    ].join('\n'),
  );
});

test('detail display formatting reuses the same mobile-friendly paragraph reflow', () => {
  assert.equal(
    formatConversationDetailDisplayText([
      '当前真实情况是：',
      '- 手机上刚才的 PIN 页里，输入框里就是 2468',
      '- 失败文案原来显示的是：Value <!DOCTYPE ... cannot be converted to JSONObject',
      '  这说明请求拿到的是 HTML，不是 JSON。',
    ].join('\n')),
    [
      '当前真实情况是：',
      '- 手机上刚才的 PIN 页里，输入框里就是 2468',
      '- 失败文案原来显示的是：Value <!DOCTYPE ... cannot be converted to JSONObject这说明请求拿到的是 HTML，不是 JSON。',
    ].join('\n'),
  );
});
