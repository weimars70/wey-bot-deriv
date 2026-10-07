import { defineStore } from 'pinia';
import { useAuthStore } from './auth.store';
import { crashIaStrategyService } from 'src/services/crashIaStrategy.service';
import { weySignalsService } from 'src/services/weySignals.service';
import { h1StrategyService } from 'src/services/h1Strategy.service';
import { signalCenterService } from 'src/services/signalCenter.service';
import { getSocket } from 'src/services/socket.service';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { LocalNotifications } from '@capacitor/local-notifications';

// ─── Notificaciones nativas de fondo ─────────────────────────────────────────
// Canal de notificaciones Android (requerido para Android 8+)
const NOTIF_CHANNEL_ID = 'weybot_alerts';
let notifChannelCreated = false;
let notifPermissionGranted = false;
let notifIdCounter = 1000;
const H1_ALERT_ALLOWED_EMAIL = 'weimarsuber@gmail.com';
const H1_EVALUATION_MINUTES = [13, 28, 43, 58];
let signalCenterSocket = null;
let signalCenterSocketHandler = null;

function getSignalCenterStorageKey(kind) {
  let identity = 'default';
  try {
    const authStore = useAuthStore();
    identity = authStore.user?.id || authStore.user?.email || 'default';
  } catch (e) {}
  return `signal_center_${kind}_${identity}`;
}

function readStoredCenterIds(kind) {
  try {
    const value = JSON.parse(localStorage.getItem(getSignalCenterStorageKey(kind)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (e) {
    return [];
  }
}

function writeStoredCenterIds(kind, ids) {
  try {
    localStorage.setItem(
      getSignalCenterStorageKey(kind),
      JSON.stringify([...new Set(ids)].slice(-500)),
    );
  } catch (e) {}
}

function isScheduledSignalType(type = '') {
  return type === 'H1_NO_WICK'
    || type.startsWith('DOUBLE_WICK')
    || type === 'HIGH_STARS_SIGNAL'
    || type.includes('SPIKE');
}

function isAnticipatedH1Alert(alert) {
  return alert?.type === 'H1_NO_WICK' && /ANTICIPADA/i.test(alert.title || '');
}

function isSuppressedCrashBoomReview(alert) {
  return alert?.type === 'CRASH_REVIEW' || alert?.type === 'BOOM_REVIEW';
}

function isAllowedH1AlertUser(authStore) {
  return (authStore.user?.email || '').trim().toLowerCase() === H1_ALERT_ALLOWED_EMAIL;
}

function getPreSpikeEvaluationWindow(now = new Date()) {
  const evaluationMinutes = H1_EVALUATION_MINUTES;
  const minute = now.getMinutes();
  if (!evaluationMinutes.includes(minute)) return null;

  const targetMinute = (minute + 2) % 60;
  const dateKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(minute).padStart(2, '0'),
  ].join('-');

  return {
    key: dateKey,
    targetLabel: `:${String(targetMinute).padStart(2, '0')}`,
  };
}

async function ensureNativeNotifReady() {
  if (!Capacitor.isNativePlatform()) return false;

  // Solicitar permiso (solo pregunta una vez al usuario)
  if (!notifPermissionGranted) {
    try {
      const { display } = await LocalNotifications.requestPermissions();
      notifPermissionGranted = display === 'granted';
    } catch (e) {
      return false;
    }
  }
  if (!notifPermissionGranted) return false;

  // Crear canal de alta importancia (sonido + vibración incluso en background)
  if (!notifChannelCreated) {
    try {
      await LocalNotifications.createChannel({
        id: NOTIF_CHANNEL_ID,
        name: 'WeyBot Alertas',
        description: 'Señales y confirmaciones en vivo del radar WeyBot',
        importance: 5,           // IMPORTANCE_HIGH — heads-up + sonido
        visibility: 1,           // VISIBILITY_PUBLIC
        sound: 'default',
        vibration: true,
        lights: true,
        lightColor: '#F5A623',
      });
      notifChannelCreated = true;
    } catch (e) {
      // Canal puede ya existir, no es error fatal
      notifChannelCreated = true;
    }
  }
  return true;
}

/**
 * Dispara una notificación del sistema con sonido.
 * El OS la entrega aunque la app esté minimizada o el WebView suspendido.
 */
async function fireNativeNotification(title, body) {
  try {
    const ready = await ensureNativeNotifReady();
    if (!ready) return false;
    const id = notifIdCounter++;
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          channelId: NOTIF_CHANNEL_ID,
          // Sin schedule → entrega inmediata, el OS no la pospone
          sound: 'default',
          smallIcon: 'ic_launcher_foreground',
          iconColor: '#F5A623',
          autoCancel: true,
          extra: null,
        },
      ],
    });
    return true;
  } catch (e) {
    return false;
  }
}

function formatPronounceableMarket(symbol) {
  const s = (symbol || '').toUpperCase();
  if (s.includes('CRASH1000')) return 'Crash mil';
  if (s.includes('CRASH900'))  return 'Crash novecientos';
  if (s.includes('CRASH600'))  return 'Crash seiscientos';
  if (s.includes('CRASH500'))  return 'Crash quinientos';
  if (s.includes('CRASH300'))  return 'Crash trescientos';
  if (s.includes('CRASH200'))  return 'Crash doscientos';
  if (s.includes('CRASH100'))  return 'Crash cien';
  if (s.includes('BOOM1000'))  return 'Boom mil';
  if (s.includes('BOOM900'))   return 'Boom novecientos';
  if (s.includes('BOOM600'))   return 'Boom seiscientos';
  if (s.includes('BOOM500'))   return 'Boom quinientos';
  if (s.includes('BOOM300'))   return 'Boom trescientos';
  if (s.includes('BOOM200'))   return 'Boom doscientos';
  if (s.includes('BOOM100'))   return 'Boom cien';
  return s;
}

function formatAlertPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return '--';
  return price.toFixed(3).replace(/\.?0+$/, '');
}

function compactAlertReason(reason, maxLength = 120) {
  const normalized = String(reason || 'esperar confirmacion de reaccion')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function buildCrashBoomAlertReport(item) {
  const isBoom = item.marketType === 'BOOM' || item.symbol.startsWith('BOOM');
  const direction = isBoom ? 'BUY' : 'SELL';
  const filters = item.filters || {};
  const ready = isBoom ? Boolean(item.canBuy) : Boolean(item.canSell);
  const coolingCount = Number(
    isBoom ? filters.consecutiveRedM1 : filters.consecutiveGreenM1,
  ) || 0;
  const coolingRequired = Number(filters.minGreenRequired) || 3;
  const coolingColor = isBoom ? 'rojas' : 'verdes';
  const expectedTrend = isBoom ? 'alcista' : 'bajista';
  const inRetest = item.status === 'EN_RETESTEO'
    || (item.retestZone?.isInRetest && !item.retestZone?.isReadyForEntry);
  const inEntryArea = item.status === 'EN_ZONA_50' || item.status === 'EN_RETESTEO';
  const orderBlockInZone = item.activeOrderBlock?.status === 'EN_ZONA';
  const fulfilled = [];
  const missing = [];

  if (inEntryArea) {
    fulfilled.push('zona de precio activa');
  } else if (ready) {
    fulfilled.push('reaccion M5 valida');
  } else if (item.status === 'EN_BASE_CAJA') {
    missing.push(`llegar al 50% (${formatAlertPrice(item.entryLevel50)})`);
  }

  if (filters.trendOk) {
    fulfilled.push(`tendencia M15 ${expectedTrend}`);
  } else {
    missing.push(`tendencia M15 ${expectedTrend}`);
  }

  if (filters.greenOk) {
    fulfilled.push(`${coolingCount} velas ${coolingColor} M1`);
  } else {
    const remaining = Math.max(0, coolingRequired - coolingCount);
    missing.push(`${remaining} vela(s) ${coolingColor} M1 (${coolingCount}/${coolingRequired})`);
  }

  if (inRetest) {
    missing.push('salir del retesteo M5');
  } else if (item.m5Viability?.isViable) {
    fulfilled.push('confirmacion M5');
  } else {
    missing.push(`M5: ${compactAlertReason(item.m5Viability?.reason)}`);
  }

  if (orderBlockInZone) fulfilled.push('precio dentro del OB');

  const rsi = Number(filters.rsi_M5);
  const rsiValue = Number.isFinite(rsi) ? rsi.toFixed(1) : 'sin datos';
  const rsiRequirement = isBoom ? '<=35' : '>=65';
  if (filters.rsiOk) fulfilled.push(`RSI M5 ${rsiValue} (${rsiRequirement})`);
  else missing.push(`RSI M5 ${rsiValue} (requiere ${rsiRequirement})`);

  const fingerprint = ready
    ? `READY_${direction}`
    : [
        'REVIEW',
        item.status,
        filters.trendOk ? 'T1' : 'T0',
        filters.greenOk ? 'C1' : `C${coolingCount}`,
        filters.rsiOk ? 'I1' : 'I0',
        item.m5Viability?.isViable ? 'M1' : 'M0',
        inRetest ? 'R1' : 'R0',
      ].join('_');

  return {
    isBoom,
    direction,
    ready,
    fulfilled,
    missing,
    context: null,
    fingerprint,
  };
}

let sharedAudioCtx = null;
let isAudioUnlocked = false;

// Generador de tono WAV PCM en Base64 para garantizar reproducción en móviles
function generateWavDataUri(frequency = 880, durationSeconds = 0.3) {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = new Uint8Array(44 + numSamples);

  buffer.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  const fileSize = 36 + numSamples;
  buffer[4] = fileSize & 0xff;
  buffer[5] = (fileSize >> 8) & 0xff;
  buffer[6] = (fileSize >> 16) & 0xff;
  buffer[7] = (fileSize >> 24) & 0xff;
  buffer.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  buffer.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  buffer[16] = 16;
  buffer[20] = 1;
  buffer[22] = 1; // Mono
  buffer[24] = sampleRate & 0xff;
  buffer[25] = (sampleRate >> 8) & 0xff;
  buffer[28] = sampleRate & 0xff;
  buffer[29] = (sampleRate >> 8) & 0xff;
  buffer[32] = 1;
  buffer[34] = 8;
  buffer.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  buffer[40] = numSamples & 0xff;
  buffer[41] = (numSamples >> 8) & 0xff;
  buffer[42] = (numSamples >> 16) & 0xff;
  buffer[43] = (numSamples >> 24) & 0xff;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-3.2 * (t / durationSeconds));
    const sample = Math.sin(2 * Math.PI * frequency * t) * envelope;
    buffer[44 + i] = Math.floor(128 + 120 * sample);
  }

  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

const CHIME_WAV_TRADE = generateWavDataUri(659.25, 0.35); // E5
const CHIME_WAV_RADAR = generateWavDataUri(523.25, 0.28); // C5

function playHtml5AudioFallback(toneType = 'trade') {
  try {
    const src = toneType === 'trade' ? CHIME_WAV_TRADE : CHIME_WAV_RADAR;
    const audio = new Audio(src);
    audio.volume = 1.0;
    audio.play().catch(() => {});
  } catch (e) {}
}

function unlockAudioHardware(ctx) {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Buffer silencioso de 1 muestra para activar el DAC de audio en Android e iOS
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    isAudioUnlocked = true;
  } catch (e) {}
}

function getSafeAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch (e) {
    return null;
  }
}

// Desbloqueo global automático e infalible al primer gesto en móvil o desktop
if (typeof window !== 'undefined') {
  const unlockEvents = ['click', 'touchstart', 'touchend', 'keydown', 'pointerdown'];
  const unlockHandler = () => {
    const ctx = getSafeAudioContext();
    if (ctx) unlockAudioHardware(ctx);
    if ('speechSynthesis' in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    // Desbloquear también el reproductor HTML5
    try {
      const a = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      a.play().catch(() => {});
    } catch {}
  };
  unlockEvents.forEach((evt) => window.addEventListener(evt, unlockHandler, { passive: true, once: false }));
}

export const useAlertsStore = defineStore('alerts', {
  state: () => ({
    alerts: [],
    soundEnabled: localStorage.getItem('alerts_sound_enabled') !== 'false',
    voiceEnabled: localStorage.getItem('alerts_voice_enabled') !== 'false',
    lastAlertTimestamps: {},
    crashBoomEvaluationStates: {},
    lastPreSpikeEvaluationKey: null,
    preSpikeEvaluationInFlight: false,
    signalCenterSyncInFlight: false,
    pollingTimer: null,
    isInitialized: false,
  }),

  getters: {
    unreadCount: (state) => state.alerts.filter((a) => !a.read).length,
    activeAlerts: (state) => state.alerts,
  },

  actions: {
    setSoundEnabled(val) {
      this.soundEnabled = val;
      localStorage.setItem('alerts_sound_enabled', val ? 'true' : 'false');
    },

    setVoiceEnabled(val) {
      this.voiceEnabled = val;
      localStorage.setItem('alerts_voice_enabled', val ? 'true' : 'false');
    },

    markAllAsRead() {
      for (const a of this.alerts) {
        a.read = true;
      }
    },

    markAsRead(id) {
      const item = this.alerts.find((a) => a.id === id);
      if (item) item.read = true;
    },

    clearAlerts() {
      const dismissed = readStoredCenterIds('dismissed');
      const backendIds = this.alerts
        .map((alert) => alert.backendId)
        .filter(Boolean);
      writeStoredCenterIds('dismissed', [...dismissed, ...backendIds]);
      this.alerts = [];
    },

    /**
     * Emite un sonido de campana armónica suave (onda sinusoidal pura, no pito estridente).
     * Si Web Audio API está suspendido en móvil (app en background), usa notificación nativa.
     */
    playChimeSound(toneType = 'trade') {
      let webAudioSuccess = false;
      try {
        const ctx = getSafeAudioContext();
        if (ctx && ctx.state !== 'suspended') {
          const now = ctx.currentTime;
          const notes = toneType === 'trade'
            ? [
                { freq: 523.25, start: 0.00, dur: 0.22, vol: 0.45 },
                { freq: 659.25, start: 0.08, dur: 0.25, vol: 0.40 },
                { freq: 783.99, start: 0.16, dur: 0.35, vol: 0.40 },
              ]
            : [
                { freq: 659.25, start: 0.00, dur: 0.20, vol: 0.40 },
                { freq: 783.99, start: 0.10, dur: 0.30, vol: 0.45 },
              ];

          for (const n of notes) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(n.freq, now + n.start);

            gain.gain.setValueAtTime(0.0001, now + n.start);
            gain.gain.linearRampToValueAtTime(n.vol, now + n.start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + n.start);
            osc.stop(now + n.start + n.dur + 0.03);
          }
          webAudioSuccess = true;
        }
      } catch (e) {
        webAudioSuccess = false;
      }

      // Si Web Audio no estaba listo o falló en móvil, usar el fallback HTML5
      if (!webAudioSuccess) {
        playHtml5AudioFallback(toneType);
      }
    },

    /**
     * Emite alerta hablada a alto volumen usando el motor nativo del sistema (Android TTS)
     * o la Web Speech API del navegador.
     */
    async speakVoice(text) {
      if (!text || !this.voiceEnabled) return;

      // 1. En APK Android Nativa (Capacitor): Motor nativo TextToSpeech del teléfono
      try {
        if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
          try {
            await TextToSpeech.stop().catch(() => {});
            await TextToSpeech.speak({
              text,
              lang: 'es-ES',
              rate: 1.0,
              pitch: 1.0,
              volume: 1.0,
              category: 'ambient',
            });
            return;
          } catch (nativeErr) {
            console.warn('TextToSpeech nativo falló, pasando a Web Speech:', nativeErr);
          }
        }
      } catch (e) {
        console.warn('Error verificando plataforma nativa:', e);
      }

      // 2. En Navegador Web (Desktop / Móvil PWA): Web Speech API
      try {
        if (!('speechSynthesis' in window)) return;

        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.cancel();

        const utter = new SpeechSynthesisUtterance(text);
        utter.volume = 1.0;
        utter.rate = 1.05;
        utter.pitch = 1.05;
        utter.lang = 'es-ES';

        const voices = window.speechSynthesis.getVoices() || [];
        const esVoice = voices.find(
          (v) => (v.lang && (v.lang.startsWith('es') || v.lang.includes('ES') || v.lang.includes('MX')))
        );
        if (esVoice) utter.voice = esVoice;

        window.speechSynthesis.speak(utter);
      } catch (e) {
        console.warn('Error en síntesis de voz web:', e);
      }
    },

    /**
     * Prueba interactiva de sonido y locución de voz a alto volumen.
     */
    testAudioAlert() {
      const ctx = getSafeAudioContext();
      if (ctx) unlockAudioHardware(ctx);
      this.playChimeSound('trade');
      setTimeout(() => {
        this.speakVoice('¡Alerta de prueba! Sistema de confirmaciones Deriv activo a alto volumen.');
      }, 380);
    },

    /**
     * Registra y emite una alerta verificando la ventana de enfriamiento (cooldown).
     */
    triggerNotification({
      type,
      symbol,
      title,
      message,
      speechText,
      routeQuery,
      targetPath,
      severity = 'success',
      dedupeKey,
      playChime = true,
      toneType = 'radar',
      id,
      backendId,
      createdAt,
      read = false,
      bypassPreferences = false,
    }) {
      // ── FILTRADO POR PARAMETRIZACIÓN DINÁMICA DEL USUARIO ──
      if (!bypassPreferences) {
        try {
          const authStore = useAuthStore();
          const prefs = authStore.strategyPreferences;
          if (type && type.startsWith('H1_') && !isAllowedH1AlertUser(authStore)) return;
          if (type && type.startsWith('H1_') && !prefs.h1NoWick) return;
          if (type && type.startsWith('DOUBLE_WICK') && !prefs.doubleWick) return;
          if (type && (type.includes('CRASH_') || type.includes('BOOM_') || type === 'OB_EN_ZONA' || type === 'CONFIRMACION_ZONA') && !prefs.crashBoomIa) return;
          if (type === 'HIGH_STARS_SIGNAL' && !prefs.weySignals) return;
          if (type && (type === 'SPIKE_DETECTED' || type.includes('SPIKE')) && !prefs.spikePatterns) return;
        } catch (e) {}
      }

      const cooldownMs = 120_000; // 2 minutos de enfriamiento
      const key = dedupeKey || `${symbol}_${type}`;
      const now = Date.now();

      if (
        !bypassPreferences &&
        this.alerts.some((alert) =>
          alert.backendId &&
          alert.type === type &&
          alert.symbol === symbol &&
          now - (alert.createdAtEpoch || 0) <= 5 * 60_000,
        )
      ) {
        return;
      }

      if (this.lastAlertTimestamps[key] && now - this.lastAlertTimestamps[key] < cooldownMs) {
        return;
      }

      this.lastAlertTimestamps[key] = now;
      const createdAtEpoch = createdAt ? new Date(createdAt).getTime() : now;
      const safeCreatedAtEpoch = Number.isFinite(createdAtEpoch) ? createdAtEpoch : now;

      const newAlert = {
        id: id || `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        backendId: backendId || null,
        type,
        symbol,
        title,
        message,
        speechText,
        targetPath: targetPath || '/crash-ia',
        routeQuery: routeQuery || { symbol },
        severity,
        time: new Date(safeCreatedAtEpoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAtEpoch: safeCreatedAtEpoch,
        read,
      };

      this.alerts.unshift(newAlert);
      if (this.alerts.length > 40) {
        this.alerts.pop();
      }

      const isScheduledMinute = H1_EVALUATION_MINUTES.includes(new Date().getMinutes());
      const canPlayScheduledSignalAudio = !isScheduledSignalType(type) || isScheduledMinute;

      // 1. Sonido: en primer plano → Web Audio; en background/APK → notificación nativa con sonido del sistema
      if (this.soundEnabled && playChime && canPlayScheduledSignalAudio) {
        if (Capacitor.isNativePlatform()) {
          // Siempre disparar notificación nativa (el OS la entrega incluso con app minimizada)
          fireNativeNotification(title, message || title).then((sent) => {
            // Si la app está en primer plano el WebView sigue activo → también tocar el chime
            if (!sent) this.playChimeSound(toneType);
          });
          // Intentar también el chime por si el WebView sigue activo
          this.playChimeSound(toneType);
        } else {
          this.playChimeSound(toneType);
        }
      }

      // 2. Emisión de Voz a Alto Volumen
      if (this.voiceEnabled && speechText && canPlayScheduledSignalAudio) {
        setTimeout(() => {
          this.speakVoice(speechText);
        }, 350);
      }
    },

    ingestSignalCenterAlerts(items, live = false) {
      if (!Array.isArray(items) || !items.length) return;

      this.alerts = this.alerts.filter((alert) => !isSuppressedCrashBoomReview(alert));
      items = items.filter((item) => !isSuppressedCrashBoomReview(item));
      if (!items.length) return;

      const delivered = new Set(readStoredCenterIds('delivered'));
      const dismissed = new Set(readStoredCenterIds('dismissed'));
      const existingBackendIds = new Set(
        this.alerts.map((alert) => alert.backendId).filter(Boolean),
      );
      const ordered = [...items]
        .filter((item) => item?.id && !dismissed.has(item.id))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const now = Date.now();
      const newestFreshUnseen = [...ordered]
        .reverse()
        .find((item) =>
          !delivered.has(item.id) &&
          now - new Date(item.createdAt).getTime() <= 5 * 60_000,
        );

      for (const item of ordered) {
        if (existingBackendIds.has(item.id)) continue;

        const createdAtEpoch = new Date(item.createdAt).getTime();
        const wasDelivered = delivered.has(item.id);
        const localDuplicate = this.alerts.find((alert) =>
          !alert.backendId &&
          alert.type === item.type &&
          alert.symbol === item.symbol &&
          (item.type !== 'H1_NO_WICK'
            || isAnticipatedH1Alert(alert) === isAnticipatedH1Alert(item)) &&
          Math.abs((alert.createdAtEpoch || 0) - createdAtEpoch) <= 5 * 60_000,
        );

        if (localDuplicate) {
          localDuplicate.backendId = item.id;
          localDuplicate.title = item.title;
          localDuplicate.message = item.message;
          localDuplicate.targetPath = item.targetPath;
          localDuplicate.routeQuery = item.routeQuery || {};
          localDuplicate.severity = item.severity;
          existingBackendIds.add(item.id);
          delivered.add(item.id);
          continue;
        }

        const shouldAnnounce = !wasDelivered && newestFreshUnseen?.id === item.id;
        this.triggerNotification({
          id: `center_${item.id}`,
          backendId: item.id,
          type: item.type,
          symbol: item.symbol || 'GENERAL',
          title: item.title,
          message: item.message,
          speechText: shouldAnnounce ? item.speechText : null,
          targetPath: item.targetPath || '/dashboard',
          routeQuery: item.routeQuery || {},
          severity: item.severity || 'warning',
          dedupeKey: `SIGNAL_CENTER_${item.id}`,
          playChime: shouldAnnounce || (live && !wasDelivered),
          toneType: item.type?.includes('CONFIRMED') ? 'trade' : 'radar',
          createdAt: item.createdAt,
          read: wasDelivered,
          bypassPreferences: true,
        });
        existingBackendIds.add(item.id);
        delivered.add(item.id);
      }

      writeStoredCenterIds('delivered', [...delivered]);
    },

    async syncSignalCenterAlerts() {
      if (this.signalCenterSyncInFlight) return;
      this.signalCenterSyncInFlight = true;
      try {
        const items = await signalCenterService.list(60);
        this.ingestSignalCenterAlerts(items, false);
      } catch (e) {
        // El radar local sigue funcionando aunque la bandeja persistente no responda.
      } finally {
        this.signalCenterSyncInFlight = false;
      }
    },

    /**
     * Notifica la ejecución en vivo de un trade del bot (Campanita, sonido y voz).
     */
    notifyTradeExecuted(trade) {
      if (!trade || !trade.symbol) return;
      try {
        const authStore = useAuthStore();
        const prefs = authStore.strategyPreferences;
        const strat = (trade.strategy || '').toUpperCase();
        if (strat.includes('H1') && !prefs.h1NoWick) return;
        if (strat.includes('DOUBLE_WICK') && !prefs.doubleWick) return;
        if ((strat.includes('CRASH_BOOM') || strat.includes('ZONAS_V')) && !prefs.crashBoomIa) return;
        if (strat.includes('SPIKE') && !prefs.spikePatterns) return;
        if (strat === 'M5_PLUS' && !prefs.m5Plus) return;
        if (strat === 'M5_X' && !prefs.m5X) return;
      } catch (e) {}
      const pronounce = formatPronounceableMarket(trade.symbol);
      const isBuy = trade.direction === 'BUY';
      const dirEs = isBuy ? 'compra' : 'venta';
      const targetPath = trade.strategy === 'H1_NO_WICK'
        ? '/h1-strategy'
        : trade.strategy === 'M5_PLUS'
          ? '/m5plus-strategy'
          : trade.strategy === 'M5_X'
            ? '/m5x-strategy'
          : '/crash-ia';
      const stratLabel = trade.strategy === 'H1_NO_WICK'
        ? 'H1'
        : trade.strategy === 'M5_PLUS'
          ? 'M5++'
          : trade.strategy === 'M5_X'
            ? 'M5X'
          : 'Zonas V y H1';

      this.triggerNotification({
        type: 'TRADE_OPENED',
        symbol: trade.symbol,
        title: `🚀 ¡TRADE EJECUTADO EN ${trade.mercado || trade.symbol}!`,
        message: `${isBuy ? '🟢 COMPRA (BUY)' : '🔴 VENTA (SELL)'} @ ${trade.entryPrice} | SL: ${trade.stopLossPrice || 'Protegido'} | Estrategia: ${stratLabel}`,
        speechText: `¡Atención! Orden ${stratLabel} ejecutada en MetaTrader 5 para ${pronounce}. Operación de ${dirEs} iniciada.`,
        targetPath,
        routeQuery: { symbol: trade.symbol },
        severity: 'positive',
        dedupeKey: `trade_${trade.id}`,
        playChime: true,
      });
    },

    /**
     * Evalúa un único resultado de Crash/Boom IA (cuando se carga directamente en la pantalla de la estrategia)
     * para que la alerta suene de inmediato sin esperar el intervalo de sondeo.
     */
    checkSingleEvaluation(item) {
      if (!item || !item.symbol) return;
      const pronounce = formatPronounceableMarket(item.symbol);
      const report = buildCrashBoomAlertReport(item);

      if (!report.ready) {
        delete this.crashBoomEvaluationStates[item.symbol];
        return;
      }

      if (this.crashBoomEvaluationStates[item.symbol] === report.fingerprint) return;
      this.crashBoomEvaluationStates[item.symbol] = report.fingerprint;

      const fulfilledText = report.fulfilled.length
        ? report.fulfilled.join(', ')
        : 'todos los filtros completos';
      const price = formatAlertPrice(item.currentPrice);
      const stopLoss = formatAlertPrice(item.stopLossPrice);

      this.triggerNotification({
        type: `${report.isBoom ? 'BOOM_BUY' : 'CRASH_SELL'}_CONFIRMED`,
        symbol: item.symbol,
        title: `POSIBLE SPIKE ${report.direction}: ${item.symbol}`,
        message: `Precio ${price} | Cumple: ${fulfilledText} | SL ${stopLoss}${report.context ? ` | ${report.context}` : ''}`,
        speechText: `Atencion. Posible spike ${report.isBoom ? 'alcista' : 'bajista'} confirmado en ${pronounce}. Revise el grafico antes de operar.`,
        targetPath: '/crash-ia',
        routeQuery: { symbol: item.symbol },
        severity: 'positive',
        dedupeKey: `${item.symbol}_${report.fingerprint}`,
        playChime: true,
        toneType: 'trade',
      });
    },

    /** Alerta de dos velas: M5 opera; H1 solo avisa. */
    checkSingleDoubleWick(item) {
      if (!item || !item.symbol || !item.isValid) return;

      const pronounce = formatPronounceableMarket(item.symbol);
      const isBoom = item.marketType === 'BOOM';
      const dirText = isBoom ? 'compra' : 'venta';
      const isH1 = item.timeframe === 'H1';

      this.triggerNotification({
        type: isH1 ? 'DOUBLE_WICK_H1_ALERT' : 'DOUBLE_WICK_MECHA',
        symbol: item.symbol,
        title: isH1
          ? `🔔 Estrategia de dos velas en H1: ${item.symbol}`
          : `${isBoom ? '📈' : '📉'} ${item.symbol} ${isBoom ? 'BUY' : 'SELL'} por dos velas M5`,
        message: isH1
          ? `${item.reason} Solo alerta H1; no se abre operación automática.`
          : `${item.reason} Entrada ${item.direction} | SL ${item.stopLossPrice}.`,
        speechText: isH1
          ? `¡Atención! Estrategia de dos velas en Hache uno para ${pronounce}. Solo alerta.`
          : `¡Atención! ${pronounce} en patrón de dos velas M cinco para ${dirText}.`,
        targetPath: '/double-wick-strategy',
        routeQuery: { symbol: item.symbol },
        severity: isBoom ? 'positive' : 'warning',
        dedupeKey: `${item.symbol}_DOUBLE_WICK_${item.timeframe || 'M5'}_${item.patternEpoch || item.entryPrice}`,
        playChime: true,
        toneType: isH1 ? 'radar' : 'trade',
      });
    },

    /**
     * Sondea periódicamente las estrategias y el motor de señales para detectar confirmaciones.
     */
    async pollOpportunities() {
      try {
        await this.syncSignalCenterAlerts();
        const authStore = useAuthStore();
        const prefs = authStore.strategyPreferences;

        // 1. Monitoreo de Estrategia Crash & Boom IA (Zonas V, 50% y Order Blocks)
        if (prefs.crashBoomIa) {
          const summary = await crashIaStrategyService.getSummary().catch(() => null);
          if (Array.isArray(summary)) {
            for (const item of summary) {
              this.checkSingleEvaluation(item);
            }
          }
        }

        // 2. Monitoreo de doble vela con mecha (M5)
        if (prefs.doubleWick) {
          const [doubleWickSummary, doubleWickH1Summary] = await Promise.all([
            crashIaStrategyService.getDoubleWickSummary().catch(() => null),
            crashIaStrategyService.getDoubleWickH1Summary().catch(() => null),
          ]);
          if (Array.isArray(doubleWickSummary)) {
            for (const item of doubleWickSummary) {
              this.checkSingleDoubleWick(item);
            }
          }
          if (Array.isArray(doubleWickH1Summary)) {
            for (const item of doubleWickH1Summary) {
              this.checkSingleDoubleWick(item);
            }
          }
        }

        // 3. Monitoreo de Estrategia H1 (Cierre de velas sin mecha / Marubozu)
        if (
          prefs.h1NoWick &&
          isAllowedH1AlertUser(authStore) &&
          H1_EVALUATION_MINUTES.includes(new Date().getMinutes())
        ) {
          const h1Res = await h1StrategyService.getAnalysisPublic(0.5).catch(() => null);
          if (h1Res && Array.isArray(h1Res.activeAlerts)) {
            for (const alert of h1Res.activeAlerts) {
              const pronounce = formatPronounceableMarket(alert.symbol);
              const dir = (alert.direction || '').toUpperCase() === 'ALCISTA' ? 'alcista' : 'bajista';
              const isAnticipated = !!alert.isAnticipated;
              const prefix = isAnticipated ? 'Cierre anticipado: ' : '';
              const h4Warning = alert.h4AgainstTrade
                ? ` La tendencia Hache cuatro ${String(alert.h4Trend || '').toLowerCase()} esta en contra. Evalua bien antes de operar.`
                : '';
              const reactionInfo = alert.historicalReaction?.found
                ? ` El indice ya reacciono ${alert.historicalReaction.count === 1 ? 'una vez' : `${alert.historicalReaction.count} veces`} cerca de este nivel. La ultima reaccion fue ${String(alert.historicalReaction.lastDirection || '').toLowerCase()} y recorrio ${alert.historicalReaction.lastMovePoints} puntos.`
                : '';
              this.triggerNotification({
                type: 'H1_NO_WICK',
                symbol: alert.symbol,
                title: `🕯️ ¡Alerta H1 ${isAnticipated ? 'ANTICIPADA ' : ''}en ${alert.mercado}! (${alert.direction})`,
                message: alert.message || `Vela ${alert.direction} (Cuerpo: ${alert.body} pts).`,
                speechText: `Radar H1: ${prefix}Vela ${dir} en ${pronounce}.${h4Warning}${reactionInfo}`,
                targetPath: '/h1-strategy',
                routeQuery: { symbol: alert.symbol },
                severity: 'warning',
                dedupeKey: `${alert.symbol}_H1_${alert.closedAt || ''}_${isAnticipated ? 'ANTICIPADA' : 'CONFIRMADA'}`,
                playChime: true,
                toneType: 'radar',
              });
            }
          }
        }

        // 4. Evaluación global dos minutos antes de :00, :15, :30 y :45.
        const preSpikeWindow = getPreSpikeEvaluationWindow();
        if (
          preSpikeWindow &&
          isAllowedH1AlertUser(authStore) &&
          !this.preSpikeEvaluationInFlight &&
          this.lastPreSpikeEvaluationKey !== preSpikeWindow.key
        ) {
          this.preSpikeEvaluationInFlight = true;
          this.lastPreSpikeEvaluationKey = preSpikeWindow.key;
          try {
            const comparison = await weySignalsService.getComparison(true).catch(() => null);
            const viableSignals = (comparison?.rows || [])
              .map((row) => row.wey)
              .filter((signal) => signal?.viable)
              .sort((a, b) => (b.estrellas ?? 0) - (a.estrellas ?? 0) || (b.rb ?? 0) - (a.rb ?? 0));

            if (viableSignals.length) {
              const announced = viableSignals.slice(0, 4);
              const markets = announced.map((signal) => formatPronounceableMarket(signal.symbol));
              const first = announced[0];
              this.triggerNotification({
                type: 'PRE_QUARTER_VIABLE',
                symbol: first.symbol,
                title: `Posible spike antes de ${preSpikeWindow.targetLabel}`,
                message: `${viableSignals.length} índice${viableSignals.length === 1 ? '' : 's'} viable${viableSignals.length === 1 ? '' : 's'} tras evaluar 4H, 1H, 30M y 15M.`,
                speechText: `Atención. Posible spike en ${markets.join(', ')}.`,
                targetPath: '/dashboard',
                routeQuery: {},
                severity: 'warning',
                dedupeKey: `PRE_QUARTER_${preSpikeWindow.key}`,
                playChime: true,
                toneType: 'radar',
              });
            }
          } finally {
            this.preSpikeEvaluationInFlight = false;
          }
        }
      } catch (err) {
        // Silencioso para no ensuciar consola si no hay conexión temporal
      }
    },

    /**
     * Inicia el ciclo de monitoreo en segundo plano (cada 8 segundos).
     * En Android activa el ForegroundService oficial para no ser suspendido por el sistema.
     * Usa el evento appStateChange de Capacitor para re-sondear al volver al frente.
     */
    async startMonitoring() {
      if (this.isInitialized) return;
      this.isInitialized = true;

      try {
        signalCenterSocket = getSocket();
        signalCenterSocketHandler = (alert) => this.ingestSignalCenterAlerts([alert], true);
        signalCenterSocket.off('signal-center.alert');
        signalCenterSocket.on('signal-center.alert', signalCenterSocketHandler);
      } catch (e) {}

      // Solicitar permisos de notificación nativa al arrancar (antes de que llegue la primera alerta)
      try {
        await ensureNativeNotifReady();
      } catch (e) {}

      // Iniciar Foreground Service nativo de Android si estamos en la APK
      try {
        if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
          const { ForegroundService } = await import('@capawesome-team/capacitor-android-foreground-service');
          await ForegroundService.startForegroundService({
            id: 1001,
            title: 'WeyBot - Radar Activo',
            body: 'Monitoreando confirmaciones y señales en vivo en segundo plano',
            smallIcon: 'ic_launcher_foreground',
          }).catch((err) => console.warn('ForegroundService start error:', err));

          // Escuchar cambios de estado de la app (foreground ↔ background)
          // Cuando vuelve al frente forzamos un poll inmediato para no perder alertas
          try {
            const { App } = await import('@capacitor/app');
            App.addListener('appStateChange', ({ isActive }) => {
              if (isActive) {
                // App volvió al primer plano → poll inmediato
                this.pollOpportunities();
              }
            });
          } catch (e) {}
        }
      } catch (e) {
        console.warn('Error iniciando servicio en segundo plano:', e);
      }

      // Sondeo inicial inmediato
      this.pollOpportunities();

      // Sondeo periódico cada 8 segundos
      // Nota: en Android el WebView puede congelarse en background,
      // pero el ForegroundService mantiene el proceso y el intervalo
      // sigue corriendo gracias al WAKE_LOCK declarado en el Manifest.
      this.pollingTimer = setInterval(() => {
        this.pollOpportunities();
      }, 8_000);
    },

    async stopMonitoring() {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }
      this.isInitialized = false;
      this.crashBoomEvaluationStates = {};

      if (signalCenterSocket && signalCenterSocketHandler) {
        signalCenterSocket.off('signal-center.alert', signalCenterSocketHandler);
      }
      signalCenterSocket = null;
      signalCenterSocketHandler = null;

      try {
        if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
          const { ForegroundService } = await import('@capawesome-team/capacitor-android-foreground-service');
          await ForegroundService.stopForegroundService().catch(() => {});
        }
      } catch (e) {}
    },
  },
});
