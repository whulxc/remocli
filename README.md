# RemoCLI

RemoCLI is a mobile-first control plane for remote `Codex CLI` sessions running across one or more `WSL` distributions. It combines a Windows-side gateway, per-WSL agents, a responsive web UI, and an Android WebView shell app.

## What it includes

- A `gateway` service for authentication, multi-agent aggregation, notifications, session locks, and artifact proxying
- A per-WSL `agent` service that manages `tmux` sessions and captures session snapshots
- A mobile-friendly web UI for session lists, chat-style interaction, raw terminal fallback, and artifacts
- An Android shell app that wraps the web UI and bridges notifications, vibration, and deep links

## Repository layout

- `src/gateway/server.js`: Windows-side control plane
- `src/agent/server.js`: per-WSL session manager
- `src/frontend/app.js`: responsive web console
- `android/app/src/main/java/com/remoteconnect/mobile/MainActivity.kt`: Android shell app
- `config/gateway.example.json`: standalone gateway example config
- `config/agent.example.json`: standalone agent example config
- `config/deployment.example.json`: example manifest for local/Tailscale-style deployments
- `config/deployment.cloudflare-access.example.json`: example manifest for formal public deployment behind Cloudflare Access
- `docs/public-deployment-modes.md`: USB, LAN, preview, and formal public deployment guidance

## Local development

1. Install dependencies:

   ```bash
   npm install
   npm run build
   ```

2. Copy example configs and fill in secrets:

   ```bash
   cp config/gateway.example.json config/gateway.local.json
   cp config/agent.example.json config/agent.local.json
   ```

3. Start one WSL agent:

   ```bash
   REMOTE_CONNECT_AGENT_CONFIG=config/agent.local.json npm run start:agent
   ```

4. Start the gateway:

   ```bash
   REMOTE_CONNECT_GATEWAY_CONFIG=config/gateway.local.json npm run start:gateway
   ```

5. Open `http://127.0.0.1:8080` and log in with the configured PIN.

## Connection modes

RemoCLI supports four practical connection modes:

- USB local validation: `http://127.0.0.1:8080`
- LAN direct on the same trusted network: `http://<windows-lan-ip>:<lan-port>`
- Quick tunnel preview: `https://<random>.trycloudflare.com`
- Formal public deployment: dedicated application hostname plus front-door identity and gateway PIN

Read [docs/public-deployment-modes.md](docs/public-deployment-modes.md) before choosing a public URL.

## Windows + WSL deployment

1. Copy the example deployment manifest:

   ```bash
   cp config/deployment.example.json config/deployment.local.json
   ```

2. Fill in:

   - `workspace.defaultWslRepoPath`
   - `gateway.distro`
   - `gateway.pin`
   - `gateway.sessionSecret`
   - `gateway.publicBaseUrl`
   - `gotify.baseUrl`
   - `gotify.token`
   - every `agents[].token`
   - every `agents[].distro` and `agents[].port`

3. Generate runtime configs:

   ```bash
   node scripts/generate-deployment-config.mjs config/deployment.local.json
   ```

4. Start the stack from Windows:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/windows/start-remote-connect.ps1 -DeploymentConfigPath config/deployment.local.json
   ```

5. Verify local health from WSL:

   ```bash
   node scripts/check-deployment.mjs config/deployment.local.json
   ```

For formal public mode with a named tunnel, start from `config/deployment.cloudflare-access.example.json` instead.

## Android app

The Android app is a native shell around the RemoCLI web UI:

- It loads the configured gateway URL in a `WebView`
- It stores connection profiles locally
- It bridges completion/error events into native notifications, sound, and vibration
- It registers the deep link `remoteconnect://open?gateway=<url>&session=<id>`

Build and install helpers:

- `scripts/build-android-apk.sh`
- `scripts/install-android-debug.sh`

Build the debug APK with:

```bash
./scripts/build-android-apk.sh
```

The generated APK will be copied to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
downloads/remocli-debug.apk
```

## Artifact flow

Each agent injects:

- `REMOTE_CONNECT_SESSION`
- `REMOTE_CONNECT_ARTIFACT_DIR`

into started session commands. Images written into `REMOTE_CONNECT_ARTIFACT_DIR` appear in the phone UI and can trigger notifications through the gateway.

## Checks

Run the project checks with:

```bash
npm run check
```
