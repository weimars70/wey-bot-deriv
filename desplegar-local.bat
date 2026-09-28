@echo off
setlocal
cd /d "%~dp0"
title Despliegue Manual - WeyBot Produccion (Puerto 3039)
cls

echo ========================================================
echo    WEYBOT - DESPLIEGUE MANUAL EN VPS (PUERTO 3039)
echo ========================================================
echo.

echo [1/4] Compilando Frontend (Quasar)...
cd frontend
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Fallo la compilacion del Frontend.
    pause
    exit /b %errorlevel%
)
if exist "dist\pwa" (
    powershell -NoProfile -Command "Copy-Item -Path 'dist\pwa' -Destination 'dist\spa' -Recurse -Force"
)
cd ..

echo.
echo [2/4] Compilando Backend (NestJS)...
cd backend
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Fallo la compilacion del Backend.
    pause
    exit /b %errorlevel%
)
cd ..

echo.
echo [3/4] Sincronizando EA en MetaTrader 5...
set "MT5_EXPERTS=C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\BCEF3407BBF131B442A8FC1AD8407C61\MQL5\Experts"
if exist "%MT5_EXPERTS%" (
    copy /y "DerivApp_Bridge_EA.ex5" "%MT5_EXPERTS%\" >nul 2>nul
    copy /y "DerivApp_Bridge_EA.mq5" "%MT5_EXPERTS%\" >nul 2>nul
    echo      Archivos de EA actualizados en MT5.
)

echo.
echo [4/4] Reiniciando servicio en PM2...
call pm2 restart bot-indices 2>nul || call pm2 start ecosystem.config.cjs
call pm2 save

echo.
echo ========================================================
echo    DESPLIEGUE COMPLETADO EXITOSAMENTE
echo    URL Local: http://localhost:3039/bot/
echo ========================================================
echo.
pause
