#!/usr/bin/env pwsh

Write-Host "Starting Network Tester..." -ForegroundColor Green

# Check if executable exists
if (-not (Test-Path "network-tester.exe")) {
    Write-Host "`nExecutable not found. Building first..." -ForegroundColor Yellow
    .\build.ps1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
}

# Run the executable
Write-Host "`nStarting server..." -ForegroundColor Cyan
.\network-tester.exe
