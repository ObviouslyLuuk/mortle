@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
    echo Starting server at http://localhost:8000
    start "" "http://localhost:8000"
    echo Press Ctrl+C to stop the server.
    python -m http.server 8000
    exit /b 0
)

where npx >nul 2>nul
if %errorlevel%==0 (
    echo Starting server at http://localhost:5173
    start "" "http://localhost:5173"
    echo Press Ctrl+C to stop the server.
    npx --yes serve -l 5173 .
    exit /b 0
)

echo Python and Node.js were not found.
echo Install either one to run the local test server.
pause
exit /b 1
