param(
  [string]$DeploymentConfigPath = "config/deployment.quick-tunnel.local.json"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DeploymentPath = if ([System.IO.Path]::IsPathRooted($DeploymentConfigPath)) {
  (Resolve-Path $DeploymentConfigPath).Path
} else {
  (Resolve-Path (Join-Path $RepoRoot $DeploymentConfigPath)).Path
}
$Deployment = Get-Content $DeploymentPath -Raw | ConvertFrom-Json
$DefaultRepoPath = $Deployment.workspace.defaultWslRepoPath

function Get-RepoPath($Item) {
  if ($Item.PSObject.Properties.Name -contains "wslRepoPath" -and $Item.wslRepoPath) {
    return $Item.wslRepoPath
  }
  return $DefaultRepoPath
}

function Invoke-WslService($Distro, $RepoPath, $Command) {
  & wsl.exe -d $Distro --cd $RepoPath bash -lc $Command
}

$GatewayRepoPath = Get-RepoPath $Deployment.gateway
$QuickTunnelUrl = Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath "cd '$GatewayRepoPath' && ./scripts/wsl/start-quick-tunnel.sh '$DeploymentConfigPath'"
$QuickTunnelUrl = ($QuickTunnelUrl | Select-Object -Last 1).Trim()

if (-not $QuickTunnelUrl) {
  throw "Quick Tunnel URL was not returned"
}

& wsl.exe -d $Deployment.gateway.distro --cd $GatewayRepoPath bash -lc "cd '$GatewayRepoPath' && node scripts/set-public-base-url.mjs '$DeploymentConfigPath' '$QuickTunnelUrl' && node scripts/generate-deployment-config.mjs '$DeploymentConfigPath' && ./scripts/wsl/stop-service.sh gateway && ./scripts/wsl/start-service.sh gateway gateway 'config/generated/gateway.generated.json'"

Write-Output $QuickTunnelUrl
