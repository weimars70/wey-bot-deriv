<template>
  <q-page class="q-pa-lg comparison-page">
    <!-- Header Section -->
    <div class="page-header q-mb-lg row items-center justify-between">
      <div>
        <div class="row items-center q-gutter-sm">
          <q-icon name="compare_arrows" size="32px" color="primary" />
          <h1 class="text-h5 text-weight-bold text-slate-800 q-my-none">
            Comparador: Local vs BotOld
          </h1>
        </div>
        <div class="text-caption text-slate-500 q-mt-xs">
          Compara en tiempo real los cálculos locales (EMA, RSI, MACD, ATR, MTF) frente a las señales de BotOld.
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <span v-if="lastCalculated" class="text-caption text-slate-400">
          Último cálculo: {{ lastCalculatedTime }}
        </span>
        <q-btn
          unelevated
          color="primary"
          icon="refresh"
          label="Recalcular y Comparar"
          :loading="loading"
          @click="loadComparison"
        />
      </div>
    </div>

    <!-- Summary KPI Cards -->
    <div class="row q-col-gutter-md q-mb-lg">
      <div class="col-12 col-sm-6 col-md-3">
        <q-card flat class="stat-card">
          <div class="stat-icon bg-blue-1 text-blue-8">
            <q-icon name="memory" size="24px" />
          </div>
          <div>
            <div class="stat-value text-slate-800">{{ summary.total || 0 }}</div>
            <div class="stat-label">Símbolos Calculados</div>
          </div>
        </q-card>
      </div>

      <div class="col-12 col-sm-6 col-md-3">
        <q-card flat class="stat-card">
          <div class="stat-icon bg-purple-1 text-purple-8">
            <q-icon name="radar" size="24px" />
          </div>
          <div>
            <div class="stat-value text-purple-9">{{ summary.withApex || 0 }}</div>
            <div class="stat-label">Con Señal en BotOld</div>
          </div>
        </q-card>
      </div>

      <div class="col-12 col-sm-6 col-md-3">
        <q-card flat class="stat-card">
          <div class="stat-icon bg-green-1 text-green-8">
            <q-icon name="check_circle" size="24px" />
          </div>
          <div>
            <div class="stat-value text-green-9">{{ summary.directionMatches || 0 }}</div>
            <div class="stat-label">Dirección Coincidente</div>
          </div>
        </q-card>
      </div>

      <div class="col-12 col-sm-6 col-md-3">
        <q-card flat class="stat-card">
          <div class="stat-icon bg-amber-1 text-amber-9">
            <q-icon name="verified" size="24px" />
          </div>
          <div>
            <div class="stat-value text-amber-9">{{ summary.strongMatches || 0 }}</div>
            <div class="stat-label">Alta Coincidencia</div>
          </div>
        </q-card>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="row items-center justify-between q-mb-md filter-bar">
      <div class="row q-gutter-sm items-center">
        <q-btn-toggle
          v-model="filterType"
          toggle-color="primary"
          flat
          dense
          :options="[
            { label: 'Todos', value: 'all' },
            { label: 'Solo Crash', value: 'crash' },
            { label: 'Solo Boom', value: 'boom' },
            { label: 'Con BotOld Activo', value: 'has_apex' }
          ]"
        />
        <q-toggle
          v-model="onlyThreeStars"
          color="amber-8"
          dense
          label="Solo 3★ o más"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Mostrar solo señales locales con 3 o 4 estrellas de confluencia</q-tooltip>
        </q-toggle>
      </div>

      <div class="text-caption text-slate-500">
        Mostrando <b>{{ filteredRows.length }}</b> de {{ rows.length }} instrumentos ({{ onlyThreeStars ? '≥3★' : 'todos' }})
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && !rows.length" class="row q-col-gutter-md">
      <div v-for="i in 4" :key="i" class="col-12">
        <q-skeleton type="rect" height="120px" style="border-radius: 12px;" />
      </div>
    </div>

    <!-- Empty state for 3 stars -->
    <div
      v-else-if="!filteredRows.length"
      class="text-center q-pa-xl bg-white q-mb-md"
      style="border: 1px dashed #e2e8f0; border-radius: 12px;"
    >
      <q-icon name="stars" size="44px" color="amber-7" />
      <div class="text-subtitle1 text-weight-bold text-slate-800 q-mt-sm">
        Sin señales locales con 3 o más estrellas en este momento
      </div>
      <div class="text-caption text-slate-500 q-mt-xs">
        El motor local filtra automáticamente y solo muestra las señales con alta confluencia técnica (acumulación previa + RSI + MTF).
      </div>
      <q-btn
        v-if="onlyThreeStars"
        flat
        dense
        color="primary"
        label="Mostrar todos los índices sin filtrar estrellas"
        class="q-mt-md text-weight-bold"
        @click="onlyThreeStars = false"
      />
    </div>

    <!-- Comparison Table / Cards List -->
    <div v-else class="comparison-list">
      <q-card
        v-for="row in filteredRows"
        :key="row.symbol"
        flat
        class="comparison-card q-mb-md"
        :class="{
          'border-matched': row.match.directionMatch,
          'border-no-apex': !row.apex
        }"
      >
        <!-- Header row of the card -->
        <div class="card-header row items-center justify-between q-px-md q-py-sm">
          <div class="row items-center q-gutter-sm">
            <span class="symbol-badge">{{ row.symbol }}</span>
            <q-badge
              :color="isCrash(row.symbol) ? 'red-1' : 'emerald-1'"
              :text-color="isCrash(row.symbol) ? 'red-9' : 'green-9'"
              class="type-badge"
            >
              {{ isCrash(row.symbol) ? 'CRASH (VENTA)' : 'BOOM (COMPRA)' }}
            </q-badge>
          </div>

          <div class="row items-center q-gutter-xs">
            <template v-if="row.apex">
              <q-badge
                v-if="row.match.directionMatch"
                color="green-1"
                text-color="green-9"
                class="status-pill"
              >
                <q-icon name="check" size="14px" class="q-mr-xs" />
                Dirección coincide
              </q-badge>
              <q-badge
                v-else
                color="red-1"
                text-color="red-9"
                class="status-pill"
              >
                <q-icon name="close" size="14px" class="q-mr-xs" />
                Dirección difiere
              </q-badge>

              <q-badge
                v-if="row.match.entryDiffPct !== null"
                color="grey-2"
                text-color="grey-9"
                class="status-pill"
              >
                Dif. Entrada: {{ row.match.entryDiffPct }}%
              </q-badge>
            </template>
            <q-badge v-else color="grey-2" text-color="grey-7" class="status-pill">
              BotOld en espera de señal
            </q-badge>
          </div>
        </div>

        <!-- Body comparison: Local vs Apex -->
        <div class="card-body row q-col-gutter-none">
          <!-- Left Column: Motor Wey (Local) -->
          <div class="col-12 col-md-6 local-col q-pa-md">
            <div class="col-title row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <q-icon name="computer" size="18px" color="indigo-7" />
                <span class="text-weight-bold text-slate-800">Motor Wey (Local)</span>
                <span class="wey-mini-badge">WEY</span>
              </div>
              <div class="stars-row">
                <span
                  v-for="s in 4"
                  :key="s"
                  class="star-dot"
                  :class="{ active: s <= (row.wey?.estrellas || 0) }"
                >★</span>
              </div>
            </div>

            <div v-if="row.wey" class="metrics-grid">
              <div class="metric-item">
                <div class="m-label">Dirección</div>
                <div
                  class="m-value text-weight-bold"
                  :class="row.wey.direccion === 'COMPRA' ? 'text-green-7' : 'text-red-7'"
                >
                  {{ row.wey.direccion }}
                </div>
              </div>

              <div class="metric-item">
                <div class="m-label">Precio Entrada</div>
                <div class="m-value font-mono">{{ formatNum(row.wey.entrada) }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Stop Loss</div>
                <div class="m-value text-red-7 font-mono">{{ formatNum(row.wey.sl) }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Take Profit</div>
                <div class="m-value text-green-7 font-mono">{{ formatNum(row.wey.tp) }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Ratio R:B</div>
                <div class="m-value font-mono">1:{{ row.wey.rb }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Recorrido</div>
                <div class="m-value font-mono">{{ row.wey.recorrido }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">RSI (14)</div>
                <div class="m-value font-mono">{{ row.wey.rsi }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Alineación MTF</div>
                <div class="m-value text-weight-medium">
                  <span
                    :class="{
                      'text-green-7': row.wey.alignment === 'ALINEADO',
                      'text-amber-8': row.wey.alignment === 'PARCIAL',
                      'text-grey-6': row.wey.alignment !== 'ALINEADO' && row.wey.alignment !== 'PARCIAL'
                    }"
                  >
                    {{ row.wey.alignment }}
                  </span>
                </div>
              </div>
            </div>

            <div v-else class="text-caption text-grey-6 q-pa-sm bg-grey-1 rounded-borders">
              Esperando acumulación de velas locales (mínimo 30 velas).
            </div>

            <!-- Sesgo pill -->
            <div v-if="row.wey?.sesgo" class="sesgo-pill q-mt-sm"
              :class="{
                'sesgo--bull':  row.wey.sesgo.includes('ALCISTA'),
                'sesgo--bear':  row.wey.sesgo.includes('BAJISTA'),
                'sesgo--mixed': row.wey.sesgo.includes('MEZCLADO'),
              }"
            >
              {{ row.wey.sesgo }}
            </div>
          </div>

          <!-- Right Column: BotOld Referencia -->
          <div class="col-12 col-md-6 apex-col q-pa-md">
            <div class="col-title row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <q-icon name="cloud_sync" size="18px" color="orange-8" />
                <span class="text-weight-bold text-slate-800">BotOld (Referencia)</span>
                <q-badge v-if="row.apex?.fuente" color="orange-1" text-color="orange-9" class="q-ml-xs">
                  {{ row.apex.fuente }}
                </q-badge>
              </div>
              <div v-if="row.apex" class="stars-row">
                <span
                  v-for="s in 4"
                  :key="s"
                  class="star-dot"
                  :class="{ active: s <= (row.apex?.estrellas || 0) }"
                >★</span>
              </div>
            </div>

            <div v-if="row.apex" class="metrics-grid">
              <div class="metric-item">
                <div class="m-label">Dirección</div>
                <div
                  class="m-value text-weight-bold"
                  :class="row.apex.direccion === 'COMPRA' ? 'text-green-7' : 'text-red-7'"
                >
                  {{ row.apex.direccion }}
                </div>
              </div>

              <div class="metric-item">
                <div class="m-label">Precio Entrada</div>
                <div class="m-value font-mono">{{ formatNum(row.apex.entrada) }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Stop Loss</div>
                <div class="m-value text-red-7 font-mono">{{ formatNum(row.apex.sl) }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Take Profit</div>
                <div class="m-value text-green-7 font-mono">{{ formatNum(row.apex.tp) }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Ratio R:B</div>
                <div class="m-value font-mono">1:{{ row.apex.rb }}</div>
              </div>

              <div class="metric-item">
                <div class="m-label">Recorrido</div>
                <div class="m-value font-mono">{{ row.apex.recorrido }}</div>
              </div>

              <div class="metric-item col-span-2">
                <div class="m-label">Sesgo / Especialista</div>
                <div class="m-value text-caption text-slate-600">
                  {{ row.apex.sesgo || 'N/A' }}
                </div>
              </div>
            </div>

            <div v-else class="empty-apex text-center q-pa-md">
              <q-icon name="hourglass_empty" size="24px" color="grey-4" />
              <div class="text-caption text-grey-6 q-mt-xs">
                Sin señal activa de BotOld para este índice en este momento.
              </div>
            </div>
          </div>
        </div>
      </q-card>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { weySignalsService } from 'src/services/weySignals.service';

const loading = ref(false);
const rows = ref([]);
const summary = ref({
  total: 0,
  withApex: 0,
  directionMatches: 0,
  strongMatches: 0,
});
const lastCalculated = ref(null);
const filterType = ref('all');
const onlyThreeStars = ref(true);
let autoTimer = null;

const lastCalculatedTime = computed(() => {
  if (!lastCalculated.value) return '';
  return new Date(lastCalculated.value).toLocaleTimeString();
});

const filteredRows = computed(() => {
  return rows.value.filter((r) => {
    // Filtro por 3 o más estrellas en Wey local
    if (onlyThreeStars.value && (r.wey?.estrellas ?? 0) < 3) return false;

    if (filterType.value === 'crash') return isCrash(r.symbol);
    if (filterType.value === 'boom') return !isCrash(r.symbol);
    if (filterType.value === 'has_apex') return !!r.apex;
    return true;
  });
});

function isCrash(symbol) {
  return symbol.toUpperCase().includes('CRASH');
}

function formatNum(val) {
  if (val == null || isNaN(val)) return '—';
  return Number(val).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

async function loadComparison() {
  loading.value = true;
  try {
    const res = await weySignalsService.getComparison();
    if (res && res.rows) {
      rows.value = res.rows;
      summary.value = res.summary || {};
      lastCalculated.value = res.summary?.computedAt || new Date().toISOString();
    }
  } catch (err) {
    console.error('Error al cargar comparador Wey vs Apex:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadComparison();
  // Auto refresh cada 30 segundos
  autoTimer = setInterval(loadComparison, 30000);
});

onUnmounted(() => {
  if (autoTimer) clearInterval(autoTimer);
});
</script>

<style scoped>
.comparison-page {
  background-color: #f8fafc;
  min-height: 100vh;
}

.text-slate-800 { color: #1e293b; }
.text-slate-600 { color: #475569; }
.text-slate-500 { color: #64748b; }
.text-slate-400 { color: #94a3b8; }

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px 20px;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}

.stat-label {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}

.comparison-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.comparison-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}

.card-header {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.symbol-badge {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.type-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
}

.status-pill {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 500;
}

.local-col {
  border-right: 1px solid #f1f5f9;
}

@media (max-width: 1023px) {
  .local-col {
    border-right: none;
    border-bottom: 1px solid #f1f5f9;
  }
}

.col-title {
  font-size: 13px;
}

.stars-row {
  display: flex;
  gap: 2px;
}

.star-dot {
  color: #cbd5e1;
  font-size: 14px;
}

.star-dot.active {
  color: #f59e0b;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 600px) {
  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.metric-item {
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 8px 10px;
}

.m-label {
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}

.m-value {
  font-size: 13px;
  color: #1e293b;
}

.col-span-2 {
  grid-column: span 2;
}

.mtf-bar {
  border-top: 1px dashed #e2e8f0;
  padding-top: 8px;
}

.mtf-pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.tf-buy {
  background: #dcfce7;
  color: #15803d;
}

.tf-sell {
  background: #fee2e2;
  color: #b91c1c;
}

.tf-neutral {
  background: #f1f5f9;
  color: #64748b;
}

.empty-apex {
  background: #fafafa;
  border-radius: 8px;
  border: 1px dashed #e2e8f0;
}

.wey-mini-badge {
  font-size: 9px;
  font-weight: 800;
  background: #e0e7ff;
  color: #4338ca;
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.sesgo-pill {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 5px;
  display: inline-block;
}

.sesgo--bull  { color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; }
.sesgo--bear  { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; }
.sesgo--mixed { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; }
</style>
