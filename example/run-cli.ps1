param(
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

$cliEntry = Join-Path $repoRoot "packages\cli\dist\index.js"

$toolchainDir = "C:\Users\carl\.platformio\packages\toolchain-gccarmnoneeabi-teensy\bin"
$elfPath = "C:\root\git\thenfour\TeensyMemAnalyzer\example\firmware.elf"
$mapPath = "C:\root\git\thenfour\TeensyMemAnalyzer\example\firmware.map"

if (-not (Test-Path $cliEntry)) {
    throw "CLI entry '$cliEntry' not found. Build the workspace first (yarn run build)."
}

$arguments = @(
    $cliEntry,
    "--target","teensy40",
    "--elf",$elfPath,
    "--map",$mapPath,
    "--toolchain-dir",$toolchainDir
)

if ($Json) {
    $arguments += "--json"
}

Write-Host "Running Teensy memory analysis..." -ForegroundColor Cyan
Write-Host "node $($arguments -join ' ')" -ForegroundColor DarkGray

node @arguments
