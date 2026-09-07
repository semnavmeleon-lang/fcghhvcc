@echo off
setlocal
set "PORT=8934"

set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
    set "FOUND=1"
)

if defined FOUND (
    echo Server stopped.
) else (
    echo No server found on port %PORT% - already stopped.
)
timeout /t 2 >nul
