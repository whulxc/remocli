param(
  [string]$DeploymentConfigPath = "config/deployment.cloudflare-access.local.json",
  [string]$Token
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

function Quote-ForBash($Value) {
  if ($null -eq $Value) {
    return "''"
  }

  return "'" + ($Value -replace "'", "'\"'\"'") + "'"
}

function Resolve-WslPath($RepoPath, $PathValue) {
  $Normalized = "$PathValue".Trim().Replace("\", "/")
  if (-not $Normalized) {
    return $RepoPath.TrimEnd("/")
  }

  if ($Normalized.StartsWith("/")) {
    return $Normalized
  }

  return ($RepoPath.TrimEnd("/") + "/" + $Normalized.TrimStart("/"))
}

function Get-WslDirectoryName($PathValue) {
  $Normalized = "$PathValue".TrimEnd("/")
  $LastSlash = $Normalized.LastIndexOf("/")
  if ($LastSlash -le 0) {
    return "/"
  }

  return $Normalized.Substring(0, $LastSlash)
}

if ($Deployment.PSObject.Properties.Name -notcontains "namedTunnel") {
  throw "Deployment config does not define namedTunnel."
}

$NamedTunnel = $Deployment.namedTunnel
if ($NamedTunnel.PSObject.Properties.Name -contains "enabled" -and -not $NamedTunnel.enabled) {
  throw "Deployment namedTunnel.enabled is false."
}

$GatewayRepoPath = Get-RepoPath $Deployment.gateway
$TunnelLabel = if ($NamedTunnel.PSObject.Properties.Name -contains "label" -and $NamedTunnel.label) {
  $NamedTunnel.label
} else {
  "formal-tunnel"
}
$TunnelTokenFilePath = if ($NamedTunnel.PSObject.Properties.Name -contains "tokenFilePath" -and $NamedTunnel.tokenFilePath) {
  Resolve-WslPath $GatewayRepoPath $NamedTunnel.tokenFilePath
} else {
  Resolve-WslPath $GatewayRepoPath ("data/private/{0}.token" -f $TunnelLabel)
}

if (-not $Token) {
  $SecureToken = Read-Host -Prompt "Cloudflare named tunnel token" -AsSecureString
  $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
  try {
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
  }
}

$Token = "$Token".Trim()
if (-not $Token) {
  throw "Named tunnel token cannot be empty."
}

$DirectoryPath = Get-WslDirectoryName $TunnelTokenFilePath
$Command = "mkdir -p $(Quote-ForBash $DirectoryPath) && umask 077 && cat > $(Quote-ForBash $TunnelTokenFilePath) && chmod 600 $(Quote-ForBash $TunnelTokenFilePath)"
$Token | & wsl.exe -d $Deployment.gateway.distro --cd $GatewayRepoPath bash -lc $Command

Write-Output "Saved named tunnel token to $TunnelTokenFilePath"
