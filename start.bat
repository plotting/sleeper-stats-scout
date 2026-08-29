@echo off
REM Starts Matzie's Dynasty League locally at http://localhost:8080
REM Double-click this file, or run it from a terminal.

cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. See the errors above.
        pause
        exit /b 1
    )
)

echo Starting dev server at http://localhost:8080 ...
call npm run dev

pause
