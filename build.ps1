#!/usr/bin/env pwsh

Write-Host "Building Network Tester..." -ForegroundColor Green

# Build frontend
Write-Host "`nStep 1: Building React frontend..." -ForegroundColor Cyan
Set-Location frontend
$env:NODE_OPTIONS="--no-deprecation"
npm install
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed!" -ForegroundColor Red
    exit 1
}
Set-Location ..

# Build Go application
Write-Host "`nStep 2: Building Go application..." -ForegroundColor Cyan
go build -o network-tester.exe .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n✓ Build complete! Executable is at: network-tester.exe" -ForegroundColor Green
Write-Host "Run it with: .\network-tester.exe" -ForegroundColor Yellow
