#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Notes = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$gui = Join-Path $root "src\gui-experimental.cjs"
$text = [IO.File]::ReadAllText($gui)
$match = [regex]::Match($text, 'PLUGIN_VERSION\s*=\s*"([^"]+)"')
if (-not $match.Success) { throw "PLUGIN_VERSION не найден в src\gui-experimental.cjs" }
$version = $match.Groups[1].Value

$release = Join-Path $root "release"
if (Test-Path $release) { Remove-Item $release -Recurse -Force }

$config = Join-Path $release "config"
$plugin = Join-Path $config "deepseek-balance-plugin"
New-Item -ItemType Directory -Force -Path $plugin, (Join-Path $config "scripts"), (Join-Path $config "commands") | Out-Null

Copy-Item (Join-Path $root "src\index.js") (Join-Path $plugin "index.js")
Copy-Item (Join-Path $root "src\gui-experimental.cjs") (Join-Path $plugin "gui-experimental.cjs")
Copy-Item (Join-Path $root "scripts\deepseek-balance.ps1") (Join-Path $config "scripts\deepseek-balance.ps1")
Copy-Item (Join-Path $root "commands\balance.md") (Join-Path $config "commands\balance.md")
Copy-Item (Join-Path $root "install.ps1") (Join-Path $release "install.ps1")
Copy-Item (Join-Path $root "README.md") (Join-Path $release "README.md")

$utf8 = New-Object System.Text.UTF8Encoding($false)

$pkg = [ordered]@{
    name = "opencode-deepseek-pills"
    version = $version
    private = $true
    type = "module"
    exports = [ordered]@{
        "." = "./index.js"
        "./gui-experimental" = "./gui-experimental.cjs"
    }
} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $plugin "package.json"), $pkg, $utf8)

$cfg = [ordered]@{
    '$schema' = "https://opencode.ai/config.json"
    plugins = @("./deepseek-balance-plugin")
} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $config "opencode.jsonc"), $cfg, $utf8)

$docs = Join-Path $root "docs"
New-Item -ItemType Directory -Force -Path $docs | Out-Null
$zip = Join-Path $docs "opencode-transfer.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(
    $release,
    $zip,
    [IO.Compression.CompressionLevel]::Optimal,
    $false
)

$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()

if (-not $Notes) {
    $notesFile = Join-Path $root "RELEASE_NOTES.md"
    if (Test-Path $notesFile) { $Notes = ([IO.File]::ReadAllText($notesFile)).Trim() }
}
if (-not $Notes) { $Notes = "Версия $version" }

$manifest = [ordered]@{
    version = $version
    zip = "https://raw.githubusercontent.com/I-Lednev/opencode-deepseek-pills/main/docs/opencode-transfer.zip"
    sha256 = $hash
    size = (Get-Item $zip).Length
    notes = $Notes
    publishedAt = (Get-Date).ToString("yyyy-MM-dd")
} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $docs "version.json"), $manifest, $utf8)

$rootPkgPath = Join-Path $root "package.json"
if (Test-Path $rootPkgPath) {
    $rootPkg = Get-Content $rootPkgPath -Raw | ConvertFrom-Json
    $rootPkg.version = $version
    [IO.File]::WriteAllText($rootPkgPath, ($rootPkg | ConvertTo-Json -Depth 20), $utf8)
}

Write-Host "Версия:   $version"
Write-Host "ZIP:      $zip"
Write-Host "SHA-256:  $hash"
Write-Host "Манифест: $(Join-Path $docs 'version.json')"
Write-Host ""
Write-Host "Дальше: .\publish.ps1 -Token ""ghp_..."""
