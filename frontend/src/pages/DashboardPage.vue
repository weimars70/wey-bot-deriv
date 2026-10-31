<template>
  <q-page class="q-pa-md dashboard-page">

    <!-- ═══════════════════════════════════════════════════════════════
         SECCIÓN 1 · SPIKE RADAR — Crash & Boom IA · Zonas V y H1
         Solo índices con condiciones institucionales 100% completas
    ════════════════════════════════════════════════════════════════ -->
    <div class="section-header spike-radar-header q-mb-md row items-center justify-between">
      <div class="row items-center q-gutter-sm">
        <span class="live-pulse-dot radar-pulse" :class="{ active: spikeRadarList.length > 0 }" />
        <div>
          <div class="radar-title row items-center q-gutter-xs">
            <span>🎯 Spike Radar · Crash &amp; Boom IA</span>
            <span class="radar-tag">ULTRA-SNIPER</span>
            <q-badge
              v-if="spikeRadarList.length"
              color="red-9"
              :label="spikeRadarList.length"
              class="q-ml-xs"
            />
          </div>
          <div class="section-sub">
            Señal ACTIVA: canSell/canBuy + OB fresco en zona + V-patrón real + M5 viable + Vela Amiga + Enfriamiento M1 + Tendencia M15 + precio en OB · ordenado por score
            <span v-if="lastRadarUpdate" class="q-ml-xs">
              · calculado {{ lastRadarUpdateTime }}
            </span>
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <q-btn
          unelevated
          color="red-9"
          icon="radar"
          label="Actualizar Radar"
          dense
          class="q-px-sm"
          :loading="radarLoading"
          @click="loadSpikeRadar"
        />
        <q-btn
          flat
          dense
          color="red-9"
          icon="open_in_new"
          label="Ver estrategia completa"
          to="/crash-ia-strategy"
        >
          <q-tooltip>Abrir página Crash &amp; Boom IA · Zonas V y H1</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Radar loading skeletons -->
    <div v-if="radarLoading && !spikeRadarList.length" class="row q-col-gutter-md q-mb-xl">
      <div v-for="i in 3" :key="i" class="col-12 col-sm-6 col-lg-4">
        <q-skeleton type="rect" height="140px" style="border-radius:12px;" />
      </div>
    </div>

    <!-- Radar vacío -->
    <div
      v-else-if="!radarLoading && !spikeRadarList.length"
      class="radar-empty q-pa-lg text-center q-mb-xl"
    >
      <q-icon name="radar" size="36px" color="grey-5" />
      <div class="text-subtitle2 text-weight-bold text-slate-500 q-mt-sm">
        Sin alertas Spike Radar en este momento
      </div>
      <div class="text-caption text-slate-400 q-mt-xs">
        Los 10 índices están siendo monitoreados. Se alertará cuando un índice cumpla todos los filtros institucionales simultáneamente.
      </div>
    </div>

    <!-- Radar Cards -->
    <div v-else class="row q-col-gutter-md q-mb-xl">
      <div
        v-for="entry in spikeRadarList"
        :key="entry.symbol"
        class="col-12 col-sm-6 col-lg-4"
      >
        <q-card
          class="spike-radar-card"
          :class="entry.marketType === 'CRASH' ? 'radar-crash' : 'radar-boom'"
          flat
          bordered
        >
          <q-card-section class="q-pa-md">
            <!-- Header: Mercado + Score -->
            <div class="row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <span class="radar-market-icon">{{ entry.marketType === 'CRASH' ? '📉' : '📈' }}</span>
                <span class="radar-mercado">{{ entry.mercado }}</span>
                <q-badge
                  :color="entry.canSell ? 'red-8' : 'green-8'"
                  :label="entry.operationType"
                  class="text-weight-bold"
                />
              </div>
              <div class="radar-score-pill" :class="entry.score >= 90 ? 'score-elite' : entry.score >= 75 ? 'score-high' : 'score-ok'">
                {{ entry.score }}%
              </div>
            </div>

            <!-- Precios clave -->
            <div class="row q-col-gutter-xs q-mb-sm">
              <div class="col-6">
                <div class="radar-label">Precio actual</div>
                <div class="radar-value">{{ entry.currentPrice }}</div>
              </div>
              <div class="col-6">
                <div class="radar-label">Entrada OB 50%</div>
                <div class="radar-value text-weight-bold" :class="entry.canSell ? 'text-red-8' : 'text-green-8'">{{ entry.entryLevel50 }}</div>
              </div>
              <div class="col-6">
                <div class="radar-label">Stop Loss</div>
                <div class="radar-value text-negative">{{ entry.stopLossPrice }}</div>
              </div>
              <div class="col-6">
                <div class="radar-label">Línea H1</div>
                <div class="radar-value text-indigo-7">{{ entry.h1LinePrice }}</div>
              </div>
            </div>

            <!-- Badges de confirmaciones -->
            <div class="row q-gutter-xs q-mb-sm">
              <q-badge outline color="teal-7" label="✓ OB" />
              <q-badge outline color="teal-7" label="✓ V-Patrón" />
              <q-badge outline color="teal-7" label="✓ M5 Viable" />
              <q-badge outline color="teal-7" label="✓ Vela Amiga" />
              <q-badge outline color="teal-7" label="✓ Enfriamiento" />
              <q-badge outline color="teal-7" label="✓ Tendencia M15" />
              <q-badge
                :color="entry.obStatus === 'FRESCO' ? 'green-8' : 'amber-8'"
                :label="entry.obStatus"
              />
            </div>

            <!-- RSI + Tendencia -->
            <div class="row items-center justify-between">
              <div class="text-caption text-slate-500">
                RSI M5: <strong>{{ entry.rsi_M5 }}</strong>
                · {{ entry.trendM15 }}
              </div>
              <q-btn
                flat
                dense
                size="xs"
                color="indigo-7"
                icon="open_in_new"
                :to="`/crash-ia-strategy?symbol=${entry.symbol}`"
              >
                <q-tooltip>Ver análisis completo de {{ entry.mercado }}</q-tooltip>
              </q-btn>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════
         SECCIÓN 2 · MOTOR WEY — Señales Sniper generales
    ════════════════════════════════════════════════════════════════ -->
    <div class="section-header wey-section-header q-mb-md row items-center justify-between">
      <div class="row items-center q-gutter-sm">
        <span class="live-pulse-dot wey-pulse active" />
        <div>
          <div class="wey-title row items-center q-gutter-xs">
            <span>⚡ Wey Trading · Sala de Operaciones</span>
            <span class="wey-tag">MOTOR SNIPER</span>
          </div>
          <div class="section-sub">
            Filtro institucional estricto: Order Block (30%–85%) · Estructura M15 · Confluencia 4H+1H+15M · Recorrido ≤ 45%
            <span v-if="lastWeyUpdate" class="q-ml-xs">
              · calculado {{ lastWeyUpdateTime }}
            </span>
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <div v-if="rawWeySignals.length" class="evaluation-clock-pill row items-center q-px-sm q-py-xs">
          <span class="text-caption text-weight-bold text-slate-700">
            Viables: <span class="text-positive text-weight-bolder">{{ viableCount }}</span>/{{ rawWeySignals.length }}
            · Sniper 4★: <span class="text-amber-9 text-weight-bolder">{{ sniperCount }}</span>
          </span>
        </div>

        <!-- Reloj anticipado dos minutos antes de cada cuarto de hora -->
        <div class="evaluation-clock-pill row items-center q-px-sm q-py-xs">
          <q-icon name="timer" size="14px" class="q-mr-xs text-indigo-7" />
          <span class="text-caption text-weight-bold text-slate-700">
            Próxima evaluación: <span class="text-indigo-9 text-weight-bolder">{{ countdownText }}</span> ({{ nextEvaluationTime }})
          </span>
          <q-tooltip>Evaluación anticipada a las :13, :28 y :43</q-tooltip>
        </div>

        <q-toggle
          v-model="onlyViable"
          color="positive"
          dense
          label="Solo Viables"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Exige Order Block activo (30%–85%), estructura M15 limpia, ≥2 spikes/3h, 4H+1H+15M alineados y recorrido ≤45%</q-tooltip>
        </q-toggle>

        <q-toggle
          v-model="onlySniperFourStars"
          color="amber-9"
          dense
          label="Solo 4★ Sniper"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Muestra únicamente entradas 4★ con alineación perfecta 4/4, OB activo, ≥3 spikes/3h y R/B ≥8.5</q-tooltip>
        </q-toggle>

        <q-toggle
          v-if="!onlySniperFourStars"
          v-model="onlyThreeStars"
          color="indigo-7"
          dense
          label="Solo 3★ o más"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Mostrar solo señales locales con 3 o 4 estrellas</q-tooltip>
        </q-toggle>

        <q-btn
          unelevated
          color="indigo-7"
          icon="sync"
          label="Recalcular"
          dense
          class="q-px-sm"
          :loading="weyLoading"
          @click="loadWeySignals"
        />

        <q-btn
          flat
          dense
          color="indigo-7"
          icon="candlestick_chart"
          label="Estrategia H1 (24h)"
          to="/h1-strategy"
        >
          <q-tooltip>Abrir monitor de velas H1 sin mecha y alertas</q-tooltip>
        </q-btn>

      </div>
    </div>

    <!-- Wey loading skeletons -->
    <div v-if="weyLoading && !weySignalsList.length" class="row q-col-gutter-md q-mb-xl">
      <div v-for="i in 4" :key="i" class="col-12 col-sm-6 col-lg-3">
        <q-skeleton type="rect" height="175px" style="border-radius:12px;" />
      </div>
    </div>

    <!-- Wey empty state -->
    <div
      v-else-if="!weySignalsList.length"
      class="empty-box q-pa-xl text-center q-mb-xl"
    >
      <q-icon name="stars" size="44px" color="amber-7" />
      <div class="text-subtitle1 text-weight-bold text-slate-800 q-mt-sm">
        No hay señales Wey {{ onlySniperFourStars ? '4★ Sniper' : 'viables' }} en este momento
      </div>
      <div class="text-caption text-slate-500 q-mt-xs">
        El motor Sniper filtra entradas sin Order Block activo (30%–85%), sin estructura M15 limpia, con recorrido agotado (&gt;45%) o en mercados fríos (&lt;2 spikes en 3h).
      </div>
      <div class="row items-center justify-center q-gutter-sm q-mt-md">
        <q-btn
          v-if="onlySniperFourStars"
          outline
          dense
          color="amber-9"
          label="Ver también señales 3★ viables"
          class="q-px-sm text-weight-bold"
          @click="onlySniperFourStars = false"
        />
        <q-btn
          v-if="onlyViable"
          outline
          dense
          color="primary"
          label="Ver diagnóstico de todos los índices (incl. no viables)"
          class="q-px-sm text-weight-bold"
          @click="onlyViable = false; onlySniperFourStars = false; onlyThreeStars = false"
        />
        <q-btn
          v-if="onlyThreeStars && !onlyViable"
          flat
          dense
          color="slate-700"
          label="Mostrar también 1★ y 2★"
          class="q-px-sm text-weight-bold"
          @click="onlyThreeStars = false"
        />
      </div>
    </div>

    <!-- Wey Signal Cards Grid (identicas a Apex, ordenadas por estrellas desc) -->
    <div v-else class="row q-col-gutter-md q-mb-xl">
      <div
        v-for="s in weySignalsList"
        :key="s.symbol"
        class="col-12 col-sm-6 col-lg-3"
      >
        <WeySignalCard :signal="s" />
      </div>
    </div>

  </q-page>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { weySignalsService } from 'src/services/weySignals.service';
import { api } from 'src/boot/axios';
import WeySignalCard from 'src/components/WeySignalCard.vue';

// ─── Spike Radar (Crash & Boom IA) ──────────────────────────────────────────
const radarLoading    = ref(false);
const spikeRadarList  = ref([]);
const lastRadarUpdate = ref(null);
let radarTimer        = null;

const lastRadarUpdateTime = computed(() => {
  if (!lastRadarUpdate.value) return '';
  return new Date(lastRadarUpdate.value).toLocaleTimeString();
});

async function loadSpikeRadar() {
  radarLoading.value = true;
  try {
    const res = await api.get('/strategies/crash-ia/spike-radar');
    spikeRadarList.value = Array.isArray(res.data) ? res.data : [];
    lastRadarUpdate.value = new Date().toISOString();
  } catch (err) {
    console.error('Error al cargar Spike Radar:', err);
  } finally {
    radarLoading.value = false;
  }
}

// ─── Wey Signals (Motor Sniper) ─────────────────────────────────────────────

const weyLoading          = ref(false);
const rawWeySignals       = ref([]);
const lastWeyUpdate       = ref(null);
const onlyThreeStars      = ref(true);
const onlySniperFourStars = ref(false);
const onlyViable          = ref(true);
const countdownText       = ref('00:00');
const nextEvaluationTime  = ref('');
let countdownTimer        = null;
let lastScheduledEvaluationKey = null;

const viableCount = computed(() => rawWeySignals.value.filter((s) => s.viable).length);
const sniperCount = computed(() => rawWeySignals.value.filter((s) => s.viable && (s.estrellas ?? 0) >= 4).length);

const lastWeyUpdateTime = computed(() => {
  if (!lastWeyUpdate.value) return '';
  return new Date(lastWeyUpdate.value).toLocaleTimeString();
});

function updateCountdown() {
  const now = new Date();
  const evaluationMinutes = [13, 28, 43, 58];
  const minutes = now.getMinutes();

  if (evaluationMinutes.includes(minutes) && now.getSeconds() <= 1) {
    const evaluationKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${minutes}`;
    if (lastScheduledEvaluationKey !== evaluationKey) {
      lastScheduledEvaluationKey = evaluationKey;
      loadWeySignals();
    }
  }

  const nextTargetMinute = evaluationMinutes.find((minute) => minute > minutes);
  const targetDate = new Date(now);
  if (nextTargetMinute === undefined) {
    targetDate.setHours(now.getHours() + 1, evaluationMinutes[0], 0, 0);
  } else {
    targetDate.setMinutes(nextTargetMinute, 0, 0);
  }

  const diffMs = targetDate.getTime() - now.getTime();
  const totalSec = Math.floor(diffMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  countdownText.value = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  nextEvaluationTime.value = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Señales locales Wey ordenadas por estrellas de mayor a menor (4★ → 3★)
const weySignalsList = computed(() => {
  let list = rawWeySignals.value;
  if (onlyViable.value) {
    list = list.filter((s) => s.viable);
  }
  if (onlySniperFourStars.value) {
    list = list.filter((s) => (s.estrellas ?? 0) >= 4);
  } else if (onlyThreeStars.value) {
    list = list.filter((s) => (s.estrellas ?? 0) >= 3);
  }
  return [...list].sort((a, b) => {
    // Ordenar de mayor a menor estrellas
    if ((b.estrellas ?? 0) !== (a.estrellas ?? 0)) {
      return (b.estrellas ?? 0) - (a.estrellas ?? 0);
    }
    // Si empatan, mayor R:B
    if ((b.rb ?? 0) !== (a.rb ?? 0)) {
      return (b.rb ?? 0) - (a.rb ?? 0);
    }
    return a.mercado.localeCompare(b.mercado);
  });
});

async function loadWeySignals() {
  weyLoading.value = true;
  try {
    const res = await weySignalsService.getSignals(0, false);
    if (res && Array.isArray(res.signals)) {
      rawWeySignals.value = res.signals;
      lastWeyUpdate.value = res.lastUpdated || new Date().toISOString();
    }
  } catch (err) {
    console.error('Error al cargar señales Wey:', err);
  } finally {
    weyLoading.value = false;
  }
}

onMounted(() => {
  loadSpikeRadar();
  loadWeySignals();
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
  // Actualizar el radar cada 30 segundos
  radarTimer = setInterval(loadSpikeRadar, 30_000);
});

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
  if (radarTimer) clearInterval(radarTimer);
});
</script>

<style scoped>
.dashboard-page {
  background-color: #f8fafc;
  min-height: 100vh;
}

/* ── Spike Radar section ─────────────────────────────────────────────────── */
.spike-radar-header {
  border-bottom: 2px solid #fca5a5;
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.radar-title {
  font-size:      17px;
  font-weight:    800;
  color:          #b91c1c;
  letter-spacing: 0.3px;
}

.radar-tag {
  font-size:      9px;
  font-weight:    800;
  background:     #fee2e2;
  color:          #b91c1c;
  padding:        2px 6px;
  border-radius:  4px;
  letter-spacing: 0.8px;
}

.radar-empty {
  background:    #fff;
  border:        1px dashed #e5e7eb;
  border-radius: 12px;
}

.spike-radar-card {
  border-radius:  14px;
  transition:     box-shadow 0.2s;
}
.spike-radar-card:hover {
  box-shadow: 0 4px 24px 0 rgba(185,28,28,0.13);
}
.radar-crash {
  border-color: #fca5a5 !important;
  background:   linear-gradient(135deg, #fff5f5 0%, #fff 100%);
}
.radar-boom {
  border-color: #86efac !important;
  background:   linear-gradient(135deg, #f0fdf4 0%, #fff 100%);
}

.radar-market-icon { font-size: 20px; }
.radar-mercado {
  font-size:   15px;
  font-weight: 800;
  color:       #1e293b;
}

.radar-score-pill {
  font-size:     12px;
  font-weight:   800;
  padding:       3px 9px;
  border-radius: 20px;
}
.score-elite { background: #15803d; color: #fff; }
.score-high  { background: #b45309; color: #fff; }
.score-ok    { background: #475569; color: #fff; }

.radar-label {
  font-size:  9px;
  color:      #94a3b8;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 1px;
}
.radar-value {
  font-size:   13px;
  font-weight: 700;
  color:       #1e293b;
}

/* pulse rojo para radar activo */
.radar-pulse.active {
  background-color: #ef4444;
  box-shadow: 0 0 0 0 rgba(239,68,68,0.7);
  animation: radar-ring 1.2s infinite;
}
@keyframes radar-ring {
  0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
  70%  { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
  100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
}

.text-slate-900 { color: #0f172a; }
.text-slate-800 { color: #1e293b; }
.text-slate-700 { color: #334155; }
.text-slate-500 { color: #64748b; }
.text-slate-400 { color: #94a3b8; }

/* ── Section Headers ─────────────────────────────────────────────────────── */
.section-header {
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 12px;
}

.wey-section-header {
  border-top:    1px solid #e2e8f0;
  padding-top:   24px;
}

.wey-title {
  font-size:      17px;
  font-weight:    800;
  color:          #4338ca;
  letter-spacing: 0.3px;
}

.wey-tag {
  font-size:      9px;
  font-weight:    800;
  background:     #e0e7ff;
  color:          #4338ca;
  padding:        2px 6px;
  border-radius:  4px;
  letter-spacing: 0.8px;
}

.section-sub {
  font-size:  11px;
  color:      #64748b;
  margin-top: 2px;
}

/* ── Live Pulse Dots ─────────────────────────────────────────────────────── */
.live-pulse-dot {
  display:       inline-block;
  width:         8px;
  height:        8px;
  border-radius: 50%;
  background:    #cbd5e1;
  flex-shrink:   0;
  transition:    background 0.3s;
}

.wey-pulse.active {
  background: #6366f1;
  box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6);
  animation:  wey-pulse-anim 2s ease-in-out infinite;
}

@keyframes wey-pulse-anim {
  0%   { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.7); }
  70%  { box-shadow: 0 0 0 7px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}

.empty-box {
  background:    #ffffff;
  border:        1px dashed #e2e8f0;
  border-radius: 12px;
}

.evaluation-clock-pill {
  background: #ede9fe;
  border: 1px solid #c4b5fd;
  border-radius: 8px;
}

</style>
