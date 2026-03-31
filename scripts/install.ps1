# Install mecha on Windows.
# Usage: irm https://raw.githubusercontent.com/xiaolai/mecha.im/main/scripts/install.ps1 | iex
#    or: .\install.ps1 -Version v0.5.11
param(
    [string]$Version = "",
    [string]$InstallDir = "$env:LOCALAPPDATA\mecha"
)

$ErrorActionPreference = "Stop"
$Repo = "xiaolai/mecha.im"

# Windows is always amd64 (arm64 Windows not supported yet)
$Platform = "linux-amd64"  # WSL
Write-Host "Note: mecha runs in WSL on Windows. This script installs the Linux binary into WSL." -ForegroundColor Yellow
Write-Host "If you want native Windows support, use WSL:" -ForegroundColor Yellow
Write-Host "  wsl curl -fsSL https://raw.githubusercontent.com/$Repo/main/scripts/install.sh | sh" -ForegroundColor Cyan
Write-Host ""

# For WSL passthrough
$wslCheck = wsl echo ok 2>$null
if ($wslCheck -eq "ok") {
    Write-Host "WSL detected. Installing into WSL..." -ForegroundColor Green
    wsl bash -c "curl -fsSL https://raw.githubusercontent.com/$Repo/main/scripts/install.sh | MECHA_VERSION='$Version' sh"
} else {
    Write-Host "WSL not found. Please install WSL first:" -ForegroundColor Red
    Write-Host "  wsl --install" -ForegroundColor Cyan
    exit 1
}
