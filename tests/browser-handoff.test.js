import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBrowserAppRedirectPage } from '../src/gateway/browser-handoff.js';

test('browser handoff page auto-redirects back to the app and keeps a manual button', () => {
  const html = renderBrowserAppRedirectPage('remoteconnect://open?gateway=https%3A%2F%2Fai.example.com&grant=abc123');

  assert.match(html, /验证成功，正在返回 APP/u);
  assert.match(html, /window\.location\.replace\(appUrl\)/u);
  assert.match(html, /id="open-app-button"/u);
  assert.match(html, /href="remoteconnect:\/\/open\?gateway=https%3A%2F%2Fai\.example\.com&amp;grant=abc123"/u);
});
