@echo off
rem ==============================================================================
rem START-WINDOWS.bat — Zero-Prerequisite Auto-Launcher for Windows
rem ==============================================================================
rem Double-click this file to launch the OTA Name Generator dashboard.
rem It automatically configures portable runtimes and dependencies with no admin rights.

setlocal enabledelayedexpansion
title OTA Property Name Generator

rem Change directory to script folder safely (supports spaces in path)
cd /d "%~dp0"

echo ==================================================================
echo       OTA Property Name Generator — Windows Auto-Launcher        
echo ==================================================================

set "PORT=5178"
set "URL=http://localhost:%PORT%"
set "RUNTIME_DIR=%~dp0.runtime"
set "NODE_PORTABLE_DIR=%RUNTIME_DIR%\node"

rem ------------------------------------------------------------------------------
rem [1/4] Check or Auto-Bootstrap Node.js Runtime (No Admin / Sudo Required)
rem ------------------------------------------------------------------------------
where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [1/4] Using system Node.js.
) else (
    if exist "%NODE_PORTABLE_DIR%\node.exe" (
        set "PATH=%NODE_PORTABLE_DIR%;%PATH%"
        echo [1/4] Using portable Node.js runtime.
    ) else (
        echo [1/4] Node.js not detected on your computer.
        echo       Downloading portable standalone Node.js (no admin required)...
        
        if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"
        
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
          "$destZip = '%RUNTIME_DIR%\node.zip'; " ^
          "Write-Host '      Downloading Node.js v20 LTS...'; " ^
          "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip' -OutFile $destZip; " ^
          "Write-Host '      Extracting runtime files...'; " ^
          "Expand-Archive -Path $destZip -DestinationPath '%RUNTIME_DIR%' -Force; " ^
          "Remove-Item -Force $destZip; " ^
          "if (Test-Path '%RUNTIME_DIR%\node') { Remove-Item -Recurse -Force '%RUNTIME_DIR%\node' }; " ^
          "Rename-Item -Path '%RUNTIME_DIR%\node-v20.18.0-win-x64' -NewName 'node';"
          
        if not exist "%NODE_PORTABLE_DIR%\node.exe" (
            echo [ERROR] Failed to download portable Node.js runtime automatically.
            echo Please check your internet connection or install Node.js manually from https://nodejs.org
            pause
            exit /b 1
        )
        
        set "PATH=%NODE_PORTABLE_DIR%;%PATH%"
        echo       Portable Node.js successfully installed!
    )
)

rem ------------------------------------------------------------------------------
rem [2/4] Check & Auto-Install Dependencies
rem ------------------------------------------------------------------------------
if not exist "%~dp0node_modules" (
    echo [2/4] Installing application dependencies (one-time setup)...
    call npm install --no-audit --no-fund
) else (
    echo [2/4] Dependencies verified (node_modules ready).
)

rem Optional Python library check if Python is installed
where python >nul 2>nul
if %errorlevel% equ 0 (
    python -c "import openpyxl" >nul 2>nul
    if !errorlevel! neq 0 (
        pip install openpyxl --quiet >nul 2>nul
    )
)

rem ------------------------------------------------------------------------------
rem [3/4] Port Management & Safeguards
rem ------------------------------------------------------------------------------
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo [3/4] Application is ALREADY RUNNING on port %PORT%.
    echo       Opening dashboard in your browser...
    start "" "%URL%"
    timeout /t 2 >nul
    exit /b 0
)

echo [3/4] Port %PORT% is available.

rem ------------------------------------------------------------------------------
rem [4/4] Launch Application & Open Browser
rem ------------------------------------------------------------------------------
echo [4/4] Launching OTA Name Generator...
echo ------------------------------------------------------------------
echo   Local Dashboard: %URL%
echo   Keep this command window open while using the application.
echo   To stop: Press Ctrl + C or close this window.
echo ------------------------------------------------------------------

rem Open browser in background
start "" "%URL%"

rem Run server in foreground
node server.js

pause
