#Requires -Version 7.0
param(
    [switch]$AllowLocalAuthProof,
    [switch]$StartOnly,
    [switch]$RunOnly,
    [string]$SupabaseCommand = 'supabase'
)

# Explicit opt-in: creates real disposable local Auth accounts and sends only to local Mailpit.
# All CLI JSON, keys, email contents and generated credentials stay in process memory.
# Run with -AllowLocalAuthProof -SupabaseCommand <absolute supabase.exe path>.
# -StartOnly leaves the isolated stack ready; -RunOnly reuses it. Success leaves it running.
# CLI v3: https://supabase.com/changelog/supabase-cli-v3
# SMTP/template config: https://supabase.com/docs/guides/local-development/cli/config
$ErrorActionPreference = 'Stop'
$stage = 'LOCAL_AUTH_GUARD'
if (-not $AllowLocalAuthProof -or ($StartOnly -and $RunOnly)) {
    Write-Output 'FAIL LOCAL_AUTH_GUARD'
    exit 1
}

function Invoke-Captured {
    param([string]$Command, [string[]]$Arguments, [hashtable]$Variables = @{})
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Command
    $info.WorkingDirectory = $repoRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    # Shell Supabase settings take precedence in CLI v3. Prevent inherited hosted/SMTP settings.
    foreach ($name in @($info.Environment.Keys)) {
        if ($name -like 'SUPABASE_*' -or $name -like 'VITE_SUPABASE_*' -or $name -like 'BACKSTABBER_AUTH_EMAIL_PROOF*') {
            [void]$info.Environment.Remove($name)
        }
    }
    foreach ($name in $Variables.Keys) { $info.Environment[$name] = $Variables[$name] }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(600000)) {
            $process.Kill($true)
            throw 'LOCAL_PROCESS_TIMEOUT'
        }
        return @{ ExitCode = $process.ExitCode; Out = $stdout.GetAwaiter().GetResult(); Error = $stderr.GetAwaiter().GetResult() }
    } finally { $process.Dispose() }
}

try {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '..'))
    $fixtureRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot 'work/auth-email-proof'))
    $expectedRoot = Join-Path $workspaceRoot 'work'
    if (-not $fixtureRoot.StartsWith($expectedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'LOCAL_FIXTURE_PATH_INVALID'
    }
    $cli = (Get-Command $SupabaseCommand -ErrorAction Stop).Source
    $stage = 'CLI_VERSION'
    $version = Invoke-Captured $cli @('--version')
    if ($version.ExitCode -ne 0 -or $version.Out -notmatch '(?m)^3\.[1-9][0-9]*\.') { throw 'CLI_VERSION_UNSUPPORTED' }
    Write-Output 'PASS CLI_VERSION'
    foreach ($command in @('start', 'status')) {
        $stage = 'CLI_HELP'
        $help = Invoke-Captured $cli @($command, '--help')
        if ($help.ExitCode -ne 0) { throw 'CLI_HELP_UNAVAILABLE' }
    }
    $stage = 'LOCAL_FIXTURE'
    $configPath = Join-Path $fixtureRoot 'supabase/config.toml'
    if (-not $RunOnly) {
        New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'supabase/templates') -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures/auth-email/config.toml') -Destination $configPath
        foreach ($template in @('confirmation', 'recovery')) {
            Copy-Item -LiteralPath (Join-Path $repoRoot "supabase/templates/$template.html") -Destination (Join-Path $fixtureRoot "supabase/templates/$template.html")
        }
    }
    if (-not (Test-Path -LiteralPath $configPath) -or (Get-Content -LiteralPath $configPath -Raw) -notmatch '(?m)^project_id = "auth-email-proof"$') {
        throw 'LOCAL_PROJECT_INVALID'
    }
    Write-Output 'PASS LOCAL_FIXTURE'
    if (-not $RunOnly) {
        $stage = 'CLI_START'
        $start = Invoke-Captured $cli @('start', '--workdir', $fixtureRoot, '--exclude', 'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor')
        if ($start.ExitCode -ne 0) { throw 'CLI_START_FAILED' }
        Write-Output 'PASS CLI_START'
    }
    if ($StartOnly) { exit 0 }
    $stage = 'CLI_STATUS'
    $status = Invoke-Captured $cli @('status', '--workdir', $fixtureRoot, '-o', 'json')
    if ($status.ExitCode -ne 0) { throw 'CLI_STATUS_FAILED' }
    $local = $status.Out | ConvertFrom-Json
    # CLI v3 status uses uppercase names for the local environment.
    $apiUrl = [string]$local.API_URL
    $publicKey = [string]$local.PUBLISHABLE_KEY
    if (-not $publicKey) { $publicKey = [string]$local.ANON_KEY }
    if ($apiUrl.TrimEnd('/') -ne 'http://127.0.0.1:55441' -or -not $publicKey) { throw 'LOCAL_STATUS_INVALID' }
    Write-Output 'PASS CLI_STATUS'
    $stage = 'LOCAL_RUNTIME_POLICY'
    $inspection = Invoke-Captured (Get-Command docker -ErrorAction Stop).Source @('inspect', 'supabase_auth_auth-email-proof')
    if ($inspection.ExitCode -ne 0) { throw 'LOCAL_AUTH_CONTAINER_MISSING' }
    $container = @($inspection.Out | ConvertFrom-Json)[0]
    $authVariables = @{}
    foreach ($entry in $container.Config.Env) {
        $pair = $entry.Split('=', 2)
        $authVariables[$pair[0]] = $pair[1]
    }
    $classes = [string]$authVariables['GOTRUE_PASSWORD_REQUIRED_CHARACTERS']
    if ($container.Name -ne '/supabase_auth_auth-email-proof' -or $container.State.Health.Status -ne 'healthy' -or
        $authVariables['GOTRUE_MAILER_AUTOCONFIRM'] -ne 'false' -or
        $authVariables['GOTRUE_MAILER_OTP_EXP'] -ne '3600' -or $authVariables['GOTRUE_MAILER_OTP_LENGTH'] -ne '6' -or
        $authVariables['GOTRUE_PASSWORD_MIN_LENGTH'] -ne '8' -or $authVariables['GOTRUE_EXTERNAL_GOOGLE_ENABLED'] -eq 'true' -or
        $authVariables['GOTRUE_SMTP_HOST'] -notmatch '^supabase_(inbucket|mailpit)_auth-email-proof$' -or
        -not $classes.Contains('abcdefghijklmnopqrstuvwxyz') -or -not $classes.Contains('ABCDEFGHIJKLMNOPQRSTUVWXYZ') -or
        -not $classes.Contains('0123456789') -or -not $classes.Contains('!')) { throw 'LOCAL_AUTH_POLICY_MISMATCH' }
    Write-Output 'PASS LOCAL_RUNTIME_POLICY'
    $stage = 'REAL_AUTH_PROOF'
    $result = Invoke-Captured (Get-Command node -ErrorAction Stop).Source @((Join-Path $repoRoot 'web/e2e/auth-email-local.mjs')) @{
        BACKSTABBER_AUTH_EMAIL_PROOF = 'auth-email-proof'
        BACKSTABBER_AUTH_EMAIL_PROOF_URL = $apiUrl
        BACKSTABBER_AUTH_EMAIL_PROOF_PUBLISHABLE_KEY = $publicKey
        BACKSTABBER_AUTH_EMAIL_PROOF_MAILPIT = 'http://127.0.0.1:55444'
    }
    # Even unexpected child output cannot print a key, recipient, OTP, URL, body or exception.
    foreach ($line in ($result.Out -split '\r?\n')) {
        if ($line -match '^(PASS|FAIL) [A-Z][A-Z0-9_]*(?: HTTP_[1-5][0-9]{2})?$') { Write-Output $line }
    }
    if ($result.ExitCode -ne 0) { throw 'REAL_AUTH_PROOF_FAILED' }
} catch {
    Write-Output "FAIL $stage"
    exit 1
}
