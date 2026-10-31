<template>
  <q-page class="q-pa-lg ea-smc-page">

    <!-- ═══════════════════════════════════════════════════════════
         ENCABEZADO
    ════════════════════════════════════════════════════════════ -->
    <div class="page-header q-mb-md row items-center justify-between flex-wrap q-gutter-y-sm">
      <div>
        <div class="row items-center q-gutter-sm">
          <div class="header-icon-box">
            <q-icon name="insights" size="26px" color="white" />
          </div>
          <div>
            <div class="row items-center q-gutter-xs">
              <h1 class="text-h5 text-weight-bolder text-slate-900 q-my-none">
                EA WEY SMC · Scanner y Gráfico en Vivo
              </h1>
              <q-badge color="purple-7" label="EA SMC MT5" class="text-weight-bold" />
            </div>
            <div class="text-caption text-slate-500 q-mt-xs">
              Visualización idéntica al EA MT5: Zonas SMC, CHoCH, Swings (HH/HL/LH/LL), OB, FVG y condiciones de trade
            </div>
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <!-- Resumen -->
        <div class="ready-summary-pill row items-center q-px-md q-py-xs">
          <q-icon name="check_circle" size="16px" color="green-7" class="q-mr-xs" />
          <span class="text-caption text-weight-bold text-slate-700">
            <span class="text-green-8 text-weight-bolder">{{ readyCount }}</span>/10 listos para trade
          </span>
        </div>
        <!-- Botón actualizar -->
        <q-btn
          unelevated
          color="purple-7"
          icon="refresh"
          label="ACTUALIZAR"
          dense
          class="q-px-sm"
          :loading="loading"
          @click="loadAll"
        />
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
         SELECTOR RÁPIDO DE SÍMBOLOS (PILLS)
    ════════════════════════════════════════════════════════════ -->
    <div class="symbol-pills-row row items-center q-gutter-xs q-mb-md overflow-x-auto">
      <q-btn
        v-for="item in results"
        :key="item.symbol"
        unelevated
        dense
        size="sm"
        :class="[
          'symbol-pill-btn',
          selectedSymbol === item.symbol ? 'symbol-pill-btn--active' : '',
          item.ready ? 'symbol-pill-btn--ready' : ''
        ]"
        :color="selectedSymbol === item.symbol ? (item.direction === 'BUY' ? 'green-8' : 'red-8') : 'slate-800'"
        @click="selectSymbol(item.symbol)"
      >
        <span class="q-mr-xs">{{ item.direction === 'BUY' ? '📈' : '📉' }}</span>
        <span>{{ item.name }}</span>
        <q-badge
          :color="item.ready ? 'green-5' : 'purple-6'"
          text-color="white"
          :label="`${item.score}/7`"
          class="q-ml-xs text-weight-bolder"
        />
      </q-btn>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
         SECCIÓN PRINCIPAL: GRÁFICO DEL EA SMC MT5
    ════════════════════════════════════════════════════════════ -->
    <div class="q-mb-lg">
      <q-card class="bg-slate-950 text-white shadow-lg border-slate" flat bordered style="border-radius: 14px;">
        <q-card-section class="q-pa-none">
          <div v-if="chartLoading" class="flex flex-center" style="height: 480px;">
            <q-spinner-dots size="48px" color="purple-4" />
            <span class="q-ml-md text-slate-400">Cargando gráfico SMC {{ selectedSymbol }}...</span>
          </div>
          <EaWeySMCChart
            v-else-if="currentChartData"
            :symbol="selectedSymbol"
            :direction="currentSelectedResult?.direction || 'SELL'"
            :chartData="currentChartData"
            :htfBiasLabel="currentSelectedResult?.conditions?.htfBiasLabel || 'NEUTRAL'"
          />
          <div v-else class="flex flex-center text-slate-500" style="height: 480px;">
            Sin datos de velas disponibles para {{ selectedSymbol }}
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
         GRID DE CONDICIONES DETALLADAS POR SÍMBOLO
    ════════════════════════════════════════════════════════════ -->
    <div class="row q-col-gutter-md">
      <div
        v-for="item in results"
        :key="item.symbol"
        class="col-12 col-sm-6 col-lg-4"
      >
        <q-card
          class="smc-card cursor-pointer"
          :class="[
            item.direction === 'BUY' ? 'smc-card--boom' : 'smc-card--crash',
            item.ready ? 'smc-card--ready' : '',
            selectedSymbol === item.symbol ? 'smc-card--selected' : '',
          ]"
          flat bordered
          @click="selectSymbol(item.symbol)"
        >
          <q-card-section class="q-pa-md">
            <!-- Header: Símbolo + Dirección + Badge LISTO/ESPERANDO -->
            <div class="row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <span class="smc-icon">{{ item.direction === 'BUY' ? '📈' : '📉' }}</span>
                <span class="smc-symbol">{{ item.name }}</span>
                <q-badge
                  :color="item.direction === 'BUY' ? 'green-8' : 'red-8'"
                  :label="item.direction"
                  class="text-weight-bold"
                />
              </div>
              <div class="row items-center q-gutter-xs">
                <q-btn
                  flat round dense
                  size="xs"
                  icon="show_chart"
                  :color="selectedSymbol === item.symbol ? 'purple-3' : 'slate-5'"
                >
                  <q-tooltip>Ver en gráfico</q-tooltip>
                </q-btn>
                <q-badge
                  v-if="item.ready"
                  color="green-7"
                  label="LISTO ✓"
                  class="text-weight-bold smc-ready-badge"
                />
                <q-badge
                  v-else
                  color="grey-6"
                  label="ESPERANDO"
                  class="text-weight-bold"
                />
              </div>
            </div>

            <!-- Score: X/7 estrellas -->
            <div class="row items-center q-gutter-xs q-mb-sm">
              <span class="text-caption text-weight-bold text-slate-500">Score EA:</span>
              <span
                v-for="n in 7"
                :key="n"
                class="smc-star"
                :class="n <= item.score ? 'smc-star--active' : 'smc-star--empty'"
              >★</span>
              <span class="text-caption text-weight-bold text-slate-600">{{ item.score }}/7</span>
            </div>

            <!-- Checklist de condiciones -->
            <div class="smc-checklist q-mb-sm">
              <div class="smc-check-row">
                <span :class="item.conditions.htfBias ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.htfBias ? '✓' : '✗' }}
                </span>
                <span class="check-label">1. Sesgo HTF H1</span>
                <q-badge
                  outline
                  :color="item.conditions.htfBiasLabel === 'ALCISTA' ? 'green-7' : item.conditions.htfBiasLabel === 'BAJISTA' ? 'red-7' : 'grey-6'"
                  :label="item.conditions.htfBiasLabel"
                  class="q-ml-xs"
                />
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.hasActiveZone ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.hasActiveZone ? '✓' : '✗' }}
                </span>
                <span class="check-label">2. Zona SMC activa (≥3 reacciones)</span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.hasPullback ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.hasPullback ? '✓' : '✗' }}
                </span>
                <span class="check-label">3. Pullback hacia zona (≥1.5 ATR)</span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.hasChoCH ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.hasChoCH ? '✓' : '✗' }}
                </span>
                <span class="check-label">4. CHoCH / Rechazo confirmado</span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.inDiscountPremium ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.inDiscountPremium ? '✓' : '✗' }}
                </span>
                <span class="check-label">
                  5. {{ item.direction === 'BUY' ? 'Descuento (precio bajo)' : 'Premium (precio alto)' }}
                </span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.hasRecentSpike ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.hasRecentSpike ? '✓' : '✗' }}
                </span>
                <span class="check-label">6. Spike reciente (&lt;3h)</span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.notExhausted ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.notExhausted ? '✓' : '✗' }}
                </span>
                <span class="check-label">7. Sin agotamiento (recorrido ≤45%)</span>
              </div>
            </div>

            <!-- Precio actual y posición -->
            <div class="row items-center justify-between q-mb-xs">
              <div>
                <div class="radar-label">Precio actual</div>
                <div class="radar-value font-mono">{{ item.currentPrice }}</div>
              </div>
              <div class="text-right">
                <div class="radar-label">Posición en rango M5</div>
                <div class="row items-center q-gutter-xs">
                  <q-linear-progress
                    :value="item.pricePosition / 100"
                    :color="item.direction === 'BUY' ? 'green-7' : 'red-7'"
                    class="smc-range-bar"
                    rounded
                  />
                  <span class="radar-value font-mono">{{ item.pricePosition }}%</span>
                </div>
              </div>
            </div>

            <!-- Razón / Motivo -->
            <div class="smc-reason text-caption q-mt-xs" :class="item.ready ? 'text-green-8' : 'text-slate-500'">
              {{ item.reason }}
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Última actualización -->
    <div v-if="lastUpdate" class="text-caption text-slate-400 text-center q-mt-lg">
      Última actualización: {{ lastUpdateTime }} · auto-refresh cada 30s
    </div>

  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { eaWeySMCService } from 'src/services/eaWeySMC.service.js';
import EaWeySMCChart from 'src/components/EaWeySMCChart.vue';

const loading        = ref(false);
const chartLoading   = ref(false);
const results        = ref([]);
const selectedSymbol = ref('CRASH500');
const currentChartData = ref(null);
const lastUpdate     = ref(null);
let refreshTimer     = null;

const readyCount = computed(() => results.value.filter((r) => r.ready).length);

const currentSelectedResult = computed(() => {
  return results.value.find(r => r.symbol === selectedSymbol.value) || null;
});

const lastUpdateTime = computed(() => {
  if (!lastUpdate.value) return '';
  return new Date(lastUpdate.value).toLocaleTimeString();
});

async function selectSymbol(sym) {
  selectedSymbol.value = sym;
  await loadChartData(sym);
}

async function loadChartData(sym) {
  chartLoading.value = true;
  try {
    const data = await eaWeySMCService.getChart(sym);
    if (data && !data.error) {
      currentChartData.value = data;
    }
  } catch (err) {
    console.error(`Error cargando gráfico para ${sym}:`, err);
  } finally {
    chartLoading.value = false;
  }
}

async function loadAll() {
  loading.value = true;
  try {
    const data = await eaWeySMCService.scan();
    results.value = Array.isArray(data) ? data : [];
    lastUpdate.value = new Date().toISOString();

    // Cargar gráfico para el seleccionado
    await loadChartData(selectedSymbol.value);
  } catch (err) {
    console.error('Error cargando EA WEY SMC scanner:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadAll();
  refreshTimer = setInterval(loadAll, 30_000);
});

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.ea-smc-page {
  background-color: #0b1120;
  min-height: 100vh;
}
.header-icon-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ready-summary-pill {
  background-color: #1e293b;
  border-radius: 20px;
  border: 1px solid #334155;
}
.symbol-pill-btn {
  border-radius: 8px;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0.3px;
}
.symbol-pill-btn--active {
  box-shadow: 0 0 10px rgba(124, 58, 237, 0.5);
}
.symbol-pill-btn--ready {
  border: 1px solid #10b981;
}
.smc-card {
  border-radius: 12px;
  transition: all 0.2s ease;
  background-color: #111827;
  border-color: #1f2937;
}
.smc-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.smc-card--selected {
  border-color: #8b5cf6 !important;
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.3);
}
.smc-card--boom {
  border-left: 4px solid #10b981;
}
.smc-card--crash {
  border-left: 4px solid #ef4444;
}
.smc-card--ready {
  border: 2px solid #10b981 !important;
  background-color: #064e3b15;
}
.smc-icon {
  font-size: 16px;
}
.smc-symbol {
  font-size: 15px;
  font-weight: 800;
  color: #f1f5f9;
}
.smc-star {
  font-size: 14px;
}
.smc-star--active {
  color: #fbbf24;
}
.smc-star--empty {
  color: #374151;
}
.smc-checklist {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.smc-check-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.check-ok {
  color: #10b981;
  font-weight: 900;
  width: 14px;
  text-align: center;
}
.check-fail {
  color: #ef4444;
  font-weight: 900;
  width: 14px;
  text-align: center;
}
.check-label {
  color: #94a3b8;
  font-size: 11px;
}
.radar-label {
  font-size: 11px;
  color: #64748b;
}
.radar-value {
  font-size: 13px;
  font-weight: 700;
  color: #e2e8f0;
}
.smc-range-bar {
  width: 60px;
  height: 6px;
}
.smc-reason {
  border-top: 1px solid #1f2937;
  padding-top: 6px;
  font-size: 11px;
  line-height: 1.3;
}
</style>
