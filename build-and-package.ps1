# Script de Build y Deploy para BOT-INDICES (Deriv App)
# Uso: .\build-and-package.ps1 [-NoBuild] [-SkipFrontend] [-SkipBackend] [-SkipBridgeStart]
param(
    [switch]$NoBuild,
    [switch]$SkipFrontend,
    [switch]$SkipBackend,
    [switch]$SkipBridgeStart
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   BOT-INDICES - Build & Deploy Unificado al VPS" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# -- Configuración --------------------------------------------
$projectRoot    = $PSScriptRoot                          # Raíz del proyecto local
$deployDir      = Join-Path $projectRoot "DEPLOY_PACKAGE"
$tarFile        = Join-Path $projectRoot "deploy_package.tar.gz"
$serverFolder   = "bot-indices"                          # Carpeta destino en el VPS
$vpsUser        = "weimars"
$vpsIp          = "2.58.80.90"
$vpsFullPath    = "/home/$vpsUser/$serverFolder"
$appPort        = 3038                                   # Puerto único unificado

Write-Host ""
Write-Host "Configuración de Despliegue:" -ForegroundColor Gray
Write-Host "  Proyecto local : $projectRoot"
Write-Host "  Destino VPS    : $vpsUser@$vpsIp`:$vpsFullPath"
Write-Host "  Puerto único   : $appPort (Backend + Frontend SPA + WebSockets)"
Write-Host ""

# -- 1. Limpiar artefactos anteriores --------------------------
Write-Host "[1/5] Limpiando artefactos anteriores..." -ForegroundColor Yellow
if (Test-Path $deployDir) { 
    Remove-Item -Recurse -Force $deployDir -ErrorAction SilentlyContinue
}
if (Test-Path $tarFile) { 
    Remove-Item -Force $tarFile -ErrorAction SilentlyContinue 
}
New-Item -ItemType Directory -Path $deployDir | Out-Null

# -- 2. Builds en paralelo (Frontend Quasar + Backend NestJS) --
if (-not $NoBuild) {
    Write-Host "[2/5] Construyendo aplicación (Frontend Quasar + Backend NestJS)..." -ForegroundColor Yellow

    $jobs = @()

    if (-not $SkipFrontend) {
        Write-Host "  -> Lanzando build de Frontend (Quasar SPA)..."
        $frontendPath = Join-Path $projectRoot "frontend"
        $jobs += Start-Job -Name "FrontendBuild" -ScriptBlock {
            param($path)
            Set-Location $path
            $output = & cmd.exe /c "npm run build" 2>&1
            [PSCustomObject]@{
                ExitCode = $LASTEXITCODE
                Output   = ($output -join "`n")
            }
        } -ArgumentList $frontendPath
    }

    if (-not $SkipBackend) {
        Write-Host "  -> Lanzando build de Backend (NestJS)..."
        $backendPath = Join-Path $projectRoot "backend"
        $jobs += Start-Job -Name "BackendBuild" -ScriptBlock {
            param($path)
            Set-Location $path
            $output = & cmd.exe /c "npm run build" 2>&1
            [PSCustomObject]@{
                ExitCode = $LASTEXITCODE
                Output   = ($output -join "`n")
            }
        } -ArgumentList $backendPath
    }

    if ($jobs.Count -gt 0) {
        Write-Host "  Esperando que terminen las compilaciones..." -ForegroundColor Gray
        $null = Wait-Job $jobs

        $failed = $false
        foreach ($job in $jobs) {
            $result = Receive-Job $job
            if ($result.ExitCode -eq 0) {
                Write-Host "  [OK] $($job.Name) completado exitosamente." -ForegroundColor Green
            } else {
                Write-Host "  [ERROR] $($job.Name) falló (ExitCode: $($result.ExitCode)):" -ForegroundColor Red
                Write-Host $result.Output -ForegroundColor DarkRed
                $failed = $true
            }
            Remove-Job $job
        }

        if ($failed) {
            Write-Host "`nAbortando despliegue: uno o más builds fallaron." -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host '[2/5] Build omitido (--NoBuild detectado).' -ForegroundColor Magenta
}

# -- 3. Ensamblar paquete para un solo puerto ------------------
Write-Host "[3/5] Ensamblando paquete de despliegue unificado..." -ForegroundColor Yellow

# Backend compilado
$backendDist = Join-Path $projectRoot "backend\dist"
if (-not (Test-Path $backendDist)) {
    Write-Host "ERROR: No se encontró backend\dist. ¿Se ejecutó el build de backend?" -ForegroundColor Red
    exit 1
}
$deployBackend = Join-Path $deployDir "backend"
New-Item -ItemType Directory -Path "$deployBackend\dist" -Force | Out-Null
Copy-Item -Path "$backendDist\*" -Destination "$deployBackend\dist" -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "backend\package.json")      -Destination "$deployBackend\" -Force
Copy-Item -Path (Join-Path $projectRoot "backend\package-lock.json") -Destination "$deployBackend\" -Force

# Backend .env (asegurar PORT=3038)
$envProd = Join-Path $projectRoot "backend\.env.production"
$envDev  = Join-Path $projectRoot "backend\.env"
if (Test-Path $envProd) {
    Copy-Item -Path $envProd -Destination "$deployBackend\.env" -Force
    Write-Host "  -> Usando .env.production para el VPS" -ForegroundColor Gray
} elseif (Test-Path $envDev) {
    Copy-Item -Path $envDev -Destination "$deployBackend\.env" -Force
    Write-Host "  -> Usando backend\.env para el VPS" -ForegroundColor Gray
}

# Notification credentials usually live only in backend/.env. Complete the
# deployment package with values missing from the production environment,
# without printing secrets or storing them in tracked files.
$deployEnv = Join-Path $deployBackend ".env"
$notificationKeys = @(
    "APIKEYWHATSAPP",
    "EVOLUTION_API_KEY",
    "EVOLUTION_API_URL",
    "EVOLUTION_INSTANCE",
    "EVOLUTION_H1_WHATSAPP_ENABLED",
    "EVOLUTION_H1_CALL_ENABLED",
    "EVOLUTION_H1_NUMBERS",
    "EVOLUTION_H1_CALL_DURATION_SECONDS"
)

function Read-EnvValues([string]$path) {
    $values = @{}
    if (-not (Test-Path $path)) { return $values }

    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            $values[$Matches[1]] = $Matches[2]
        }
    }
    return $values
}

if ((Test-Path $envDev) -and (Test-Path $deployEnv)) {
    $developmentValues = Read-EnvValues $envDev
    $productionValues = Read-EnvValues $deployEnv
    $notificationLines = @()

    foreach ($key in $notificationKeys) {
        $sourceValue = if ($developmentValues.ContainsKey($key)) { [string]$developmentValues[$key] } else { "" }
        $targetValue = if ($productionValues.ContainsKey($key)) { [string]$productionValues[$key] } else { "" }

        if (-not [string]::IsNullOrWhiteSpace($sourceValue) -and [string]::IsNullOrWhiteSpace($targetValue)) {
            $notificationLines += "$key=$sourceValue"
            $productionValues[$key] = $sourceValue
        }
    }

    if ($notificationLines.Count -gt 0) {
        Add-Content -LiteralPath $deployEnv -Value "`n# Notification settings added during deployment"
        Add-Content -LiteralPath $deployEnv -Value $notificationLines
        Write-Host "  -> Configuracion de notificaciones incluida en el paquete" -ForegroundColor Gray
    }

    $hasNotificationKey =
        -not [string]::IsNullOrWhiteSpace([string]$productionValues["EVOLUTION_API_KEY"]) -or
        -not [string]::IsNullOrWhiteSpace([string]$productionValues["APIKEYWHATSAPP"])

    if (-not $hasNotificationKey) {
        Write-Warning "El paquete no contiene EVOLUTION_API_KEY ni APIKEYWHATSAPP; no se enviaran senales por WhatsApp."
    }
}

# Sesión de ApexFusion / BotOld
$apexSession = Join-Path $projectRoot "backend\.apex-session.json"
if (Test-Path $apexSession) {
    Copy-Item -Path $apexSession -Destination "$deployBackend\.apex-session.json" -Force
    Write-Host "  -> Sesión activa de BotOld (.apex-session.json) copiada al paquete" -ForegroundColor Gray
}


# Frontend construido (Quasar genera en frontend/dist/pwa o dist/spa)
$frontendPwa = Join-Path $projectRoot "frontend\dist\pwa"
$frontendSpa = Join-Path $projectRoot "frontend\dist\spa"
$frontendDist = if (Test-Path $frontendPwa) { $frontendPwa } else { $frontendSpa }

if (-not (Test-Path $frontendDist)) {
    Write-Host "ERROR: No se encontró frontend\dist\pwa ni dist\spa. ¿Se ejecutó el build de Quasar?" -ForegroundColor Red
    exit 1
}
$deployFrontend = Join-Path $deployDir "frontend\dist\spa"
New-Item -ItemType Directory -Path $deployFrontend -Force | Out-Null
Copy-Item -Path "$frontendDist\*" -Destination $deployFrontend -Recurse -Force
$modeLabel = if ($frontendDist -eq $frontendPwa) { "PWA Móvil Instalable" } else { "SPA" }
Write-Host "  -> Frontend $modeLabel incluido en /frontend/dist/spa (servido por NestJS en puerto $appPort)" -ForegroundColor Gray

# ecosystem.config.cjs para PM2
Copy-Item -Path (Join-Path $projectRoot "ecosystem.config.cjs") -Destination "$deployDir\" -Force

# package.json raíz mínimo para identificación
@"
{ "name": "bot-indices", "version": "1.0.0", "private": true }
"@ | Set-Content -Path "$deployDir\package.json" -Encoding UTF8

Write-Host "  [OK] Paquete ensamblado en $deployDir" -ForegroundColor Green

# -- 4. Comprimir en TAR.GZ con rutas POSIX y permisos correctos --
Write-Host "[4/5] Comprimiendo paquete en $tarFile (usando tar nativo)..." -ForegroundColor Yellow
& tar.exe -czf $tarFile -C $deployDir .
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR al comprimir con tar.exe" -ForegroundColor Red
    exit 1
}
$tarSize = [math]::Round((Get-Item $tarFile).Length / 1MB, 2)
Write-Host "  [OK] Archivo tar.gz creado: $tarFile ($tarSize MB)" -ForegroundColor Green

# -- 5. Transferir y desplegar en el VPS -----------------------
Write-Host "[5/5] Transfiriendo y desplegando en el VPS..." -ForegroundColor Yellow

Write-Host "  -> Subiendo $tarFile a $vpsUser@$vpsIp`:/home/$vpsUser/deploy_package.tar.gz..."
& scp $tarFile "$vpsUser@$vpsIp`:/home/$vpsUser/deploy_package.tar.gz"
if ($LASTEXITCODE -ne 0) { 
    Write-Host "ERROR en la transferencia SCP" -ForegroundColor Red
    exit 1 
}

Write-Host "  -> Ejecutando comandos de extracción y arranque remoto en VPS..."
$remoteCmds = @"
set -e

echo '--- Preparando estructura de directorios ---'
mkdir -p "$vpsFullPath"
chown -R ${vpsUser}:${vpsUser} "$vpsFullPath"

# Limpiar dist previos para garantizar build limpio sin borrar node_modules
rm -rf "$vpsFullPath/backend/dist" "$vpsFullPath/frontend/dist"

echo '--- Extrayendo paquete con permisos nativos ---'
tar -xzf /home/${vpsUser}/deploy_package.tar.gz -C "$vpsFullPath"
rm -f /home/${vpsUser}/deploy_package.tar.gz

echo '--- Asegurando permisos de ejecución (755) para evitar EACCES ---'
chown -R ${vpsUser}:${vpsUser} "$vpsFullPath"
chmod -R 755 "$vpsFullPath"

echo '--- Instalando dependencias del backend en el VPS ---'
cd $vpsFullPath/backend
npm install --include=dev --prefer-offline --no-audit --no-fund

echo '--- Gestionando proceso en PM2 ---'
cd $vpsFullPath
pm2 restart ecosystem.config.cjs || pm2 start ecosystem.config.cjs
pm2 save

echo '--- Esperando verificación de salud ---'
sleep 3
curl -s -o /dev/null -w "Respuesta HTTP local: %{http_code}\n" http://localhost:3038/bot/ || true

echo '--- Estado de PM2 ---'
pm2 list | grep bot-indices || pm2 list
"@

# Limpiar retornos de carro (CR) para Linux
$remoteCmds = $remoteCmds -replace "`r", ""

& ssh "$vpsUser@$vpsIp" $remoteCmds
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR en la ejecución remota de SSH" -ForegroundColor Red
    exit 1
}

# El bridge corre en este PC porque es quien tiene acceso a los archivos de MT5.
# Tras reiniciar el VPS, comprueba su conexion y lo inicia si esta detenido.
if (-not $SkipBridgeStart) {
    Write-Host "  -> Verificando conexion del bridge local con MT5..." -ForegroundColor Gray
    $bridgeStatusUrl = "http://$vpsIp/bot/api/trading/mt5-status"
    $bridgeConnected = $false

    try {
        Start-Sleep -Seconds 2
        $bridgeStatus = Invoke-RestMethod -Uri $bridgeStatusUrl -Method Get -TimeoutSec 5
        $bridgeConnected = [bool]$bridgeStatus.connected
    } catch {
        $bridgeConnected = $false
    }

    if (-not $bridgeConnected) {
        $bridgeLauncher = Join-Path $projectRoot "iniciar-bridge-mt5.bat"
        if (Test-Path $bridgeLauncher) {
            Start-Process -FilePath "cmd.exe" `
                -ArgumentList @("/c", "`"$bridgeLauncher`"") `
                -WorkingDirectory $projectRoot `
                -WindowStyle Hidden
            Start-Sleep -Seconds 4

            try {
                $bridgeStatus = Invoke-RestMethod -Uri $bridgeStatusUrl -Method Get -TimeoutSec 5
                $bridgeConnected = [bool]$bridgeStatus.connected
            } catch {
                $bridgeConnected = $false
            }
        }
    }

    if ($bridgeConnected) {
        Write-Host "  [OK] MT5 Bridge conectado y enviando posiciones al VPS." -ForegroundColor Green
    } else {
        Write-Warning "MT5 Bridge sigue desconectado. Verifica que MetaTrader y DerivApp_Bridge_EA esten activos."
    }
}

# -- Limpieza local --------------------------------------------
if (Test-Path $tarFile)   { Remove-Item -Force $tarFile -ErrorAction SilentlyContinue }
if (Test-Path $deployDir) { Remove-Item -Recurse -Force $deployDir -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  ¡DESPLIEGUE UNIFICADO COMPLETADO CON ÉXITO!" -ForegroundColor Green
Write-Host "  Acceso por Nginx  : http://$vpsIp/bot/" -ForegroundColor Green
Write-Host "  Carpeta en el VPS : $vpsFullPath" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan
