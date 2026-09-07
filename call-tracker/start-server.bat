@echo off
setlocal
set "PORT=8934"
set "APPDIR=%~dp0"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"
set "URL=http://localhost:%PORT%/index.html"

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    start "" "%URL%"
    exit /b
)

where python >nul 2>&1
if errorlevel 1 (
    echo python not found - install Python from python.org and try again.
    pause
    exit /b 1
)

rem Regular python.exe (not pythonw.exe) run hidden via -WindowStyle Hidden:
rem pythonw.exe has no stdout/stderr at all, and http.server writes an
rem access-log line to stderr on every request - with pythonw that write
rem throws and kills the connection on the very first request. Regular
rem python.exe still has valid (just invisible) streams, so it works.
powershell -NoProfile -WindowStyle Hidden -Command "Set-Location '%APPDIR%'; Start-Process -FilePath 'python' -ArgumentList '-m','http.server','%PORT%','--bind','127.0.0.1' -WindowStyle Hidden"

timeout /t 2 /nobreak >nul
start "" "%URL%"
exit /b
