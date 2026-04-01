param(
  [Parameter(Mandatory = $true)]
  [string]$Distro,

  [Parameter(Mandatory = $true)]
  [string]$SessionName,

  [string]$WindowTitle = "",

  [switch]$AsAdmin
)

$ErrorActionPreference = "Stop"

function Convert-UncPathToWslPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Distro
  )

  $Prefix = "\\wsl.localhost\$Distro\"
  if (-not $Path.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  $Relative = $Path.Substring($Prefix.Length).TrimStart('\')
  if (-not $Relative) {
    return '/'
  }

  return '/' + ($Relative -replace '\\', '/')
}

$ScriptRootWsl = Convert-UncPathToWslPath -Path $PSScriptRoot -Distro $Distro
if (-not $ScriptRootWsl) {
  throw "Unable to resolve WSL path for $PSScriptRoot"
}

$TempScriptName = "remocli-open-$([guid]::NewGuid().ToString('N')).sh"
$TempScriptWsl = "/tmp/$TempScriptName"
$TempScriptUnc = "\\wsl.localhost\$Distro\tmp\$TempScriptName"
$TempScriptContent = @"
#!/usr/bin/env bash
if ! tmux has-session -t '$SessionName' 2>/dev/null; then
  echo 'Unknown tmux session: $SessionName' >&2
  exec bash -i
fi

tmux attach-session -t '$SessionName'
exec bash -i
"@

Set-Content -Path $TempScriptUnc -Value $TempScriptContent
& wsl.exe -d $Distro -- chmod +x $TempScriptWsl | Out-Null

$AttachArguments = @(
  "-d",
  $Distro,
  "--",
  "bash",
  "-lc",
  $TempScriptWsl
)
$Wt = Get-Command wt.exe -ErrorAction SilentlyContinue

if ($Wt) {
  $StartParams = @{
    FilePath = $Wt.Source
    ArgumentList = @("new-tab")
    WindowStyle = "Normal"
  }

  if ($WindowTitle) {
    $StartParams.ArgumentList += @("--title", $WindowTitle)
  }

  $StartParams.ArgumentList += @("wsl.exe")
  $StartParams.ArgumentList += $AttachArguments
  if ($AsAdmin) {
    $StartParams.Verb = "RunAs"
  }

  Start-Process @StartParams | Out-Null
  Write-Output "started:wt"
  exit 0
}

$FallbackParams = @{
  FilePath = "wsl.exe"
  ArgumentList = $AttachArguments
  WorkingDirectory = $env:USERPROFILE
  WindowStyle = "Normal"
}

if ($AsAdmin) {
  $FallbackParams.Verb = "RunAs"
}

Start-Process @FallbackParams | Out-Null
Write-Output "started:wsl"
