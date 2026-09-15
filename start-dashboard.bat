@echo off
rem Double-click this to start the Commander Simulator dashboard - no typed
rem commands needed. Runs scripts/start-dashboard.sh under Git Bash, which
rem does the real work (first-time setup, both servers, opening your
rem browser). Close this window (or press Ctrl+C in it) to stop everything.

setlocal
set "HERE=%~dp0"

where bash >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\Git\bin\bash.exe" (
        set "BASH=C:\Program Files\Git\bin\bash.exe"
    ) else (
        echo Couldn't find a "bash" to run this with.
        echo This project's dev scripts are bash scripts - install Git for Windows
        echo ^(https://git-scm.com/download/win^), which includes Git Bash, then try again.
        pause
        exit /b 1
    )
) else (
    set "BASH=bash"
)

"%BASH%" "%HERE%scripts\start-dashboard.sh"
pause
