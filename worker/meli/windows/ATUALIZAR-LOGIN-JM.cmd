@echo off
title Atualizar Login JMRoutes
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar-login-jm.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel atualizar o login.
  pause
)
