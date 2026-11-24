#Requires -Version 7.0
param(
    [switch]$AllowLocalAuthBrowserProof,
    [string]$SupabaseCommand = 'supabase'
)

# Opt-in REAL browser Auth proof. Only game profile/friends/rooms endpoints are stubbed.
# Reuses the existing auth-email-proof stack. Creates no services, schema or remote accounts.
# CLI output, credentials, mailbox bodies and browser output remain in memory and are filtered.
$ErrorActionPreference = 'Stop'
$stage = 'GUARD'
$vite = $null
if (-not $AllowLocalAuthBrowserProof) { Write-Output 'FAIL AUTH_BROWSER_GUARD'; exit 1 }

function New-ProofProcess {
    param([string]$Command, [string[]]$Arguments, [hashtable]$Variables = @{}, [string]$Directory = $repoRoot)
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Command
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    foreach ($name in @($info.Environment.Keys)) {
        if ($name -like 'SUPABASE_*' -or $name -like 'VITE_*' -or $name -like 'BACKSTABBER_*') { [void]$info.Environment.Remove($name) }
    }
    foreach ($name in $Variables.Keys) { $info.Environment[$name] = $Variables[$name] }
    $child = [System.Diagnostics.Process]::new()
    $child.StartInfo = $info
    [void]$child.Start()
    return @{ Process = $child; Out = $child.StandardOutput.ReadToEndAsync(); Error = $child.StandardError.ReadToEndAsync() }
}

function Invoke-ProofProcess {
    param([string]$Command, [string[]]$Arguments, [hashtable]$Variables = @{}, [string]$Directory = $repoRoot)
    $child = New-ProofProcess $Command $Arguments $Variables $Directory
    try {
        if (-not $child.Process.WaitForExit(240000)) { $child.Process.Kill($true); throw 'LOCAL_PROCESS_TIMEOUT' }
        return @{ ExitCode = $child.Process.ExitCode; Out = $child.Out.GetAwaiter().GetResult(); Error = $child.Error.GetAwaiter().GetResult() }
    } finally { $child.Process.Dispose() }
}

try {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $fixtureRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '../work/auth-email-proof'))
    $fixture = Get-Content -LiteralPath (Join-Path $fixtureRoot 'supabase/config.toml') -Raw
    if ($fixture -notmatch '(?m)^project_id = "auth-email-proof"$') { throw 'LOCAL_PROJECT_REQUIRED' }
    $cli = (Get-Command $SupabaseCommand -ErrorAction Stop).Source
    $node = (Get-Command node -ErrorAction Stop).Source
    $stage = 'CLI_STATUS'
    $status = Invoke-ProofProcess $cli @('status', '--workdir', $fixtureRoot, '-o', 'json')
    if ($status.ExitCode -ne 0) { throw 'LOCAL_STATUS_FAILED' }
    $local = $status.Out | ConvertFrom-Json
    $publicKey = [string]$local.PUBLISHABLE_KEY
    if (-not $publicKey) { $publicKey = [string]$local.ANON_KEY }
    $validKey = $publicKey -match '^sb_publishable_[\w-]+$'
    if (-not $validKey -and $publicKey -match '^[\w-]+\.[\w-]+\.[\w-]+$') {
        $payload = $publicKey.Split('.')[1].Replace('-', '+').Replace('_', '/')
        $payload = $payload.PadRight($payload.Length + (4 - $payload.Length % 4) % 4, '=')
        $decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
        $validKey = $decoded.role -eq 'anon'
    }
    if ($local.API_URL -ne 'http://127.0.0.1:55441' -or -not $validKey) { throw 'LOCAL_PUBLIC_CONFIG_REQUIRED' }
    Write-Output 'PASS AUTH_BROWSER_LOOPBACK_CONFIG'
    $stage = 'LOCAL_RUNTIME'
    $inspection = Invoke-ProofProcess (Get-Command docker -ErrorAction Stop).Source @('inspect', 'supabase_auth_auth-email-proof')
    if ($inspection.ExitCode -ne 0) { throw 'LOCAL_AUTH_REQUIRED' }
    $container = @($inspection.Out | ConvertFrom-Json)[0]
    $variables = @{}
    foreach ($entry in $container.Config.Env) { $parts = $entry.Split('=', 2); $variables[$parts[0]] = $parts[1] }
    if ($container.Name -ne '/supabase_auth_auth-email-proof' -or $container.State.Health.Status -ne 'healthy' -or
        $variables['GOTRUE_MAILER_AUTOCONFIRM'] -ne 'false' -or $variables['GOTRUE_EXTERNAL_GOOGLE_ENABLED'] -eq 'true' -or
        $variables['GOTRUE_SMTP_HOST'] -notmatch '^supabase_(inbucket|mailpit)_auth-email-proof$') { throw 'LOCAL_RUNTIME_REQUIRED' }
    Write-Output 'PASS AUTH_BROWSER_LOCAL_RUNTIME'
    $webRoot = Join-Path $repoRoot 'web'
    $environment = @{
        VITE_SUPABASE_URL = 'http://127.0.0.1:55441'
        VITE_SUPABASE_PUBLISHABLE_KEY = $publicKey
        VITE_GAME_SCHEMA = 'bs_staging'
        VITE_API_URL = 'http://127.0.0.1:18085/api/v1'
        BACKSTABBER_E2E_URL = 'http://127.0.0.1:4263'
        BACKSTABBER_AUTH_EMAIL_BROWSER = 'auth-email-proof'
        BACKSTABBER_AUTH_EMAIL_BROWSER_PROJECT = 'auth-email-proof'
        BACKSTABBER_AUTH_EMAIL_BROWSER_URL = 'http://127.0.0.1:55441'
        BACKSTABBER_AUTH_EMAIL_BROWSER_PUBLIC_KEY = $publicKey
    }
    $stage = 'VITE_LOCAL'
    $vite = New-ProofProcess $node @((Join-Path $webRoot 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4263', '--strictPort') $environment $webRoot
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($vite.Process.HasExited) { throw 'LOCAL_VITE_FAILED' }
        try {
            $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4263/' -TimeoutSec 2 -MaximumRedirection 0
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'LOCAL_VITE_UNAVAILABLE' }
    Write-Output 'PASS AUTH_BROWSER_LOCAL_VITE HTTP_200'
    $stage = 'REAL_CONTROLLER_PROOF'
    $result = Invoke-ProofProcess $node @((Join-Path $webRoot 'node_modules/@playwright/test/cli.js'), 'test', 'e2e/auth-email-browser.spec.ts', '--workers=1', '--reporter=list') $environment $webRoot
    foreach ($line in ($result.Out -split '\r?\n')) {
        $safe = ($line -replace '\x1b\[[0-9;]*[A-Za-z]', '').Trim()
        if ($safe -match '^(PASS|FAIL) AUTH_BROWSER_[A-Z0-9_]+(?: HTTP_[1-5][0-9]{2})?$') { Write-Output $safe }
    }
    if ($result.ExitCode -ne 0) { throw 'LOCAL_BROWSER_PROOF_FAILED' }
    Write-Output 'PASS AUTH_BROWSER_COMPLETE'
} catch {
    Write-Output "FAIL AUTH_BROWSER_$stage"
    exit 1
} finally {
    if ($vite) {
        if (-not $vite.Process.HasExited) { $vite.Process.Kill($true) }
        $vite.Process.Dispose()
    }
}
