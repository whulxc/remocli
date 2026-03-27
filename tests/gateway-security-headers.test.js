import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGatewaySecurityHeaders,
  buildAppContentSecurityPolicy,
  buildBrowserHandoffContentSecurityPolicy,
} from '../src/gateway/security-headers.js';

test('gateway default CSP locks the app to same-origin resources plus websocket connectivity', () => {
  const csp = buildAppContentSecurityPolicy();
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self' ws: wss:/);
  assert.match(csp, /img-src 'self' data: blob:/);
});

test('browser handoff CSP allows only the inline redirect page resources it needs', () => {
  const csp = buildBrowserHandoffContentSecurityPolicy();
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'unsafe-inline'/);
  assert.match(csp, /style-src 'unsafe-inline'/);
  assert.doesNotMatch(csp, /connect-src/);
});

test('gateway security header middleware applies defensive defaults', () => {
  const headers = new Map();
  let nextCalled = false;
  const res = {
    setHeader(name, value) {
      headers.set(name, value);
    },
    getHeader(name) {
      return headers.get(name);
    },
  };

  applyGatewaySecurityHeaders({}, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
  assert.equal(headers.get('X-Permitted-Cross-Domain-Policies'), 'none');
  assert.equal(headers.get('Content-Security-Policy'), buildAppContentSecurityPolicy());
});
