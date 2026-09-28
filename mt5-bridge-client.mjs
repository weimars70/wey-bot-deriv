// Puente bidireccional entre MetaTrader 5 y el Servidor WeyBot (Local)

import fs from 'fs';
import path from 'path';

const SERVER_URL = process.env.BOT_SERVER_URL || 'http://127.0.0.1:3038/bot';
const MT5_DIR =
  process.env.MT5_FILES_DIR ||
  'C:/Users/Administrator/AppData/Roaming/MetaQuotes/Terminal/BCEF3407BBF131B442A8FC1AD8407C61/MQL5/Files';

const COMMANDS_FILE = path.join(MT5_DIR, 'deriv_bridge_commands.json');
const FEEDBACK_FILE = path.join(MT5_DIR, 'deriv_bridge_feedback.json');
const POSITIONS_FILE = path.join(MT5_DIR, 'deriv_bridge_positions.json');
const HISTORY_FILE = path.join(MT5_DIR, 'deriv_bridge_history.json');

console.log('====================================================');
console.log('🤖  WeyBot MT5 Bridge Client (Local Windows <-> VPS)');
console.log('====================================================');
console.log(`🌐 Servidor VPS : ${SERVER_URL}`);
console.log(`📁 Carpeta MT5  : ${MT5_DIR}`);
console.log('');

if (!fs.existsSync(MT5_DIR)) {
  console.error(`❌ ERROR: La carpeta de MT5 no existe: ${MT5_DIR}`);
  console.error('Verifica la ruta de tu terminal de MetaTrader 5.');
  process.exit(1);
}

// Inicializar archivo de comandos si no existe
if (!fs.existsSync(COMMANDS_FILE)) {
  fs.writeFileSync(COMMANDS_FILE, '', 'utf8');
}

let lastFeedbackSize = 0;
try {
  if (fs.existsSync(FEEDBACK_FILE)) {
    lastFeedbackSize = fs.statSync(FEEDBACK_FILE).size;
  }
} catch {}

let lastPositionsHash = '';
let lastHistoryHash = '';
let lastSentPositionsAt = 0;
const lastErrorAt = new Map();

function logBridgeError(scope, error) {
  const now = Date.now();
  const previous = lastErrorAt.get(scope) || 0;
  if (now - previous < 15_000) return;

  lastErrorAt.set(scope, now);
  console.error(`[${scope}] ${error?.message || error}`);
}

/**
 * 1. Consultar comandos pendientes del servidor VPS y escribirlos en MT5
 */
async function syncCommands() {
  try {
    const res = await fetch(`${SERVER_URL}/api/trading/bridge/commands`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      throw new Error(`Servidor respondio HTTP ${res.status}`);
    }
    const commands = await res.json();

    if (Array.isArray(commands) && commands.length > 0) {
      for (const cmd of commands) {
        const queuedAt = Number(cmd?.queuedAt || 0);
        if (cmd?.action === 'OPEN' && queuedAt > 0 && Date.now() - queuedAt > 60_000) {
          console.warn(`[CMD OMITIDO] Orden vencida para ${cmd.symbol || 'simbolo desconocido'}.`);
          continue;
        }

        const line = JSON.stringify(cmd) + '\n';
        fs.appendFileSync(COMMANDS_FILE, line, 'utf8');
        console.log(
          `📥 [CMD -> MT5] Orden recibida del bot: ${cmd.action} ${cmd.symbol} (${cmd.direction || ''}) Lot: ${cmd.lot || 'default'} SL: ${cmd.stopLossPrice || 'auto'}`
        );
      }
    }
  } catch (err) {
    logBridgeError('COMANDOS', err);
  }
}

/**
 * 2. Enviar confirmaciones de órdenes (feedback) desde MT5 hacia el servidor VPS
 */
async function syncFeedback() {
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) return;
    const stat = fs.statSync(FEEDBACK_FILE);
    if (stat.size > lastFeedbackSize) {
      const fd = fs.openSync(FEEDBACK_FILE, 'r');
      const buffer = Buffer.alloc(stat.size - lastFeedbackSize);
      fs.readSync(fd, buffer, 0, buffer.length, lastFeedbackSize);
      fs.closeSync(fd);

      const newContent = buffer.toString('utf8');
      if (newContent.trim()) {
        const res = await fetch(`${SERVER_URL}/api/trading/bridge/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: newContent }),
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          console.log(`📤 [FEEDBACK -> VPS] Confirmación de ejecución enviada al servidor.`);
        } else {
          throw new Error(`Servidor respondio HTTP ${res.status}`);
        }
      }
      lastFeedbackSize = stat.size;
    } else if (stat.size < lastFeedbackSize) {
      // El archivo fue limpiado o rotado por el EA
      lastFeedbackSize = stat.size;
    }
  } catch (err) {
    logBridgeError('FEEDBACK', err);
  }
}

/**
 * 3. Sincronizar posiciones abiertas en vivo desde MT5 hacia el servidor VPS
 */
async function syncPositions() {
  try {
    if (!fs.existsSync(POSITIONS_FILE)) return;
    const content = fs.readFileSync(POSITIONS_FILE, 'utf8');
    if (!content || !content.trim().startsWith('[')) return;

    const now = Date.now();
    if (content !== lastPositionsHash || now - lastSentPositionsAt > 3500) {
      const positions = JSON.parse(content);
      const response = await fetch(`${SERVER_URL}/api/trading/bridge/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        throw new Error(`Servidor respondio HTTP ${response.status}`);
      }
      lastPositionsHash = content;
      lastSentPositionsAt = now;
    }
  } catch (err) {
    logBridgeError('POSICIONES', err);
  }
}

/**
 * 4. Sincronizar historial de operaciones cerradas desde MT5 hacia el servidor VPS
 */
async function syncHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return;
    const content = fs.readFileSync(HISTORY_FILE, 'utf8');
    if (!content || !content.trim().startsWith('[')) return;

    if (content !== lastHistoryHash) {
      const history = JSON.parse(content);
      const response = await fetch(`${SERVER_URL}/api/trading/bridge/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        throw new Error(`Servidor respondio HTTP ${response.status}`);
      }
      lastHistoryHash = content;
    }
  } catch (err) {
    logBridgeError('HISTORIAL', err);
  }
}

console.log('✅ Puente MT5 <-> VPS iniciado y activo.');
console.log('Escuchando órdenes del bot en tiempo real...\n');

// Publica el estado inmediatamente para que el VPS sepa que MT5 esta disponible.
void syncPositions();
void syncHistory();

// Bucle de sincronización de comandos y feedback en alta frecuencia (cada 400ms)
setInterval(async () => {
  await syncCommands();
  await syncFeedback();
}, 400);

// Bucle de sincronización de posiciones abiertas (cada 1.2s)
setInterval(async () => {
  await syncPositions();
}, 1200);

// Bucle de sincronización de historial cerrado (cada 4s)
setInterval(async () => {
  await syncHistory();
}, 4000);
