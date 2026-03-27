param(
  [string]$DeploymentConfigPath = "config/deployment.cloudflare-access.local.json",
  [string]$TaskName = "RemoCLI Formal Public Mode",
  [switch]$AtStartup
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DeploymentPath = if ([System.IO.Path]::IsPathRooted($DeploymentConfigPath)) {
  (Resolve-Path $DeploymentConfigPath).Path
} else {
  (Resolve-Path (Join-Path $RepoRoot $DeploymentConfigPath)).Path
}
$Deployment = Get-Content $DeploymentPath -Raw | ConvertFrom-Json

function Quote-ForCommandLineArgument($Value) {
  return '"' + ("$Value" -replace '"', '\"') + '"'
}

function Quote-ForBash($Value) {
  if ($null -eq $Value) {
    return "''"
  }

  return "'" + ("$Value" -replace "'", "'\"'\"'") + "'"
}

function Get-RepoPath($Item) {
  if ($Item.PSObject.Properties.Name -contains "wslRepoPath" -and $Item.wslRepoPath) {
    return $Item.wslRepoPath
  }

  return $Deployment.workspace.defaultWslRepoPath
}

function Get-NamedTunnelConfig($DeploymentConfig) {
  if ($DeploymentConfig.PSObject.Properties.Name -notcontains "namedTunnel") {
    return $null
  }

  if ($DeploymentConfig.namedTunnel.PSObject.Properties.Name -contains "enabled" -and -not $DeploymentConfig.namedTunnel.enabled) {
    return $null
  }

  return $DeploymentConfig.namedTunnel
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

function Resolve-WslPath($Distro, $RepoPath, $PathValue) {
  $TrimmedPath = "$PathValue".Trim()
  if (-not $TrimmedPath) {
    return $RepoPath.TrimEnd("/")
  }

  if ($TrimmedPath.StartsWith("/")) {
    return $TrimmedPath
  }

  $UncPath = Convert-UncWslPathToWsl $Distro $TrimmedPath
  if ($UncPath) {
    return $UncPath
  }

  $DrivePath = Convert-DrivePathToWsl $TrimmedPath
  if ($DrivePath) {
    return $DrivePath
  }

  return Convert-RelativePathToWsl $RepoPath $TrimmedPath
}

function Build-StartupBashCommand($DeploymentConfig, $GatewayRepoPath, $DeploymentConfigWslPath) {
  $Commands = @(
    "set -euo pipefail",
    "node scripts/generate-deployment-config.mjs $(Quote-ForBash $DeploymentConfigWslPath)"
  )

  if ($DeploymentConfig.gotify.PSObject.Properties.Name -contains "service" -and $DeploymentConfig.gotify.service) {
    $Commands += "./scripts/wsl/start-gotify.sh $(Quote-ForBash $DeploymentConfigWslPath)"
  }

  $Commands += "./scripts/wsl/start-service.sh gateway gateway 'config/generated/gateway.generated.json'"

  foreach ($Agent in $DeploymentConfig.agents) {
    $AgentRepoPath = Get-RepoPath $Agent
    $AgentDistro = if ($Agent.PSObject.Properties.Name -contains "distro" -and $Agent.distro) {
      $Agent.distro
    } else {
      $DeploymentConfig.gateway.distro
    }

    if ($AgentDistro -ne $DeploymentConfig.gateway.distro -or $AgentRepoPath -ne $GatewayRepoPath) {
      throw "register-startup-task.ps1 currently supports startup-task registration only when gateway and all agents share the same WSL distro and repo path."
    }

    $Commands += "./scripts/wsl/start-service.sh agent $(Quote-ForBash ("agent-" + $Agent.id)) $(Quote-ForBash ("config/generated/agent.{0}.generated.json" -f $Agent.id))"
  }

  $NamedTunnel = Get-NamedTunnelConfig $DeploymentConfig
  if ($NamedTunnel) {
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
    $TunnelTokenFilePath = if ($NamedTunnel.PSObject.Properties.Name -contains "tokenFilePath" -and $NamedTunnel.tokenFilePath) {
      Resolve-WslPath $DeploymentConfig.gateway.distro $GatewayRepoPath $NamedTunnel.tokenFilePath
    } else {
      Resolve-WslPath $DeploymentConfig.gateway.distro $GatewayRepoPath ("data/private/{0}.token" -f $TunnelLabel)
    }
    $TunnelHealthUrl = if ($DeploymentConfig.gateway.PSObject.Properties.Name -contains "publicBaseUrl" -and $DeploymentConfig.gateway.publicBaseUrl) {
      $DeploymentConfig.gateway.publicBaseUrl
    } else {
      ""
    }
    $Commands += "./scripts/wsl/start-named-tunnel.sh '' $(Quote-ForBash $TunnelLabel) $(Quote-ForBash $TunnelProtocol) $(Quote-ForBash $TunnelTokenFilePath) $(Quote-ForBash $TunnelHealthUrl)"
  }

  return ($Commands -join "; ")
}

$WindowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$UserName = $WindowsIdentity.Name
$RepoWslPath = Get-RepoPath $Deployment.gateway

if (-not $RepoWslPath) {
  throw "deployment.workspace.defaultWslRepoPath or deployment.gateway.wslRepoPath is required"
}

$DeploymentPathForTask = Resolve-WslPath $Deployment.gateway.distro $RepoWslPath $DeploymentConfigPath
$StartupBashCommand = Build-StartupBashCommand $Deployment $RepoWslPath $DeploymentPathForTask

$ActionArguments = @(
  "-d"
  (Quote-ForCommandLineArgument $Deployment.gateway.distro)
  "--cd"
  (Quote-ForCommandLineArgument $RepoWslPath)
  "bash"
  "-lc"
  (Quote-ForCommandLineArgument $StartupBashCommand)
) -join " "

$Action = New-ScheduledTaskAction -Execute "wsl.exe" -Argument $ActionArguments
$Trigger = if ($AtStartup) {
  New-ScheduledTaskTrigger -AtStartup
} else {
  New-ScheduledTaskTrigger -AtLogOn -User $UserName
}
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Start RemoCLI gateway, agents, and named tunnel through WSL" `
  -Force | Out-Null

Write-Output "Registered scheduled task '$TaskName'"
Write-Output "Trigger: $(if ($AtStartup) { 'At startup' } else { 'At logon' })"
Write-Output "User: $UserName"
Write-Output "Deployment config: $DeploymentPathForTask"
Write-Output "Action: wsl.exe $ActionArguments"
