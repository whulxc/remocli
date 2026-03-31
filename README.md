# RemoCLI

RemoCLI is a mobile-first control plane for remote `Codex CLI` sessions running across one or more `WSL` distributions. It combines a Windows-side gateway, per-WSL agents, a responsive web UI, and an Android WebView shell app.

## Host requirements

RemoCLI is currently designed for a `Windows + WSL` host.

Minimum requirements:

- Windows 11 with `PowerShell`
- at least one `WSL2` distro with:
  - `bash`
  - `node`
  - `npm`
  - `tmux`
  - `curl`
  - `python3`
- Android phone testing requires:
  - `adb` in Windows `PATH` or at `D:\software\Android\SDK\platform-tools\adb.exe`
- Formal public deployment additionally requires:
  - a named Cloudflare Tunnel token
  - a real public application hostname

Practical notes:

- The gateway is a Node.js process that runs in WSL.
- The Android shell app is for testing and mobile use; desktop users can also open the web UI directly.
- This repository is not an npm package and does not provide a one-command cross-platform installer yet.

## Five-minute quick start

If this is your first time running RemoCLI, start with **USB local validation**. Do not start with formal public deployment unless you already have a real public hostname and a Cloudflare tunnel token.

### Computer side

1. Install JavaScript dependencies and build the frontend:

   ```bash
   npm install
   npm run build
   ```

2. Copy the example configs:

   ```bash
   cp config/gateway.example.json config/gateway.local.json
   cp config/agent.example.json config/agent.local.json
   ```

3. Edit those local files and set:

   - a PIN in `config/gateway.local.json`
   - a session secret in `config/gateway.local.json`
   - an agent token in both files

4. Start one agent and one gateway in two terminals:

   ```bash
   REMOTE_CONNECT_AGENT_CONFIG=config/agent.local.json npm run start:agent
   ```

   ```bash
   REMOTE_CONNECT_GATEWAY_CONFIG=config/gateway.local.json npm run start:gateway
   ```

5. Verify the local web UI on the computer:

   ```text
   http://127.0.0.1:8080
   ```

### Phone side

For Android USB validation:

1. Enable USB debugging on the phone.
2. Connect the phone to the Windows host by USB.
3. Build and install the debug APK:

   ```bash
   ./scripts/build-android-apk.sh
   ./scripts/install-android-debug.sh
   ```

4. Open the app, choose `USB direct`, tap `Verify`, and enter the PIN.

If you only want to use the desktop browser, you can stop after opening `http://127.0.0.1:8080`.

### Before you choose another mode

- `USB direct` is the easiest first-run path.
- `LAN direct` is for a trusted local network on the same Wi-Fi.
- `Quick tunnel preview` is for temporary public testing.
- `Formal public deployment` needs a real application hostname and a named Cloudflare tunnel token.

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

## What is documented today

The repository currently includes:

- example gateway, agent, and deployment configs
- scripts to start, stop, and inspect the gateway, agents, USB reverse watcher, LAN bridge, quick tunnel, and named tunnel
- Android build and install helpers
- deployment mode guidance in [docs/public-deployment-modes.md](docs/public-deployment-modes.md)

The repository does not yet include:

- a single one-click installer for all prerequisites
- an interactive setup wizard
- automatic provisioning of Cloudflare Access applications
- automatic installation of Node.js, WSL, `tmux`, or Android SDK on a fresh machine

## Android app

The Android app is a native shell around the RemoCLI web UI:

- It loads the configured gateway URL in a `WebView`
- It stores connection profiles locally
- It bridges completion/error events into native notifications, sound, and vibration
- It registers the deep link `remoteconnect://open?gateway=<url>&session=<id>`

Build and install helpers:

- `scripts/build-android-apk.sh`
- `scripts/install-android-debug.sh`

The first time you start the WSL services, RemoCLI will download `cloudflared` and `gotify` binaries into `tools/**/bin/` on demand. Those downloaded binaries are ignored by git and are not part of the open-source source tree.

Build the debug APK with:

```bash
./scripts/build-android-apk.sh
```

The generated APK will be copied to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
downloads/remocli-debug.apk
```

## Using an AI assistant to install it

Yes, another user can ask an AI coding assistant to install and configure RemoCLI, but the AI still needs a machine that already satisfies the host requirements above.

What the AI can reasonably do:

- inspect the repo
- copy example configs
- fill in local config values you provide
- start the gateway and agent
- build the frontend
- build and install the Android debug APK
- configure USB, LAN, quick tunnel, or named tunnel flows

What the AI cannot do without your input:

- invent your PIN, secrets, or Cloudflare tunnel token
- create your Cloudflare Access application without your account access
- install Windows features such as WSL if the machine does not already allow that workflow
- approve Android-side install prompts on the phone for you

Suggested prompt for AI-assisted setup:

```text
Set up this RemoCLI repository for local USB validation on my Windows + WSL machine.

Constraints:
- work in the current repo only
- use config/*.example.json as the starting point
- explain computer-side and phone-side steps separately
- prefer USB local validation first
- tell me exactly which secrets or values you need from me before continuing
- after each change, say whether I need to refresh the web page, reopen the app, or restart the gateway or agent
```

Suggested prompt for formal public deployment:

```text
Set up this RemoCLI repository for formal public deployment behind Cloudflare Access.

Constraints:
- do not treat the Cloudflare Access team domain as the application hostname
- use config/deployment.cloudflare-access.example.json as the starting point
- tell me which values I must provide: public hostname, allowed emails, tunnel token, PIN, and session secret
- explain computer-side and phone-side steps separately
- verify gateway, then agent, then tunnel health before claiming success
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
