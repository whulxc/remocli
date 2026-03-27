param(
  [string]$TargetModel = "",
  [string]$TargetSerial = "",
  [int]$Port = 8080,
  [int]$PollIntervalSeconds = 2,
  [switch]$RunLoop,
  [switch]$Stop,
  [switch]$Status
)

$ErrorActionPreference = "Stop"
$WatcherName = "usb-reverse-watcher"
$StateRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "RemoCLI"
$PidPath = Join-Path $StateRoot "$WatcherName.pid"
$StatusPath = Join-Path $StateRoot "$WatcherName.status.json"
$DefaultAdbPath = "D:\software\Android\SDK\platform-tools\adb.exe"
$CurrentScriptPath = $MyInvocation.MyCommand.Path

function Ensure-StateRoot {
  if (-not (Test-Path $StateRoot)) {
    New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  }
}

function Write-WatcherStatus($State, $Message, $Serial = "") {
  Ensure-StateRoot
  [pscustomobject]@{
    state = $State
    message = $Message
    targetModel = $TargetModel
    targetSerial = $TargetSerial
    activeSerial = $Serial
    port = $Port
    updatedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json | Set-Content -Path $StatusPath -Encoding ascii
}

function Get-RunningWatcherProcess {
  if (-not (Test-Path $PidPath)) {
    return $null
  }

  $PidValue = Get-Content -Path $PidPath -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $PidValue) {
    return $null
  }

  try {
    return Get-Process -Id ([int]$PidValue) -ErrorAction Stop
  } catch {
    Remove-Item -Path $PidPath -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Resolve-AdbPath {
  if (Test-Path $DefaultAdbPath) {
    return $DefaultAdbPath
  }

  $Command = Get-Command adb -ErrorAction SilentlyContinue
  if ($Command -and $Command.Source) {
    return $Command.Source
  }

  throw "adb.exe not found. Expected $DefaultAdbPath or adb on Windows PATH."
}

function Get-DeviceLines($AdbPath) {
  $Lines = & $AdbPath devices -l 2>$null
  return @($Lines | Where-Object { $_ -match '^\S+\s+device\b' })
}

function Resolve-TargetDeviceSerial($AdbPath) {
  $Devices = Get-DeviceLines $AdbPath
  if ($TargetSerial) {
    $Line = $Devices | Where-Object { $_ -match ("^{0}\s+device\b" -f [regex]::Escape($TargetSerial)) } | Select-Object -First 1
    if ($Line) {
      return (($Line -split '\s+')[0]).Trim()
    }
    return $null
  }

  if ($TargetModel) {
    $ModelToken = "model:$TargetModel"
    $Line = $Devices | Where-Object { $_ -like "*$ModelToken*" } | Select-Object -First 1
    if ($Line) {
      return (($Line -split '\s+')[0]).Trim()
    }
    return $null
  }

  $First = $Devices | Select-Object -First 1
  if ($First) {
    return (($First -split '\s+')[0]).Trim()
  }

  return $null
}

function Test-ReverseMapping($AdbPath, $Serial) {
  $Mapping = "tcp:$Port tcp:$Port"
  $Lines = & $AdbPath -s $Serial reverse --list 2>$null
  return @($Lines | Where-Object { $_ -like "*$Mapping*" }).Count -gt 0
}

function Ensure-ReverseMapping($AdbPath, $Serial) {
  if (Test-ReverseMapping $AdbPath $Serial) {
    Write-WatcherStatus "ready" "adb reverse tcp:$Port -> tcp:$Port is ready" $Serial
    return
  }

  & $AdbPath -s $Serial reverse "tcp:$Port" "tcp:$Port" | Out-Null
  if (-not (Test-ReverseMapping $AdbPath $Serial)) {
    throw "adb reverse tcp:$Port -> tcp:$Port verification failed"
  }

  Write-WatcherStatus "ready" "restored adb reverse tcp:$Port -> tcp:$Port" $Serial
}

function Start-WatcherLoop {
  Ensure-StateRoot
  Set-Content -Path $PidPath -Value $PID -Encoding ascii
  Write-WatcherStatus "starting" "USB reverse watcher is starting"

  while ($true) {
    try {
      $AdbPath = Resolve-AdbPath
      & $AdbPath start-server | Out-Null
      $Serial = Resolve-TargetDeviceSerial $AdbPath
      if ($Serial) {
        Ensure-ReverseMapping $AdbPath $Serial
      } else {
        $Message = if ($TargetSerial) {
          "waiting for USB device reconnect: $TargetSerial"
        } elseif ($TargetModel) {
          "waiting for USB device reconnect: model:$TargetModel"
        } else {
          "waiting for any USB device reconnect"
        }
        Write-WatcherStatus "waiting-for-device" $Message
      }
    } catch {
      Write-WatcherStatus "error" $_.Exception.Message
    }

    Start-Sleep -Seconds $PollIntervalSeconds
  }
}

function Start-WatcherProcess {
  Ensure-StateRoot
  $RunningProcess = Get-RunningWatcherProcess
  if ($RunningProcess) {
    Write-Output ("USB reverse watcher already running (PID {0})" -f $RunningProcess.Id)
    return
  }

  $ArgumentList = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $CurrentScriptPath,
    "-RunLoop",
    "-Port",
    $Port.ToString(),
    "-PollIntervalSeconds",
    $PollIntervalSeconds.ToString()
  )
  if ($TargetModel) {
    $ArgumentList += @("-TargetModel", $TargetModel)
  }
  if ($TargetSerial) {
    $ArgumentList += @("-TargetSerial", $TargetSerial)
  }

  $Process = Start-Process -FilePath "powershell.exe" -ArgumentList $ArgumentList -WindowStyle Hidden -PassThru
  Set-Content -Path $PidPath -Value $Process.Id -Encoding ascii
  Write-WatcherStatus "starting" ("USB reverse watcher started, pid {0}" -f $Process.Id)
  Write-Output ("Started USB reverse watcher (PID {0})" -f $Process.Id)
}

function Stop-WatcherProcess {
  Ensure-StateRoot
  $RunningProcess = Get-RunningWatcherProcess
  if ($RunningProcess) {
    Stop-Process -Id $RunningProcess.Id -Force
    Write-WatcherStatus "stopped" ("USB reverse watcher stopped, pid {0}" -f $RunningProcess.Id)
    Remove-Item -Path $PidPath -Force -ErrorAction SilentlyContinue
    Write-Output ("Stopped USB reverse watcher (PID {0})" -f $RunningProcess.Id)
    return
  }

  Write-WatcherStatus "stopped" "USB reverse watcher is not running"
  Remove-Item -Path $PidPath -Force -ErrorAction SilentlyContinue
  Write-Output "USB reverse watcher is not running"
}

function Show-WatcherStatus {
  Ensure-StateRoot
  $RunningProcess = Get-RunningWatcherProcess
  $StatusData = $null
  if (Test-Path $StatusPath) {
    try {
      $StatusData = Get-Content -Path $StatusPath -Raw | ConvertFrom-Json
    } catch {
      $StatusData = $null
    }
  }

  if (-not $RunningProcess) {
    Write-Output "USB reverse watcher: stopped"
    if ($StatusData) {
      Write-Output ("  last_state={0} updated={1}" -f $StatusData.state, $StatusData.updatedAt)
      if ($StatusData.message) {
        Write-Output ("  {0}" -f $StatusData.message)
      }
    }
    return
  }

  $Summary = "USB reverse watcher: running"
  $Summary += " pid=$($RunningProcess.Id)"
  if ($StatusData) {
    $Summary += " state=$($StatusData.state)"
    if ($StatusData.activeSerial) {
      $Summary += " serial=$($StatusData.activeSerial)"
    }
  }
  Write-Output $Summary
  if ($StatusData) {
    Write-Output ("  target_model={0}" -f $StatusData.targetModel)
    if ($StatusData.targetSerial) {
      Write-Output ("  target_serial={0}" -f $StatusData.targetSerial)
    }
    Write-Output ("  updated={0}" -f $StatusData.updatedAt)
    if ($StatusData.message) {
      Write-Output ("  {0}" -f $StatusData.message)
    }
  }
}

if ($RunLoop) {
  Start-WatcherLoop
  exit 0
}

if ($Stop) {
  Stop-WatcherProcess
  exit 0
}

if ($Status) {
  Show-WatcherStatus
  exit 0
}

Start-WatcherProcess
