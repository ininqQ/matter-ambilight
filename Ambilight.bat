@echo off
rem Ambilight launcher: checks Node.js and dependencies, then starts sync.
rem First launch runs the setup wizard. Stop: Ctrl+C or close the window (the light is restored).
rem Usage: Ambilight.bat [command]   (default: start; e.g. "Ambilight.bat setup")
chcp 65001 >nul
title Ambilight
cd /d "%~dp0"

set "CMD=%~1"
if "%CMD%"=="" set "CMD=start"

rem ---------- Node.js ----------
set "NODE=%ProgramFiles%\nodejs\node.exe"
set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if exist "%NODE%" goto have_node
where node >nul 2>nul
if errorlevel 1 goto no_node
set "NODE=node"
set "NPM=npm"
goto have_node

:no_node
echo Node.js is not installed. / Node.js не установлен.
where winget >nul 2>nul
if errorlevel 1 goto manual_node
choice /c YN /m "Install Node.js LTS now via winget? / Установить Node.js сейчас"
if errorlevel 2 goto manual_node
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
if exist "%ProgramFiles%\nodejs\node.exe" goto have_node
:manual_node
echo.
echo Install Node.js 20+ from https://nodejs.org and run this file again.
echo Установите Node.js 20+ с https://nodejs.org и запустите этот файл снова.
pause
exit /b 1

:have_node
rem ---------- dependencies (first launch) ----------
if exist "node_modules\@matter\main\package.json" goto run
echo Installing dependencies (first launch, ~1 min)... / Устанавливаю зависимости (первый запуск, ~1 мин)...
call "%NPM%" ci --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo npm install failed - see the messages above. / Не удалось установить зависимости - см. сообщения выше.
    pause
    exit /b 1
)

:run
"%NODE%" ambilight.mjs %CMD% %2 %3 %4
if errorlevel 1 (
    echo.
    pause
)
