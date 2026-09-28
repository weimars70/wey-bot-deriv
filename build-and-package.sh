#!/bin/bash

# Script Maestro para Generar Paquete de Producción (Optimizado) para macOS / Linux

NO_BUILD=false
SKIP_FRONTEND=false
SKIP_BACKEND=false

# Pase de argumentos
for arg in "$@"
do
    case $arg in
        --NoBuild) NO_BUILD=true ;;
        --SkipFrontend) SKIP_FRONTEND=true ;;
        --SkipBackend) SKIP_BACKEND=true ;;
    esac
done

echo -e "\033[1;36m--- Iniciando Proceso de Construcción Optimizado ---\033[0m"

DEPLOY_DIR="DEPLOY_PACKAGE"
ZIP_FILE="deploy_package.zip"
SERVER_FOLDER="acueducto-V3"
VPS_USER="weimars"
VPS_IP="2.58.80.90"
VPS_FULL_PATH="/home/weimars/$SERVER_FOLDER"

# 1. Limpiar versiones anteriores locales
echo "Limpiando versiones anteriores locales..."
rm -rf $DEPLOY_DIR
rm -f $ZIP_FILE
mkdir -p $DEPLOY_DIR

# 2. Construcción en paralelo si no se indica lo contrario
if [ "$NO_BUILD" = false ]; then
    echo -e "\n\033[1;33m[1/2] Iniciando construcciones en paralelo...\033[0m"

    if [ "$SKIP_FRONTEND" = false ]; then
        echo " - Lanzando build de Frontend (Root)..."
        rm -rf dist
        npm run build &
        FRONTEND_PID=$!
    fi

    if [ "$SKIP_BACKEND" = false ]; then
        echo " - Lanzando build de Backend..."
        rm -rf backend/dist
        (cd backend && npm run build) &
        BACKEND_PID=$!
    fi

    echo -e "\033[1;30mEsperando a que las construcciones terminen...\033[0m"
    
    FAILED=false
    
    if [ "$SKIP_FRONTEND" = false ]; then
        wait $FRONTEND_PID
        if [ $? -eq 0 ]; then
            echo -e " - FrontendBuild completado con éxito. \033[1;32m✓\033[0m"
        else
            echo -e " - \033[1;31m¡Error en FrontendBuild!\033[0m"
            FAILED=true
        fi
    fi

    if [ "$SKIP_BACKEND" = false ]; then
        wait $BACKEND_PID
        if [ $? -eq 0 ]; then
            echo -e " - BackendBuild completado con éxito. \033[1;32m✓\033[0m"
        else
            echo -e " - \033[1;31m¡Error en BackendBuild!\033[0m"
            FAILED=true
        fi
    fi

    if [ "$FAILED" = true ]; then
        echo -e "\n\033[1;31mEl proceso se detuvo debido a errores en la compilación.\033[0m"
        exit 1
    fi
else
    echo -e "\n\033[1;35mSaltando etapa de compilación (--NoBuild detectado)\033[0m"
fi

# 3. Ensamblar Paquete Final Local
echo -e "\n\033[1;32m[2/2] Ensamblando paquete local y comprimiendo...\033[0m"

# Frontend
if [ -d "dist" ]; then
    cp -R dist $DEPLOY_DIR/
fi

# Backend
mkdir -p $DEPLOY_DIR/backend/dist
if [ -d "backend/dist" ]; then
    cp -R backend/dist/* $DEPLOY_DIR/backend/dist/
fi
cp backend/package.json $DEPLOY_DIR/backend/ 2>/dev/null || true
cp backend/package-lock.json $DEPLOY_DIR/backend/ 2>/dev/null || true
mkdir -p $DEPLOY_DIR/backend/src
if [ -f "backend/src/realtime-server.mjs" ]; then
    cp backend/src/realtime-server.mjs $DEPLOY_DIR/backend/src/
fi

# Root configs
cp package.json $DEPLOY_DIR/ 2>/dev/null || true
cp package-lock.json $DEPLOY_DIR/ 2>/dev/null || true
cp ecosystem.config.cjs $DEPLOY_DIR/ 2>/dev/null || true

# Copiar .envs
if [ -f ".env" ]; then cp .env $DEPLOY_DIR/; fi
if [ -f "backend/.env" ]; then cp backend/.env $DEPLOY_DIR/backend/; fi

# COMPRESIÓN PARA SUBIDA RÁPIDA
echo -e "\033[1;30mCompactando archivos para transferencia (Zip)...\033[0m"
cd $DEPLOY_DIR
zip -rq ../$ZIP_FILE *
cd ..

# 4. Despliegue automático al VPS
echo -e "\n\033[1;36m--- Iniciando Transferencia y Despliegue ---\033[0m"

echo "Subiendo archivo comprimido (esto es mucho más rápido que SCP recursivo)..."
scp $ZIP_FILE $VPS_USER@$VPS_IP:/home/weimars/$ZIP_FILE

echo "Extrayendo y actualizando en el VPS..."
ssh $VPS_USER@$VPS_IP << "EOF"
mkdir -p /home/weimars/acueducto-V3
unzip -o /home/weimars/deploy_package.zip -d /home/weimars/acueducto-V3
rm /home/weimars/deploy_package.zip
cd /home/weimars/acueducto-V3
npm install --production --prefer-offline
cd backend
npm install --production --prefer-offline
cd ..
pm2 reload ecosystem.config.cjs || pm2 start ecosystem.config.cjs
pm2 save
EOF

# Limpieza local
rm -f $ZIP_FILE

echo -e "\n\033[1;36m====================================================\033[0m"
echo -e "\033[1;32m¡DESPLIEGUE OPTIMIZADO COMPLETADO!\033[0m"
echo "Transferencia mediante ZIP y Recarga PM2 exitosa."
echo -e "\033[1;36m====================================================\033[0m"
