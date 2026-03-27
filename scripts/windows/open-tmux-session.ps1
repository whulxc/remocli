param(
  [Parameter(Mandatory = $true)]
  [string]$Distro,

  [Parameter(Mandatory = $true)]
  [string]$SessionName,

  [string]$WindowTitle = "",

  [switch]$AsAdmin
)

$ErrorActionPreference = "Stop"

$AttachArguments = @(
  "-d",
  $Distro,
  "--",
  "tmux",
  "attach-session",
  "-t",
  $SessionName
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
  WindowStyle = "Normal"
}

if ($AsAdmin) {
  $FallbackParams.Verb = "RunAs"
}

Start-Process @FallbackParams | Out-Null
Write-Output "started:wsl"
