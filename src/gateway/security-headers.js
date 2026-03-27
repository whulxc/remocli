const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "media-src 'self' blob:",
].join('; ');

const BROWSER_HANDOFF_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
].join('; ');

export function buildAppContentSecurityPolicy() {
  return APP_CONTENT_SECURITY_POLICY;
}

export function buildBrowserHandoffContentSecurityPolicy() {
  return BROWSER_HANDOFF_CONTENT_SECURITY_POLICY;
}

export function applyGatewaySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  if (!res.getHeader('Content-Security-Policy')) {
    res.setHeader('Content-Security-Policy', buildAppContentSecurityPolicy());
  }

  next();
}
