@echo off
:: ═══════════════════════════════════════════════════════════════════════════
:: Quantro — run.bat
:: Double-click this file to start Quantro.
:: It opens a PowerShell window, loads .env, and launches the app.
:: ═══════════════════════════════════════════════════════════════════════════

:: Check .env exists before launching PowerShell
if not exist "%~dp0.env" (
    echo.
    echo  ERROR: .env not found.
    echo.
    echo  Steps:
    echo    1. Open this folder in Explorer
    echo    2. Copy  .env.template  to  .env
    echo    3. Open .env in Notepad and fill in your database password,
    echo       JWT_SECRET, and NGINX_BIN path
    echo    4. Double-click run.bat again
    echo.
    pause
    exit /b 1
)

echo Starting Quantro...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"

:: Keep window open if there was an error
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  Start failed. See error above.
    pause
)
