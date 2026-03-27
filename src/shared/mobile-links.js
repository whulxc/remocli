function normalizeBaseUrl(value) {
  if (!value) {
    return '';
  }

  return `${value}`.trim().replace(/\/+$/, '');
}

export function buildMobileOpenUrl({ mobileDeepLinkBase, gatewayUrl, entryUrl, sessionId, grant, profileId } = {}) {
  const deepLinkBase = normalizeBaseUrl(mobileDeepLinkBase);
  if (!deepLinkBase) {
    return null;
  }

  const url = new URL(deepLinkBase);
  const normalizedGatewayUrl = normalizeBaseUrl(gatewayUrl);
  const normalizedEntryUrl = normalizeBaseUrl(entryUrl);
  const normalizedSessionId = `${sessionId || ''}`.trim();
  const normalizedGrant = `${grant || ''}`.trim();
  const normalizedProfileId = `${profileId || ''}`.trim();

  if (normalizedGatewayUrl) {
    url.searchParams.set('gateway', normalizedGatewayUrl);
  }
  if (normalizedEntryUrl) {
    url.searchParams.set('entry', normalizedEntryUrl);
  }
  if (normalizedSessionId) {
    url.searchParams.set('session', normalizedSessionId);
  }
  if (normalizedGrant) {
    url.searchParams.set('grant', normalizedGrant);
  }
  if (normalizedProfileId) {
    url.searchParams.set('profile', normalizedProfileId);
  }

  return url.toString();
}
