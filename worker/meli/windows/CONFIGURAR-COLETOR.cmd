@echo off
title Configurar Coletor JMRoutes
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local.ps1"
if errorlevel 1 (
  echo.
  echo A configuracao encontrou um erro. Envie uma foto desta janela.
  pause
)
