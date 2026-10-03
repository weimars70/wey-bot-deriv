<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn flat dense round icon="menu" @click="drawer = !drawer" />
        <q-toolbar-title>Deriv Data Dashboard</q-toolbar-title>

        <!-- ════════════════════════════════════════════════════════════════ -->
        <!-- ── CAMPANITA DE NOTIFICACIONES, SONIDO Y VOZ ALTO VOLUMEN ────── -->
        <!-- ════════════════════════════════════════════════════════════════ -->
        <q-btn
          flat
          round
          dense
          :icon="alertsStore.unreadCount > 0 ? 'notifications_active' : 'notifications'"
          :color="alertsStore.unreadCount > 0 ? 'amber-3' : 'white'"
          class="q-mr-sm"
          :class="alertsStore.unreadCount > 0 ? 'alert-bell-pulse' : ''"
        >
          <!-- Badge numérico de confirmaciones no leídas -->
          <q-badge
            v-if="alertsStore.unreadCount > 0"
            color="red-7"
            floating
            rounded
            class="text-weight-bolder font-mono"
          >
            {{ alertsStore.unreadCount }}
          </q-badge>
          <q-tooltip>Señales y Confirmaciones en Vivo (Sonido y Voz)</q-tooltip>

          <!-- Menú desplegable al dar clic -->
          <q-menu
            anchor="bottom right"
            self="top right"
            :offset="[0, 10]"
            class="alerts-menu-dropdown shadow-12"
          >
            <!-- 1. Encabezado del Menú -->
            <div class="row items-center justify-between q-pa-sm bg-slate-900 text-white border-b-slate">
              <div class="row items-center q-gutter-xs">
                <q-icon name="notifications_active" color="amber-4" size="20px" />
                <span class="text-subtitle2 text-weight-bolder">Centro de Señales y Alertas</span>
              </div>
              <q-btn
                v-if="alertsStore.unreadCount > 0"
                flat
                dense
                size="xs"
                color="amber-3"
                label="Marcar leídas"
                class="text-weight-bold"
                @click="alertsStore.markAllAsRead"
              />
            </div>

            <!-- 2. Barra de Configuración de Sonido y Voz Alto Volumen -->
            <div class="bg-slate-50 q-pa-sm border-b-slate">
              <div class="row items-center justify-between q-mb-xs">
                <div class="row items-center q-gutter-sm">
                  <q-toggle
                    v-model="soundModel"
                    dense
                    size="xs"
                    color="indigo-7"
                    label="Sonido"
                    class="text-caption text-weight-bold text-slate-700"
                  />
                  <q-toggle
                    v-model="voiceModel"
                    dense
                    size="xs"
                    color="emerald-7"
                    label="Voz Alto Volumen"
                    class="text-caption text-weight-bold text-slate-700"
                  />
                </div>
              </div>

              <!-- Botón para probar el sonido y la voz -->
              <q-btn
                unelevated
                dense
                size="sm"
                color="amber-9"
                text-color="white"
                icon="record_voice_over"
                label="🔊 Probar Alerta Sonora y Voz"
                class="full-width text-weight-bolder q-mt-xs"
                @click="alertsStore.testAudioAlert()"
              >
                <q-tooltip>Emite la campana y lee la confirmación por voz a alto volumen</q-tooltip>
              </q-btn>
            </div>

            <!-- 3. Lista de Señales y Confirmaciones -->
            <div v-if="alertsStore.activeAlerts.length === 0" class="q-pa-lg text-center text-slate-500">
              <div class="radar-dot q-mx-auto q-mb-sm"></div>
              <div class="text-weight-bold text-slate-700">Sin alertas activas en este instante</div>
              <div class="text-caption text-slate-400 q-mt-xs">
                Monitoreo activo de H1, Crash &amp; Boom IA y niveles vigilados, incluso si la app estuvo cerrada.
              </div>
            </div>

            <q-scroll-area v-else style="height: 360px; max-height: 60vh; width: 100%; min-width: 100%;">
              <q-list separator class="full-width">
                <q-item
                  v-for="alert in alertsStore.activeAlerts"
                  :key="alert.id"
                  clickable
                  v-ripple
                  class="q-py-sm full-width"
                  :class="alert.read ? 'bg-white' : 'bg-amber-0'"
                  @click="goToAlert(alert)"
                >
                  <q-item-section avatar top>
                    <q-avatar
                      size="36px"
                      :color="getAlertAvatarColor(alert.type)"
                      text-color="white"
                      :icon="getAlertAvatarIcon(alert.type)"
                    />
                  </q-item-section>

                  <q-item-section class="col">
                    <div class="row items-center justify-between no-wrap q-mb-xs">
                      <span class="text-caption text-weight-bolder text-slate-900 ellipsis">
                        {{ alert.title }}
                      </span>
                      <span class="text-caption text-slate-400 font-mono q-ml-sm text-no-wrap" style="font-size: 11px;">
                        {{ alert.time }}
                      </span>
                    </div>
                    <div class="text-caption text-slate-700" style="font-size: 12px; line-height: 1.3; word-break: break-word;">
                      {{ alert.message }}
                    </div>
                  </q-item-section>

                  <q-item-section side>
                    <q-btn flat round dense size="sm" icon="open_in_new" color="primary">
                      <q-tooltip>Abrir en Gráfico</q-tooltip>
                    </q-btn>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-scroll-area>

            <!-- 4. Pie de Menú con Accesos Rápidos -->
            <div class="row items-center justify-between q-pa-sm bg-slate-100 border-t-slate">
              <div class="row items-center q-gutter-xs">
                <q-btn
                  v-if="userPrefs.crashBoomIa"
                  flat
                  dense
                  size="sm"
                  color="purple-8"
                  label="Crash &amp; Boom"
                  class="text-weight-bold"
                  @click="router.push('/crash-ia')"
                />
                <span v-if="userPrefs.crashBoomIa && userPrefs.h1NoWick" class="text-slate-300">|</span>
                <q-btn
                  v-if="userPrefs.h1NoWick"
                  flat
                  dense
                  size="sm"
                  color="indigo-8"
                  label="Estrategia H1"
                  class="text-weight-bold"
                  @click="router.push('/h1-strategy')"
                />
              </div>
              <q-btn
                v-if="alertsStore.activeAlerts.length > 0"
                flat
                dense
                size="sm"
                color="slate-6"
                label="Limpiar todo"
                @click="alertsStore.clearAlerts"
              />
            </div>
          </q-menu>
        </q-btn>

        <!-- Datos del Usuario, Configuración y Logout -->
        <q-btn flat dense round icon="tune" color="amber-4" class="q-mr-sm" @click="openPrefsDialog">
          <q-tooltip>Parametrizar mis estrategias</q-tooltip>
        </q-btn>
        <div class="text-caption q-mr-md font-mono">{{ authStore.user?.email }}</div>
        <q-btn flat dense round icon="logout" @click="onLogout">
          <q-tooltip>Cerrar sesión</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-drawer v-model="drawer" bordered>
      <q-list>
        <!-- Dashboard general solo visible si hay más de 1 estrategia activa -->
        <q-item v-if="activeStrategiesCount > 1" clickable to="/dashboard" exact>
          <q-item-section avatar><q-icon name="dashboard" /></q-item-section>
          <q-item-section>Dashboard</q-item-section>
        </q-item>

        <q-item v-if="userPrefs.crashBoomIa" clickable to="/crash-ia">
          <q-item-section avatar><q-icon name="insights" color="purple-7" /></q-item-section>
          <q-item-section>
            <div class="row items-center justify-between">
              <span>Estrategia Crash &amp; Boom IA</span>
              <q-badge color="purple-7" label="ZONAS" class="text-weight-bold" />
            </div>
          </q-item-section>
        </q-item>

        <q-item v-if="userPrefs.spikePatterns" clickable to="/spike-strategy">
          <q-item-section avatar><q-icon name="bolt" color="amber-5" /></q-item-section>
          <q-item-section>
            <div class="row items-center justify-between">
              <span class="text-weight-bold text-amber-3">Patrones Spike IA · Crash &amp; Boom</span>
              <q-badge color="amber-8" text-color="black" label="MULTI" class="text-weight-bolder" />
            </div>
          </q-item-section>
        </q-item>

        <q-item v-if="userPrefs.h1NoWick" clickable to="/h1-strategy">
          <q-item-section avatar><q-icon name="candlestick_chart" color="indigo-7" /></q-item-section>
          <q-item-section>
            <div class="row items-center justify-between">
              <span>Estrategia H1</span>
              <q-badge color="amber-8" label="24H" class="text-weight-bold" />
            </div>
          </q-item-section>
        </q-item>

        <!-- Informe Diario solo visible si hay más de 1 estrategia activa -->
        <q-item v-if="activeStrategiesCount > 1" clickable to="/daily-report">
          <q-item-section avatar><q-icon name="query_stats" color="emerald-5" /></q-item-section>
          <q-item-section>
            <div class="row items-center justify-between">
              <span class="text-weight-bold text-emerald-4">Informe Diario e IA</span>
              <q-badge color="emerald-8" label="STATS" class="text-weight-bold" />
            </div>
          </q-item-section>
        </q-item>

        <q-item clickable to="/watched-levels">
          <q-item-section avatar><q-icon name="pin_drop" color="cyan-6" /></q-item-section>
          <q-item-section>
            <div class="row items-center justify-between">
              <span>Puntos vigilados</span>
              <q-badge color="cyan-8" label="NIVELES" class="text-weight-bold" />
            </div>
          </q-item-section>
        </q-item>

        <q-separator />

        <q-item v-if="isAdmin" clickable to="/users">
          <q-item-section avatar><q-icon name="group" color="primary" /></q-item-section>
          <q-item-section>Usuarios</q-item-section>
        </q-item>

        <q-item v-else clickable to="/update-profile">
          <q-item-section avatar><q-icon name="manage_accounts" color="primary" /></q-item-section>
          <q-item-section>Actualizar datos</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <!-- Modal de Parametrización Dinámica de Estrategias -->
    <q-dialog v-model="showPrefsDialog">
      <q-card style="width: 520px; max-width: 95vw; border-radius: 16px;">
        <q-card-section class="bg-slate-900 text-white q-pa-md">
          <div class="row items-center justify-between">
            <div class="row items-center q-gutter-sm">
              <q-icon name="tune" color="amber-4" size="24px" />
              <div class="text-h6 text-weight-bold">Parametrización Dinámica</div>
            </div>
            <q-btn flat dense round icon="close" color="white" v-close-popup />
          </div>
          <div class="text-caption text-grey-4 q-mt-xs">
            Selecciona las estrategias que deseas operar y monitorear. Las opciones del menú, alertas sonoras y locución de voz se activarán exclusivamente para las estrategias que elijas.
          </div>
        </q-card-section>

        <q-card-section class="q-pa-md">
          <!-- Botones de Acción Rápida -->
          <div class="row q-gutter-xs q-mb-md justify-between">
            <q-btn size="sm" outline color="primary" label="Todas" @click="selectAllPrefs(true)" />
            <q-btn size="sm" outline color="indigo-7" label="Solo H1" @click="selectOnlyOne('h1NoWick')" />
            <q-btn size="sm" outline color="purple-7" label="Solo Crash/Boom IA" @click="selectOnlyOne('crashBoomIa')" />
            <q-btn size="sm" outline color="grey-7" label="Desactivar Todas" @click="selectAllPrefs(false)" />
          </div>

          <q-separator class="q-mb-md" />

          <!-- Toggles -->
          <div class="q-gutter-y-sm">
            <div class="row items-center justify-between q-pa-sm rounded-borders bg-grey-1">
              <div class="row items-center q-gutter-sm">
                <q-icon name="candlestick_chart" color="indigo-7" size="24px" />
                <div>
                  <div class="text-weight-bold text-slate-800">Estrategia H1</div>
                  <div class="text-caption text-grey-6">Cierre Marubozu (anticipado :58 y cierre H1)</div>
                </div>
              </div>
              <q-toggle v-model="editPrefs.h1NoWick" color="indigo-7" />
            </div>

            <div class="row items-center justify-between q-pa-sm rounded-borders bg-grey-1">
              <div class="row items-center q-gutter-sm">
                <q-icon name="insights" color="purple-7" size="24px" />
                <div>
                  <div class="text-weight-bold text-slate-800">Estrategia Crash &amp; Boom IA</div>
                  <div class="text-caption text-grey-6">Zonas V, retroceso al 50% y Order Blocks</div>
                </div>
              </div>
              <q-toggle v-model="editPrefs.crashBoomIa" color="purple-7" />
            </div>

            <div class="row items-center justify-between q-pa-sm rounded-borders bg-grey-1">
              <div class="row items-center q-gutter-sm">
                <q-icon name="bolt" color="amber-7" size="24px" />
                <div>
                  <div class="text-weight-bold text-slate-800">Patrones Spike IA</div>
                  <div class="text-caption text-grey-6">Detección de patrones rápidos de spike en Crash y Boom</div>
                </div>
              </div>
              <q-toggle v-model="editPrefs.spikePatterns" color="amber-7" />
            </div>

            <div class="row items-center justify-between q-pa-sm rounded-borders bg-grey-1">
              <div class="row items-center q-gutter-sm">
                <q-icon name="star" color="cyan-7" size="24px" />
                <div>
                  <div class="text-weight-bold text-slate-800">Señales Wey (>= 4★)</div>
                  <div class="text-caption text-grey-6">Oportunidades de alta probabilidad del radar de señales</div>
                </div>
              </div>
              <q-toggle v-model="editPrefs.weySignals" color="cyan-7" />
            </div>
          </div>
        </q-card-section>

        <q-separator />

        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat label="Cancelar" color="grey-7" v-close-popup />
          <q-btn color="primary" icon="save" label="Guardar Configuración" :loading="savingPrefs" @click="savePreferences" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { onMounted, onUnmounted, ref, computed, reactive, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from 'stores/auth.store';
import { useAlertsStore } from 'stores/alerts.store';
import { useTradingStore } from 'stores/trading.store';

const $q = useQuasar();
const drawer = ref(false);
const authStore = useAuthStore();
const alertsStore = useAlertsStore();
const tradingStore = useTradingStore();
const router = useRouter();
const route = useRoute();

// ── Parametrización Dinámica de Estrategias ──
const showPrefsDialog = ref(false);
const savingPrefs = ref(false);
const userPrefs = computed(() => authStore.strategyPreferences);
const isAdmin = computed(
  () => (authStore.user?.email || '').trim().toLowerCase() === 'weimarsuber@gmail.com',
);

const activeStrategiesCount = computed(() => {
  const p = userPrefs.value || {};
  return [p.h1NoWick, p.crashBoomIa, p.spikePatterns, p.weySignals].filter(Boolean).length;
});

const singleActiveRoute = computed(() => {
  const p = userPrefs.value || {};
  const active = [
    [p.h1NoWick, '/h1-strategy'],
    [p.crashBoomIa, '/crash-ia'],
    [p.spikePatterns, '/spike-strategy'],
  ].filter(([enabled]) => enabled);
  return active.length === 1 ? active[0][1] : null;
});

function checkAndRedirectSingleStrategy() {
  if ((route.path === '/' || route.path === '') && activeStrategiesCount.value === 1 && singleActiveRoute.value) {
    router.replace(singleActiveRoute.value);
  }
}

watch(
  () => [route.path, activeStrategiesCount.value],
  () => {
    checkAndRedirectSingleStrategy();
  },
  { immediate: true }
);

const editPrefs = reactive({
  h1NoWick: true,
  doubleWick: true,
  crashBoomIa: true,
  spikePatterns: true,
  weySignals: true,
  m5Plus: true,
  m5X: true,
});

function openPrefsDialog() {
  Object.assign(editPrefs, userPrefs.value);
  showPrefsDialog.value = true;
}

function selectAllPrefs(val) {
  editPrefs.h1NoWick = val;
  editPrefs.crashBoomIa = val;
  editPrefs.spikePatterns = val;
  editPrefs.weySignals = val;
}

function selectOnlyOne(targetKey) {
  editPrefs.h1NoWick = targetKey === 'h1NoWick';
  editPrefs.crashBoomIa = targetKey === 'crashBoomIa';
  editPrefs.spikePatterns = targetKey === 'spikePatterns';
  editPrefs.weySignals = targetKey === 'weySignals';
}

async function savePreferences() {
  savingPrefs.value = true;
  try {
    await authStore.saveStrategyPreferences({ ...editPrefs });
    $q.notify({
      type: 'positive',
      icon: 'check_circle',
      message: 'Preferencias de estrategias guardadas con éxito.',
      position: 'top',
      timeout: 2500,
    });
    showPrefsDialog.value = false;
    if (activeStrategiesCount.value === 1 && singleActiveRoute.value) {
      router.replace(singleActiveRoute.value);
    }
  } catch (e) {
    $q.notify({
      type: 'negative',
      icon: 'error',
      message: 'Error al guardar preferencias: ' + (e.response?.data?.message || e.message),
      position: 'top',
    });
  } finally {
    savingPrefs.value = false;
  }
}

const soundModel = computed({
  get: () => alertsStore.soundEnabled,
  set: (v) => alertsStore.setSoundEnabled(v),
});

const voiceModel = computed({
  get: () => alertsStore.voiceEnabled,
  set: (v) => alertsStore.setVoiceEnabled(v),
});

function getAlertAvatarColor(type) {
  if (!type) return 'primary';
  if (type === 'TRADE_OPENED') return 'deep-purple-7';
  if (type.startsWith('WATCHED_LEVEL')) return 'teal-7';
  if (type.startsWith('H1_NO_WICK')) return 'purple-8';
  if (type.includes('BOOM') && type.includes('BUY')) return 'emerald-7';
  if (type.includes('CRASH') && type.includes('SELL')) return 'indigo-7';
  if (type.includes('BOOM')) return 'emerald-7';
  if (type.includes('CRASH')) return 'indigo-7';
  if (type.includes('IN_ZONE')) return 'deep-orange-7';
  if (type === 'OB_EN_ZONA') return 'amber-8';
  if (type === 'HIGH_STARS_SIGNAL') return 'cyan-7';
  return 'primary';
}

function getAlertAvatarIcon(type) {
  if (!type) return 'notifications';
  if (type === 'TRADE_OPENED') return 'rocket_launch';
  if (type.startsWith('WATCHED_LEVEL')) return 'location_on';
  if (type.startsWith('H1_NO_WICK')) return 'candlestick_chart';
  if (type.includes('BOOM') && type.includes('BUY')) return 'shopping_cart';
  if (type.includes('CRASH') && type.includes('SELL')) return 'point_of_sale';
  if (type.includes('BOOM')) return 'trending_up';
  if (type.includes('CRASH')) return 'trending_down';
  if (type.includes('IN_ZONE')) return 'radar';
  if (type === 'OB_EN_ZONA') return 'account_balance';
  if (type === 'HIGH_STARS_SIGNAL') return 'star';
  return 'notifications';
}

function goToAlert(alert) {
  alertsStore.markAsRead(alert.id);
  router.push({ path: alert.targetPath || '/crash-ia', query: alert.routeQuery });
}

onMounted(() => {
  if (!authStore.user) authStore.fetchMe().catch(() => {});

  // Iniciar monitoreo continuo en segundo plano de señales, confirmaciones y trades
  alertsStore.startMonitoring();
  tradingStore.startPolling();

  // Desbloqueo del AudioContext al primer clic del usuario
  const unlockAudio = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const c = new AudioCtx();
        if (c.state === 'suspended') c.resume();
      }
    } catch (e) {}
    window.removeEventListener('click', unlockAudio);
  };
  window.addEventListener('click', unlockAudio, { once: true });
});

onUnmounted(() => {
  alertsStore.stopMonitoring();
  tradingStore.stopPolling();
});

function onLogout() {
  alertsStore.stopMonitoring();
  authStore.logout();
  router.push({ name: 'login' });
}
</script>

<style scoped>
.border-b-slate {
  border-bottom: 1px solid #e2e8f0;
}

.border-t-slate {
  border-top: 1px solid #e2e8f0;
}

.radar-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  animation: radarPulse 1.8s infinite;
}

@keyframes radarPulse {
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  }
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 10px rgba(16, 185, 129, 0);
  }
  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

@keyframes bellPulse {
  0% { transform: scale(1); }
  25% { transform: scale(1.15) rotate(-8deg); }
  50% { transform: scale(1.15) rotate(8deg); }
  75% { transform: scale(1.12) rotate(-4deg); }
  100% { transform: scale(1) rotate(0deg); }
}

.alert-bell-pulse {
  animation: bellPulse 1.6s infinite ease-in-out;
}

.bg-amber-0 {
  background-color: #fffbeb;
}
</style>
