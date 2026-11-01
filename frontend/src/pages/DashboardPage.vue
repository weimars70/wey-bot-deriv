<template>
  <q-page class="q-pa-md dashboard-page">

    <!-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
         SECCIÃ“N 1 Â· SPIKE RADAR â€” Crash & Boom IA Â· Zonas V y H1
         Solo Ã­ndices con condiciones institucionales 100% completas
    â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
    <div class="section-header spike-radar-header q-mb-md row items-center justify-between">
      <div class="row items-center q-gutter-sm">
        <span class="live-pulse-dot radar-pulse" :class="{ active: spikeRadarList.length > 0 }" />
        <div>
          <div class="radar-title row items-center q-gutter-xs">
            <span>ðŸŽ¯ Spike Radar Â· Crash &amp; Boom IA</span>
            <span class="radar-tag">ULTRA-SNIPER</span>
            <q-badge
              v-if="spikeRadarList.length"
              color="red-9"
              :label="spikeRadarList.length"
              class="q-ml-xs"
            />
          </div>
          <div class="section-sub">
            SeÃ±al ACTIVA: canSell/canBuy + OB fresco en zona + V-patrÃ³n real + M5 viable + Vela Amiga + Enfriamiento M1 + Tendencia M15 + precio en OB Â· ordenado por score
            <span v-if="lastRadarUpdate" class="q-ml-xs">
              Â· calculado {{ lastRadarUpdateTime }}
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
          to="/crash-ia"
        >
          <q-tooltip>Abrir EA WEY SMC</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Radar loading skeletons -->
    <div v-if="radarLoading && !spikeRadarList.length" class="row q-col-gutter-md q-mb-xl">
      <div v-for="i in 3" :key="i" class="col-12 col-sm-6 col-lg-4">
        <q-skeleton type="rect" height="140px" style="border-radius:12px;" />
      </div>
    </div>

    <!-- Radar vacÃ­o -->
    <div
      v-else-if="!radarLoading && !spikeRadarList.length"
      class="radar-empty q-pa-lg text-center q-mb-xl"
    >
      <q-icon name="radar" size="36px" color="grey-5" />
      <div class="text-subtitle2 text-weight-bold text-slate-500 q-mt-sm">
        Sin alertas Spike Radar en este momento
      </div>
      <div class="text-caption text-slate-400 q-mt-xs">
        Los 10 Ã­ndices estÃ¡n siendo monitoreados. Se alertarÃ¡ cuando un Ã­ndice cumpla todos los filtros institucionales simultÃ¡neamente.
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
                <span class="radar-market-icon">{{ entry.marketType === 'CRASH' ? 'ðŸ“‰' : 'ðŸ“ˆ' }}</span>
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
                <div class="radar-label">LÃ­nea H1</div>
                <div class="radar-value text-indigo-7">{{ entry.h1LinePrice }}</div>
              </div>
            </div>

            <!-- Badges de confirmaciones -->
            <div class="row q-gutter-xs q-mb-sm">
              <q-badge outline color="teal-7" label="âœ“ OB" />
              <q-badge outline color="teal-7" label="âœ“ V-PatrÃ³n" />
              <q-badge outline color="teal-7" label="âœ“ M5 Viable" />
              <q-badge outline color="teal-7" label="âœ“ Vela Amiga" />
              <q-badge outline color="teal-7" label="âœ“ Enfriamiento" />
              <q-badge outline color="teal-7" label="âœ“ Tendencia M15" />
              <q-badge
                :color="entry.obStatus === 'FRESCO' ? 'green-8' : 'amber-8'"
                :label="entry.obStatus"
              />
            </div>

            <!-- RSI + Tendencia -->
            <div class="row items-center justify-between">
              <div class="text-caption text-slate-500">
                RSI M5: <strong>{{ entry.rsi_M5 }}</strong>
                Â· {{ entry.trendM15 }}
              </div>
              <q-btn
                flat
                dense
                size="xs"
                color="indigo-7"
                icon="open_in_new"
                :to="`/crash-ia?symbol=${entry.symbol}`"
              >
                <q-tooltip>Ver anÃ¡lisis completo de {{ entry.mercado }}</q-tooltip>
              </q-btn>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>
    <!-- ═══════════════════════════════════════════════════════════════
         SECCIÓN 1.5 · EA WEY SMC — Índices listos para operar
    ════════════════════════════════════════════════════════════════ -->
    <div class="section-header smc-section-header q-mb-md row items-center justify-between">
      <div class="row items-center q-gutter-sm">
        <span class="live-pulse-dot smc-pulse" :class="{ active: smcReadyList.length > 0 }" />
        <div>
          <div class="smc-title row items-center q-gutter-xs">
            <span>🤖 EA WEY SMC · Listos para Operar</span>
            <span class="smc-tag">AUTO</span>
            <q-badge
              v-if="smcReadyList.length"
              color="purple-8"
              :label="smcReadyList.length"
              class="q-ml-xs"
            />
          </div>
          <div class="section-sub">
            Scanner automático de condiciones SMC: sesgo HTF H1 · zona activa · pullback · CHoCH · descuento/premium
            <span v-if="lastSmcUpdate" class="q-ml-xs">
              · actualizado {{ lastSmcUpdateTime }}
            </span>
          </div>
        </div>
      </div>
      <div class="row items-center q-gutter-sm">
        <q-btn
          unelevated
          color="purple-7"
          icon="refresh"
          label="Actualizar"
          dense
          class="q-px-sm"
          :loading="smcLoading"
          @click="loadSmcScanner"
        />
        <q-btn
          flat
          dense
          color="purple-7"
          icon="open_in_new"
          label="VER SCANNER COMPLETO"
          to="/ea-wey-smc"
        >
          <q-tooltip>Ver análisis completo de los 10 índices</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- SMC loading skeletons -->
    <div v-if="smcLoading && !smcAllResults.length" class="row q-col-gutter-md q-mb-xl">
      <div v-for="i in 3" :key="i" class="col-12 col-sm-6 col-lg-4">
        <q-skeleton type="rect" height="120px" style="border-radius:12px;" />
      </div>
    </div>

    <!-- Sin índices listos -->
    <div
      v-else-if="!smcLoading && !smcReadyList.length"
      class="radar-empty q-pa-lg text-center q-mb-xl"
    >
      <q-icon name="hourglass_empty" size="36px" color="grey-5" />
      <div class="text-subtitle2 text-weight-bold text-slate-500 q-mt-sm">
        Sin índices listos para el EA en este momento
      </div>
      <div class="text-caption text-slate-400 q-mt-xs">
        Los 10 índices están siendo evaluados. Se mostrará cuando alguno cumpla todas las condiciones SMC.
      </div>
    </div>

    <!-- Cards compactas de índices listos -->
    <div v-else class="row q-col-gutter-md q-mb-xl">
      <div
        v-for="item in smcReadyList"
        :key="item.symbol"
        class="col-12 col-sm-6 col-lg-4"
      >
        <q-card
          class="smc-compact-card"
          :class="item.direction === 'BUY' ? 'smc-compact--boom' : 'smc-compact--crash'"
          flat bordered
        >
          <q-card-section class="q-pa-md">
            <div class="row items-center justify-between q-mb-xs">
              <div class="row items-center q-gutter-xs">
                <span style="font-size:16px;">{{ item.direction === 'BUY' ? '📈' : '📉' }}</span>
                <span class="smc-compact-symbol">{{ item.name }}</span>
                <q-badge :color="item.direction === 'BUY' ? 'green-8' : 'red-8'" :label="item.direction" class="text-weight-bold" />
              </div>
              <div class="row items-center q-gutter-xs">
                <span v-for="n in 7" :key="n" style="font-size:11px;" :style="{ color: n <= item.score ? '#d97706' : '#cbd5e1' }">★</span>
                <q-badge color="green-7" label="LISTO ✓" class="text-weight-bold q-ml-xs" />
              </div>
            </div>
            <div class="row q-gutter-xs q-mb-xs">
              <q-badge :outline="!item.conditions.htfBias" :color="item.conditions.htfBias ? 'teal-7' : 'grey-5'" :label="'HTF ' + item.conditions.htfBiasLabel.slice(0,3)" class="text-weight-bold" />
              <q-badge :outline="!item.conditions.hasActiveZone" :color="item.conditions.hasActiveZone ? 'teal-7' : 'grey-5'" label="ZONA" class="text-weight-bold" />
              <q-badge :outline="!item.conditions.hasPullback" :color="item.conditions.hasPullback ? 'teal-7' : 'grey-5'" label="PB" class="text-weight-bold" />
              <q-badge :outline="!item.conditions.hasChoCH" :color="item.conditions.hasChoCH ? 'teal-7' : 'grey-5'" label="CHoCH" class="text-weight-bold" />
              <q-badge :outline="!item.conditions.inDiscountPremium" :color="item.conditions.inDiscountPremium ? 'teal-7' : 'grey-5'" :label="item.direction === 'BUY' ? 'DESC' : 'PREM'" class="text-weight-bold" />
              <q-badge :outline="!item.conditions.hasRecentSpike" :color="item.conditions.hasRecentSpike ? 'amber-7' : 'grey-5'" label="SPIKE" class="text-weight-bold" />
              <q-badge :outline="!item.conditions.notExhausted" :color="item.conditions.notExhausted ? 'teal-7' : 'grey-5'" label="45%" class="text-weight-bold" />
            </div>
            <div class="row items-center justify-between">
              <span class="text-caption text-slate-500">Precio: <strong class="text-slate-800">{{ item.currentPrice }}</strong></span>
              <span class="text-caption text-slate-500">Rango: <strong :class="item.direction === 'BUY' ? 'text-green-7' : 'text-red-7'">{{ item.pricePosition }}%</strong></span>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>


    <!-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
         SECCIÃ“N 2 Â· MOTOR WEY â€” SeÃ±ales Sniper generales
    â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
    <div class="section-header wey-section-header q-mb-md row items-center justify-between">
      <div class="row items-center q-gutter-sm">
        <span class="live-pulse-dot wey-pulse active" />
        <div>
          <div class="wey-title row items-center q-gutter-xs">
            <span>âš¡ Wey Trading Â· Sala de Operaciones</span>
            <span class="wey-tag">MOTOR SNIPER</span>
          </div>
          <div class="section-sub">
            Filtro institucional estricto: Order Block (30%â€“85%) Â· Estructura M15 Â· Confluencia 4H+1H+15M Â· Recorrido â‰¤ 45%
            <span v-if="lastWeyUpdate" class="q-ml-xs">
              Â· calculado {{ lastWeyUpdateTime }}
            </span>
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <div v-if="rawWeySignals.length" class="evaluation-clock-pill row items-center q-px-sm q-py-xs">
          <span class="text-caption text-weight-bold text-slate-700">
            Viables: <span class="text-positive text-weight-bolder">{{ viableCount }}</span>/{{ rawWeySignals.length }}
            Â· Sniper 4â˜…: <span class="text-amber-9 text-weight-bolder">{{ sniperCount }}</span>
          </span>
        </div>

        <!-- Reloj anticipado dos minutos antes de cada cuarto de hora -->
        <div class="evaluation-clock-pill row items-center q-px-sm q-py-xs">
          <q-icon name="timer" size="14px" class="q-mr-xs text-indigo-7" />
          <span class="text-caption text-weight-bold text-slate-700">
            PrÃ³xima evaluaciÃ³n: <span class="text-indigo-9 text-weight-bolder">{{ countdownText }}</span> ({{ nextEvaluationTime }})
          </span>
          <q-tooltip>EvaluaciÃ³n anticipada a las :13, :28 y :43</q-tooltip>
        </div>

        <q-toggle
          v-model="onlyViable"
          color="positive"
          dense
          label="Solo Viables"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Exige Order Block activo (30%â€“85%), estructura M15 limpia, â‰¥2 spikes/3h, 4H+1H+15M alineados y recorrido â‰¤45%</q-tooltip>
        </q-toggle>

        <q-toggle
          v-model="onlySniperFourStars"
          color="amber-9"
          dense
          label="Solo 4â˜… Sniper"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Muestra Ãºnicamente entradas 4â˜… con alineaciÃ³n perfecta 4/4, OB activo, â‰¥3 spikes/3h y R/B â‰¥8.5</q-tooltip>
        </q-toggle>

        <q-toggle
          v-if="!onlySniperFourStars"
          v-model="onlyThreeStars"
          color="indigo-7"
          dense
          label="Solo 3â˜… o mÃ¡s"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Mostrar solo seÃ±ales locales con 3 o 4 estrellas</q-tooltip>
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

    <!-- Tabs para alternar entre En Vivo y Bitácora 24 Horas -->
    <div class="row items-center justify-between q-mb-md">
      <q-tabs
        v-model="activeTab"
        dense
        no-caps
        active-color="primary"
        indicator-color="primary"
        class="text-slate-600 bg-white shadow-1 rounded-borders"
        style="border: 1px solid #e2e8f0; border-radius: 8px;"
      >
        <q-tab name="active" label="⚡ Señales Activas / En Vivo">
          <q-badge color="indigo-7" :label="weySignalsList.length" class="q-ml-xs text-weight-bold" />
        </q-tab>
        <q-tab name="history" label="🕒 Historial de Señales (24 Horas)">
          <q-badge color="amber-9" :label="weyHistorySignals.length" class="q-ml-xs text-weight-bold" />
        </q-tab>
      </q-tabs>

      <span v-if="activeTab === 'history'" class="text-caption text-slate-500">
        Las señales se conservan ordenadas cronológicamente de más reciente a más antigua y expiran automáticamente tras 24h.
      </span>
    </div>

    <!-- VISTA 1: SEÑALES ACTIVAS EN VIVO -->
    <template v-if="activeTab === 'active'">
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

      <!-- Wey Signal Cards Grid -->
      <div v-else class="row q-col-gutter-md q-mb-xl">
        <div
          v-for="s in weySignalsList"
          :key="s.symbol"
          class="col-12 col-sm-6 col-lg-3"
        >
          <WeySignalCard :signal="s" />
        </div>
      </div>
    </template>

    <!-- VISTA 2: HISTORIAL CONSERVADO (ÚLTIMAS 24 HORAS) -->
    <template v-else>
      <div v-if="!weyHistorySignals.length" class="empty-box q-pa-xl text-center q-mb-xl">
        <q-icon name="history_toggle_drop_down" size="44px" color="slate-4" />
        <div class="text-subtitle1 text-weight-bold text-slate-700 q-mt-sm">
          Sin señales acumuladas en las últimas 24 horas
        </div>
        <div class="text-caption text-slate-500 q-mt-xs">
          Cada vez que el motor Wey detecte señales viables, quedarán archivadas aquí automáticamente ordenadas de la más reciente a la más antigua.
        </div>
      </div>

      <div v-else class="row q-col-gutter-md q-mb-xl">
        <div
          v-for="s in weyHistorySignals"
          :key="s.signature || (s.symbol + '_' + s.savedAt)"
          class="col-12 col-sm-6 col-lg-3"
        >
          <div class="history-card-container">
            <div class="history-timestamp-badge row items-center justify-between q-px-sm q-py-xs">
              <span class="row items-center q-gutter-xs text-caption text-weight-bold font-mono">
                <q-icon name="schedule" size="13px" />
                <span>{{ formatHistoryTime(s.savedAt) }}</span>
              </span>
              <span class="text-caption text-slate-500 font-mono">hace {{ formatHistoryAge(s.savedAt) }}</span>
            </div>
            <WeySignalCard :signal="s" />
          </div>
        </div>
      </div>
    </template>

  </q-page>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { weySignalsService } from 'src/services/weySignals.service';
import { api } from 'src/boot/axios';
import WeySignalCard from 'src/components/WeySignalCard.vue';
import { eaWeySMCService } from 'src/services/eaWeySMC.service.js';

// â”€â”€â”€ Spike Radar (Crash & Boom IA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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


// ─── Historial de Señales Wey (24 horas) ──────────────────────────────
const WEY_HISTORY_KEY = 'wey_signals_history_24h';
const MAX_HISTORY_MS  = 24 * 60 * 60 * 1000; // 24 horas

const weyHistorySignals = ref([]);
const activeTab = ref('active'); // 'active' | 'history'

function loadStoredWeyHistory() {
  try {
    const raw = localStorage.getItem(WEY_HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    const now = Date.now();
    // Filtrar aquellas con más de 24 horas
    return (Array.isArray(list) ? list : []).filter(
      (s) => s.savedAt && now - Number(s.savedAt) <= MAX_HISTORY_MS,
    );
  } catch (err) {
    console.error('Error cargando historial de señales:', err);
    return [];
  }
}

function saveWeyHistory(list) {
  try {
    localStorage.setItem(WEY_HISTORY_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('Error guardando historial de señales:', err);
  }
}

function archiveIncomingSignals(signals) {
  if (!Array.isArray(signals) || !signals.length) return;
  const now = Date.now();
  let history = loadStoredWeyHistory();

  for (const sig of signals) {
    // Si no es viable y tiene menos de 2 estrellas, no aporta valor historizarla
    if (!sig.viable && (sig.estrellas ?? 0) < 2) continue;

    const signature = `${sig.symbol}_${sig.direccion}_${sig.estrellas}_${sig.entrada}`;
    const existingIdx = history.findIndex((h) => h.signature === signature);

    if (existingIdx >= 0) {
      // Actualizar datos conservando fecha original si tiene menos de 2h
      history[existingIdx] = {
        ...history[existingIdx],
        ...sig,
        signature,
        savedAt: history[existingIdx].savedAt || now,
      };
    } else {
      // Nueva señal detectada: agregar al inicio (más reciente primero)
      history.unshift({
        ...sig,
        signature,
        savedAt: now,
      });
    }
  }

  // Filtrar estrictamente las más antiguas que 24 horas y ordenar desc (más reciente arriba)
  history = history
    .filter((s) => s.savedAt && now - Number(s.savedAt) <= MAX_HISTORY_MS)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  weyHistorySignals.value = history;
  saveWeyHistory(history);
}

function formatHistoryTime(epoch) {
  if (!epoch) return '--:--';
  return new Date(Number(epoch)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatHistoryAge(epoch) {
  if (!epoch) return '0m';
  const diff = Date.now() - Number(epoch);
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

// ─── EA WEY SMC Scanner ──────────────────────────────────────────────────────
const smcLoading    = ref(false);
const smcAllResults = ref([]);
const lastSmcUpdate = ref(null);
let smcTimer        = null;

const smcReadyList = computed(() => smcAllResults.value.filter((r) => r.ready));

const lastSmcUpdateTime = computed(() => {
  if (!lastSmcUpdate.value) return '';
  return new Date(lastSmcUpdate.value).toLocaleTimeString();
});

async function loadSmcScanner() {
  smcLoading.value = true;
  try {
    const data = await eaWeySMCService.scan();
    smcAllResults.value = Array.isArray(data) ? data : [];
    lastSmcUpdate.value = new Date().toISOString();
  } catch (err) {
    console.error('Error al cargar EA WEY SMC scanner:', err);
  } finally {
    smcLoading.value = false;
  }
}

// â”€â”€â”€ Wey Signals (Motor Sniper) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// SeÃ±ales locales Wey ordenadas por estrellas de mayor a menor (4â˜… â†’ 3â˜…)
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
      archiveIncomingSignals(res.signals);
    }
  } catch (err) {
    console.error('Error al cargar señales Wey:', err);
  } finally {
    weyLoading.value = false;
  }
}

onMounted(() => {
  weyHistorySignals.value = loadStoredWeyHistory();
  loadSpikeRadar();
  loadWeySignals();
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
  // Actualizar el radar cada 30 segundos
  radarTimer = setInterval(loadSpikeRadar, 30_000);
  // SMC Scanner: cargar y actualizar cada 60 segundos
  loadSmcScanner();
  smcTimer = setInterval(loadSmcScanner, 60_000);
});

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
  if (radarTimer) clearInterval(radarTimer);
  if (smcTimer) clearInterval(smcTimer);
});
</script>

<style scoped>
.dashboard-page {
  background-color: #f8fafc;
  min-height: 100vh;
}

/* â”€â”€ Spike Radar section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

/* â”€â”€ Section Headers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

/* â”€â”€ Live Pulse Dots â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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


/* ── EA WEY SMC Section ──────────────────────────────────────────────────── */
.smc-section-header {
  border-top:    1px solid #e2e8f0;
  padding-top:   24px;
  border-bottom: 2px solid #d8b4fe;
  padding-bottom: 12px;
}

.smc-title {
  font-size:      17px;
  font-weight:    800;
  color:          #7c3aed;
  letter-spacing: 0.3px;
}

.smc-tag {
  font-size:      9px;
  font-weight:    800;
  background:     #ede9fe;
  color:          #7c3aed;
  padding:        2px 6px;
  border-radius:  4px;
  letter-spacing: 0.8px;
}

.smc-compact-card {
  border-radius: 12px;
  transition:    box-shadow 0.2s;
}
.smc-compact-card:hover {
  box-shadow: 0 4px 16px 0 rgba(124, 58, 237, 0.12);
}
.smc-compact--crash {
  border-color: #fca5a5 !important;
  background:   linear-gradient(135deg, #fff5f5 0%, #fff 100%);
}
.smc-compact--boom {
  border-color: #86efac !important;
  background:   linear-gradient(135deg, #f0fdf4 0%, #fff 100%);
}
.smc-compact-symbol {
  font-size:   14px;
  font-weight: 800;
  color:       #1e293b;
}

.smc-pulse.active {
  background:  #7c3aed;
  box-shadow:  0 0 0 0 rgba(124, 58, 237, 0.6);
  animation:   smc-pulse-anim 2s ease-in-out infinite;
}
@keyframes smc-pulse-anim {
  0%   { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.7); }
  70%  { box-shadow: 0 0 0 7px rgba(124, 58, 237, 0); }
  100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0); }
}

/* ── Historial de Señales Container ── */
.history-card-container {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.history-timestamp-badge {
  background-color: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
  color: #334155;
}
</style>
