<template>
  <q-page class="q-pa-md smc-synthetics-page">
    <!-- Header Principal -->
    <div class="row items-center justify-between q-mb-md header-container">
      <div class="row items-center q-gutter-sm">
        <span class="live-pulse-dot" :class="{ active: readyList.length > 0 }" />
        <div>
          <div class="row items-center q-gutter-xs">
            <span class="page-title text-h6 text-weight-bolder text-slate-900">
              ⚡ SMC Pro · Sintéticos, Oro (XAU/USD) &amp; Forex
            </span>
            <q-badge color="amber-9" text-color="black" label="ORO · FOREX · SINTÉTICOS" class="text-weight-bold" />
            <q-badge
              v-if="readyList.length"
              color="green-8"
              :label="`${readyList.length} LISTOS`"
              class="text-weight-bold"
            />
          </div>
          <div class="text-caption text-slate-500 q-mt-xs">
            Estrategia SMC institucional pura: Oro (XAU/USD), pares de Forex correlacionados, Step Index, Volatility y Jump · Detección bidireccional (BUY / SELL) según estructura de mercado · POI (OB/FVG) · Descuento/Premium · CHoCH M5 · SL Ceñido y TP
            <span v-if="lastUpdate" class="q-ml-xs text-weight-medium">
              · Actualizado: {{ lastUpdateTime }}
            </span>
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <q-btn
          unelevated
          color="indigo-7"
          icon="refresh"
          label="Actualizar Scanner"
          dense
          class="q-px-sm"
          :loading="loading"
          @click="loadScanner"
        />
        <q-btn
          flat
          dense
          color="indigo-7"
          icon="dashboard"
          label="Ir al Dashboard"
          to="/dashboard"
        />
      </div>
    </div>

    <!-- Barra de Filtros (Categoría + Toggle Solo Listos) -->
    <div class="row items-center justify-between q-mb-md filter-bar bg-white q-pa-sm rounded-borders shadow-1">
      <q-tabs
        v-model="selectedCategory"
        dense
        no-caps
        active-color="indigo-7"
        indicator-color="indigo-7"
        class="text-slate-600"
      >
        <q-tab name="ALL" label="Todos">
          <q-badge color="slate-6" :label="results.length" class="q-ml-xs text-weight-bold" />
        </q-tab>
        <q-tab name="METALS" label="Oro &amp; Metales">
          <q-badge color="amber-9" text-color="black" :label="countByCategory('METALS')" class="q-ml-xs text-weight-bold" />
        </q-tab>
        <q-tab name="FOREX" label="Forex">
          <q-badge color="blue-7" :label="countByCategory('FOREX')" class="q-ml-xs text-weight-bold" />
        </q-tab>
        <q-tab name="STEP" label="Step Index">
          <q-badge color="cyan-7" :label="countByCategory('STEP')" class="q-ml-xs text-weight-bold" />
        </q-tab>
        <q-tab name="VOLATILITY" label="Volatility">
          <q-badge color="purple-7" :label="countByCategory('VOLATILITY')" class="q-ml-xs text-weight-bold" />
        </q-tab>
        <q-tab name="JUMP" label="Jump Indices">
          <q-badge color="deep-orange-7" :label="countByCategory('JUMP')" class="q-ml-xs text-weight-bold" />
        </q-tab>
      </q-tabs>

      <div class="row items-center q-gutter-sm">
        <q-toggle
          v-model="onlyReady"
          color="positive"
          dense
          label="Solo Listos para Operar"
          class="text-caption text-weight-bold text-slate-700"
        />
      </div>
    </div>

    <!-- Skeletons durante carga inicial -->
    <div v-if="loading && !results.length" class="row q-col-gutter-md q-mb-xl">
      <div v-for="i in 6" :key="i" class="col-12 col-sm-6 col-md-4 col-lg-3">
        <q-skeleton type="rect" height="180px" style="border-radius:12px;" />
      </div>
    </div>

    <!-- Grid de Tarjetas de Índices Sintéticos -->
    <div v-else class="row q-col-gutter-md q-mb-xl">
      <div
        v-for="item in filteredResults"
        :key="item.symbol"
        class="col-12 col-sm-6 col-md-4 col-lg-3"
      >
        <q-card
          class="synth-card cursor-pointer"
          :class="[
            item.direction === 'BUY' ? 'synth-card--buy' : 'synth-card--sell',
            selectedSymbol === item.symbol ? 'synth-card--selected' : '',
          ]"
          flat
          bordered
          @click="selectSymbol(item.symbol)"
        >
          <q-card-section class="q-pa-md">
            <!-- Header de Tarjeta: Mercado + Dirección + Score -->
            <div class="row items-center justify-between q-mb-xs">
              <div>
                <div class="row items-center q-gutter-xs">
                  <span style="font-size: 16px;">{{ item.direction === 'BUY' ? '📈' : '📉' }}</span>
                  <span class="text-subtitle2 text-weight-bolder text-slate-900">{{ item.name }}</span>
                </div>
                <div class="text-caption text-slate-400 font-mono row items-center q-gutter-xs">
                  <span>{{ item.symbol }}</span>
                  <span>·</span>
                  <q-badge
                    dense
                    :color="getCategoryColor(item.category)"
                    :text-color="item.category === 'METALS' ? 'black' : 'white'"
                    :label="item.category"
                    class="text-weight-bold"
                  />
                </div>
              </div>

              <div class="text-right">
                <q-badge
                  :color="item.direction === 'BUY' ? 'green-8' : 'red-8'"
                  :label="item.direction"
                  class="text-weight-bolder q-mb-xs"
                />
                <div class="row items-center justify-end q-gutter-xs">
                  <span v-for="n in 6" :key="n" style="font-size:10px;" :style="{ color: n <= item.score ? '#f59e0b' : '#cbd5e1' }">★</span>
                  <q-badge
                    :color="item.ready ? 'green-7' : 'indigo-7'"
                    :label="item.ready ? 'LISTO ✓' : `${item.score}/6`"
                    class="text-weight-bold"
                  />
                </div>
              </div>
            </div>

            <!-- Precios Clave: Precio actual y R:B -->
            <div class="row q-col-gutter-xs q-mt-xs q-mb-xs">
              <div class="col-6">
                <div class="stat-label">Precio Actual</div>
                <div class="stat-value font-mono">{{ item.currentPrice }}</div>
              </div>
              <div class="col-6">
                <div class="stat-label">Riesgo / Beneficio</div>
                <div class="stat-value text-weight-bolder font-mono" :class="item.direction === 'BUY' ? 'text-green-7' : 'text-red-7'">
                  1:{{ item.riskReward || '2.5' }}
                </div>
              </div>
            </div>

            <!-- Niveles de SL y TP sugeridos -->
            <div class="row q-col-gutter-xs q-mb-sm">
              <div class="col-6">
                <div class="stat-label">Stop Loss</div>
                <div class="stat-value text-negative font-mono text-caption">{{ item.stopLossPrice || '-' }}</div>
              </div>
              <div class="col-6">
                <div class="stat-label">Take Profit</div>
                <div class="stat-value text-positive font-mono text-caption">{{ item.takeProfitPrice || '-' }}</div>
              </div>
            </div>

            <!-- Badges de confirmación SMC -->
            <div class="row q-gutter-xs q-mb-sm">
              <q-badge
                :outline="!item.conditions?.htfBias"
                :color="item.conditions?.htfBias ? (item.direction === 'BUY' ? 'green-7' : 'red-7') : 'grey-5'"
                :label="`HTF ${item.conditions?.htfBiasLabel ? item.conditions.htfBiasLabel.slice(0,3) : 'H1'}`"
                class="text-weight-bold"
              />
              <q-badge
                :outline="!item.conditions?.hasActiveZone"
                :color="item.conditions?.hasActiveZone ? 'indigo-7' : 'grey-5'"
                label="ZONA OB"
                class="text-weight-bold"
              />
              <q-badge
                :outline="!item.conditions?.hasPullback"
                :color="item.conditions?.hasPullback ? 'indigo-7' : 'grey-5'"
                label="PULLBACK"
                class="text-weight-bold"
              />
              <q-badge
                :outline="!item.conditions?.hasChoCH"
                :color="item.conditions?.hasChoCH ? 'amber-8' : 'grey-5'"
                label="CHoCH"
                class="text-weight-bold"
              />
              <q-badge
                :outline="!item.conditions?.inDiscountPremium"
                :color="item.conditions?.inDiscountPremium ? 'teal-7' : 'grey-5'"
                :label="item.direction === 'BUY' ? 'DESCUENTO' : 'PREMIUM'"
                class="text-weight-bold"
              />
              <q-badge
                :outline="!item.conditions?.notExhausted"
                :color="item.conditions?.notExhausted ? 'teal-7' : 'grey-5'"
                label="40% REC"
                class="text-weight-bold"
              />
            </div>

            <!-- Footer de la tarjeta con motivo y botón para ver gráfico -->
            <div class="row items-center justify-between q-mt-xs">
              <span class="text-caption text-slate-500 ellipsis" style="max-width: 170px;">
                {{ item.reason }}
              </span>
              <q-btn
                flat
                dense
                size="sm"
                color="indigo-7"
                icon="candlestick_chart"
                label="Ver Gráfico"
                @click.stop="selectSymbol(item.symbol)"
              />
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Estado vacío si el filtro no deja resultados -->
    <div v-if="!loading && !filteredResults.length" class="empty-box q-pa-xl text-center q-mb-xl">
      <q-icon name="filter_alt_off" size="44px" color="indigo-4" />
      <div class="text-subtitle1 text-weight-bold text-slate-800 q-mt-sm">
        No hay índices {{ onlyReady ? 'listos para operar' : '' }} en la categoría {{ selectedCategory }}
      </div>
      <div class="text-caption text-slate-500 q-mt-xs">
        Prueba cambiando el filtro o desactivando "Solo Listos para Operar".
      </div>
      <q-btn
        v-if="onlyReady"
        outline
        dense
        color="indigo-7"
        label="Ver todos los índices"
        class="q-mt-md text-weight-bold"
        @click="onlyReady = false"
      />
    </div>

    <!-- Sección de Gráfico Interactivo -->
    <div v-if="selectedItem" class="chart-section q-mt-lg">
      <div class="row items-center justify-between q-mb-sm">
        <div class="row items-center q-gutter-xs">
          <q-icon name="candlestick_chart" size="22px" color="indigo-7" />
          <span class="text-h6 text-weight-bolder text-slate-900">
            Gráfico SMC en Vivo: {{ selectedItem.name }} ({{ selectedItem.symbol }})
          </span>
          <q-badge
            :color="selectedItem.direction === 'BUY' ? 'green-8' : 'red-8'"
            :label="`${selectedItem.direction} · 1:${selectedItem.riskReward || '2.5'}`"
            class="text-weight-bold q-ml-xs"
          />
        </div>

        <q-btn
          flat
          dense
          color="indigo-7"
          icon="refresh"
          label="Refrescar Gráfico"
          :loading="chartLoading"
          @click="loadChartData(selectedItem.symbol)"
        />
      </div>

      <div v-if="chartLoading && !selectedChartData" class="q-pa-xl text-center bg-slate-900 rounded-borders">
        <q-spinner color="indigo-4" size="40px" />
        <div class="text-white text-caption q-mt-sm">Cargando velas y zonas institucionales...</div>
      </div>

      <SmcSyntheticsChart
        v-else-if="selectedChartData"
        :symbol="selectedItem.symbol"
        :direction="selectedItem.direction"
        :category="selectedItem.category"
        :chart-data="selectedChartData"
        :htf-bias-label="selectedItem.conditions?.htfBiasLabel || 'NEUTRAL'"
      />
    </div>

  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { smcSyntheticsService } from 'src/services/smcSynthetics.service';
import SmcSyntheticsChart from 'src/components/SmcSyntheticsChart.vue';

const route = useRoute();

const loading = ref(false);
const chartLoading = ref(false);
const results = ref([]);
const lastUpdate = ref(null);
const selectedCategory = ref('ALL'); // 'ALL' | 'STEP' | 'VOLATILITY' | 'JUMP'
const onlyReady = ref(false);
const selectedSymbol = ref(null);
const selectedChartData = ref(null);
let refreshTimer = null;

const readyList = computed(() => results.value.filter((r) => r.ready));

const lastUpdateTime = computed(() => {
  if (!lastUpdate.value) return '';
  return new Date(lastUpdate.value).toLocaleTimeString();
});

const filteredResults = computed(() => {
  let list = results.value;
  if (selectedCategory.value !== 'ALL') {
    list = list.filter((r) => r.category === selectedCategory.value);
  }
  if (onlyReady.value) {
    list = list.filter((r) => r.ready);
  }
  return list;
});

const selectedItem = computed(() => {
  return results.value.find((r) => r.symbol === selectedSymbol.value) || null;
});

function countByCategory(cat) {
  return results.value.filter((r) => r.category === cat).length;
}

function getCategoryColor(cat) {
  switch (cat) {
    case 'METALS': return 'amber-9';
    case 'FOREX': return 'blue-7';
    case 'STEP': return 'cyan-7';
    case 'VOLATILITY': return 'purple-7';
    case 'JUMP': return 'deep-orange-7';
    default: return 'indigo-7';
  }
}

async function loadScanner() {
  loading.value = true;
  try {
    const data = await smcSyntheticsService.scan();
    results.value = Array.isArray(data) ? data : [];
    lastUpdate.value = new Date().toISOString();

    // Si no hay seleccionado o el parámetro de ruta viene en la URL
    const targetSymbol = route.query.symbol;
    if (targetSymbol && results.value.some((r) => r.symbol === targetSymbol)) {
      selectSymbol(targetSymbol);
    } else if (!selectedSymbol.value && results.value.length > 0) {
      selectSymbol(results.value[0].symbol);
    } else if (selectedSymbol.value) {
      loadChartData(selectedSymbol.value);
    }
  } catch (err) {
    console.error('Error cargando escáner de sintéticos:', err);
  } finally {
    loading.value = false;
  }
}

async function selectSymbol(symbol) {
  selectedSymbol.value = symbol;
  await loadChartData(symbol);
}

async function loadChartData(symbol) {
  if (!symbol) return;
  chartLoading.value = true;
  try {
    const data = await smcSyntheticsService.getChart(symbol);
    if (data) {
      selectedChartData.value = data;
    }
  } catch (err) {
    console.error(`Error cargando gráfico para ${symbol}:`, err);
  } finally {
    chartLoading.value = false;
  }
}

onMounted(() => {
  loadScanner();
  // Recargar cada 45 segundos
  refreshTimer = setInterval(loadScanner, 45_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.smc-synthetics-page {
  background-color: #f8fafc;
  min-height: 100vh;
}

.header-container {
  border-bottom: 2px solid #c7d2fe;
  padding-bottom: 12px;
}

.live-pulse-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #cbd5e1;
}

.live-pulse-dot.active {
  background: #4f46e5;
  box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.7);
  animation: synth-pulse 1.8s infinite;
}

@keyframes synth-pulse {
  0% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(79, 70, 229, 0); }
  100% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0); }
}

.filter-bar {
  border: 1px solid #e2e8f0;
}

.synth-card {
  border-radius: 12px;
  transition: all 0.2s ease-in-out;
  background: #ffffff;
}
.synth-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
}

.synth-card--buy {
  border-top: 4px solid #10b981 !important;
}
.synth-card--sell {
  border-top: 4px solid #ef4444 !important;
}

.synth-card--selected {
  outline: 2px solid #4f46e5;
  box-shadow: 0 6px 20px rgba(79, 70, 229, 0.15);
}

.stat-label {
  font-size: 9px;
  color: #94a3b8;
  font-weight: 700;
  text-transform: uppercase;
}
.stat-value {
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
}

.empty-box {
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
}

.chart-section {
  border-top: 1px solid #e2e8f0;
  padding-top: 16px;
}
</style>

