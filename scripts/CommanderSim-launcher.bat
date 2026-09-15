@echo off
rem Commander Simulator - double-click this to run it. Nothing else needs
rem to be installed: this folder already has its own copy of Node.js and
rem Java, used only by this app, not touching anything else on your
rem machine. Close this window (or press Ctrl+C) to stop it.

setlocal
set "HERE=%~dp0"
set "NODE=%HERE%runtime\node\node.exe"
set "JAVA_EXECUTABLE=%HERE%runtime\jre\bin\java.exe"

if not exist "%NODE%" (
    echo Couldn't find the bundled Node.js runtime at:
    echo   %NODE%
    echo This copy looks incomplete - try re-downloading it.
    pause
    exit /b 1
)
if not exist "%JAVA_EXECUTABLE%" (
    echo Couldn't find the bundled Java runtime at:
    echo   %JAVA_EXECUTABLE%
    echo This copy looks incomplete - try re-downloading it.
    pause
    exit /b 1
)

rem A conservative-but-workable default for an unknown machine - override
rem by setting FORGE_MAX_HEAP_MB before running this if a game needs more.
if not defined FORGE_MAX_HEAP_MB set "FORGE_MAX_HEAP_MB=2048"
set "NODE_ENV=production"

echo Starting Commander Simulator...
start "" cmd /c "timeout /t 4 >nul && start http://localhost:4000"
"%NODE%" "%HERE%server\dist\api\server.js"

echo.
echo Commander Simulator stopped.
pause
