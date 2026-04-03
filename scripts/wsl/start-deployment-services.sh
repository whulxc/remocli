#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOYMENT_CONFIG_PATH="${1:-config/deployment.cloudflare-access.local.json}"

cd "$REPO_ROOT"

node scripts/generate-deployment-config.mjs "$DEPLOYMENT_CONFIG_PATH"

gotify_enabled="$(
  node -e '
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(config.gotify && config.gotify.service ? "1" : "0");
  ' "$DEPLOYMENT_CONFIG_PATH"
)"

if [[ "$gotify_enabled" == "1" ]]; then
  ./scripts/wsl/start-gotify.sh "$DEPLOYMENT_CONFIG_PATH"
fi

./scripts/wsl/start-service.sh gateway gateway "config/generated/gateway.generated.json"

mapfile -t agent_ids < <(
  node -e '
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const agent of config.agents || []) {
      if (agent && agent.id) {
        console.log(agent.id);
      }
    }
  ' "$DEPLOYMENT_CONFIG_PATH"
)

for agent_id in "${agent_ids[@]}"; do
  ./scripts/wsl/start-service.sh agent "agent-$agent_id" "config/generated/agent.$agent_id.generated.json"
done

named_tunnel_lines="$(
  node -e '
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const namedTunnel = config.namedTunnel;
    if (!namedTunnel || namedTunnel.enabled === false) {
      process.stdout.write("0");
      process.exit(0);
    }
    const label = namedTunnel.label || "formal-tunnel";
    const protocol = namedTunnel.protocol || "http2";
    const tokenFilePath = namedTunnel.tokenFilePath || `data/private/${label}.token`;
    const healthUrl = (config.gateway && config.gateway.publicBaseUrl) ? config.gateway.publicBaseUrl : "";
    process.stdout.write(["1", label, protocol, tokenFilePath, healthUrl].join("\n"));
  ' "$DEPLOYMENT_CONFIG_PATH"
)"

IFS=$'\n' read -r -d '' named_enabled named_label named_protocol named_token_file named_health_url < <(
  printf '%s\0' "$named_tunnel_lines"
)

if [[ "$named_enabled" == "1" ]]; then
  ./scripts/wsl/start-named-tunnel.sh '' "$named_label" "$named_protocol" "$named_token_file" "$named_health_url"
fi
