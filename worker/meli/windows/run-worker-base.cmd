@echo off
setlocal
cd /d "%~dp0.."
if not exist ".env.local" exit /b 2
if not exist "logs" mkdir "logs"

set "WORKER_BASE=%~1"
set "START_DELAY=%~2"
set "WORKER_LABEL=%~3"
if "%WORKER_BASE%"=="" exit /b 3
if "%START_DELAY%"=="" set "START_DELAY=0"
if "%WORKER_LABEL%"=="" set "WORKER_LABEL=%WORKER_BASE%"

set "BASE_CODES=%WORKER_BASE%"
set "WRITE_BASE_CODES=%WORKER_BASE%"
set "JMR_SESSION_FILE_PATH=./data/jmr-session.enc"
set "SYNC_INTERVAL_SECONDS=60"

rem O worker deve usar a conexao direta da maquina. Algumas ferramentas de
rem desenvolvimento injetam proxies locais temporarios no ambiente; quando
rem esses processos terminam, o proxy fica inacessivel e bloqueia toda a rede.
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "GIT_HTTP_PROXY="
set "GIT_HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="

if not "%START_DELAY%"=="0" timeout /t %START_DELAY% /nobreak >nul

:loop
"C:\Program Files\nodejs\node.exe" --env-file=.env.local dist\index.js >> "logs\worker-%WORKER_LABEL%.log" 2>&1
timeout /t 15 /nobreak >nul
goto loop
