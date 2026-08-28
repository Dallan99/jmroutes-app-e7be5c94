@echo off
setlocal
cd /d "%~dp0.."
if not exist ".env.local" exit /b 2
if not exist "logs" mkdir "logs"
:loop
"C:\Program Files\nodejs\node.exe" --env-file=.env.local dist\index.js >> logs\worker.log 2>&1
timeout /t 15 /nobreak >nul
goto loop
