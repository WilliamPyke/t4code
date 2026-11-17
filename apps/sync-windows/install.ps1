# Installs Tinkjam Sync for the current user, with no administrator and no questions:
#   powershell -ExecutionPolicy Bypass -c "irm https://trellium.org/downloads/install.ps1 | iex"
# Downloads the installer, checks its SHA-256 against the published one, and runs it silently.
# Safe to run again: when the same version is installed it only makes sure Tinkjam Sync is running.
# Arguments after the script name go to the installer (when run as a file, not through iex).
$ErrorActionPreference = 'Stop'
$downloads = if ($env:TINKJAM_SYNC_DOWNLOADS) { $env:TINKJAM_SYNC_DOWNLOADS.TrimEnd('/') } else { 'https://trellium.org/downloads' }
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
$expected = ($web.DownloadString("$downloads/TinkjamSyncSetup.exe.sha256").Trim() -split '\s+')[0].ToLowerInvariant()
if ($expected -notmatch '^[0-9a-f]{64}$') { throw "The published checksum is not readable: $expected" }

if ((Test-Path $installed) -and (Get-FileHash -Algorithm SHA256 $installed).Hash.ToLowerInvariant() -eq $expected) {
  # Already this version. Starting it again only shows the running copy, or starts it if it stopped.
  if ($extra.Count -gt 0) { Start-Process -FilePath $installed -ArgumentList (Join-Arguments $extra) } else { Start-Process -FilePath $installed }
  Write-Host 'Tinkjam Sync is already installed and up to date. It is running in the tray, by the clock.'
  return
}

$setup = Join-Path ([IO.Path]::GetTempPath()) ('TinkjamSyncSetup-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
  Write-Host 'Downloading Tinkjam Sync...'
  $web.DownloadFile("$downloads/TinkjamSyncSetup.exe", $setup)
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
Write-Host 'Tinkjam Sync is installed and running in the tray, by the clock.'
Write-Host 'If this computer is not connected yet, a page opens in the browser: the person at this computer signs in and presses Connect.'
