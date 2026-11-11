#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$IntegrationID = "deepseek",
    [string]$ApiBase = "https://api.deepseek.com"
)

$ErrorActionPreference = "Stop"

try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
} catch { }

function Find-OpenCodeCli {
    $candidates = New-Object System.Collections.Generic.List[string]

    if ($env:OPENCODE_CLI) { $candidates.Add($env:OPENCODE_CLI) }

    # Desktop app CLI first: it shares auth and config with the app window.
    # A separate npm opencode install (V1) may be earlier in PATH and use other credentials.
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\ai.opencode.desktop\resources\opencode-cli.exe"))

    Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs") -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*opencode*" } |
        ForEach-Object { $candidates.Add((Join-Path $_.FullName "resources\opencode-cli.exe")) }

    $cmd = Get-Command opencode-cli.exe, opencode-cli, opencode.exe, opencode -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($cmd) { $candidates.Add($cmd.Source) }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }

    return $null
}

function Get-DeepSeekKey {
    if ($env:DEEPSEEK_API_KEY) { return $env:DEEPSEEK_API_KEY }

    $cli = Find-OpenCodeCli
    if (-not $cli) {
        throw "opencode CLI not found. Set DEEPSEEK_API_KEY or OPENCODE_CLI."
    }

    $raw = (& $cli auth export 2>$null | Out-String).Trim()
    if (-not $raw) { throw "opencode auth export returned nothing." }

    $parsed = $raw | ConvertFrom-Json
    $all = @()
    foreach ($item in $parsed) { $all += $item }

    $credentials = @($all | Where-Object {
        $_.integrationID -eq $IntegrationID -and $_.value.type -eq "key" -and $_.value.key
    })

    if ($credentials.Count -eq 0) {
        throw "No saved key for integration '$IntegrationID'. Connect DeepSeek in OpenCode settings."
    }

    $active = @($credentials | Where-Object { $_.active -eq $true })
    if ($active.Count -gt 0) { return $active[0].value.key }

    return $credentials[0].value.key
}

try {
    $key = Get-DeepSeekKey
    $response = Invoke-RestMethod `
        -Uri "$ApiBase/user/balance" `
        -Headers @{ Authorization = "Bearer $key"; Accept = "application/json" } `
        -TimeoutSec 20

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("DeepSeek API balance")

    foreach ($info in ($response.balance_infos | Sort-Object { [decimal]$_.total_balance } -Descending)) {
        $line = "  {0} {1}  (topped up: {2}, granted: {3})" -f `
            $info.currency, $info.total_balance, $info.topped_up_balance, $info.granted_balance
        $lines.Add($line)
    }

    $status = if ($response.is_available) { "available" } else { "insufficient balance" }
    $lines.Add("  Status: $status")

    $lines -join [Environment]::NewLine
}
catch {
    "DeepSeek balance error: $($_.Exception.Message)"
    exit 1
}
