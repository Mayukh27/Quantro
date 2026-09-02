# Quantro - stop.ps1
Param(
    [string]$NginxBin = "nginx"
)

$ErrorActionPreference = "SilentlyContinue"

# Use PSScriptRoot so stop.bat works from any working directory
if ($PSScriptRoot) {
    $RootDir = $PSScriptRoot
} else {
    $RootDir = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($MyInvocation.MyCommand.Path))
}
Set-Location $RootDir

# Load .env to pick up NGINX_BIN
if (Test-Path ".env") {
    Get-Content .env | ForEach-Object {
        $line = $_.Trim()
        if ($line -match '^\s*#' -or $line -match '^\s*$') { return }
        $kv = $line -split '=', 2
        if ($kv.Length -eq 2) {
            [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim(), "Process")
        }
    }
}
if ($env:NGINX_BIN) { $NginxBin = $env:NGINX_BIN }

# --- Stop backend ------------------------------------------------------------
# Kill by tracked pid first, then sweep for any leftover java processes
# running app.jar (in case the pid file is stale or pid was wrong).
$stopped = $false

if (Test-Path "pids\backend.pids") {
    Get-Content "pids\backend.pids" | ForEach-Object {
        $javaPid = $_.Trim()
        if ($javaPid) {
            $proc = Get-Process -Id $javaPid -ErrorAction SilentlyContinue
            if ($proc) {
                # Kill the process and all its children
                $children = Get-CimInstance Win32_Process |
                    Where-Object { $_.ParentProcessId -eq $javaPid }
                $children | ForEach-Object {
                    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                }
                Stop-Process -Id $javaPid -Force -ErrorAction SilentlyContinue
                Write-Host "Stopped backend pid $javaPid" -ForegroundColor Yellow
                $stopped = $true
            }
        }
    }
    Remove-Item "pids\backend.pids" -Force -ErrorAction SilentlyContinue
}

# Sweep: kill any java.exe process that has app.jar in its command line
$jarPath = Join-Path $RootDir "app.jar"
Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
    Where-Object { $_.CommandLine -like "*app.jar*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped lingering Java pid $($_.ProcessId)" -ForegroundColor Yellow
        $stopped = $true
    }

if (!$stopped) {
    Write-Host "No backend processes found." -ForegroundColor DarkGray
}

# --- Stop nginx --------------------------------------------------------------
# Kill by process name - does not require pid file or nginx -s stop signal
$nginxProcs = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
if ($nginxProcs) {
    $nginxProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped nginx." -ForegroundColor Yellow
} else {
    Write-Host "nginx was not running." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Quantro stopped." -ForegroundColor Cyan