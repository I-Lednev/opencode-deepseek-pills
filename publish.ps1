#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Token = "",
    [string]$TokenFile = "",
    [string]$Owner = "I-Lednev",
    [string]$Repo = "opencode-deepseek-pills",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

if (-not $Token -and $TokenFile) {
    if (-not (Test-Path -LiteralPath $TokenFile)) { throw "Файл с токеном не найден: $TokenFile" }
    $Token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
}

if (-not $Token) { throw "Укажите -Token или -TokenFile" }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$api = "https://api.github.com"
$headers = @{
    Authorization = "Bearer $Token"
    "User-Agent" = "OpenCode-DeepSeek-Pills"
    Accept = "application/vnd.github+json"
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        $Body = $null
    )

    $params = @{
        Method = $Method
        Uri = "$api$Path"
        Headers = $headers
    }

    if ($null -ne $Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 20 -Compress)
        $params.ContentType = "application/json"
    }

    try {
        return Invoke-RestMethod @params
    } catch {
        $status = $null
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        if ($status -eq 404) { return $null }
        throw
    }
}

Write-Host "GitHub: $Owner/$Repo"

$repoInfo = Invoke-Api -Method "GET" -Path "/repos/$Owner/$Repo"
if (-not $repoInfo) {
    Write-Host "Создаю репозиторий..."
    $created = Invoke-Api -Method "POST" -Path "/user/repos" -Body @{
        name = $Repo
        private = $false
        auto_init = $true
        description = "OpenCode Desktop pills: DeepSeek balance, spend, tariff and rates"
    }
    if (-not $created) { throw "Не удалось создать репозиторий" }
    Start-Sleep -Seconds 2
    $repoInfo = Invoke-Api -Method "GET" -Path "/repos/$Owner/$Repo"
} else {
    Write-Host "Репозиторий уже существует"
}

if ($repoInfo -and $repoInfo.default_branch) {
    $Branch = $repoInfo.default_branch
}
Write-Host "Ветка: $Branch"

$branches = Invoke-Api -Method "GET" -Path "/repos/$Owner/$Repo/branches"
$emptyRepo = -not $branches -or @($branches).Count -eq 0
if ($emptyRepo) { Write-Host "Репозиторий пустой: первый файл создаст ветку $Branch" }

$files = Get-ChildItem -Path $root -Recurse -File | Where-Object {
    $relative = $_.FullName.Substring($root.Length + 1)
    ($relative -notmatch '^(\.git|release|node_modules)(\\|/)') -and ($_.Name -notmatch '\.log$')
}

foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length + 1).Replace("\", "/")
    $content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))
    $existing = Invoke-Api -Method "GET" -Path "/repos/$Owner/$Repo/contents/$relative`?ref=$Branch"

    $body = @{
        message = "Update $relative"
        content = $content
    }
    if (-not $emptyRepo) { $body.branch = $Branch }
    if ($existing -and $existing.sha) { $body.sha = $existing.sha }

    Invoke-Api -Method "PUT" -Path "/repos/$Owner/$Repo/contents/$relative" -Body $body | Out-Null
    $emptyRepo = $false
    Write-Host "  + $relative"
}

Write-Host "Включаю GitHub Pages..."
$pages = Invoke-Api -Method "GET" -Path "/repos/$Owner/$Repo/pages"
$source = @{ branch = $Branch; path = "/docs" }

if (-not $pages) {
    Invoke-Api -Method "POST" -Path "/repos/$Owner/$Repo/pages" -Body @{ source = $source } | Out-Null
} else {
    Invoke-Api -Method "PUT" -Path "/repos/$Owner/$Repo/pages" -Body @{ source = $source } | Out-Null
}

$pagesOwner = $Owner.ToLowerInvariant()

Write-Host ""
Write-Host "Готово."
Write-Host "Страница:  https://$pagesOwner.github.io/$Repo/"
Write-Host "Манифест:  https://$pagesOwner.github.io/$Repo/version.json"
Write-Host "Подождите 1-2 минуты, пока GitHub Pages соберёт сайт."
