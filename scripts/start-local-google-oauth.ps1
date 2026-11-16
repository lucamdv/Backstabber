$ErrorActionPreference = 'Stop'

function Invoke-SupabaseCli {
    param([string[]]$CliArguments, [string]$FailureMessage)

    $npx = Get-Command npx.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1
    # Windows PowerShell 5.1 treats a native stderr progress line as an error record.
    $ErrorActionPreference = 'Continue'
    & $npx.Source --yes --package supabase@3.1.0 -- supabase @CliArguments --workdir $repo --agent no 2>$null
    if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

$repo = Split-Path -Parent $PSScriptRoot
$config = Join-Path $repo 'supabase/config.toml'
$original = [IO.File]::ReadAllBytes($config)
$source = [Text.Encoding]::UTF8.GetString($original)
$provider = [regex]'(?m)^(\[auth\.external\.google\][^\r\n]*\r?\n(?:#[^\r\n]*\r?\n)*)enabled = false(?=\r?$)'
$enabled = $provider.Replace($source, '${1}enabled = true', 1)
if ($enabled -eq $source) {
    throw 'Expected Google to be disabled in the local Supabase config.'
}

$clientIdName = 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID'
$secretName = 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET'
$originalClientId = [Environment]::GetEnvironmentVariable($clientIdName, 'Process')
$originalSecret = [Environment]::GetEnvironmentVariable($secretName, 'Process')
try {
    if ([string]::IsNullOrWhiteSpace($originalClientId)) {
        [Environment]::SetEnvironmentVariable($clientIdName, (Read-Host 'Google OAuth Client ID'), 'Process')
    }
    if ([string]::IsNullOrWhiteSpace($originalSecret)) {
        $maskedSecret = Read-Host 'Google OAuth Client Secret' -AsSecureString
        [Environment]::SetEnvironmentVariable($secretName, [Net.NetworkCredential]::new('', $maskedSecret).Password, 'Process')
    }
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($clientIdName, 'Process')) -or
        [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($secretName, 'Process'))) {
        throw 'Both OAuth variables must be set for this local run.'
    }

    Write-Host 'Iniciando Auth, PostgreSQL e Realtime locais no Docker...'
    try {
        [IO.File]::WriteAllText($config, $enabled)
        $extras = 'storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
        Invoke-SupabaseCli -CliArguments @('start', '--exclude', $extras, '--ignore-health-check') `
            -FailureMessage 'Local Supabase startup failed. Check Docker Desktop and whether the ports are in use.' | Out-Null
    } finally {
        [IO.File]::WriteAllBytes($config, $original)
    }
    Write-Host 'Verificando o Auth local e o provedor Google...'
    $statusJson = Invoke-SupabaseCli -CliArguments @('status', '--output', 'json') `
        -FailureMessage 'Could not verify local Supabase status.'
    $status = ($statusJson -join [Environment]::NewLine) | ConvertFrom-Json
    if ($status.API_URL -ne 'http://127.0.0.1:54321') { throw 'Unexpected local Auth URL.' }
    $publicKey = $status.PUBLISHABLE_KEY
    if (-not $publicKey) { $publicKey = $status.ANON_KEY }
    $auth = $null
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        try {
            $auth = Invoke-RestMethod -Uri 'http://127.0.0.1:54321/auth/v1/settings' `
                -Headers @{ apikey = $publicKey } -MaximumRedirection 0 -TimeoutSec 5
            break
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    if (-not $auth) { throw 'The local Auth endpoint did not become ready.' }
    if ($auth.external.google -ne $true) { throw 'Google is disabled in the running stack. Stop the local stack and try again.' }
    Write-Output 'Supabase local iniciado. Google habilitado nesta instancia local. Configuracao padrao restaurada.'
} finally {
    [Environment]::SetEnvironmentVariable($clientIdName, $originalClientId, 'Process')
    [Environment]::SetEnvironmentVariable($secretName, $originalSecret, 'Process')
    if ($maskedSecret) { $maskedSecret.Dispose() }
}
