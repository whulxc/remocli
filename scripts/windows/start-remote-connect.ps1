param(
  [string]$DeploymentConfigPath = "config/deployment.local.json",
  [switch]$SkipGenerate,
  [switch]$SkipNamedTunnel
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

function Quote-ForBash($Value) {
  if ($null -eq $Value) {
    return "''"
  }

  return "'" + ($Value -replace "'", "'\"'\"'") + "'"
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

function Test-WslFileExists($Distro, $RepoPath, $PathValue) {
  $Command = "[[ -s $(Quote-ForBash $PathValue) ]]"
  & wsl.exe -d $Distro --cd $RepoPath bash -lc $Command *> $null
  return $LASTEXITCODE -eq 0
}

function Write-WslFile($Distro, $RepoPath, $PathValue, $Content) {
  $DirectoryPath = Get-WslDirectoryName $PathValue
  $Command = "mkdir -p $(Quote-ForBash $DirectoryPath) && umask 077 && cat > $(Quote-ForBash $PathValue) && chmod 600 $(Quote-ForBash $PathValue)"
  $Content | & wsl.exe -d $Distro --cd $RepoPath bash -lc $Command
}

if (-not $SkipGenerate) {
  $GatewayRepoPath = Get-RepoPath $Deployment.gateway
  Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath "cd '$GatewayRepoPath' && node scripts/generate-deployment-config.mjs '$DeploymentConfigPath'"
}

$GatewayConfigPath = "config/generated/gateway.generated.json"
$GatewayRepoPath = Get-RepoPath $Deployment.gateway

if ($Deployment.gotify.PSObject.Properties.Name -contains "service" -and $Deployment.gotify.service) {
  Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath "cd '$GatewayRepoPath' && ./scripts/wsl/start-gotify.sh '$DeploymentConfigPath'"
}

Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath "cd '$GatewayRepoPath' && ./scripts/wsl/start-service.sh gateway gateway '$GatewayConfigPath'"

foreach ($Agent in $Deployment.agents) {
  $RepoPath = Get-RepoPath $Agent
  $AgentConfigPath = "config/generated/agent.$($Agent.id).generated.json"
  $ServiceName = "agent-$($Agent.id)"
  Invoke-WslService $Agent.distro $RepoPath "cd '$RepoPath' && ./scripts/wsl/start-service.sh agent '$ServiceName' '$AgentConfigPath'"
}

& (Join-Path $PSScriptRoot "watch-android-usb-reverse.ps1")

try {
  & (Join-Path $PSScriptRoot "ensure-lan-direct.ps1") -DeploymentConfigPath $DeploymentPath
} catch {
  Write-Warning $_
}

$NamedTunnel = Get-NamedTunnelConfig $Deployment
if (-not $SkipNamedTunnel -and $NamedTunnel) {
  $TunnelLabel = if ($NamedTunnel.PSObject.Properties.Name -contains "label" -and $NamedTunnel.label) {
    $NamedTunnel.label
  } else {
    "formal-tunnel"
  }
  $TunnelProtocol = if ($NamedTunnel.PSObject.Properties.Name -contains "protocol" -and $NamedTunnel.protocol) {
    $NamedTunnel.protocol
  } else {
    "http2"
  }
  $TunnelHealthUrl = if ($Deployment.gateway.PSObject.Properties.Name -contains "publicBaseUrl" -and $Deployment.gateway.publicBaseUrl) {
    $Deployment.gateway.publicBaseUrl
  } else {
    ""
  }
  $TunnelTokenFilePath = if ($NamedTunnel.PSObject.Properties.Name -contains "tokenFilePath" -and $NamedTunnel.tokenFilePath) {
    Resolve-WslPath $GatewayRepoPath $NamedTunnel.tokenFilePath
  } else {
    Resolve-WslPath $GatewayRepoPath ("data/private/{0}.token" -f $TunnelLabel)
  }
  $TunnelTokenEnvVar = if ($NamedTunnel.PSObject.Properties.Name -contains "tokenEnvVar" -and $NamedTunnel.tokenEnvVar) {
    $NamedTunnel.tokenEnvVar
  } else {
    "CLOUDFLARED_TUNNEL_TOKEN"
  }
  $TunnelTokenFromEnv = [Environment]::GetEnvironmentVariable($TunnelTokenEnvVar)

  if ($TunnelTokenFromEnv) {
    Write-WslFile $Deployment.gateway.distro $GatewayRepoPath $TunnelTokenFilePath $TunnelTokenFromEnv.Trim()
  } elseif (-not (Test-WslFileExists $Deployment.gateway.distro $GatewayRepoPath $TunnelTokenFilePath)) {
    throw "Named tunnel is enabled but no token was found. Set Windows env var $TunnelTokenEnvVar or save the token to $TunnelTokenFilePath."
  }

  $StartTunnelCommand = "cd $(Quote-ForBash $GatewayRepoPath) && ./scripts/wsl/start-named-tunnel.sh '' $(Quote-ForBash $TunnelLabel) $(Quote-ForBash $TunnelProtocol) $(Quote-ForBash $TunnelTokenFilePath) $(Quote-ForBash $TunnelHealthUrl)"
  Invoke-WslService $Deployment.gateway.distro $GatewayRepoPath $StartTunnelCommand
}
