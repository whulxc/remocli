# RemoCLI Maintenance Guide

This repository is maintained as a `Windows + WSL` control plane for remote CLI sessions. Use this file as the default engineering context for new maintenance sessions.

## What matters first

- Treat the stack as four layers:
  - `gateway`
  - per-WSL `agent`
  - transport (`USB`, `LAN`, `Quick tunnel preview`, `Formal public deployment`)
  - Android/Web client state
- For connection or login problems, always check layers in that order.
- Do not start from app-side guessing when `gateway` or `agent` health is unknown.

## Primary entrypoints

- Gateway server: `src/gateway/server.js`
- Agent server: `src/agent/server.js`
- Frontend app: `src/frontend/app.js`
- Android shell: `android/app/src/main/java/com/remoteconnect/mobile/MainActivity.kt`
- Deployment config generation: `scripts/generate-deployment-config.mjs`
- Public deployment notes: `docs/public-deployment-modes.md`
- Troubleshooting: `docs/troubleshooting.md`

## Default troubleshooting flow

### 1. Identify the active mode

- `USB direct`
- `LAN direct`
- `Quick tunnel preview`
- `Formal public deployment`

Do not treat the Cloudflare Access team domain as the application hostname.

### 2. Check the local stack

- Gateway:
  - `curl -sS http://127.0.0.1:8080/health`
- Agent:
  - `node scripts/check-deployment.mjs <deployment-manifest>`
- Logs:
  - `tail -n 80 data/runtime/gateway.log`
  - `tail -n 80 data/runtime/agent-*.log`

### 3. Check the transport

- USB:
  - `adb devices`
  - `adb reverse --list`
- LAN:
  - test the Windows LAN URL from the host first
- Formal public:
  - `curl -I https://<public-hostname>`
  - if `1033`, check named tunnel state and logs

### 4. Only then check client state

- Web page stale state: refresh once
- Android stale state: reopen app once
- Only use UI tree / `logcat` when:
  - the user says “still broken”, or
  - server-side state is healthy but phone behavior disagrees

## Low-token maintenance defaults

- Do not restate the entire README in every maintenance session.
- Read `AGENTS.md` first, then only open files relevant to the active problem.
- Prefer short status reports:
  - root cause
  - exact fix
  - validation
  - whether web refresh / app reopen / gateway restart / agent restart is needed
- For repeat issues, reuse the same path:
  - mode -> gateway -> agent -> transport -> client

## Common commands

### Build and tests

- `npm test`
- `npm run build`

### Local runtime checks

- `node scripts/check-deployment.mjs <deployment-manifest>`
- `./scripts/wsl/status-service.sh gateway`
- `./scripts/wsl/status-service.sh agent-<id>`
- `./scripts/wsl/status-named-tunnel.sh <label> '<health-url>'`

### Typical restarts

- `./scripts/wsl/start-service.sh gateway gateway config/generated/gateway.generated.json`
- `./scripts/wsl/start-service.sh agent agent-<id> config/generated/agent.<id>.generated.json`
- `./scripts/wsl/start-named-tunnel.sh '' <label> <protocol> <token-file> <health-url>`

If a Windows-side launcher is in play, prefer the existing repo script rather than inventing a new startup path.

## App-side maintenance boundary

- This maintenance context is not an in-app usage guide.
- Keep Android/WebView details minimal unless they are required for:
  - login recovery
  - notification behavior
  - real device validation
- If app behavior disagrees with healthy backend state, validate on a real device before changing logic again.

## Open-source safety rules

- Never commit:
  - `config/*.local.json`
  - `config/generated/**`
  - `data/**`
  - `downloads/**`
  - `output/**`
  - `android/local.properties`
  - logs, UI tree dumps, device screenshots, `logcat`
- Never publish:
  - real hostnames
  - real emails
  - PINs
  - secrets, tokens, session secrets
  - device serials
  - local IPs
- Before pushing, run:
  - `./scripts/check-open-source-safety.sh`

Use example values in docs and prompts:

- `https://remote.example.com`
- `user@example.com`
- `/workspace/demo`
- `demo-agent`
