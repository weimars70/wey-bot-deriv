<template>
  <q-page class="m5x-page q-pa-md q-pa-lg-md">
    <header class="page-header row items-center justify-between q-col-gutter-md q-mb-lg">
      <div class="col-12 col-md">
        <div class="row items-center q-gutter-sm">
          <div class="header-icon"><q-icon name="compress" size="27px" /></div>
          <div>
            <h1 class="text-h5 text-weight-bolder q-my-none">Estrategia M5X</h1>
            <div class="text-caption text-grey-7">
              Vela verde chata en M5 para índices Crash, con entrada SELL al cierre.
            </div>
          </div>
        </div>
      </div>
      <div class="col-auto row q-gutter-sm">
        <q-btn
          unelevated
          :color="m5XAutoEnabled ? 'green-7' : 'grey-7'"
          :icon="m5XAutoEnabled ? 'smart_toy' : 'pause_circle'"
          :label="m5XAutoEnabled ? 'Bot M5X: ON' : 'Bot M5X: OFF'"
          :loading="savingAuto"
          @click="toggleM5XAuto"
        />
        <q-btn
          unelevated
          color="deep-orange-8"
          icon="refresh"
          label="Actualizar"
          :loading="loadingLive"
          @click="loadLive"
        />
      </div>
    </header>

    <section class="pattern-band q-mb-lg">
      <div class="row items-center q-col-gutter-xl">
        <div class="col-12 col-md-4">
          <div class="pattern-stage" aria-label="Ejemplo de vela chata M5X">
            <div class="trend-bars" aria-hidden="true">
              <span class="trend-candle trend-candle--one"></span>
              <span class="trend-candle trend-candle--two"></span>
              <span class="trend-candle trend-candle--three"></span>
            </div>
            <div class="flat-candle" aria-hidden="true">
              <span class="flat-candle__wick"></span>
              <span class="flat-candle__body"></span>
            </div>
            <div class="crash-arrow"><q-icon name="south" size="42px" /></div>
          </div>
        </div>
        <div class="col-12 col-md-8">
          <div class="text-overline text-deep-orange-9">PATRÓN EVALUADO</div>
          <div class="text-h6 text-weight-bold q-mb-sm">Vela verde chata antes del spike bajista</div>
          <div class="rule-grid">
            <div><b>Mercados:</b> únicamente índices Crash.</div>
            <div><b>Secuencia:</b> dos velas verdes consecutivas en tu gráfico.</div>
            <div><b>Altura:</b> la segunda vela debe cerrar por encima de la primera.</div>
            <div><b>Vela chata:</b> la segunda tiene el menor cuerpo y rango de las últimas tres velas.</div>
          </div>
          <q-banner dense class="evaluation-note q-mt-md">
            {{ !m5XAutoEnabled
              ? 'Trading automático pausado: la detección y las estadísticas continúan activas.'
              : mt5SourceReady
                ? 'Trading automático activo: abre SELL al cerrar una nueva vela M5X de MT5.'
                : 'Bot activo, esperando las velas de MT5. No se operan señales de la fuente DERIV de respaldo.' }}
          </q-banner>
        </div>
      </div>
    </section>

    <section class="q-mb-lg">
      <div class="section-title row items-center justify-between q-mb-sm">
        <div>
          <div class="text-subtitle1 text-weight-bolder">Monitoreo de la última vela cerrada</div>
          <div class="text-caption text-grey-6">Se actualiza automáticamente cada 30 segundos.</div>
        </div>
        <q-badge color="grey-8" :label="lastUpdatedLabel" />
      </div>

      <div class="row q-col-gutter-md">
        <div v-for="item in liveRows" :key="item.symbol" class="col-12 col-sm-6 col-lg-3">
          <q-card flat bordered class="live-card" :class="{ 'live-card--active': item.patternDetected }">
            <q-card-section>
              <div class="row items-center justify-between q-mb-sm">
                <div class="text-subtitle1 text-weight-bolder">{{ item.mercado }}</div>
                <div class="row q-gutter-xs">
                  <q-badge color="blue-grey-7" :label="item.dataSource || 'DERIV'" />
                  <q-badge
                    :color="item.patternDetected ? 'deep-orange-8' : 'grey-5'"
                    :label="item.patternDetected ? 'M5X ACTIVO' : 'EN ESPERA'"
                  />
                </div>
              </div>
              <div class="metric-row"><span>Cuerpo / rango</span><b>{{ item.bodyRatioPct || 0 }} %</b></div>
              <div class="metric-row"><span>Cuerpo / velas previas</span><b>{{ item.bodyVsAveragePct || 0 }} %</b></div>
              <div class="metric-row"><span>Rango / promedio</span><b>{{ item.rangeVsAveragePct || 0 }} %</b></div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </section>

    <section class="backtest-band">
      <div class="row items-center justify-between q-col-gutter-md q-mb-md">
        <div class="col-12 col-md">
          <div class="text-subtitle1 text-weight-bolder">Evaluación histórica</div>
          <div class="text-caption text-grey-6">
            Mide cuántas velas verdes chatas aparecieron, cuántas tuvieron un spike bajista en la vela M5 siguiente y su porcentaje.
          </div>
        </div>
        <div class="col-12 col-md-auto row items-center q-gutter-sm">
          <q-btn-toggle
            v-model="days"
            dense
            unelevated
            toggle-color="deep-orange-8"
            color="grey-3"
            text-color="grey-8"
            :options="dayOptions"
          />
          <q-btn
            unelevated
            color="grey-9"
            icon="query_stats"
            label="Evaluar"
            :loading="loadingBacktest"
            @click="runBacktest"
          />
        </div>
      </div>

      <div v-if="summary" class="row q-col-gutter-sm q-mb-md">
        <div class="col-6 col-md-3"><div class="kpi"><span>Patrones</span><b>{{ summary.totals.totalPatterns }}</b></div></div>
        <div class="col-6 col-md-3"><div class="kpi"><span>Con spike</span><b>{{ summary.totals.withSpike }}</b></div></div>
        <div class="col-6 col-md-3"><div class="kpi"><span>Sin spike</span><b>{{ summary.totals.withoutSpike }}</b></div></div>
        <div class="col-6 col-md-3"><div class="kpi kpi--accent"><span>Efectividad</span><b>{{ summary.totals.spikeRatePct }} %</b></div></div>
      </div>

      <q-table
        flat
        bordered
        row-key="symbol"
        :rows="summary?.symbols || []"
        :columns="summaryColumns"
        :loading="loadingBacktest"
        :pagination="{ rowsPerPage: 0 }"
        hide-pagination
        no-data-label="Ejecuta la evaluación para ver resultados."
      >
        <template #body-cell-mercado="props">
          <q-td :props="props">
            <div class="row items-center q-gutter-xs">
              <span>{{ props.value }}</span>
              <q-badge color="green-7" label="VERDE → SPIKE" class="text-weight-bold" />
            </div>
          </q-td>
        </template>
        <template #body-cell-spikeRatePct="props">
          <q-td :props="props">
            <q-badge :color="props.value >= 60 ? 'green-7' : props.value >= 40 ? 'amber-8' : 'red-7'">
              {{ props.value }} %
            </q-badge>
          </q-td>
        </template>
        <template #body-cell-actions="props">
          <q-td :props="props">
            <q-btn flat round dense icon="visibility" color="deep-orange-8" @click="loadDetails(props.row.symbol)">
              <q-tooltip>Ver ocurrencias</q-tooltip>
            </q-btn>
          </q-td>
        </template>
      </q-table>

      <div v-if="selectedResult" class="q-mt-lg">
        <div class="text-subtitle2 text-weight-bolder q-mb-sm">
          Ocurrencias de {{ selectedResult.mercado }}
        </div>
        <q-table
          flat
          bordered
          row-key="id"
          :rows="selectedResult.patterns"
          :columns="detailColumns"
          :pagination="{ rowsPerPage: 10 }"
          no-data-label="No se encontraron velas M5X en este periodo."
          @row-click="(_, row) => selectPattern(row)"
        >
          <template #body-cell-result="props">
            <q-td :props="props">
              <q-badge
                :color="props.value === 'SPIKE' ? 'green-7' : 'red-7'"
                :label="props.value === 'SPIKE' ? 'SPIKE' : 'SIN SPIKE'"
                class="text-weight-bold"
              />
            </q-td>
          </template>
          <template #body-cell-graph="props">
            <q-td :props="props">
              <q-btn flat dense size="sm" color="deep-orange-8" icon="show_chart" @click.stop="selectPattern(props.row)" />
            </q-td>
          </template>
        </q-table>

        <div v-if="selectedPattern && selectedPattern.signalCandle" class="chart-panel q-mt-md">
          <div class="text-subtitle2 text-weight-bold q-mb-sm">Verificación en gráfica</div>
          <svg :viewBox="`0 0 760 260`" class="pattern-chart" role="img" aria-label="Gráfica de vela M5X y spike posterior">
            <rect x="0" y="0" width="760" height="260" fill="#f8fafc" />
            <g v-for="line in chartGrid" :key="line">
              <line :x1="20" :x2="740" :y1="line" :y2="line" stroke="#dfe7f3" stroke-width="1" />
            </g>

            <line x1="20" y1="200" x2="740" y2="200" stroke="#cbd5e1" stroke-width="1.5" />
            <line x1="20" y1="20" x2="20" y2="200" stroke="#cbd5e1" stroke-width="1.5" />

            <g>
              <line :x1="220" :x2="220" :y1="chartY(selectedPattern.signalCandle.high)" :y2="chartY(selectedPattern.signalCandle.low)" stroke="#0f172a" stroke-width="2" />
              <rect
                :x="180"
                :y="chartY(Math.max(selectedPattern.signalCandle.open, selectedPattern.signalCandle.close))"
                :width="80"
                :height="Math.max(8, Math.abs(chartY(selectedPattern.signalCandle.open) - chartY(selectedPattern.signalCandle.close)))"
                :fill="isBullishSignal(selectedPattern.signalCandle) ? '#22c55e' : '#ef4444'"
                stroke="#0f172a"
                stroke-width="1.5"
              />
            </g>

            <g v-if="selectedPattern.spikeCandle">
              <line :x1="520" :x2="520" :y1="chartY(selectedPattern.spikeCandle.high)" :y2="chartY(selectedPattern.spikeCandle.low)" stroke="#0f172a" stroke-width="2" />
              <rect
                :x="480"
                :y="chartY(Math.max(selectedPattern.spikeCandle.open, selectedPattern.spikeCandle.close))"
                :width="80"
                :height="Math.max(8, Math.abs(chartY(selectedPattern.spikeCandle.open) - chartY(selectedPattern.spikeCandle.close)))"
                :fill="isBullishSignal(selectedPattern.spikeCandle) ? '#22c55e' : '#ef4444'"
                stroke="#0f172a"
                stroke-width="1.5"
              />
            </g>

            <text x="180" y="230" fill="#334155" font-size="12" font-weight="600">Vela M5X</text>
            <text x="470" y="230" fill="#334155" font-size="12" font-weight="600">Spike</text>
          </svg>

          <div class="row q-col-gutter-sm q-mt-sm">
            <div class="col-6">
              <div class="mini-metric"><span>Señal</span><b>{{ selectedPattern.signalCandle.close }}</b></div>
            </div>
            <div class="col-6">
              <div class="mini-metric"><span>Spike</span><b>{{ selectedPattern.spikePoints }} pts</b></div>
            </div>
          </div>
        </div>
        <div v-else-if="selectedResult" class="chart-panel q-mt-md text-grey-7">
          No hay datos suficientes para dibujar la gráfica de esta ocurrencia.
        </div>
      </div>
    </section>
  </q-page>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';

const $q = useQuasar();
const loadingLive = ref(false);
const loadingBacktest = ref(false);
const savingAuto = ref(false);
const m5XAutoEnabled = ref(false);
const liveRows = ref([]);
const summary = ref(null);
const selectedResult = ref(null);
const days = ref(14);
const lastUpdatedLabel = ref('Sin actualizar');
const mt5SourceReady = computed(() => liveRows.value.some((item) => item.dataSource === 'MT5'));
let liveTimer = null;

const dayOptions = [
  { label: '7 días', value: 7 },
  { label: '14 días', value: 14 },
  { label: '30 días', value: 30 },
];

const summaryColumns = [
  { name: 'mercado', label: 'Índice', field: 'mercado', align: 'left', sortable: true },
  { name: 'dataSource', label: 'Fuente', field: 'dataSource', align: 'center' },
  { name: 'totalPatterns', label: 'Patrones', field: 'totalPatterns', align: 'center', sortable: true },
  { name: 'withSpike', label: 'Con spike', field: 'withSpike', align: 'center', sortable: true },
  { name: 'withoutSpike', label: 'Sin spike', field: 'withoutSpike', align: 'center' },
  { name: 'spikeRatePct', label: 'Efectividad', field: 'spikeRatePct', align: 'center', sortable: true },
  { name: 'actions', label: '', field: 'actions', align: 'center' },
];

const detailColumns = [
  { name: 'mt5DateStr', label: 'Fecha MT5', field: 'mt5DateStr', align: 'left', sortable: true },
  { name: 'bodyRatioPct', label: 'Cuerpo/rango', field: 'bodyRatioPct', align: 'right', format: (v) => `${v} %` },
  { name: 'bodyVsAveragePct', label: 'Cuerpo/previas', field: 'bodyVsAveragePct', align: 'right', format: (v) => `${v} %` },
  { name: 'rangeVsAveragePct', label: 'Rango/promedio', field: 'rangeVsAveragePct', align: 'right', format: (v) => `${v} %` },
  { name: 'spikePoints', label: 'Spike', field: 'spikePoints', align: 'right', format: (v) => `${v} pts` },
  { name: 'spikeDelayCandles', label: 'Demora', field: 'spikeDelayCandles', align: 'center', format: (v) => v ? `${v} M5` : '-' },
  { name: 'result', label: 'Resultado', field: 'result', align: 'center' },
  { name: 'graph', label: 'Gráfica', field: 'graph', align: 'center' },
];

const selectedPattern = ref(null);
const chartGrid = Array.from({ length: 8 }, (_, index) => 30 + index * 22);

function isBullishSignal(candle) {
  if (!candle) return true;
  return Number(candle.close) >= Number(candle.open);
}

function chartY(value) {
  if (!Number.isFinite(Number(value))) return 200;
  const candleValues = [
    Number(selectedPattern.value?.signalCandle?.high ?? 0),
    Number(selectedPattern.value?.signalCandle?.low ?? 0),
    Number(selectedPattern.value?.spikeCandle?.high ?? 0),
    Number(selectedPattern.value?.spikeCandle?.low ?? 0),
  ].filter((v) => Number.isFinite(v));
  const min = candleValues.length ? Math.min(...candleValues) : 0;
  const max = candleValues.length ? Math.max(...candleValues) : 1;
  const padding = Math.max((max - min) * 0.15, 0.0001);
  return 200 - ((Number(value) - (min - padding)) / ((max + padding) - (min - padding) || 1)) * 170;
}

function selectPattern(row) {
  selectedPattern.value = row;
}

async function loadBotConfig() {
  try {
    const { data } = await api.get('/trading/config');
    m5XAutoEnabled.value = data?.m5XAutoEnabled ?? false;
  } catch (error) {
    m5XAutoEnabled.value = false;
  }
}

async function toggleM5XAuto() {
  savingAuto.value = true;
  try {
    const { data } = await api.post('/trading/toggle', {
      strategy: 'm5X',
      enabled: !m5XAutoEnabled.value,
    });
    m5XAutoEnabled.value = data?.m5XAutoEnabled ?? false;
    $q.notify({
      type: m5XAutoEnabled.value ? 'positive' : 'info',
      message: m5XAutoEnabled.value ? 'Trading automático M5X activado.' : 'Trading automático M5X pausado.',
    });
  } catch (error) {
    $q.notify({ type: 'negative', message: 'No fue posible cambiar el estado del bot M5X.' });
  } finally {
    savingAuto.value = false;
  }
}

async function loadLive() {
  loadingLive.value = true;
  try {
    const { data } = await api.get('/strategies/m5x/live-all');
    liveRows.value = Array.isArray(data) ? data : [];
    lastUpdatedLabel.value = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    $q.notify({ type: 'negative', message: 'No fue posible actualizar M5X.' });
  } finally {
    loadingLive.value = false;
  }
}

async function runBacktest() {
  loadingBacktest.value = true;
  selectedResult.value = null;
  selectedPattern.value = null;
  try {
    const { data } = await api.post('/strategies/m5x/backtest-all', { days: days.value });
    summary.value = data;
  } catch (error) {
    $q.notify({ type: 'negative', message: 'No fue posible ejecutar la evaluación M5X.' });
  } finally {
    loadingBacktest.value = false;
  }
}

async function loadDetails(symbol) {
  loadingBacktest.value = true;
  selectedPattern.value = null;
  try {
    const { data } = await api.post('/strategies/m5x/backtest', { symbol, days: days.value });
    selectedResult.value = data;
  } catch (error) {
    $q.notify({ type: 'negative', message: 'No fue posible cargar las ocurrencias.' });
  } finally {
    loadingBacktest.value = false;
  }
}

onMounted(() => {
  loadBotConfig();
  loadLive();
  runBacktest();
  liveTimer = window.setInterval(loadLive, 30000);
});

onUnmounted(() => {
  if (liveTimer) window.clearInterval(liveTimer);
});
</script>

<style scoped>
.m5x-page { max-width: 1440px; margin: 0 auto; color: #17202a; }
.header-icon { width: 46px; height: 46px; display: grid; place-items: center; background: #c2410c; color: white; border-radius: 6px; }
.pattern-band { padding: 24px; border-top: 3px solid #c2410c; border-bottom: 1px solid #d5d8dc; background: #fff; }
.pattern-stage { height: 230px; position: relative; border-left: 1px solid #d5d8dc; border-bottom: 1px solid #d5d8dc; overflow: hidden; }
.trend-bars { position: absolute; inset: 42px 110px 20px 20px; display: flex; align-items: flex-end; gap: 22px; }
.trend-candle { position: relative; display: block; width: 28px; background: #16a34a; border: 2px solid #0f7a38; }
.trend-candle::before { content: ''; position: absolute; width: 2px; height: calc(100% + 24px); background: #111827; left: 50%; top: -12px; z-index: -1; }
.trend-candle--one { height: 45px; }
.trend-candle--two { height: 62px; }
.trend-candle--three { height: 78px; }
.flat-candle { position: absolute; top: 38px; right: 72px; width: 50px; height: 72px; }
.flat-candle__wick { position: absolute; left: 24px; top: 0; width: 3px; height: 72px; background: #111827; }
.flat-candle__body { position: absolute; left: 7px; top: 29px; width: 36px; height: 14px; background: #22c55e; border: 2px solid #0f7a38; }
.crash-arrow { position: absolute; right: 73px; top: 112px; color: #dc2626; }
.rule-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; color: #4b5563; }
.evaluation-note { background: #fff7ed; color: #9a3412; border-left: 3px solid #ea580c; }
.section-title { min-height: 44px; }
.live-card { min-height: 178px; border-radius: 6px; }
.live-card--active { border: 2px solid #ea580c; background: #fff7ed; }
.metric-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eef0f2; font-size: 13px; }
.backtest-band { padding-top: 18px; border-top: 1px solid #d5d8dc; }
.kpi { min-height: 82px; padding: 14px; border: 1px solid #d5d8dc; border-radius: 6px; background: white; display: flex; flex-direction: column; }
.kpi span { color: #6b7280; font-size: 12px; }
.kpi b { font-size: 24px; }
.kpi--accent { border-color: #fb923c; background: #fff7ed; }
.chart-panel { background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
.pattern-chart { width: 100%; height: 280px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
.mini-metric { border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; padding: 10px 12px; }
.mini-metric span { display: block; font-size: 11px; color: #64748b; }
.mini-metric b { font-size: 18px; }
@media (max-width: 700px) {
  .rule-grid { grid-template-columns: 1fr; }
  .pattern-band { padding: 16px; }
}
</style>
