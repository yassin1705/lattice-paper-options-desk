$ErrorActionPreference = 'Stop'

$destinationDirectory = Join-Path $PSScriptRoot '..\.tools\cloudflared'
$destination = Join-Path $destinationDirectory 'cloudflared.exe'
$downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
Invoke-WebRequest -Uri $downloadUrl -OutFile $destination
& $destination --version
