@echo off
setlocal
cd /d "%~dp0"
title WeyBot - MT5 Trading Bridge
cls
echo ====================================================
echo     WeyBot - Conector de MetaTrader 5 al VPS
echo ====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado o no esta disponible en PATH.
  pause
  exit /b 1
)

:restart
node mt5-bridge-client.mjs
echo.
echo El bridge se detuvo. Reintentando en 5 segundos...
timeout /t 5 /nobreak >nul
goto restart
