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

function Get-NamedTunnelConfig($Deployment) {
  if ($Deployment.PSObject.Properties.Name -notcontains "namedTunnel") {
    return $null
  }

  if ($Deployment.namedTunnel.PSObject.Properties.Name -contains "enabled" -and -not $Deployment.namedTunnel.enabled) {
    return $null
  }

  return $Deployment.namedTunnel
}

$GatewayRepoPath = Get-RepoPath $Deployment.gateway

& (Join-Path $PSScriptRoot "watch-android-usb-reverse.ps1") -Status
& (Join-Path $PSScriptRoot "ensure-lan-direct.ps1") -DeploymentConfigPath $DeploymentPath -Status

if ($Deployment.gotify.PSObject.Properties.Name -contains "service" -and $Deployment.gotify.service) {
  Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath "cd '$GatewayRepoPath' && ./scripts/wsl/status-service.sh gotify"
}

Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath "cd '$GatewayRepoPath' && ./scripts/wsl/status-service.sh gateway"

foreach ($Agent in $Deployment.agents) {
  $RepoPath = Get-RepoPath $Agent
  $ServiceName = "agent-$($Agent.id)"
  Invoke-WslService $Agent.distro $RepoPath "cd '$RepoPath' && ./scripts/wsl/status-service.sh '$ServiceName'"
}

$NamedTunnel = Get-NamedTunnelConfig $Deployment
if ($NamedTunnel) {
  $TunnelLabel = if ($NamedTunnel.PSObject.Properties.Name -contains "label" -and $NamedTunnel.label) {
    $NamedTunnel.label
  } else {
    "formal-tunnel"
  }
  $TunnelHealthUrl = if ($Deployment.gateway.PSObject.Properties.Name -contains "publicBaseUrl" -and $Deployment.gateway.publicBaseUrl) {
    $Deployment.gateway.publicBaseUrl
  } else {
    ""
  }
  Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath "cd '$GatewayRepoPath' && ./scripts/wsl/status-named-tunnel.sh '$TunnelLabel' '$TunnelHealthUrl'"
}
