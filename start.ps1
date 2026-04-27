# ─── Cyprus Geo-Social TMA — Start Script (Windows, no Docker) ───────────────
# Usage: Right-click → Run with PowerShell  (or: powershell -File start.ps1)

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ENV_FILE = "$ROOT\.env"
$NGINX = "C:\nginx\nginx-1.26.3\nginx.exe"
$PG_BIN = "C:\Program Files\PostgreSQL\16\bin"

Write-Host "`n🌍 Cyprus Geo-Social TMA — Starting..." -ForegroundColor Cyan

# 1. Add PG to PATH
$env:PATH = "$PG_BIN;$env:PATH"

# 2. Make sure PG16 service is running
$pg = Get-Service "postgresql-x64-16" -ErrorAction SilentlyContinue
if ($pg.Status -ne "Running") {
    Write-Host "▶ Starting PostgreSQL 16..." -ForegroundColor Yellow
    Start-Service "postgresql-x64-16"
    Start-Sleep 3
}
Write-Host "✅ PostgreSQL 16 running (port 5433)" -ForegroundColor Green

# 3. Start Backend
Write-Host "▶ Starting Backend (port 3000)..." -ForegroundColor Yellow
$backendJob = Start-Process "node.exe" `
    -ArgumentList "--env-file=`"$ENV_FILE`" src/index.js" `
    -WorkingDirectory "$ROOT\services\backend" `
    -PassThru -WindowStyle Minimized
Write-Host "✅ Backend PID: $($backendJob.Id)" -ForegroundColor Green

Start-Sleep 2

# 4. Start Nginx
Write-Host "▶ Starting Nginx (port 80)..." -ForegroundColor Yellow
$nginxDir = Split-Path $NGINX
$nginxCheck = Get-Process "nginx" -ErrorAction SilentlyContinue
if ($nginxCheck) {
    & $NGINX -s reload
    Write-Host "✅ Nginx reloaded" -ForegroundColor Green
} else {
    Start-Process $NGINX -WorkingDirectory $nginxDir -WindowStyle Hidden
    Write-Host "✅ Nginx started" -ForegroundColor Green
}

Start-Sleep 1

# 5. Health check
Write-Host "`n🔍 Health check..." -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest "http://localhost:3000/api/places?bbox=32.2,34.5,34.7,35.8&zoom=10" -UseBasicParsing -TimeoutSec 5
    Write-Host "✅ Backend API: OK ($($r.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Backend API: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n🚀 App running at: http://localhost" -ForegroundColor Cyan
Write-Host "   API:            http://localhost/api/" -ForegroundColor Gray
Write-Host "   WebSocket:      ws://localhost/ws/" -ForegroundColor Gray
Write-Host "`nPress Ctrl+C or close this window to stop backend.`n" -ForegroundColor DarkGray

# Keep backend running
Wait-Process -Id $backendJob.Id
