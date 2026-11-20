# Builds dist\TinkjamSyncSetup.exe (the app; it installs itself), its .sha256, windows.json and install.ps1.
# Publish all four to /downloads/ on the site (tinkjam.com and trellium.org serve the same files).
# windows.json names the installer on trellium.org, which every installed copy and every network
# told to allow it reaches. Signs with signtool when TINKJAM_SIGN_THUMBPRINT
# names a code-signing certificate in the current user's store; otherwise the exe stays unsigned.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$downloads = 'https://trellium.org/downloads'
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$repo = Resolve-Path (Join-Path $root '..\..')
# windows.json is signed with the release key (scripts/sign-release.ts); installed copies refuse it unsigned.
$releaseKey = if ($env:TINKJAM_RELEASE_KEY) { $env:TINKJAM_RELEASE_KEY } else { Join-Path $HOME '.tinkjam-release\release-key.pem' }
if (-not (Test-Path $releaseKey)) { throw "No release key at $releaseKey (TINKJAM_RELEASE_KEY): windows.json can't be signed, so nothing was built." }

[xml]$project = Get-Content (Join-Path $root 'TinkjamSync.csproj')
$prefix = @($project.Project.PropertyGroup | ForEach-Object { $_.VersionPrefix } | Where-Object { $_ })[0]
# Every build is newer than the last, like the Sync package: <prefix>+<UTC yyyymmddhhmm>.
$version = "$prefix+" + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmm')

dotnet build (Join-Path $root 'TinkjamSync.csproj') -c Release -nologo -v q "-p:InformationalVersion=$version"
if ($LASTEXITCODE -ne 0) { throw "dotnet build failed ($LASTEXITCODE)" }
$exe = Join-Path $root 'bin\Release\net48\TinkjamSync.exe'

# A GUI exe only waits and prints when its output is piped.
& $exe --self-test | Write-Host
if ($LASTEXITCODE -ne 0) { throw 'self-test failed' }

if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force $dist | Out-Null
$setup = Join-Path $dist 'TinkjamSyncSetup.exe'
Copy-Item $exe $setup

if ($env:TINKJAM_SIGN_THUMBPRINT) {
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $signtool) { throw 'signtool.exe not found (Windows SDK).' }
  & $signtool.FullName sign /sha1 $env:TINKJAM_SIGN_THUMBPRINT /s My /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d 'Tinkjam Sync' $setup
  if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }
} else {
  Write-Host 'Not signed: set TINKJAM_SIGN_THUMBPRINT to sign.'
}

$sha = (Get-FileHash -Algorithm SHA256 $setup).Hash.ToLowerInvariant()
$utf8 = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText("$setup.sha256", "$sha  TinkjamSyncSetup.exe`n", $utf8)
# The version in the address keeps a cache from handing out an older installer under a newer manifest.
$manifest = [ordered]@{
  version = $version
  url = "$downloads/TinkjamSyncSetup.exe?v=" + [Uri]::EscapeDataString($version)
  sha256 = $sha
}
$windowsJson = Join-Path $dist 'windows.json'
[IO.File]::WriteAllText($windowsJson, ($manifest | ConvertTo-Json) + "`n", $utf8)
node (Join-Path $repo 'scripts\sign-release.ts') sign $windowsJson
if ($LASTEXITCODE -ne 0) { Remove-Item $windowsJson; throw 'Signing windows.json failed; it was removed so an unsigned one is never published.' }
Copy-Item (Join-Path $root 'install.ps1') (Join-Path $dist 'install.ps1')

$bytes = (Get-Item $setup).Length
if ($bytes -gt 25MB) { throw 'TinkjamSyncSetup.exe is over the 25 MB a static asset may be.' }
Write-Host ("Wrote $setup ({0:N0} KB), version $version, sha256 $sha" -f ($bytes / 1KB))
Write-Host "Publish dist\* to $downloads/"
