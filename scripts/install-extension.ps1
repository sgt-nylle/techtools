<#
 TechTools browser extension - easy installer for Windows (Chrome / Edge / Brave).

   irm https://techtools.subwrite.se/downloads/install-extension.ps1 | iex
   .\scripts\install-extension.ps1 [-Open] [-Browser chrome|edge|brave] [-Dir C:\path]

 Downloads the latest packaged extension (or uses ./extension/dist when run from the repo),
 unpacks it to %LOCALAPPDATA%\TechTools\extension, copies the folder path to the clipboard
 and shows the one-time "Load unpacked" step. Re-run to update.
#>
param(
  [switch]$Open,
  [ValidateSet('chrome','edge','brave','')][string]$Browser = '',
  [string]$Dir = (Join-Path $env:LOCALAPPDATA 'TechTools\extension')
)
$ErrorActionPreference = 'Stop'
$base = if ($env:TECHTOOLS_URL) { $env:TECHTOOLS_URL } else { 'https://techtools.subwrite.se' }
$zipUrl = "$base/downloads/techtools-extension.zip"

$local = if ($PSScriptRoot) { Join-Path $PSScriptRoot '..\extension\dist' } else { $null }
if ((Test-Path $Dir) -and (Get-ChildItem $Dir -Force | Select-Object -First 1)) {
  $m = Join-Path $Dir 'manifest.json'
  if (-not ((Test-Path $m) -and ((Get-Content $m -Raw) -match '"name":\s*"TechTools'))) {
    throw "Refusing to overwrite non-empty folder that is not a TechTools install: $Dir"
  }
  Remove-Item $Dir -Recurse -Force
}
New-Item -ItemType Directory -Path $Dir -Force | Out-Null

if ($local -and (Test-Path (Join-Path $local 'manifest.json'))) {
  Write-Host "==> Using local build: $local" -ForegroundColor Cyan
  Copy-Item (Join-Path $local '*') $Dir -Recurse -Force
} else {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) 'techtools-extension.zip'
  Write-Host "==> Downloading $zipUrl" -ForegroundColor Cyan
  Invoke-WebRequest -Uri $zipUrl -OutFile $tmp -UseBasicParsing
  Expand-Archive -Path $tmp -DestinationPath $Dir -Force
  Remove-Item $tmp -Force
}

$manifest = Join-Path $Dir 'manifest.json'
if (-not (Test-Path $manifest)) { throw "Install failed: manifest.json missing in $Dir" }
$version = (Get-Content $manifest -Raw | ConvertFrom-Json).version
Write-Host "==> TechTools extension v$version unpacked to: $Dir" -ForegroundColor Cyan
try { Set-Clipboard -Value $Dir; Write-Host "==> Folder path copied to clipboard." -ForegroundColor Cyan } catch {}

Write-Host @"

Finish in your browser (one-time, ~10 seconds):
  1. Open  chrome://extensions   (Edge: edge://extensions  |  Brave: brave://extensions)
  2. Turn on "Developer mode"
  3. Click "Load unpacked" and paste/choose:
       $Dir
  4. Pin the TechTools icon, then press Alt+Shift+T (popup) or Alt+Shift+S (side panel).

Update later by re-running this script, then click the reload icon on the extension card.
"@

if ($Open) {
  $targets = @(
    @{ n='chrome'; exe='chrome.exe'; url='chrome://extensions' },
    @{ n='edge';   exe='msedge.exe'; url='edge://extensions' },
    @{ n='brave';  exe='brave.exe';  url='brave://extensions' }
  )
  foreach ($t in $targets) {
    if ($Browser -and $Browser -ne $t.n) { continue }
    try { Start-Process $t.exe $t.url; Write-Host "==> Opened $($t.url)" -ForegroundColor Cyan; break } catch {}
  }
}
