# Public Deployment Modes

RemoCLI supports four practical connection modes. They are not equivalent.

## 1. Local / USB validation

Use this when validating the Android app itself.

- Gateway URL: `http://127.0.0.1:8080`
- Transport: local machine or `adb reverse`
- Login: direct PIN
- Best for:
  - Android UI testing
  - deep link testing
  - session list/detail validation

If multiple Android devices are connected, use:

- `REMOTE_CONNECT_USB_SERIAL`
- or `REMOTE_CONNECT_USB_MODEL`

to tell the install and watcher scripts which device to target.

## 2. LAN direct on the same trusted Wi-Fi

Use this when the phone and computer are on the same private network and you do not want to keep USB attached.

- Gateway URL: `http://<windows-lan-ip>:<lanDirect.listenPort>`
- Transport: Windows LAN port proxy -> Windows localhost -> WSL gateway
- Login: direct PIN
- Best for:
  - same-network phone testing without USB
  - trusted local access without a public URL

The WSL gateway itself should stay bound to `127.0.0.1`. Windows exposes a separate LAN port through `scripts/windows/ensure-lan-direct.ps1`.

## 3. Quick tunnel preview

Use this when you need a temporary public URL without provisioning a formal hostname.

- Gateway URL: `https://<random>.trycloudflare.com`
- Transport: Cloudflare Quick Tunnel
- Login: preview PIN flow
- Best for:
  - short-lived demos
  - browser/App flow validation

Important:

- Quick tunnels are preview/testing infrastructure only.
- They should not be treated as formal public deployment.
- The Cloudflare Access team domain is an Access portal, not your application hostname.

## 4. Formal public deployment

Use this when you want a stable, genuinely public-facing deployment.

- Gateway URL: `https://remocli.example.com`
- Transport: named tunnel
- Front-door auth: Cloudflare Access
- Gateway auth: PIN
- Trusted identity header: `cf-access-authenticated-user-email`

Recommended inputs:

- start from `config/deployment.cloudflare-access.example.json`
- set:
  - `namedTunnel.label`
  - `namedTunnel.tokenEnvVar` or `namedTunnel.tokenFilePath`
  - `gateway.publicBaseUrl`
  - `gateway.trustedProxyHeader`
  - `gateway.allowedEmails`
  - `gateway.localLoginEnabled`

For the Android app's browser-first flow:

- browser bootstrap endpoints should stay behind Access
- app-native JSON endpoints must not return an Access HTML challenge page

If your Access model cannot express that cleanly on one hostname, split into:

- one Access-protected browser bootstrap hostname
- one app-facing gateway hostname that relies on gateway PIN + device session

## Practical recommendation

1. Use USB mode for Android and deep link development.
2. Use LAN direct mode for same-network testing without a cable.
3. Use Quick Tunnel only for preview and temporary demos.
4. Use a dedicated hostname for stable formal public deployment.
