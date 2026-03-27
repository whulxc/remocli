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

$GatewayRepoPath = Get-RepoPath $Deployment.gateway
Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath "cd '$GatewayRepoPath' && ./scripts/wsl/stop-service.sh quick-tunnel"
