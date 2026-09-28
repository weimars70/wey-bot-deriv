#!/usr/bin/env bash
set -euo pipefail

MT5_USER="mt5bot"
MT5_HOME="/home/${MT5_USER}"
MT5_PREFIX="${MT5_HOME}/.mt5"
MT5_DIR="${MT5_PREFIX}/drive_c/MetaTrader5"
INSTALL_DIR="/opt/weybot-mt5"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDENTIAL_FILE="/home/weimars/.mt5-vps-access"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

for required in \
  "${SCRIPT_DIR}/mt5-terminal.service" \
  "${SCRIPT_DIR}/mt5-bridge.service" \
  "${SCRIPT_DIR}/mt5-start.ini" \
  "${SCRIPT_DIR}/MetaTrader5.desktop" \
  "${SCRIPT_DIR}/DerivApp_Bridge_EA.ex5" \
  "${SCRIPT_DIR}/mt5-bridge-client.mjs"; do
  if [[ ! -f "${required}" ]]; then
    echo "Missing required file: ${required}" >&2
    exit 1
  fi
done

echo "[1/7] Preparing the isolated MT5 user..."
if ! id "${MT5_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${MT5_USER}"
  MT5_PASSWORD="$(openssl rand -hex 12)"
  echo "${MT5_USER}:${MT5_PASSWORD}" | chpasswd
  install -o weimars -g weimars -m 600 /dev/null "${CREDENTIAL_FILE}"
  printf 'RDP_USER=%s\nRDP_PASSWORD=%s\n' "${MT5_USER}" "${MT5_PASSWORD}" > "${CREDENTIAL_FILE}"
fi

echo "[2/7] Installing RDP, virtual display and Wine dependencies..."
dpkg --add-architecture i386
install -d -m 755 /etc/apt/keyrings
wget -qO- https://dl.winehq.org/wine-builds/winehq.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/winehq-archive.key
wget -qO /etc/apt/sources.list.d/winehq-focal.sources \
  https://dl.winehq.org/wine-builds/ubuntu/dists/focal/winehq-focal.sources
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates curl wget gnupg2 openssl xrdp xvfb xfce4-session winbind cabextract
DEBIAN_FRONTEND=noninteractive apt-get install -y --install-recommends winehq-staging

echo "[3/7] Restricting RDP to the SSH tunnel..."
sed -i '0,/^port=.*/s|^port=.*|port=tcp://127.0.0.1:3389|' /etc/xrdp/xrdp.ini
usermod -aG ssl-cert xrdp
printf 'xfce4-session\n' > "${MT5_HOME}/.xsession"
chown "${MT5_USER}:${MT5_USER}" "${MT5_HOME}/.xsession"
chmod 600 "${MT5_HOME}/.xsession"
systemctl enable --now xrdp
systemctl restart xrdp

echo "[4/7] Initializing the Wine prefix..."
install -d -o "${MT5_USER}" -g "${MT5_USER}" -m 755 "${MT5_PREFIX}" "${INSTALL_DIR}"
install -d -o "${MT5_USER}" -g "${MT5_USER}" -m 700 "/tmp/runtime-${MT5_USER}"
runuser -u "${MT5_USER}" -- env \
  HOME="${MT5_HOME}" \
  XDG_RUNTIME_DIR="/tmp/runtime-${MT5_USER}" \
  WINEPREFIX="${MT5_PREFIX}" \
  WINEARCH=win64 \
  xvfb-run -a wineboot --init

echo "[5/7] Downloading and installing MetaTrader 5..."
wget -qO "${INSTALL_DIR}/mt5setup.exe" \
  https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
wget -qO "${INSTALL_DIR}/webview2.exe" \
  https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/f2910a1e-e5a6-4f17-b52d-7faf525d17f8/MicrosoftEdgeWebview2Setup.exe
chown -R "${MT5_USER}:${MT5_USER}" "${INSTALL_DIR}"

runuser -u "${MT5_USER}" -- env \
  HOME="${MT5_HOME}" \
  XDG_RUNTIME_DIR="/tmp/runtime-${MT5_USER}" \
  WINEPREFIX="${MT5_PREFIX}" \
  xvfb-run -a wine "${INSTALL_DIR}/webview2.exe" /silent /install || true

runuser -u "${MT5_USER}" -- env \
  HOME="${MT5_HOME}" \
  XDG_RUNTIME_DIR="/tmp/runtime-${MT5_USER}" \
  WINEPREFIX="${MT5_PREFIX}" \
  xvfb-run -a timeout 300 wine "${INSTALL_DIR}/mt5setup.exe" /auto '/path:C:\MetaTrader5' || true

runuser -u "${MT5_USER}" -- env WINEPREFIX="${MT5_PREFIX}" wineserver -k || true

if [[ ! -f "${MT5_DIR}/terminal64.exe" ]]; then
  echo "MetaTrader installer did not create ${MT5_DIR}/terminal64.exe" >&2
  exit 1
fi

echo "[6/7] Installing the EA, local bridge and startup files..."
install -d -o "${MT5_USER}" -g "${MT5_USER}" -m 755 \
  "${MT5_DIR}/MQL5/Experts" \
  "${MT5_DIR}/MQL5/Files" \
  "${MT5_HOME}/Desktop"
install -o "${MT5_USER}" -g "${MT5_USER}" -m 644 \
  "${SCRIPT_DIR}/DerivApp_Bridge_EA.ex5" \
  "${MT5_DIR}/MQL5/Experts/DerivApp_Bridge_EA.ex5"
install -o "${MT5_USER}" -g "${MT5_USER}" -m 644 \
  "${SCRIPT_DIR}/mt5-bridge-client.mjs" \
  "${INSTALL_DIR}/mt5-bridge-client.mjs"
install -o "${MT5_USER}" -g "${MT5_USER}" -m 600 \
  "${SCRIPT_DIR}/mt5-start.ini" \
  "${MT5_HOME}/mt5-start.ini"
install -o "${MT5_USER}" -g "${MT5_USER}" -m 755 \
  "${SCRIPT_DIR}/MetaTrader5.desktop" \
  "${MT5_HOME}/Desktop/MetaTrader5.desktop"

echo "[7/7] Installing services (left stopped until Deriv login is configured)..."
install -o root -g root -m 644 "${SCRIPT_DIR}/mt5-terminal.service" /etc/systemd/system/mt5-terminal.service
install -o root -g root -m 644 "${SCRIPT_DIR}/mt5-bridge.service" /etc/systemd/system/mt5-bridge.service
systemctl daemon-reload
systemctl disable mt5-terminal.service mt5-bridge.service >/dev/null 2>&1 || true
systemctl stop mt5-terminal.service mt5-bridge.service >/dev/null 2>&1 || true

echo
echo "MT5 installation is ready."
echo "RDP is listening only on 127.0.0.1:3389."
echo "Credentials were saved to ${CREDENTIAL_FILE}."
echo "After logging in to Deriv, run: sudo systemctl enable --now mt5-terminal mt5-bridge"

