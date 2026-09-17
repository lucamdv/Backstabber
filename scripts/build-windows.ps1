$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Set-Location -LiteralPath $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js não encontrado. Instale o Node.js 24 ou mais recente."
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
    Write-Host "Instalando dependências..."
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar dependências." }
}

Write-Host "Gerando o instalador atualizável do Backstabber..."
npm run build:windows
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o instalador." }

$installer = Join-Path $projectRoot "release\Backstabber-Windows-Setup.exe"
if (-not (Test-Path -LiteralPath $installer)) {
    throw "O instalador não foi encontrado após a compilação."
}

Write-Host "Concluído: $installer"
