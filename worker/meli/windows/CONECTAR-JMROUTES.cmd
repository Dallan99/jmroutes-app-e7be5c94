@echo off
title Conectar JMRoutes ao Worker
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" --env-file=.env.local node_modules\tsx\dist\cli.mjs scripts\auth-jmr.ts
if errorlevel 1 (
  echo.
  echo Nao foi possivel capturar a sessao. Envie uma foto desta janela.
  pause
)
