@echo off
:: ═══════════════════════════════════════════════════════════════════════════
:: Quantro — stop.bat
:: Double-click to stop all Quantro processes (backend + nginx).
:: ═══════════════════════════════════════════════════════════════════════════
echo Stopping Quantro...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  Stop failed. See error above.
    pause
)
