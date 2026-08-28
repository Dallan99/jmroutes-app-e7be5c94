@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-inicio-automatico.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel instalar o inicio automatico.
  pause
)
