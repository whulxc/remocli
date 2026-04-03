param(
  [string]$DeploymentConfigPath = "config/deployment.cloudflare-access.local.json",
  [string]$TaskName = "RemoCLI Formal Public Mode",
  [switch]$AtStartup
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).ProviderPath
$DeploymentPath = if ([System.IO.Path]::IsPathRooted($DeploymentConfigPath)) {
  (Resolve-Path $DeploymentConfigPath).ProviderPath
} else {
  (Resolve-Path (Join-Path $RepoRoot $DeploymentConfigPath)).ProviderPath
}

function Quote-ForBash($Value) {
  if ($null -eq $Value) {
    return "''"
  }

  $SingleQuoteEscape = "'" + '"' + "'" + '"' + "'"
  return "'" + ("$Value" -replace "'", $SingleQuoteEscape) + "'"
}

function Convert-RelativePathToWsl($RepoPath, $PathValue) {
  $RelativePath = "$PathValue".Trim()
  $RelativePath = $RelativePath -replace '^[.][\\/]+', ''
  $RelativePath = $RelativePath.TrimStart([char]'\', [char]'/')
  if (-not $RelativePath) {
    return $RepoPath.TrimEnd("/")
  }

  return ($RepoPath.TrimEnd("/") + "/" + $RelativePath)
}

function Convert-UncWslPathToWsl($ExpectedDistro, $PathValue) {
  if ("$PathValue" -notmatch '^[\\]{2}wsl(?:\.localhost|\$)[\\]([^\\]+)[\\](.+)$') {
    return $null
  }

  $PathDistro = $Matches[1]
  if ($ExpectedDistro -and $PathDistro -ne $ExpectedDistro) {
    throw "Deployment path points to WSL distro '$PathDistro', but the configured gateway distro is '$ExpectedDistro'."
  }

  return "/" + (($Matches[2] -replace '\\', '/').TrimStart([char]'/'))
}

function Convert-DrivePathToWsl($PathValue) {
  if ("$PathValue" -notmatch '^([A-Za-z]):[\\/](.*)$') {
    return $null
  }

  $DriveLetter = $Matches[1].ToLowerInvariant()
  $Rest = ($Matches[2] -replace '\\', '/').TrimStart([char]'/')
  return "/mnt/$DriveLetter/$Rest"
}

function Resolve-WslPath($RepoPath, $PathValue, $ExpectedDistro) {
  $TrimmedPath = "$PathValue".Trim()
  if (-not $TrimmedPath) {
    return $RepoPath.TrimEnd("/")
  }

  if ($TrimmedPath.StartsWith("/")) {
    return $TrimmedPath
  }

  $UncPath = Convert-UncWslPathToWsl $ExpectedDistro $TrimmedPath
  if ($UncPath) {
    return $UncPath
  }

  $DrivePath = Convert-DrivePathToWsl $TrimmedPath
  if ($DrivePath) {
    return $DrivePath
  }

  return Convert-RelativePathToWsl $RepoPath $TrimmedPath
}

$Deployment = Get-Content $DeploymentPath -Raw | ConvertFrom-Json
$GatewayDistro = $Deployment.gateway.distro
$RepoWslPath = if ($Deployment.gateway.PSObject.Properties.Name -contains "wslRepoPath" -and $Deployment.gateway.wslRepoPath) {
  $Deployment.gateway.wslRepoPath
} else {
  $Deployment.workspace.defaultWslRepoPath
}

if (-not $RepoWslPath) {
  throw "deployment.workspace.defaultWslRepoPath or deployment.gateway.wslRepoPath is required"
}

$DeploymentPathForTask = Resolve-WslPath $RepoWslPath $DeploymentPath $GatewayDistro
$StartupScriptPath = $RepoWslPath.TrimEnd("/") + "/scripts/wsl/start-deployment-services.sh"
$BashCommand = "$StartupScriptPath $(Quote-ForBash $DeploymentPathForTask)"

$WrapperDirectory = Join-Path $env:LOCALAPPDATA "RemoCLI"
$WrapperPath = Join-Path $WrapperDirectory "start-formal-public-mode.ps1"
$StartupDirectory = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$StartupLauncherPath = Join-Path $StartupDirectory "RemoCLI Formal Public Mode.cmd"
New-Item -ItemType Directory -Path $WrapperDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $StartupDirectory -Force | Out-Null

$WrapperContent = @(
  '$ErrorActionPreference = "Stop"',
  'Set-Location "C:\"',
  "wsl.exe -d $GatewayDistro --cd $RepoWslPath bash -lc ""$BashCommand"""
) -join "`r`n"

Set-Content -Path $WrapperPath -Value $WrapperContent -Encoding ASCII

$StartupLauncherContent = @(
  "@echo off",
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$WrapperPath"""
) -join "`r`n"

Set-Content -Path $StartupLauncherPath -Value $StartupLauncherContent -Encoding ASCII

if ($AtStartup) {
  Write-Warning "AtStartup is not supported by the startup-folder launcher. RemoCLI will auto-start after Windows logon."
}

Write-Output "Installed Windows startup launcher for '$TaskName'"
Write-Output "Mode: Formal public deployment"
Write-Output "Trigger: After Windows logon"
Write-Output "Wrapper: $WrapperPath"
Write-Output "Startup launcher: $StartupLauncherPath"
Write-Output "Deployment config: $DeploymentPathForTask"
Write-Output "Action: $WrapperContent"
