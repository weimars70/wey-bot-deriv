<template>
  <q-page class="q-pa-lg double-wick-page">
    <!-- ── CABECERA ── -->
    <div class="page-header q-mb-lg row items-center justify-between flex-wrap q-gutter-y-sm">
      <div>
        <div class="row items-center q-gutter-sm">
          <div class="header-icon-box header-icon-box--teal">
            <q-icon name="timeline" size="26px" color="white" />
          </div>
          <div>
            <h1 class="text-h5 text-weight-bolder text-slate-900 q-my-none">
              Estrategia · Dos velas (M5 y H1)
            </h1>
            <div class="text-caption text-slate-500 q-mt-xs">
              CRASH exige dos velas bajistas en escalera descendente; BOOM exige dos velas alcistas en escalera ascendente. Ambas llevan mechas largas arriba y abajo. M5 opera al cierre de la segunda; H1 solo alerta.
            </div>
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <q-btn unelevated color="teal-7" icon="refresh" label="Actualizar" :loading="loading" @click="loadData" />
      </div>
    </div>

    <!-- ── SELECTOR MERCADO ── -->
    <div class="market-family-bar row items-center justify-between q-mb-sm flex-wrap q-gutter-sm">
      <q-btn-toggle
        v-model="marketTab"
        :toggle-color="marketTab === 'BOOM' ? 'green-8' : 'indigo-8'"
        flat dense
        :options="[
          { label: '🔴 CRASH SELL', value: 'CRASH' },
          { label: '🟢 BOOM BUY',   value: 'BOOM'  },
        ]"
        class="market-type-toggle text-weight-bolder"
        @update:model-value="onMarketTabChange"
      />
    </div>

    <!-- ── SELECTOR SÍMBOLO ── -->
    <div class="index-nav-pills row items-center q-gutter-xs q-mb-md">
      <q-btn
        v-for="sym in activeSymbolsList"
        :key="sym.symbol"
        :flat="selectedSymbol !== sym.symbol"
        :unelevated="selectedSymbol === sym.symbol"
        :class="[
          'index-nav-btn text-weight-bold',
          selectedSymbol === sym.symbol
            ? (marketTab === 'BOOM' ? 'index-nav-btn--active-boom' : 'index-nav-btn--active-crash')
            : 'index-nav-btn--inactive',
        ]"
        dense
        @click="onSymbolSelect(sym.symbol)"
      >
        <span class="index-nav-title q-mr-xs">{{ sym.name }}</span>
        <q-badge
          :color="getBadgeColor(selectedEntry?.symbol === sym.symbol && selectedEntry?.isValid)"
          :label="selectedEntry?.symbol === sym.symbol && selectedEntry?.isValid ? 'ACTIVO' : 'ESPERA'"
          class="q-ml-xs text-weight-bold"
        />
      </q-btn>
    </div>

    <!-- ── PANEL SEÑAL ACTUAL ── -->
    <div v-if="selectedEntry" class="bg-white rounded-borders q-pa-lg border-slate q-mb-lg">
      <div class="row items-center justify-between q-mb-md flex-wrap">
        <div>
          <div class="row items-center q-gutter-sm">
            <span class="text-h6 text-weight-bolder text-slate-900">{{ selectedEntry.mercado }}</span>
            <q-badge
              :color="selectedEntry.direction === 'BUY' ? 'green-1' : 'red-1'"
              :text-color="selectedEntry.direction === 'BUY' ? 'green-9' : 'red-9'"
              :label="selectedEntry.direction === 'BUY' ? 'BOOM BUY' : 'CRASH SELL'"
              class="text-weight-bold"
            />
          </div>
          <div class="text-caption text-slate-500 q-mt-xs">{{ selectedEntry.reason }}</div>
        </div>
        <q-badge
          :color="selectedEntry.isValid ? 'teal-1' : 'grey-2'"
          :text-color="selectedEntry.isValid ? 'teal-9' : 'grey-8'"
          :label="selectedEntry.isValid ? 'SEÑAL VÁLIDA' : 'PATRÓN NO CONFIRMADO'"
          class="text-weight-bolder"
        />
      </div>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <div class="info-card q-pa-md rounded-borders">
            <div class="text-subtitle2 text-weight-bolder text-slate-800 q-mb-sm">Velas M5</div>
            <div class="row q-col-gutter-sm q-mb-sm">
              <div class="col-6">
                <div class="metric-box q-pa-sm rounded-borders">
                  <div class="text-caption text-slate-500">Vela anterior</div>
                  <div class="text-body1 text-weight-bolder font-mono">{{ formatNum(selectedEntry.previousCandle?.close) }}</div>
                </div>
              </div>
              <div class="col-6">
                <div class="metric-box q-pa-sm rounded-borders">
                  <div class="text-caption text-slate-500">Vela actual</div>
                  <div class="text-body1 text-weight-bolder font-mono">{{ formatNum(selectedEntry.currentCandle?.close) }}</div>
                </div>
              </div>
            </div>
            <div class="row q-col-gutter-sm">
              <div class="col-6">
                <div class="metric-box q-pa-sm rounded-borders">
                  <div class="text-caption text-slate-500">Hora previa</div>
                  <div class="text-body1 text-weight-bolder">{{ selectedEntry.previousCandle?.timeStr || '—' }}</div>
                </div>
              </div>
              <div class="col-6">
                <div class="metric-box q-pa-sm rounded-borders">
                  <div class="text-caption text-slate-500">Hora actual</div>
                  <div class="text-body1 text-weight-bolder">{{ selectedEntry.currentCandle?.timeStr || '—' }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-12 col-md-6">
          <div class="info-card q-pa-md rounded-borders">
            <div class="text-subtitle2 text-weight-bolder text-slate-800 q-mb-sm">Niveles de entrada</div>
            <div class="q-gutter-y-sm">
              <div class="level-row row items-center justify-between q-pa-xs rounded-borders bg-slate-1">
                <span class="level-label text-weight-bold text-slate-700">Entrada</span>
                <span class="level-value font-mono text-weight-bolder text-slate-900">{{ formatNum(selectedEntry.entryPrice) }}</span>
              </div>
              <div class="level-row row items-center justify-between q-pa-xs rounded-borders bg-red-1">
                <span class="level-label text-weight-bold text-red-9">Stop Loss</span>
                <span class="level-value font-mono text-weight-bolder text-red-9">{{ formatNum(selectedEntry.stopLossPrice) }}</span>
              </div>
              <div class="level-row row items-center justify-between q-pa-xs rounded-borders bg-emerald-1">
                <span class="level-label text-weight-bold text-emerald-9">Dirección</span>
                <span class="level-value font-mono text-weight-bolder text-emerald-9">{{ selectedEntry.direction }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="bg-white rounded-borders q-pa-lg border-slate text-slate-600 q-mb-lg">
      No hay una señal válida de dos velas para esta familia en este momento. Se mostrará el último patrón observado si existe.
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <!-- ── TABLA DE ESTADÍSTICAS HISTÓRICAS ── -->
    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <div class="stats-section bg-white rounded-borders border-slate q-pa-lg">

      <!-- Cabecera de la sección + selector de días -->
      <div class="row items-center justify-between q-mb-md flex-wrap q-gutter-y-sm">
        <div class="row items-center q-gutter-sm">
          <q-icon name="bar_chart" color="teal-7" size="22px" />
          <span class="text-subtitle1 text-weight-bolder text-slate-900">Historial de patrones — ¿vino spike?</span>
          <q-badge v-if="histStats" color="teal-7" :label="`${histStats.totalPatterns} patrones`" class="text-weight-bold" />
        </div>

        <div class="row items-center q-gutter-sm">
          <span class="text-caption text-slate-500">Últimos:</span>
          <q-btn-toggle
            v-model="histDays"
            flat dense size="sm"
            toggle-color="teal-7"
            :options="[
              { label: '3d',  value: 3  },
              { label: '7d',  value: 7  },
              { label: '14d', value: 14 },
              { label: '30d', value: 30 },
            ]"
            class="border-slate rounded-borders"
            @update:model-value="loadHistory"
          />
        </div>
      </div>

      <!-- KPIs de resumen -->
      <div v-if="histStats" class="row q-col-gutter-md q-mb-lg">
        <div class="col-6 col-sm-3">
          <div class="kpi-card kpi-card--neutral">
            <div class="kpi-value">{{ histStats.totalPatterns }}</div>
            <div class="kpi-label">Total patrones</div>
          </div>
        </div>
        <div class="col-6 col-sm-3">
          <div class="kpi-card kpi-card--green">
            <div class="kpi-value text-green-8">{{ histStats.withSpike }}</div>
            <div class="kpi-label">Con spike ✓</div>
          </div>
        </div>
        <div class="col-6 col-sm-3">
          <div class="kpi-card kpi-card--red">
            <div class="kpi-value text-red-8">{{ histStats.withoutSpike }}</div>
            <div class="kpi-label">Sin spike ✗</div>
          </div>
        </div>
        <div class="col-6 col-sm-3">
          <div class="kpi-card" :class="histStats.spikeRatePct >= 60 ? 'kpi-card--green' : histStats.spikeRatePct >= 40 ? 'kpi-card--amber' : 'kpi-card--red'">
            <div class="kpi-value" :class="histStats.spikeRatePct >= 60 ? 'text-green-8' : histStats.spikeRatePct >= 40 ? 'text-amber-8' : 'text-red-8'">
              {{ histStats.spikeRatePct }}%
            </div>
            <div class="kpi-label">Efectividad</div>
          </div>
        </div>
      </div>

      <!-- Skeleton mientras carga -->
      <div v-if="histLoading" class="q-gutter-y-sm">
        <q-skeleton v-for="n in 5" :key="n" type="rect" height="40px" />
      </div>

      <!-- Tabla -->
      <q-table
        v-else-if="histStats && histStats.rows.length > 0"
        :rows="histStats.rows"
        :columns="histColumns"
        row-key="epoch"
        flat
        bordered
        dense
        :rows-per-page-options="[15, 30, 50, 0]"
        rows-per-page-label="Filas por página"
        no-data-label="Sin datos para este período"
        class="hist-table"
      >
        <!-- Columna resultado: chip de color -->
        <template #body-cell-result="props">
          <q-td :props="props" class="text-center">
            <q-badge
              :color="props.row.spikeFollowed ? 'green-7' : 'red-6'"
              :label="props.row.spikeFollowed ? '✓ SPIKE' : '✗ NO SPIKE'"
              class="text-weight-bolder hist-badge"
            />
          </q-td>
        </template>

        <!-- Columna spikePoints: solo mostrar si > 0 -->
        <template #body-cell-spikePoints="props">
          <q-td :props="props" class="text-right font-mono">
            <span v-if="props.row.spikePoints > 0" class="text-green-8 text-weight-bold">
              +{{ props.row.spikePoints }} pts
            </span>
            <span v-else class="text-grey-5">—</span>
          </q-td>
        </template>

        <!-- Columna hora del spike -->
        <template #body-cell-spikeTime="props">
          <q-td :props="props" class="text-center font-mono">
            <span v-if="props.row.spikeTime" class="text-green-7 text-weight-bold">{{ props.row.spikeTime }}</span>
            <span v-else class="text-grey-5">—</span>
          </q-td>
        </template>
      </q-table>

      <div v-else-if="!histLoading && histStats && histStats.rows.length === 0" class="text-center text-slate-400 q-pa-xl">
        <q-icon name="search_off" size="36px" class="q-mb-sm" />
        <div>No se detectaron patrones en los últimos {{ histDays }} días para {{ selectedSymbol }}.</div>
      </div>

      <div v-else-if="!histLoading && !histStats" class="text-center text-slate-400 q-pa-xl">
        Selecciona un símbolo para ver el historial.
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { crashIaStrategyService } from 'src/services/crashIaStrategy.service';

// ── Estado señal actual ──────────────────────────────────────────────────────
const marketTab     = ref('BOOM');
const selectedSymbol = ref('BOOM500');
const loading       = ref(false);
const data          = ref([]);

// ── Estado historial ─────────────────────────────────────────────────────────
const histDays    = ref(7);
const histLoading = ref(false);
const histStats   = ref(null);

// ── Listas de símbolos ───────────────────────────────────────────────────────
const crashSymbols = [
  { symbol: 'CRASH300N', name: 'Crash 300'  },
  { symbol: 'CRASH500',  name: 'Crash 500'  },
  { symbol: 'CRASH600',  name: 'Crash 600'  },
  { symbol: 'CRASH900',  name: 'Crash 900'  },
  { symbol: 'CRASH1000', name: 'Crash 1000' },
];
const boomSymbols = [
  { symbol: 'BOOM300N', name: 'Boom 300'  },
  { symbol: 'BOOM500',  name: 'Boom 500'  },
  { symbol: 'BOOM600',  name: 'Boom 600'  },
  { symbol: 'BOOM900',  name: 'Boom 900'  },
  { symbol: 'BOOM1000', name: 'Boom 1000' },
];

const activeSymbolsList = computed(() =>
  marketTab.value === 'BOOM' ? boomSymbols : crashSymbols,
);

const selectedEntry = computed(() => {
  if (!data.value?.length) return null;
  const list = data.value.filter((item) =>
    marketTab.value === 'BOOM' ? item.marketType === 'BOOM' : item.marketType === 'CRASH',
  );
  return list.find((item) => item.symbol === selectedSymbol.value) || list[0] || null;
});

// ── Columnas de la tabla de historial ───────────────────────────────────────
const histColumns = [
  { name: 'patternTime', label: 'Fecha / hora patrón', field: 'patternTime', align: 'left',  sortable: true },
  { name: 'prevClose',   label: 'Cierre vela 1',       field: 'prevClose',   align: 'right', sortable: false, format: (v) => Number(v).toFixed(3) },
  { name: 'currClose',   label: 'Cierre vela 2',       field: 'currClose',   align: 'right', sortable: false, format: (v) => Number(v).toFixed(3) },
  { name: 'entryPrice',  label: 'Entrada',              field: 'entryPrice',  align: 'right', sortable: false, format: (v) => Number(v).toFixed(3) },
  { name: 'stopLossPrice', label: 'Stop Loss',          field: 'stopLossPrice', align: 'right', sortable: false, format: (v) => Number(v).toFixed(3) },
  { name: 'result',      label: 'Resultado',            field: 'result',      align: 'center', sortable: true },
  { name: 'spikePoints', label: 'Magnitud spike',       field: 'spikePoints', align: 'right', sortable: true },
  { name: 'spikeTime',   label: 'Hora spike',           field: 'spikeTime',   align: 'center', sortable: false },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function getBadgeColor(valid) {
  return valid ? 'teal-7' : 'grey-5';
}

function formatNum(v) {
  return Number(v ?? 0).toFixed(3);
}

function onMarketTabChange() {
  const families = marketTab.value === 'BOOM' ? boomSymbols : crashSymbols;
  selectedSymbol.value = families[0]?.symbol || 'BOOM500';
}

function onSymbolSelect(sym) {
  selectedSymbol.value = sym;
}

// ── Carga de datos ───────────────────────────────────────────────────────────
async function loadData() {
  loading.value = true;
  try {
    const summary = await crashIaStrategyService.getDoubleWickSummary();
    data.value = summary || [];
    const families = marketTab.value === 'BOOM' ? boomSymbols : crashSymbols;
    if (!families.some((s) => s.symbol === selectedSymbol.value)) {
      selectedSymbol.value = families[0]?.symbol || 'BOOM500';
    }
  } finally {
    loading.value = false;
  }
}

async function loadHistory() {
  histLoading.value = true;
  histStats.value = null;
  try {
    const result = await crashIaStrategyService.getDoubleWickHistory(
      selectedSymbol.value,
      histDays.value,
    );
    histStats.value = result;
  } catch (e) {
    histStats.value = null;
  } finally {
    histLoading.value = false;
  }
}

// Recargar historial cuando cambia el símbolo seleccionado
watch(selectedSymbol, () => {
  loadHistory();
});

onMounted(() => {
  loadData();
  loadHistory();
});
</script>

<style scoped>
.double-wick-page {
  background-color: #f8fafc;
  min-height: 100vh;
}

.page-header { background: transparent; }

.header-icon-box {
  width: 46px; height: 46px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
}
.header-icon-box--teal {
  background: linear-gradient(135deg, #14b8a6 0%, #0f766e 100%);
}

.border-slate { border: 1px solid #e2e8f0; }

.market-family-bar { background: transparent; }

.market-type-toggle {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: white;
}

.index-nav-pills { display: flex; flex-wrap: wrap; }

.index-nav-btn {
  border-radius: 8px;
  padding: 6px 12px;
  border: 1px solid #e2e8f0;
}
.index-nav-btn--active-boom  { background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); color: #166534; }
.index-nav-btn--active-crash { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); color: #991b1b; }
.index-nav-btn--inactive      { background: white; }

.info-card  { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; }
.metric-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
.level-row  { border: 1px solid #e2e8f0; }

/* ── KPIs de historial ── */
.kpi-card {
  border-radius: 12px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  text-align: center;
}
.kpi-card--green  { background: #f0fdf4; border-color: #bbf7d0; }
.kpi-card--red    { background: #fff1f2; border-color: #fecdd3; }
.kpi-card--amber  { background: #fffbeb; border-color: #fde68a; }
.kpi-card--neutral{ background: #f8fafc; border-color: #e2e8f0; }

.kpi-value {
  font-size: 1.75rem;
  font-weight: 800;
  font-family: monospace;
  line-height: 1.1;
  color: #0f172a;
}
.kpi-label {
  font-size: 0.72rem;
  color: #64748b;
  font-weight: 600;
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ── Tabla ── */
.hist-table { font-size: 13px; }

.hist-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
}

.font-mono { font-family: monospace; }

.stats-section { border-radius: 16px; }
</style>
