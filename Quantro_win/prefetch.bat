@echo off
:: Quantro - prefetch.bat
:: Warms nginx image cache by calling question image endpoints

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0prefetch-images.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  Prefetch failed. See error above.
    pause
)
