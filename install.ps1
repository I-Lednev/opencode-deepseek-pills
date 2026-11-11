#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectDir = "",
    [switch]$SkipSessionImport,
    [switch]$ReplaceHistory
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configTarget = Join-Path $env:USERPROFILE ".config\opencode"

if (-not $ProjectDir) {
    $ProjectDir = (Get-Location).Path
}

function Copy-Directory {
    param([string]$Source, [string]$Destination)

    if (Test-Path -LiteralPath $Destination) {
        Copy-Item -Recurse -Force (Join-Path $Source "*") $Destination
    } else {
        Copy-Item -Recurse -Force $Source $Destination
    }
}

function Find-OpenCodeCli {
    $candidates = New-Object System.Collections.Generic.List[string]

    if ($env:OPENCODE_CLI) { $candidates.Add($env:OPENCODE_CLI) }

    # Desktop app CLI first: it shares auth/config with the app window.
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\ai.opencode.desktop\resources\opencode-cli.exe"))

    Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs") -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*opencode*" } |
        ForEach-Object { $candidates.Add((Join-Path $_.FullName "resources\opencode-cli.exe")) }

    $cmd = Get-Command opencode-cli.exe, opencode-cli, opencode.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($cmd) { $candidates.Add($cmd.Source) }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }

    return $null
}

function Ensure-PluginEntry {
    param(
        [string]$ConfigPath,
        [string]$Entry
    )

    $text = Get-Content -LiteralPath $ConfigPath -Raw
    if ($text -match [regex]::Escape($Entry)) {
        Write-Host "Плагин уже прописан в $ConfigPath"
        return
    }

    try {
        $config = $text | ConvertFrom-Json
    } catch {
        Write-Warning "В $ConfigPath есть комментарии или нестандартный JSON. Добавьте в массив 'plugins' строку '$Entry' вручную."
        return
    }

    $plugins = @()
    if ($config.PSObject.Properties.Name -contains "plugins") {
        $plugins = @($config.plugins)
    }

    if ($plugins -notcontains $Entry) {
        $plugins += $Entry
    }

    if ($config.PSObject.Properties.Name -contains "plugins") {
        $config.plugins = $plugins
    } else {
        $config | Add-Member -NotePropertyName plugins -NotePropertyValue $plugins
    }

    $json = $config | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "В $ConfigPath добавлен плагин $Entry"
}

Write-Host "Конфиг OpenCode: $configTarget"
New-Item -ItemType Directory -Force -Path $configTarget | Out-Null

Copy-Directory (Join-Path $root "config\deepseek-balance-plugin") (Join-Path $configTarget "deepseek-balance-plugin")
Copy-Directory (Join-Path $root "config\scripts") (Join-Path $configTarget "scripts")
Copy-Directory (Join-Path $root "config\commands") (Join-Path $configTarget "commands")

$dataTarget = Join-Path $env:USERPROFILE ".local\share\opencode"
New-Item -ItemType Directory -Force -Path $dataTarget | Out-Null

foreach ($name in @("deepseek-balance-rate-history.json", "deepseek-balance-cbr-history.json")) {
    $source = Join-Path $root "history\$name"
    $destination = Join-Path $dataTarget $name
    if (Test-Path -LiteralPath $source) {
        if ($ReplaceHistory -or -not (Test-Path -LiteralPath $destination)) {
            Copy-Item -Force $source $destination
            Write-Host "Скопирована история курсов: $name"
        } else {
            Write-Host "История уже есть, оставлена без изменений: $name"
        }
    }
}

$jsonPath = Join-Path $configTarget "opencode.json"
$jsoncPath = Join-Path $configTarget "opencode.jsonc"
$entry = "./deepseek-balance-plugin"

if ((Test-Path -LiteralPath $jsonPath) -and (Test-Path -LiteralPath $jsoncPath)) {
    Write-Warning "Найдены оба файла: opencode.json и opencode.jsonc. OpenCode может объединять их. Лучше оставить один."
}

if (Test-Path -LiteralPath $jsonPath) {
    Ensure-PluginEntry -ConfigPath $jsonPath -Entry $entry
} elseif (Test-Path -LiteralPath $jsoncPath) {
    Ensure-PluginEntry -ConfigPath $jsoncPath -Entry $entry
} else {
    Copy-Item (Join-Path $root "config\opencode.jsonc") $jsoncPath
    Write-Host "Создан $jsoncPath"
}

if (-not $SkipSessionImport) {
    $sessionPath = Join-Path $root "session.json"

    if (-not (Test-Path -LiteralPath $sessionPath)) {
        Write-Host "session.json не найден — импорт сессии пропущен."
    } else {
        $cli = Find-OpenCodeCli

        if (-not $cli) {
            Write-Warning "opencode CLI не найден. Импортируйте сессию вручную: opencode session import session.json --directory <проект>"
        } else {
            New-Item -ItemType Directory -Force -Path $ProjectDir | Out-Null
            Write-Host "Импорт сессии в $ProjectDir ..."
            & $cli session import $sessionPath --directory $ProjectDir
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Импорт завершился с кодом $LASTEXITCODE. Возможно, сессия уже импортирована."
            }
        }
    }
}

Write-Host ""
Write-Host "Готово. Осталось:"
Write-Host "1. Подключить DeepSeek API key (Settings -> Integrations/Providers -> DeepSeek)."
Write-Host "2. Запустить OpenCode и проверить пилюли."
Write-Host "3. Должны появиться 4 пилюли: баланс, тариф, курс plati с графиком и ссылкой, курс ЦБ с графиком."
Write-Host "4. Если пилюль не видно - нажать Ctrl+R или перезапустить OpenCode."
