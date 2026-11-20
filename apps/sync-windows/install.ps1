# Installs Tinkjam Sync for the current user, with no administrator and no questions:
#   powershell -ExecutionPolicy Bypass -c "irm https://tinkjam.com/downloads/install.ps1 | iex"
# Downloads the installer windows.json names, checks its SHA-256 against the one there, and runs it silently.
# Safe to run again: when the same version is installed it only makes sure Tinkjam Sync is running.
# Arguments after the script name go to the installer (when run as a file, not through iex).
$ErrorActionPreference = 'Stop'
$downloads = if ($env:TINKJAM_SYNC_DOWNLOADS) { $env:TINKJAM_SYNC_DOWNLOADS.TrimEnd('/') } else { 'https://tinkjam.com/downloads' }
$extra = @($args)
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Tinkjam Sync'
for ($i = 0; $i -lt $extra.Count - 1; $i++) {
  if ($extra[$i] -eq '--install-dir') { $installDir = $extra[$i + 1] }
}
$installed = Join-Path $installDir 'TinkjamSync.exe'
# Windows PowerShell joins -ArgumentList items without quoting them.
function Join-Arguments($list) { ($list | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' ' }

$web = New-Object Net.WebClient
# windows.json names the version and its hash together, so a cache can never pair an old file with a new hash.
$manifest = $web.DownloadString("$downloads/windows.json") | ConvertFrom-Json
$expected = "$($manifest.sha256)".Trim().ToLowerInvariant()
if ($expected -notmatch '^[0-9a-f]{64}$') { throw "The published checksum is not readable: $expected" }
if (-not $manifest.version) { throw 'The published version is not readable.' }

if ((Test-Path $installed) -and (Get-FileHash -Algorithm SHA256 $installed).Hash.ToLowerInvariant() -eq $expected) {
  # Already this version. Starting it again only shows the running copy, or starts it if it stopped.
  if ($extra.Count -gt 0) { Start-Process -FilePath $installed -ArgumentList (Join-Arguments $extra) } else { Start-Process -FilePath $installed }
  Write-Host 'Tinkjam Sync is already installed and up to date. Its icon is near the clock (click the ^ arrow if it is not showing).'
  return
}

$setup = Join-Path ([IO.Path]::GetTempPath()) ('TinkjamSyncSetup-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
  Write-Host "Downloading Tinkjam Sync $(("$($manifest.version)" -split '\+')[0])..."
  $web.DownloadFile("$downloads/TinkjamSyncSetup.exe?v=" + [Uri]::EscapeDataString("$($manifest.version)"), $setup)
  $actual = (Get-FileHash -Algorithm SHA256 $setup).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "The download is damaged (SHA-256 $actual, expected $expected). Nothing was installed." }
  # Not -Wait: in Windows PowerShell that also waits for the app the installer starts, which keeps running.
  $process = Start-Process -FilePath $setup -ArgumentList (Join-Arguments (@('/install', '/silent') + $extra)) -PassThru
  $null = $process.Handle
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "The installer failed (exit code $($process.ExitCode)). Its log: $env:USERPROFILE\.tinkjam\logs\sync.log" }
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $setup
}
Write-Host 'Tinkjam Sync is installed and running. Its icon is near the clock (click the ^ arrow if it is not showing).'
Write-Host 'If this computer is not connected yet, a page opens in the browser: the person at this computer signs in and presses Connect.'
