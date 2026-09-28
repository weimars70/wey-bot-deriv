<template>
  <q-page class="q-pa-lg m5plus-page">

    <!-- ── CABECERA ───────────────────────────────────────────────────────── -->
    <div class="row items-center justify-between q-mb-lg flex-wrap q-gutter-y-sm">
      <div class="row items-center q-gutter-sm">
        <div class="header-icon">
          <q-icon name="show_chart" size="26px" color="white" />
        </div>
        <div>
          <h1 class="text-h5 text-weight-bolder text-slate-900 q-my-none">
            Estrategia M5+
          </h1>
          <div class="text-caption text-slate-500 q-mt-xs">
            <b>CRASH SELL:</b> doji/pin bar (cuerpo pequeño + mechas largas) seguido de vela <b>alcista</b> grande → spike bajista.
            &nbsp;|&nbsp;
            <b>BOOM BUY:</b> doji/pin bar seguido de vela <b>bajista</b> grande → spike alcista.
          </div>
        </div>
      </div>
    </div>

    <!-- ── TABS PRINCIPALES ───────────────────────────────────────────────── -->
    <q-tabs
      v-model="mainTab"
      dense
      align="left"
      active-color="cyan-8"
      indicator-color="cyan-7"
      class="q-mb-lg tabs-bar"
    >
      <q-tab name="backtest-all"  icon="analytics"      label="Backtest todos los índices" />
      <q-tab name="backtest-one"  icon="manage_search"  label="Backtest por índice" />
      <q-tab name="live"          icon="sensors"         label="Señal en vivo" />
    </q-tabs>

    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <!-- TAB 1 — BACKTEST TODOS LOS ÍNDICES                                   -->
    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <q-tab-panels v-model="mainTab" animated keep-alive>
      <q-tab-panel name="backtest-all" class="q-pa-none">

        <!-- Controles -->
        <div class="row items-center q-gutter-md q-mb-lg flex-wrap">
          <div class="row items-center q-gutter-sm">
            <span class="text-caption text-weight-bold text-slate-700">Días a analizar:</span>
            <q-btn-toggle
              v-model="allDays"
              flat dense toggle-color="cyan-7"
              :options="[{label:'7d',value:7},{label:'14d',value:14},{label:'30d',value:30},{label:'60d',value:60}]"
              class="border-slate rounded-borders"
            />
          </div>
          <q-btn
            unelevated color="cyan-8" icon="play_arrow"
            label="Ejecutar backtesting"
            :loading="allLoading"
            @click="runBacktestAll"
          />
        </div>

        <!-- KPIs globales -->
        <div v-if="allResult" class="row q-col-gutter-md q-mb-lg">
          <div class="col-6 col-sm-4 col-md-3">
            <div class="kpi-card kpi-card--neutral">
              <div class="kpi-val">{{ allResult.totals.totalPatterns }}</div>
              <div class="kpi-lbl">Total patrones</div>
            </div>
          </div>
          <div class="col-6 col-sm-4 col-md-3">
            <div class="kpi-card kpi-card--green">
              <div class="kpi-val text-green-8">{{ allResult.totals.withSpike }}</div>
              <div class="kpi-lbl">Con spike ✓</div>
            </div>
          </div>
          <div class="col-6 col-sm-4 col-md-3">
            <div class="kpi-card"
              :class="allResult.totals.spikeRatePct>=60?'kpi-card--green':allResult.totals.spikeRatePct>=40?'kpi-card--amber':'kpi-card--red'">
              <div class="kpi-val"
                :class="allResult.totals.spikeRatePct>=60?'text-green-8':allResult.totals.spikeRatePct>=40?'text-amber-8':'text-red-8'">
                {{ allResult.totals.spikeRatePct }}%
              </div>
              <div class="kpi-lbl">Efectividad global</div>
            </div>
          </div>
          <div class="col-6 col-sm-4 col-md-3">
            <div class="kpi-card kpi-card--neutral">
              <div class="kpi-val text-cyan-8">{{ allDays }}d</div>
              <div class="kpi-lbl">Período analizado</div>
            </div>
          </div>
        </div>

        <!-- Skeleton -->
        <div v-if="allLoading" class="q-gutter-y-sm">
          <q-skeleton v-for="n in 8" :key="n" type="rect" height="52px" />
        </div>

        <!-- Tabla resumen por índice -->
        <q-table
          v-else-if="allResult"
          :rows="allResult.symbols"
          :columns="allColumns"
          row-key="symbol"
          flat bordered dense
          :rows-per-page-options="[0]"
          hide-bottom
          class="all-table"
        >
          <template #body="props">
            <q-tr :props="props" :class="props.row.spikeRatePct >= 60 ? 'row-hot' : props.row.spikeRatePct >= 40 ? 'row-warm' : ''">
              <!-- Símbolo -->
              <q-td key="mercado" :props="props">
                <div class="row items-center q-gutter-xs">
                  <q-badge
                    :color="props.row.direction === 'SELL' ? 'red-6' : 'green-6'"
                    :label="props.row.direction"
                    class="text-weight-bolder"
                  />
                  <span class="text-weight-bolder">{{ props.row.mercado }}</span>
                </div>
              </q-td>
              <!-- Total patrones -->
              <q-td key="totalPatterns" :props="props" class="text-center font-mono">
                {{ props.row.totalPatterns }}
              </q-td>
              <!-- Con spike -->
              <q-td key="withSpike" :props="props" class="text-center font-mono text-green-8 text-weight-bold">
                {{ props.row.withSpike }}
              </q-td>
              <!-- Sin spike -->
              <q-td key="withoutSpike" :props="props" class="text-center font-mono text-red-7">
                {{ props.row.totalPatterns - props.row.withSpike }}
              </q-td>
              <!-- Efectividad -->
              <q-td key="spikeRatePct" :props="props" class="text-center">
                <q-badge
                  :color="props.row.spikeRatePct>=60?'green-7':props.row.spikeRatePct>=40?'amber-7':'red-6'"
                  :label="`${props.row.spikeRatePct}%`"
                  class="text-weight-bolder pct-badge"
                />
              </q-td>
              <!-- Pts promedio -->
              <q-td key="avgSpikePoints" :props="props" class="text-right font-mono text-cyan-8 text-weight-bold">
                {{ props.row.avgSpikePoints > 0 ? `+${props.row.avgSpikePoints}` : '—' }}
              </q-td>
              <!-- Acción -->
              <q-td key="action" :props="props" class="text-center">
                <q-btn
                  flat dense size="sm" icon="manage_search" color="cyan-7"
                  label="Detalle"
                  @click="goToDetail(props.row.symbol)"
                >
                  <q-tooltip>Ver detalle de patrones para {{ props.row.mercado }}</q-tooltip>
                </q-btn>
              </q-td>
            </q-tr>
          </template>
        </q-table>

        <div v-else class="text-center text-slate-400 q-pa-xl">
          <q-icon name="analytics" size="40px" class="q-mb-sm" />
          <div class="text-subtitle2">Presiona "Ejecutar backtesting" para analizar todos los índices.</div>
          <div class="text-caption q-mt-xs">Se analizarán 8 símbolos en paralelo usando velas M5 históricas.</div>
        </div>

      </q-tab-panel>

      <!-- ════════════════════════════════════════════════════════════════════ -->
      <!-- TAB 2 — BACKTEST UN ÍNDICE                                          -->
      <!-- ════════════════════════════════════════════════════════════════════ -->
      <q-tab-panel name="backtest-one" class="q-pa-none">

        <!-- Controles -->
        <div class="row items-center q-gutter-md q-mb-lg flex-wrap">
          <!-- Selector familia -->
          <q-btn-toggle
            v-model="oneFamily"
            flat dense toggle-color="cyan-7"
            :options="[{label:'🔴 CRASH',value:'CRASH'},{label:'🟢 BOOM',value:'BOOM'}]"
            class="border-slate rounded-borders"
            @update:model-value="onFamilyChange"
          />
          <!-- Selector símbolo -->
          <div class="row q-gutter-xs">
            <q-btn
              v-for="sym in activeFamilySymbols"
              :key="sym.symbol"
              :flat="oneSymbol !== sym.symbol"
              :unelevated="oneSymbol === sym.symbol"
              :color="oneSymbol === sym.symbol ? 'cyan-7' : 'grey-3'"
              :text-color="oneSymbol === sym.symbol ? 'white' : 'grey-8'"
              dense size="sm"
              :label="sym.name"
              class="sym-btn"
              @click="oneSymbol = sym.symbol"
            />
          </div>
          <!-- Días -->
          <q-btn-toggle
            v-model="oneDays"
            flat dense toggle-color="cyan-7"
            :options="[{label:'7d',value:7},{label:'14d',value:14},{label:'30d',value:30},{label:'60d',value:60}]"
            class="border-slate rounded-borders"
          />
          <q-btn
            unelevated color="cyan-8" icon="play_arrow"
            label="Ejecutar"
            :loading="oneLoading"
            @click="runBacktestOne"
          />
        </div>

        <!-- KPIs del símbolo -->
        <div v-if="oneResult" class="row q-col-gutter-md q-mb-lg">
          <div class="col-6 col-sm-3">
            <div class="kpi-card kpi-card--neutral">
              <div class="kpi-val">{{ oneResult.totalPatterns }}</div>
              <div class="kpi-lbl">Patrones encontrados</div>
            </div>
          </div>
          <div class="col-6 col-sm-3">
            <div class="kpi-card kpi-card--green">
              <div class="kpi-val text-green-8">{{ oneResult.withSpike }}</div>
              <div class="kpi-lbl">Con spike ✓</div>
            </div>
          </div>
          <div class="col-6 col-sm-3">
            <div class="kpi-card kpi-card--red">
              <div class="kpi-val text-red-8">{{ oneResult.withoutSpike }}</div>
              <div class="kpi-lbl">Sin spike ✗</div>
            </div>
          </div>
          <div class="col-6 col-sm-3">
            <div class="kpi-card"
              :class="oneResult.spikeRatePct>=60?'kpi-card--green':oneResult.spikeRatePct>=40?'kpi-card--amber':'kpi-card--red'">
              <div class="kpi-val"
                :class="oneResult.spikeRatePct>=60?'text-green-8':oneResult.spikeRatePct>=40?'text-amber-8':'text-red-8'">
                {{ oneResult.spikeRatePct }}%
              </div>
              <div class="kpi-lbl">Efectividad</div>
            </div>
          </div>
          <div class="col-6 col-sm-3">
            <div class="kpi-card kpi-card--neutral">
              <div class="kpi-val text-cyan-8">{{ oneResult.avgSpikePoints > 0 ? `+${oneResult.avgSpikePoints}` : '—' }}</div>
              <div class="kpi-lbl">Pts promedio spike</div>
            </div>
          </div>
          <div class="col-6 col-sm-3">
            <div class="kpi-card kpi-card--neutral">
              <div class="kpi-val text-slate-700">{{ oneResult.avgDelayCandles > 0 ? `${oneResult.avgDelayCandles} velas` : '—' }}</div>
              <div class="kpi-lbl">Demora media</div>
            </div>
          </div>
        </div>

        <!-- Skeleton -->
        <div v-if="oneLoading" class="q-gutter-y-sm">
          <q-skeleton v-for="n in 8" :key="n" type="rect" height="40px" />
        </div>

        <!-- Tabla detallada -->
        <q-table
          v-else-if="oneResult && oneResult.patterns.length > 0"
          :rows="oneResult.patterns"
          :columns="oneColumns"
          row-key="id"
          flat bordered dense
          :rows-per-page-options="[20, 50, 100, 0]"
          rows-per-page-label="Filas"
          class="one-table"
        >
          <!-- Resultado -->
          <template #body-cell-result="props">
            <q-td :props="props" class="text-center">
              <q-badge
                :color="props.row.spikeFollowed ? 'green-7' : 'red-6'"
                :label="props.row.spikeFollowed ? '✓ SPIKE' : '✗ NO SPIKE'"
                class="text-weight-bolder result-badge"
              />
            </q-td>
          </template>
          <!-- Puntos spike -->
          <template #body-cell-spikePoints="props">
            <q-td :props="props" class="text-right font-mono">
              <span v-if="props.row.spikePoints > 0" class="text-green-8 text-weight-bold">
                +{{ props.row.spikePoints }} pts
              </span>
              <span v-else class="text-grey-4">—</span>
            </q-td>
          </template>
          <!-- Demora -->
          <template #body-cell-spikeDelayCandles="props">
            <q-td :props="props" class="text-center font-mono">
              <span v-if="props.row.spikeDelayCandles > 0" class="text-cyan-7">
                {{ props.row.spikeDelayCandles }} × M5
              </span>
              <span v-else class="text-grey-4">—</span>
            </q-td>
          </template>
        </q-table>

        <div v-else-if="!oneLoading && oneResult && oneResult.patterns.length === 0"
          class="text-center text-slate-400 q-pa-xl">
          <q-icon name="search_off" size="36px" class="q-mb-sm" />
          <div>No se detectaron patrones M5+ en los últimos {{ oneDays }} días para {{ oneSymbol }}.</div>
        </div>

        <div v-else-if="!oneLoading && !oneResult" class="text-center text-slate-400 q-pa-xl">
          <q-icon name="manage_search" size="40px" class="q-mb-sm" />
          <div class="text-subtitle2">Selecciona un índice y presiona "Ejecutar".</div>
        </div>

      </q-tab-panel>

      <!-- ════════════════════════════════════════════════════════════════════ -->
      <!-- TAB 3 — SEÑAL EN VIVO                                               -->
      <!-- ════════════════════════════════════════════════════════════════════ -->
      <q-tab-panel name="live" class="q-pa-none">

        <!-- ── Panel M5++ Auto-Trading ─────────────────────────────────────── -->
        <div class="autotrading-panel q-pa-lg q-mb-lg rounded-borders border-slate">
          <div class="row items-center justify-between flex-wrap q-gutter-y-sm q-mb-md">
            <div class="row items-center q-gutter-sm">
              <q-icon name="bolt" color="cyan-7" size="22px" />
              <span class="text-subtitle1 text-weight-bolder text-slate-900">M5++ Auto-Trading</span>
              <q-badge
                :color="botConfig.m5PlusAutoEnabled ? 'green-7' : 'grey-5'"
                :label="botConfig.m5PlusAutoEnabled ? '● ACTIVO' : '○ INACTIVO'"
                class="text-weight-bolder"
              />
            </div>
            <div class="row items-center q-gutter-sm">
              <q-btn
                :loading="configLoading"
                :color="botConfig.m5PlusAutoEnabled ? 'red-6' : 'green-7'"
                :icon="botConfig.m5PlusAutoEnabled ? 'stop' : 'play_arrow'"
                :label="botConfig.m5PlusAutoEnabled ? 'Desactivar M5++' : 'Activar M5++'"
                unelevated
                @click="toggleM5PlusAuto"
              />
              <q-btn flat dense icon="refresh" color="grey-6" @click="loadBotConfig">
                <q-tooltip>Recargar estado del bot</q-tooltip>
              </q-btn>
            </div>
          </div>

          <div class="row q-col-gutter-md">
            <div class="col-12 col-sm-6">
              <div class="text-caption text-slate-600 q-mb-xs text-weight-bold">¿Qué hace?</div>
              <div class="text-caption text-slate-500">
                Cuando está activo, el bot evalúa el patrón M5+ cada 2.5 segundos en todos los índices.
                Al detectar <b>compresión + ruptura confirmada</b>, abre automáticamente una orden en MT5
                y emite la alerta sonora.
              </div>
            </div>
            <div class="col-12 col-sm-6">
              <div class="text-caption text-slate-600 q-mb-xs text-weight-bold">Reglas de seguridad</div>
              <ul class="text-caption text-slate-500 q-pl-md q-ma-none">
                <li>Máximo 3 trades M5++ abiertos simultáneamente</li>
                <li>Cooldown de 3 min por símbolo tras cada entrada</li>
                <li>SL monetario automático calculado por el bot</li>
                <li>Solo CRASH SELL · solo BOOM BUY</li>
              </ul>
            </div>
          </div>

          <!-- Trades activos M5++ -->
          <div v-if="botConfig.m5PlusAutoEnabled" class="q-mt-md">
            <div class="text-caption text-slate-500 font-mono">
              Trades activos totales: <b class="text-cyan-8">{{ botConfig.activeCount ?? '—' }}</b>
            </div>
          </div>
        </div>

        <!-- ── Señal en vivo ─────────────────────────────────────────────── -->
        <div class="row items-center q-gutter-sm q-mb-lg">
          <q-btn unelevated color="cyan-8" icon="refresh" label="Actualizar" :loading="liveLoading" @click="loadLiveAll" />
          <span class="text-caption text-slate-400">Última actualización: {{ liveUpdatedAt || '—' }}</span>
        </div>

        <div v-if="liveLoading" class="q-gutter-y-sm">
          <q-skeleton v-for="n in 8" :key="n" type="rect" height="56px" />
        </div>

        <div v-else-if="liveData.length > 0" class="q-gutter-md">
          <div
            v-for="item in liveData"
            :key="item.symbol"
            class="live-card q-pa-md rounded-borders border-slate"
            :class="item.patternDetected ? (item.direction === 'SELL' ? 'live-card--crash' : 'live-card--boom') : 'live-card--idle'"
          >
            <div class="row items-center justify-between flex-wrap q-gutter-y-xs">
              <div class="row items-center q-gutter-sm">
                <q-badge
                  :color="item.direction === 'SELL' ? 'red-6' : 'green-6'"
                  :label="item.direction === 'SELL' ? 'CRASH SELL' : 'BOOM BUY'"
                  class="text-weight-bolder"
                />
                <span class="text-subtitle2 text-weight-bolder text-slate-900">{{ item.mercado }}</span>
              </div>
              <q-badge
                :color="item.patternDetected ? 'cyan-7' : 'grey-4'"
                :text-color="item.patternDetected ? 'white' : 'grey-7'"
                :label="item.patternDetected ? '🎯 PATRÓN M5+ ACTIVO' : 'Sin patrón'"
                class="text-weight-bolder"
              />
            </div>
            <div class="text-caption text-slate-600 q-mt-xs">{{ item.reason }}</div>
            <div v-if="item.patternDetected" class="row q-gutter-md q-mt-sm">
              <div>
                <span class="text-caption text-slate-500">Entrada: </span>
                <span class="font-mono text-weight-bolder text-slate-900">{{ item.entryPrice.toFixed(3) }}</span>
              </div>
              <div>
                <span class="text-caption text-slate-500">Stop Loss: </span>
                <span class="font-mono text-weight-bolder text-red-8">{{ item.stopLossPrice.toFixed(3) }}</span>
              </div>
              <div>
                <span class="text-caption text-slate-500">Doji cuerpo: </span>
                <span class="font-mono text-weight-bolder text-cyan-8">{{ item.dojiBody }} pts</span>
              </div>
              <div>
                <span class="text-caption text-slate-500">Mecha doji: </span>
                <span class="font-mono text-weight-bolder text-cyan-8">{{ item.dojiWickRatio }}%</span>
              </div>
              <div>
                <span class="text-caption text-slate-500">Vela señal: </span>
                <span class="font-mono text-weight-bolder text-amber-8">{{ item.signalBody }} pts</span>
              </div>
            </div>
          </div>
        </div>

      </q-tab-panel>
    </q-tab-panels>

  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from 'boot/axios';

// ── Estado ────────────────────────────────────────────────────────────────────
const mainTab   = ref('backtest-all');

// Backtest todos
const allDays   = ref(14);
const allLoading = ref(false);
const allResult  = ref(null);

// Backtest uno
const oneFamily  = ref('CRASH');
const oneSymbol  = ref('CRASH600');
const oneDays    = ref(14);
const oneLoading = ref(false);
const oneResult  = ref(null);

// Vivo
const liveLoading   = ref(false);
const liveData      = ref([]);
const liveUpdatedAt = ref('');

// Auto-trading M5++
const configLoading = ref(false);
const botConfig     = ref({
  m5PlusAutoEnabled: false,
  activeCount: 0,
});

// ── Listas de símbolos ────────────────────────────────────────────────────────
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
const activeFamilySymbols = computed(() =>
  oneFamily.value === 'CRASH' ? crashSymbols : boomSymbols,
);

function onFamilyChange() {
  oneSymbol.value = activeFamilySymbols.value[0].symbol;
}

// ── Columnas tabla "todos" ────────────────────────────────────────────────────
const allColumns = [
  { name: 'mercado',        label: 'Índice',            field: 'mercado',        align: 'left'   },
  { name: 'totalPatterns',  label: 'Patrones',          field: 'totalPatterns',  align: 'center', sortable: true },
  { name: 'withSpike',      label: 'Con spike ✓',       field: 'withSpike',      align: 'center', sortable: true },
  { name: 'withoutSpike',   label: 'Sin spike ✗',       field: 'withoutSpike',   align: 'center' },
  { name: 'spikeRatePct',   label: 'Efectividad',       field: 'spikeRatePct',   align: 'center', sortable: true },
  { name: 'avgSpikePoints', label: 'Pts prom. spike',   field: 'avgSpikePoints', align: 'right',  sortable: true },
  { name: 'action',         label: '',                  field: 'action',         align: 'center' },
];

// ── Columnas tabla detalle ────────────────────────────────────────────────────
const oneColumns = [
  { name: 'dateStr',          label: 'Fecha / hora',     field: 'dateStr',          align: 'left'   },
  { name: 'dojiBody',         label: 'Doji (pts)',        field: 'dojiBody',         align: 'right', format: (v) => `${v} pts` },
  { name: 'dojiWickRatio',    label: 'Mecha doji (%)',    field: 'dojiWickRatio',    align: 'right', format: (v) => `${v}%` },
  { name: 'signalBody',       label: 'Vela señal (pts)',  field: 'signalBody',       align: 'right', format: (v) => `${v} pts` },
  { name: 'entryPrice',       label: 'Entrada',           field: 'entryPrice',       align: 'right', format: (v) => Number(v).toFixed(3) },
  { name: 'stopLossPrice',    label: 'Stop Loss',         field: 'stopLossPrice',    align: 'right', format: (v) => Number(v).toFixed(3) },
  { name: 'result',           label: 'Resultado',         field: 'result',           align: 'center', sortable: true },
  { name: 'spikePoints',      label: 'Magnitud spike',    field: 'spikePoints',      align: 'right',  sortable: true },
  { name: 'spikeDelayCandles', label: 'Demora (M5)',      field: 'spikeDelayCandles', align: 'center' },
];

// ── API calls ────────────────────────────────────────────────────────────────
async function runBacktestAll() {
  allLoading.value = true;
  allResult.value  = null;
  try {
    const { data } = await api.post('/strategies/m5plus/backtest-all', { days: allDays.value });
    allResult.value = data;
  } finally {
    allLoading.value = false;
  }
}

async function runBacktestOne() {
  oneLoading.value = true;
  oneResult.value  = null;
  try {
    const { data } = await api.post('/strategies/m5plus/backtest', {
      symbol: oneSymbol.value,
      days: oneDays.value,
    });
    oneResult.value = data;
  } finally {
    oneLoading.value = false;
  }
}

async function loadLiveAll() {
  liveLoading.value = true;
  try {
    const { data } = await api.get('/strategies/m5plus/live-all');
    liveData.value = Array.isArray(data) ? data : [];
    liveUpdatedAt.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } finally {
    liveLoading.value = false;
  }
}

// Navegar desde tabla "todos" al detalle del índice
function goToDetail(symbol) {
  const isBoom = symbol.startsWith('BOOM');
  oneFamily.value = isBoom ? 'BOOM' : 'CRASH';
  oneSymbol.value = symbol;
  mainTab.value   = 'backtest-one';
  runBacktestOne();
}

// ── Auto-trading M5++ ─────────────────────────────────────────────────────────
async function loadBotConfig() {
  try {
    const { data } = await api.get('/trading/config');
    botConfig.value = {
      m5PlusAutoEnabled: data.m5PlusAutoEnabled ?? false,
      activeCount: data.activeCount ?? 0,
    };
  } catch (e) {}
}

async function toggleM5PlusAuto() {
  configLoading.value = true;
  try {
    const { data } = await api.post('/trading/toggle', {
      strategy: 'm5Plus',
      enabled: !botConfig.value.m5PlusAutoEnabled,
    });
    botConfig.value = {
      m5PlusAutoEnabled: data.m5PlusAutoEnabled ?? false,
      activeCount: data.activeCount ?? 0,
    };
  } catch (e) {
    console.error('Error toggling M5++ auto-trading:', e);
  } finally {
    configLoading.value = false;
  }
}

onMounted(() => {
  loadLiveAll();
  loadBotConfig();
});
</script>

<style scoped>
.m5plus-page {
  background: #f8fafc;
  min-height: 100vh;
}

.header-icon {
  width: 46px; height: 46px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
  box-shadow: 0 8px 18px rgba(15,23,42,.12);
}

.tabs-bar {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 0 8px;
}

.border-slate { border: 1px solid #e2e8f0; }
.font-mono    { font-family: monospace; }

/* ── KPIs ── */
.kpi-card {
  border-radius: 12px; padding: 14px 16px;
  border: 1px solid #e2e8f0; background: #f8fafc; text-align: center;
}
.kpi-card--green  { background: #f0fdf4; border-color: #bbf7d0; }
.kpi-card--red    { background: #fff1f2; border-color: #fecdd3; }
.kpi-card--amber  { background: #fffbeb; border-color: #fde68a; }
.kpi-card--neutral{ background: #f8fafc; border-color: #e2e8f0; }
.kpi-val {
  font-size: 1.75rem; font-weight: 800; font-family: monospace;
  line-height: 1.1; color: #0f172a;
}
.kpi-lbl {
  font-size: .72rem; color: #64748b; font-weight: 600;
  margin-top: 4px; text-transform: uppercase; letter-spacing: .04em;
}

/* ── Tablas ── */
.all-table, .one-table { font-size: 13px; }
.pct-badge, .result-badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; }

/* Filas destacadas backtest todos */
.row-hot  { background: #f0fdf4 !important; }
.row-warm { background: #fffbeb !important; }

/* ── Selector símbolo ── */
.sym-btn { border-radius: 8px; border: 1px solid #e2e8f0; }

/* ── Tarjetas live ── */
.live-card {
  background: white;
  border-radius: 14px;
  transition: box-shadow .2s;
}
.live-card--crash { border-left: 4px solid #ef4444 !important; background: #fff5f5; }
.live-card--boom  { border-left: 4px solid #22c55e !important; background: #f0fdf4; }
.live-card--idle  { border-left: 4px solid #e2e8f0 !important; }
.live-card:hover  { box-shadow: 0 4px 16px rgba(15,23,42,.1); }

.autotrading-panel {
  background: linear-gradient(135deg, #ecfeff 0%, #f0f9ff 100%);
  border-color: #a5f3fc !important;
  border-radius: 16px;
}
</style>
