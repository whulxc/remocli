# Troubleshooting

Use this page when RemoCLI does not connect, the app cannot fetch sessions, or a public URL fails.

## First rule

Before changing code or config, identify the active connection mode:

- `USB direct`
- `LAN direct`
- `Quick tunnel preview`
- `Formal public deployment`

Do not treat the Cloudflare Access team domain as the application hostname. In formal public mode, the app hostname is your real public URL such as `https://remote.example.com`.

## Check order

Always check problems in this order:

1. `gateway`
2. `agent`
3. tunnel or public front door

That order avoids chasing the wrong layer.

## Computer side checks

### 1. Gateway health

```bash
curl -sS http://127.0.0.1:8080/health
```

Expected result:

```json
{"ok":true}
```

If this fails, restart the gateway before checking anything else.

### 2. Agent health

If you are using the deployment scripts, verify the local stack:

```bash
node scripts/check-deployment.mjs config/deployment.local.json
```

If you are troubleshooting formal public mode, replace that manifest with your Cloudflare deployment manifest.

When direct checks are needed, inspect agent logs after the gateway:

```bash
tail -n 80 data/runtime/gateway.log
tail -n 80 data/runtime/agent-*.log
```

### 3. Public entrypoint health

For formal public mode, check the real application hostname:

```bash
curl -I https://remote.example.com
```

If this returns Cloudflare `1033`, the route exists but the local tunnel process is down or disconnected.

For quick tunnel preview, verify the current `trycloudflare.com` URL directly in a browser before debugging the phone.

## Phone side checks

### USB direct

If the app cannot connect to `http://127.0.0.1:8080`:

1. Confirm USB debugging is enabled.
2. Confirm the phone is visible in `adb devices`.
3. Re-apply reverse:

   ```bash
   adb reverse tcp:8080 tcp:8080
   ```

4. Reopen the app and choose `USB direct`.

### LAN direct

If the app times out on a LAN URL:

1. Make sure the phone and computer are on the same trusted network.
2. Use the Windows LAN address, not `127.0.0.1` and not a WSL-only address.
3. Confirm the LAN bridge responds from the computer:

   ```bash
   curl -sS http://<windows-lan-ip>:<lan-port>/health
   ```

### Quick tunnel preview

Quick tunnel is for temporary testing only.

If the preview URL changes or stops loading:

1. Start a new quick tunnel.
2. Copy the new `https://<random>.trycloudflare.com` URL.
3. Update the phone app profile to that new URL.

Do not expect quick tunnel URLs to be long-lived.

### Formal public deployment

If the app shows repeated retries or the browser returns a Cloudflare error page:

1. Check the real application hostname, not the team domain.
2. Check gateway health.
3. Check agent health.
4. Check named tunnel status and logs.

If the public hostname loads but the app data still fails, the most common root causes are:

- dead tunnel process
- wrong public hostname
- wrong trusted proxy header
- Cloudflare Access protecting the wrong path

### Formal public mode did not come back after reboot

If you expect the Cloudflare-backed formal public stack to recover after a Windows reboot:

1. Sign in to Windows first. The repository's startup launcher runs after user logon, not before it.
2. Register the launcher once:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/windows/register-startup-task.ps1 -DeploymentConfigPath config/deployment.cloudflare-access.local.json
   ```

3. Verify the local services again:

   ```bash
   curl -sS http://127.0.0.1:8080/health
   node scripts/check-deployment.mjs config/deployment.cloudflare-access.local.json
   ```

4. If local health is back but the public URL still fails, inspect the named tunnel status and log.

## Common symptoms

### `Error 1033`

Meaning:

- Cloudflare has a route
- the local tunnel process is not healthy

Action:

1. Check the tunnel log
2. Restart the named tunnel
3. Re-test the real public hostname

### `Trusted browser identity required`

Meaning:

- the gateway expects a trusted identity header
- the current entrypoint is not providing it

Common cause:

- using a preview or direct public URL while the gateway is configured like formal Access mode

### App stuck on automatic retry

Meaning:

- the app still remembers a valid device session
- but the current gateway URL is temporarily unreachable

Action:

1. Fix the selected gateway mode first
2. Reopen the app
3. Switch to another connection profile only if the current mode is truly unavailable

### Session list is empty or fetch fails

Action:

1. Check `gateway.log`
2. Check `agent` logs
3. Confirm the selected project path exists on the computer side
4. Confirm the phone is pointed at the intended gateway URL

## Which mode to pick first

For a first run, prefer:

1. `USB direct`
2. `LAN direct`
3. `Quick tunnel preview`
4. `Formal public deployment`

If you do not already have a real public hostname and a named Cloudflare tunnel token, do not start with formal public deployment.
