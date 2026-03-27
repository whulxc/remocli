param(
  [string]$DeploymentConfigPath = "config/deployment.local.json"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DeploymentPath = if ([System.IO.Path]::IsPathRooted($DeploymentConfigPath)) {
  (Resolve-Path $DeploymentConfigPath).Path
} else {
  (Resolve-Path (Join-Path $RepoRoot $DeploymentConfigPath)).Path
}
$Deployment = Get-Content $DeploymentPath -Raw | ConvertFrom-Json
$ServePort = if ($Deployment.tailscale.servePort) { [int]$Deployment.tailscale.servePort } else { 443 }
$Tailscale = Get-Command tailscale -ErrorAction SilentlyContinue

if (-not $Tailscale) {
  throw "tailscale CLI not found. Install Tailscale on Windows, then re-run this script."
}

& $Tailscale.Source serve "--https=$ServePort" off
& $Tailscale.Source serve status
