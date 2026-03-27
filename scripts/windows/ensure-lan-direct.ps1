param(
  [string]$DeploymentConfigPath = "config/deployment.local.json",
  [switch]$Status,
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DeploymentPath = if (Test-Path $DeploymentConfigPath) {
  (Resolve-Path $DeploymentConfigPath).Path
} else {
  (Resolve-Path (Join-Path $RepoRoot $DeploymentConfigPath)).Path
}
$Deployment = Get-Content $DeploymentPath -Raw | ConvertFrom-Json

function Get-LanDirectConfig($Deployment) {
  $gatewayPort = if ($Deployment.gateway.PSObject.Properties.Name -contains "listenPort" -and $Deployment.gateway.listenPort) {
    [int]$Deployment.gateway.listenPort
  } else {
    8080
  }

  $config = [ordered]@{
    enabled = $false
    listenAddress = "0.0.0.0"
    listenPort = if ($gatewayPort -eq 8080) { 18080 } else { $gatewayPort + 10000 }
    connectAddress = "127.0.0.1"
    connectPort = $gatewayPort
    firewallRemoteAddress = "LocalSubnet"
    firewallRuleName = "RemoCLI LAN Direct"
  }

  if ($Deployment.PSObject.Properties.Name -contains "lanDirect" -and $Deployment.lanDirect) {
    if ($Deployment.lanDirect.PSObject.Properties.Name -contains "enabled") {
      $config.enabled = [bool]$Deployment.lanDirect.enabled
    }
    if ($Deployment.lanDirect.PSObject.Properties.Name -contains "listenAddress" -and $Deployment.lanDirect.listenAddress) {
      $config.listenAddress = $Deployment.lanDirect.listenAddress
    }
    if ($Deployment.lanDirect.PSObject.Properties.Name -contains "listenPort" -and $Deployment.lanDirect.listenPort) {
      $config.listenPort = [int]$Deployment.lanDirect.listenPort
    }
    if ($Deployment.lanDirect.PSObject.Properties.Name -contains "connectAddress" -and $Deployment.lanDirect.connectAddress) {
      $config.connectAddress = $Deployment.lanDirect.connectAddress
    }
    if ($Deployment.lanDirect.PSObject.Properties.Name -contains "connectPort" -and $Deployment.lanDirect.connectPort) {
      $config.connectPort = [int]$Deployment.lanDirect.connectPort
    }
    if ($Deployment.lanDirect.PSObject.Properties.Name -contains "firewallRemoteAddress" -and $Deployment.lanDirect.firewallRemoteAddress) {
      $config.firewallRemoteAddress = $Deployment.lanDirect.firewallRemoteAddress
    }
  }

  return [pscustomobject]$config
}

function Test-IsAdministrator {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}

function Test-IsPrivateIpv4($Address) {
  if (-not $Address) {
    return $false
  }

  return (
    $Address -match '^10\.' -or
    $Address -match '^192\.168\.' -or
    $Address -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
  )
}

function Get-ActiveLanIpv4Addresses {
  $addresses = @()
  $configs = Get-NetIPConfiguration | Where-Object {
    $_.NetAdapter.Status -eq "Up" -and
    $_.IPv4DefaultGateway -ne $null -and
    $_.IPv4Address -ne $null
  }

  foreach ($config in $configs) {
    foreach ($entry in @($config.IPv4Address)) {
      if ($entry -and (Test-IsPrivateIpv4 $entry.IPAddress)) {
        $addresses += $entry.IPAddress
      }
    }
  }

  return @($addresses | Sort-Object -Unique)
}

function Get-PortProxyEntries {
  $entries = @()
  $raw = netsh interface portproxy show all | Out-String
  foreach ($line in ($raw -split "`r?`n")) {
    if ($line -match '^\s*([0-9\.]+)\s+([0-9]+)\s+([0-9\.]+)\s+([0-9]+)\s*$') {
      $entries += [pscustomobject]@{
        ListenAddress = $matches[1]
        ListenPort = [int]$matches[2]
        ConnectAddress = $matches[3]
        ConnectPort = [int]$matches[4]
      }
    }
  }

  return $entries
}

function Remove-PortProxy($Config) {
  $matchingEntries = Get-PortProxyEntries | Where-Object {
    $_.ListenAddress -eq $Config.listenAddress -and
    $_.ListenPort -eq $Config.listenPort
  }

  foreach ($entry in $matchingEntries) {
    & netsh interface portproxy delete v4tov4 "listenaddress=$($entry.ListenAddress)" "listenport=$($entry.ListenPort)" | Out-Null
  }
}

function Ensure-PortProxy($Config) {
  $existing = Get-PortProxyEntries | Where-Object {
    $_.ListenAddress -eq $Config.listenAddress -and
    $_.ListenPort -eq $Config.listenPort -and
    $_.ConnectAddress -eq $Config.connectAddress -and
    $_.ConnectPort -eq $Config.connectPort
  }
  if ($existing) {
    return
  }

  Remove-PortProxy $Config
  & netsh interface portproxy add v4tov4 "listenaddress=$($Config.listenAddress)" "listenport=$($Config.listenPort)" "connectaddress=$($Config.connectAddress)" "connectport=$($Config.connectPort)" | Out-Null
}

function Ensure-FirewallRule($Config) {
  $existing = Get-NetFirewallRule -DisplayName $Config.firewallRuleName -ErrorAction SilentlyContinue
  if ($existing) {
    $existing | Remove-NetFirewallRule | Out-Null
  }

  New-NetFirewallRule `
    -DisplayName $Config.firewallRuleName `
    -Group "RemoCLI" `
    -Profile Private `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Protocol TCP `
    -LocalPort $Config.listenPort `
    -RemoteAddress $Config.firewallRemoteAddress | Out-Null
}

function Remove-FirewallRule($Config) {
  $existing = Get-NetFirewallRule -DisplayName $Config.firewallRuleName -ErrorAction SilentlyContinue
  if ($existing) {
    $existing | Remove-NetFirewallRule | Out-Null
  }
}

function Get-LanDirectStatus($Config) {
  $proxy = Get-PortProxyEntries | Where-Object {
    $_.ListenAddress -eq $Config.listenAddress -and $_.ListenPort -eq $Config.listenPort
  }
  $firewallRule = Get-NetFirewallRule -DisplayName $Config.firewallRuleName -ErrorAction SilentlyContinue
  $lanIps = Get-ActiveLanIpv4Addresses
  $healthChecks = @()

  foreach ($address in $lanIps) {
    $healthCode = "unreachable"
    try {
      $response = Invoke-WebRequest -Uri "http://${address}:$($Config.listenPort)/health" -UseBasicParsing -TimeoutSec 3
      $healthCode = $response.StatusCode
    } catch {
      $healthCode = "unreachable"
    }

    $healthChecks += [pscustomobject]@{
      address = $address
      url = "http://${address}:$($Config.listenPort)"
      health = $healthCode
    }
  }

  return [pscustomobject]@{
    enabled = $Config.enabled
    listenAddress = $Config.listenAddress
    listenPort = $Config.listenPort
    connectAddress = $Config.connectAddress
    connectPort = $Config.connectPort
    portProxyReady = [bool]$proxy
    firewallReady = [bool]$firewallRule
    lanUrls = $healthChecks
  }
}

function Write-LanDirectStatus($Config) {
  $status = Get-LanDirectStatus $Config
  if (-not $status.enabled) {
    Write-Output "[lan-direct] disabled"
    return
  }

  Write-Output "[lan-direct] listen=$($status.listenAddress):$($status.listenPort) -> $($status.connectAddress):$($status.connectPort)"
  Write-Output "[lan-direct] portproxy=$($status.portProxyReady) firewall=$($status.firewallReady)"
  foreach ($entry in @($status.lanUrls)) {
    Write-Output "[lan-direct] url=$($entry.url) health=$($entry.health)"
  }
}

$Config = Get-LanDirectConfig $Deployment

if ($Status) {
  Write-LanDirectStatus $Config
  exit 0
}

if (-not $Config.enabled) {
  Write-Output "[lan-direct] disabled"
  exit 0
}

if (-not (Test-IsAdministrator)) {
  throw "LAN direct setup requires an elevated Windows PowerShell session. Re-run this script as Administrator once to install the persistent LAN proxy rule."
}

if ($Stop) {
  Remove-PortProxy $Config
  Remove-FirewallRule $Config
  Write-LanDirectStatus $Config
  exit 0
}

Ensure-PortProxy $Config
Ensure-FirewallRule $Config
Write-LanDirectStatus $Config
