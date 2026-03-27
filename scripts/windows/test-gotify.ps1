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

if (-not $Deployment.gotify.baseUrl -or -not $Deployment.gotify.token) {
  throw "gotify.baseUrl and gotify.token are required"
}

$BaseUrl = $Deployment.gotify.baseUrl.TrimEnd("/")
$Body = @{
  title = "RemoCLI test"
  message = "RemoCLI formal deployment path is live."
  priority = 5
  extras = @{
    "client::display" = @{
      contentType = "text/plain"
    }
  }
}

if ($Deployment.gateway.mobileDeepLinkBase -and $Deployment.gateway.publicBaseUrl) {
  $Gateway = [System.Uri]::EscapeDataString($Deployment.gateway.publicBaseUrl)
  $ClickUrl = "$($Deployment.gateway.mobileDeepLinkBase)?gateway=$Gateway"
  $Body.extras["client::notification"] = @{
    click = @{
      url = $ClickUrl
    }
  }
}

Invoke-RestMethod -Method Post -Uri "$BaseUrl/message?token=$($Deployment.gotify.token)" -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 8)
