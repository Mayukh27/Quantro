# Quantro - start.ps1
Param(
    [string]$JavaBin   = "java",
    [string]$NginxBin  = "nginx",
    [string]$JavaOpts  = "-Xms512m -Xmx1024m",
    [int]$Instances    = 1,
    [int]$BasePort     = 18080,
    [int]$NginxPort    = 8081
)

$ErrorActionPreference = "Stop"
# $PSScriptRoot is the absolute path of this script's directory.
# It is always correct regardless of how PowerShell was launched (run.bat, cmd, etc.)
# Never use $MyInvocation.MyCommand.Path - it returns empty when called via -File.
if ($PSScriptRoot) {
    $RootDir = $PSScriptRoot
} else {
    $RootDir = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($MyInvocation.MyCommand.Path))
}
$RootDir = (Get-Item -LiteralPath $RootDir).FullName
Write-Host "Quantro root: $RootDir" -ForegroundColor DarkGray
Set-Location $RootDir

# --- 1. Require .env ---------------------------------------------------------
if (!(Test-Path ".env")) {
    Write-Host ""
    Write-Host "ERROR: .env not found." -ForegroundColor Red
    Write-Host "  Run:  copy .env.template .env" -ForegroundColor Yellow
    Write-Host "  Then fill in DB_URL, DB_USERNAME, DB_PASSWORD, JWT_SECRET, NGINX_BIN." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# --- 2. Load .env ------------------------------------------------------------
Get-Content .env | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^\s*#' -or $line -match '^\s*$') { return }
    $kv = $line -split '=', 2
    if ($kv.Length -eq 2) {
        [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim(), "Process")
    }
}

# --- 3. Override params from env ---------------------------------------------
if ($env:JAVA_BIN)    { $JavaBin   = $env:JAVA_BIN }
if ($env:NGINX_BIN)   { $NginxBin  = $env:NGINX_BIN }
if ($env:JAVA_OPTS)   { $JavaOpts  = $env:JAVA_OPTS }
if ($env:INSTANCES)   { $Instances = [int]$env:INSTANCES }
if ($env:BASE_PORT)   { $BasePort  = [int]$env:BASE_PORT }
if ($env:NGINX_PORT)  { $NginxPort = [int]$env:NGINX_PORT }

# --- 4. Validate required keys -----------------------------------------------
$missing = @()
foreach ($reqKey in @("DB_URL","DB_USERNAME","DB_PASSWORD","JWT_SECRET")) {
    $val = [System.Environment]::GetEnvironmentVariable($reqKey, "Process")
    if (!$val -or $val -match '^(your_|replace_)') { $missing += $reqKey }
}
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "ERROR: Missing or placeholder values in .env:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host ""
    exit 1
}

# --- 5. Helper ---------------------------------------------------------------
function Env-Or([string]$k, [string]$d) {
    $v = [System.Environment]::GetEnvironmentVariable($k, "Process")
    if ($v) { $v } else { $d }
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Port 80/443 requires elevation on Windows
if ($NginxPort -lt 1024 -and -not (Test-IsAdmin)) {
    Write-Host "" 
    Write-Host "Port $NginxPort requires Administrator privileges. Elevating..." -ForegroundColor Yellow
    try {
        $args = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", "`"$PSCommandPath`"",
            "-JavaBin", "`"$JavaBin`"",
            "-NginxBin", "`"$NginxBin`"",
            "-JavaOpts", "`"$JavaOpts`"",
            "-Instances", $Instances,
            "-BasePort", $BasePort,
            "-NginxPort", $NginxPort
        )
        Start-Process -FilePath "powershell.exe" -ArgumentList $args -Verb RunAs | Out-Null
        exit 0
    } catch {
        Write-Host "ERROR: Elevation was cancelled or failed." -ForegroundColor Red
        exit 1
    }
}

# --- 6. Spring Boot -D overrides ---------------------------------------------
$springOverrides = @(
    "-Dfeatures.admin=$(Env-Or 'FEATURE_ADMIN' 'true')",
    "-Dfeatures.teacher=$(Env-Or 'FEATURE_TEACHER' 'true')",
    "-Dfeatures.analytics=$(Env-Or 'FEATURE_ANALYTICS' 'true')",
    "-Dfeatures.blueprint=$(Env-Or 'FEATURE_BLUEPRINT' 'true')",
    "-Dfeatures.proctor=$(Env-Or 'FEATURE_PROCTOR' 'true')",
    "-Dfeatures.pdf=$(Env-Or 'FEATURE_PDF' 'true')",
    "-Dfeatures.ai=$(Env-Or 'FEATURE_AI' 'false')",
    "-Dfeatures.email=$(Env-Or 'FEATURE_EMAIL' 'false')",
    "-Dexam.proctor.max-violations=$(Env-Or 'PROCTOR_MAX_VIOLATIONS' '1')",
    "-Dexam.proctor.max-fullscreen-exits=$(Env-Or 'PROCTOR_MAX_FULLSCREEN_EXITS' '1')",
    "-Dexam.proctor.fullscreen-grace-seconds=$(Env-Or 'PROCTOR_GRACE_SECONDS' '10')",
    "-Dexam.timer.grace-period-seconds=$(Env-Or 'EXAM_GRACE_SECONDS' '30')"
)
$javaOptTokens = $JavaOpts -split '\s+' | Where-Object { $_ -ne '' }

# --- 7. Create directories ---------------------------------------------------
@(
    "logs", "pids", "cache\images",
    "nginx\logs",
    "temp\client_body_temp", "temp\proxy_temp",
    "temp\fastcgi_temp", "temp\scgi_temp", "temp\uwsgi_temp"
) | ForEach-Object { New-Item -ItemType Directory -Path $_ -Force | Out-Null }

# --- 8. Write nginx.windows.conf from template -------------------------------
$templatePath = Join-Path $RootDir "nginx\nginx.windows.conf.template"
$confPath     = Join-Path $RootDir "nginx\nginx.windows.conf"

if (!(Test-Path $templatePath)) {
    Write-Host "ERROR: nginx\nginx.windows.conf.template not found." -ForegroundColor Red
    exit 1
}

$nginxRoot       = $RootDir -replace '\\', '/'
$nginxRootForNginx = $nginxRoot
$templateContent = Get-Content $templatePath -Raw
$confContent     = $templateContent -replace 'QUANTRO_ROOT', $nginxRootForNginx
$confContent     = $confContent -replace 'NGINX_PORT', $NginxPort
Set-Content -Path $confPath -Value $confContent -Encoding ASCII

Write-Host "nginx config written  => $confPath" -ForegroundColor DarkGray
Write-Host "  root               => $nginxRootForNginx/build" -ForegroundColor DarkGray
Write-Host "  listen             => $NginxPort" -ForegroundColor DarkGray

# --- 9. Kill stale nginx and backends ----------------------------------------
# Kill nginx first so it releases port 80 and the conf file lock.
# We kill by process name only - "nginx -s stop" requires the old pid file
# to exist and will log a harmless error if nginx was not running.
Write-Host "Stopping any existing nginx..." -ForegroundColor DarkGray
Get-Process -Name "nginx" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

if (Test-Path "pids\backend.pids") {
    Get-Content "pids\backend.pids" | ForEach-Object {
        $backendPid = $_.Trim()
        if ($backendPid -and (Get-Process -Id $backendPid -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped stale backend pid $backendPid" -ForegroundColor DarkGray
        }
    }
    Remove-Item "pids\backend.pids" -Force
}

# --- 10. Verify app.jar ------------------------------------------------------
$jarPath = Join-Path $RootDir "app.jar"
if (!(Test-Path $jarPath)) {
    Write-Host "ERROR: app.jar not found at $jarPath" -ForegroundColor Red
    exit 1
}

# --- 11. Resolve java --------------------------------------------------------
$found = Get-Command $JavaBin -ErrorAction SilentlyContinue
if (!$found) {
    Write-Host "ERROR: '$JavaBin' not found. Install Java 17+ or set JAVA_BIN in .env." -ForegroundColor Red
    exit 1
}
$resolvedJava = $found.Source
Write-Host "Java: $resolvedJava" -ForegroundColor DarkGray

# --- 12. Start backend instance(s) -------------------------------------------
# WHY A BATCH LAUNCHER:
# PowerShell Start-Process splits arguments on spaces even inside an array
# when the underlying CreateProcess call serialises them into a command line.
# Paths like "C:\Users\...\Online_Exam_System v-2\Quantro_win\app.jar"
# get truncated at the space. Writing a .bat file and launching cmd.exe /c
# is the most robust way to handle spaces in paths on Windows - cmd.exe
# preserves quoted arguments exactly as written.
Write-Host ""
$startedPorts = @()
for ($i = 0; $i -lt $Instances; $i++) {
    $port    = $BasePort + $i
    $logOut  = Join-Path $RootDir "logs\backend-$port.log"
    $logErr  = Join-Path $RootDir "logs\backend-$port.err.log"
    $batFile = Join-Path $RootDir "pids\run-backend-$port.bat"

    # Build the full command line inside the bat file.
    # Every path is wrapped in double-quotes so spaces are preserved.
    # Each -D flag is a single token with no spaces so no quoting needed there.
    $javaOptsStr    = $javaOptTokens -join " "
    $overridesStr   = $springOverrides -join " "
    $batContent  = "@echo off`r`n"
    $batContent += "`"$resolvedJava`" $javaOptsStr $overridesStr -jar `"$jarPath`" --server.port=$port >> `"$logOut`" 2>> `"$logErr`"`r`n"

    Set-Content -Path $batFile -Value $batContent -Encoding ASCII

    # Launch the bat file via cmd.exe. cmd.exe handles the quoted paths correctly.
    $quotedBat = "`"$batFile`""
    $proc = Start-Process `
        -FilePath         "cmd.exe" `
        -ArgumentList     "/c", $quotedBat `
        -WorkingDirectory $RootDir `
        -PassThru `
        -WindowStyle      Hidden

    Add-Content -Path "pids\backend.pids" -Value $proc.Id
    Write-Host "  Backend instance $($i+1)  port=$port  pid=$($proc.Id)" -ForegroundColor Green
    Write-Host "    log: logs\backend-$port.log"
    $startedPorts += $port
}

# --- 13. Wait then check backend is alive ------------------------------------
Write-Host ""
$maxWaitSeconds = 30
$pollIntervalSeconds = 2
Write-Host "Waiting up to $maxWaitSeconds seconds for backend to listen..." -ForegroundColor DarkGray

$deadline = (Get-Date).AddSeconds($maxWaitSeconds)
$allAlive = $false
$alivePids = @()

while ((Get-Date) -lt $deadline) {
    $alivePids = @()
    $allAlive = $true
    foreach ($port in $startedPorts) {
        $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($listener) {
            $backendPid = $listener.OwningProcess
            if ($backendPid -and (Get-Process -Id $backendPid -ErrorAction SilentlyContinue)) {
                $alivePids += $backendPid
                continue
            }
        }
        $allAlive = $false
    }

    if ($allAlive) { break }
    Start-Sleep -Seconds $pollIntervalSeconds
}

if (!$allAlive) {
    foreach ($port in $startedPorts) {
        Write-Host "ERROR: Backend (port $port) is not listening." -ForegroundColor Red
        $errLog = Join-Path $RootDir "logs\backend-$port.err.log"
        if (Test-Path $errLog) {
            Write-Host "--- Last 20 lines of backend error log ---" -ForegroundColor DarkGray
            Get-Content $errLog | Select-Object -Last 20 | ForEach-Object {
                Write-Host "  $_" -ForegroundColor DarkGray
            }
            Write-Host "------------------------------------------" -ForegroundColor DarkGray
        }
    }
    Write-Host "Fix the error above then run start.ps1 again." -ForegroundColor Yellow
    exit 1
}

if ($alivePids.Count -gt 0) {
    $uniquePids = $alivePids | Sort-Object -Unique
    Set-Content -Path "pids\backend.pids" -Value $uniquePids
}
Write-Host "Backend alive." -ForegroundColor Green

# --- 14. Validate nginx binary -----------------------------------------------
Write-Host ""
Write-Host "Starting nginx..." -ForegroundColor Cyan

$nginxResolved = Get-Command $NginxBin -ErrorAction SilentlyContinue
if (!$nginxResolved -and !(Test-Path $NginxBin -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: nginx not found at '$NginxBin'." -ForegroundColor Red
    Write-Host "  Set NGINX_BIN=C:\nginx-1.30.0\nginx.exe in .env" -ForegroundColor Yellow
    exit 1
}

# --- 15. Start nginx ---------------------------------------------------------
& "$NginxBin" -p "$RootDir" -c "nginx\nginx.windows.conf"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: nginx failed to start. Check logs\nginx.error.log" -ForegroundColor Red
    $nginxErr = Join-Path $RootDir "logs\nginx.error.log"
    if (Test-Path $nginxErr) {
        Write-Host "--- nginx error log ---" -ForegroundColor DarkGray
        Get-Content $nginxErr | Select-Object -Last 15 | ForEach-Object {
            Write-Host "  $_" -ForegroundColor DarkGray
        }
        Write-Host "----------------------" -ForegroundColor DarkGray
    }
    exit 1
}
Write-Host "nginx started." -ForegroundColor Green

# --- 16. Print summary -------------------------------------------------------
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -notmatch '^127\.' -and
        $_.IPAddress -notmatch '^169\.254'
    } | Select-Object -First 1).IPAddress
if (!$lanIp) { $lanIp = "<your-LAN-IP>" }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Quantro is running!" -ForegroundColor Green
Write-Host "------------------------------------------" -ForegroundColor DarkGray
Write-Host "  This machine :  http://localhost/" -ForegroundColor Green
Write-Host "  LAN clients  :  http://$lanIp/" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend log  :  logs\backend-$BasePort.log"
Write-Host "  nginx log    :  logs\nginx.access.log"
Write-Host "  nginx errors :  logs\nginx.error.log"
Write-Host ""
Write-Host "  Backend needs ~20 s to be fully ready." -ForegroundColor DarkGray
Write-Host "  To stop: double-click stop.bat" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan