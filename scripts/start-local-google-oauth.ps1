$ErrorActionPreference = 'Stop'

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

    try {
        [IO.File]::WriteAllText($config, $enabled)
        & npx.cmd --yes --package supabase@3.1.0 -- supabase start --workdir $repo --agent no *> $null
        if ($LASTEXITCODE -ne 0) {
            throw 'Local Supabase startup failed. Check Docker Desktop and whether the ports are in use.'
        }
    } finally {
        [IO.File]::WriteAllBytes($config, $original)
    }
    $statusJson = & npx.cmd --yes --package supabase@3.1.0 -- supabase status --workdir $repo --agent no --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify local Supabase status.' }
    $status = ($statusJson -join [Environment]::NewLine) | ConvertFrom-Json
    if ($status.API_URL -ne 'http://127.0.0.1:54321') { throw 'Unexpected local Auth URL.' }
    $publicKey = $status.PUBLISHABLE_KEY
    if (-not $publicKey) { $publicKey = $status.ANON_KEY }
    $auth = Invoke-RestMethod -Uri 'http://127.0.0.1:54321/auth/v1/settings' `
        -Headers @{ apikey = $publicKey } -MaximumRedirection 0 -TimeoutSec 10
    if ($auth.external.google -ne $true) { throw 'Google is disabled in the running stack. Stop the local stack and try again.' }
    Write-Output 'Supabase local iniciado. Google habilitado nesta instancia local. Configuracao padrao restaurada.'
} finally {
    [Environment]::SetEnvironmentVariable($clientIdName, $originalClientId, 'Process')
    [Environment]::SetEnvironmentVariable($secretName, $originalSecret, 'Process')
    if ($maskedSecret) { $maskedSecret.Dispose() }
}
