<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="900px" full-width-sm>
    <q-card class="bg-slate-950 text-white border-slate shadow-24" style="width: 860px; max-width: 95vw;">
      <!-- Header del Modal -->
      <q-card-section class="row items-center justify-between bg-slate-900 border-b-slate q-py-sm">
        <div class="row items-center q-gutter-sm">
          <q-icon name="candlestick_chart" color="amber-4" size="24px" />
          <div>
            <div class="text-subtitle1 text-weight-bolder">Inspector de Velas &amp; Patrón Previo al Spike</div>
            <div class="text-caption text-slate-400">Trade: {{ trade?.id }} · {{ trade?.entryDateStr }}</div>
          </div>
        </div>
        <q-btn flat round dense icon="close" v-close-popup color="slate-4" />
      </q-card-section>

      <q-card-section class="q-pa-md">
        <!-- 1. Tarjeta de Diagnóstico del Patrón Identificado -->
        <div class="row q-col-gutter-sm q-mb-md">
          <div class="col-12 col-md-8">
            <q-card class="bg-slate-900 border-slate q-pa-sm">
              <div class="text-caption text-slate-400 text-weight-bold q-mb-xs">PATRÓN DETECTADO POR LA IA</div>
              <div class="row items-center q-gutter-sm">
                <q-badge
                  :color="trade?.result === 'WIN' ? 'positive' : 'negative'"
                  class="text-weight-bolder text-body2 q-py-xs q-px-sm"
                >
                  {{ trade?.result === 'WIN' ? '✅ TRADE GANADOR' : '❌ STOP LOSS' }}
                </q-badge>
                <span class="text-body2 text-weight-bolder text-amber-3">{{ trade?.patternDetected || 'Retroceso Zona V 50%' }}</span>
              </div>
              <div class="text-caption text-slate-300 q-mt-xs">
                <span v-if="trade?.hasTwoWicks" class="text-emerald-4 text-weight-bold">
                  ✓ Cumple patrón de 2 velas con mecha superior previa (rechazo y absorción).
                </span>
                <span v-else class="text-slate-400">
                  Sin patrón estricto de 2 mechas; detonado por confluencia de retroceso 50% y EMA 50.
                </span>
                <span v-if="trade?.hasRetestPattern" class="text-amber-4 text-weight-bold q-ml-sm">
                  ✓ Nivel retesteado con {{ trade?.retestSpikesCount }} caídas anteriores.
                </span>
              </div>
            </q-card>
          </div>

          <div class="col-12 col-md-4">
            <q-card class="bg-slate-900 border-slate q-pa-sm text-center">
              <div class="text-caption text-slate-400 text-weight-bold">RESULTADO NETO</div>
              <div class="text-h6 text-weight-bolder font-mono" :class="trade?.pnlUsd >= 0 ? 'text-emerald-4' : 'text-rose-4'">
                {{ trade?.pnlUsd >= 0 ? '+' : '' }}${{ trade?.pnlUsd?.toFixed(2) }} USD
              </div>
              <div class="text-caption text-slate-400 font-mono">
                {{ trade?.pnlPoints >= 0 ? '+' : '' }}{{ trade?.pnlPoints }} pts en {{ trade?.durationMin }} min
              </div>
            </q-card>
          </div>
        </div>

        <!-- 2. Gráfico Visual de las Velas alrededor del Trade -->
        <div class="chart-box bg-slate-900 rounded-borders border-slate overflow-hidden q-mb-md">
          <div class="row items-center justify-between q-px-sm q-py-xs bg-slate-800 text-caption text-slate-300 border-b-slate">
            <span class="text-weight-bold">Secuencia de Velas M5 (6 previas $\rightarrow$ Entrada $\rightarrow$ Salida)</span>
            <span class="text-slate-400 font-mono">{{ snippetCandles.length }} velas mostradas</span>
          </div>
          <div ref="snippetChartContainer" style="height: 240px; width: 100%;"></div>
        </div>

        <!-- 3. Tabla Desglosada Vela por Vela con Análisis de Mechas -->
        <div class="text-subtitle2 text-weight-bold text-slate-200 q-mb-xs">
          Análisis Anatómico de las Velas (Apertura, Cierre y Mechas de Rechazo)
        </div>
        <q-markup-table dark flat dense bordered class="bg-slate-900 font-mono text-caption">
          <thead>
            <tr class="text-slate-400 text-left">
              <th>Momento</th>
              <th>Hora</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Close</th>
              <th>Mecha Superior</th>
              <th>Cuerpo</th>
              <th>Diagnóstico</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(c, idx) in enrichedSnippetCandles"
              :key="c.time"
              :class="{
                'bg-amber-10 text-white text-weight-bold': c.isEntryCandle,
                'bg-purple-10 text-white text-weight-bold': c.isSpike,
              }"
            >
              <td>
                <q-badge v-if="c.isEntryCandle" color="amber-8" text-color="black" label="ENTRADA" />
                <q-badge v-else-if="c.isSpike" color="purple-7" label="SPIKE 💥" />
                <span v-else class="text-slate-400">Vela {{ idx + 1 - entryIndex }}</span>
              </td>
              <td>{{ formatTime(c.time) }}</td>
              <td>{{ c.open }}</td>
              <td>{{ c.high }}</td>
              <td>{{ c.low }}</td>
              <td :class="c.close >= c.open ? 'text-emerald-4' : 'text-rose-4'">{{ c.close }}</td>
              <td>
                <span :class="c.upperWick >= 2.0 ? 'text-amber-4 text-weight-bold' : 'text-slate-400'">
                  {{ c.upperWick }} pts ({{ c.wickPercent }}%)
                </span>
              </td>
              <td>{{ c.body }} pts</td>
              <td>
                <span v-if="c.isSpike" class="text-purple-3 text-weight-bold">
                  Caída brusca (-{{ (c.open - c.low).toFixed(1) }} pts)
                </span>
                <span v-else-if="c.hasRejectionWick" class="text-amber-3">
                  Rechazo de techo (mecha &ge; 25%)
                </span>
                <span v-else-if="c.close >= c.open" class="text-slate-400">
                  Vela de carga alcista
                </span>
                <span v-else class="text-slate-400">Vela neutra</span>
              </td>
            </tr>
          </tbody>
        </q-markup-table>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { createChart, LineStyle } from 'lightweight-charts';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  trade: { type: Object, default: null },
});

defineEmits(['update:modelValue']);

const snippetChartContainer = ref(null);
let chart = null;
let candleSeries = null;

const snippetCandles = computed(() => {
  return props.trade?.candlesSnippet || [];
});

const entryIndex = computed(() => {
  if (!props.trade || !snippetCandles.value.length) return 0;
  const idx = snippetCandles.value.findIndex((c) => Math.abs(c.time - props.trade.entryTime) <= 60);
  return idx >= 0 ? idx : Math.max(0, snippetCandles.value.length - 3);
});

const enrichedSnippetCandles = computed(() => {
  return snippetCandles.value.map((c, idx) => {
    const range = Math.max(0.01, c.high - c.low);
    const upperWick = c.upperWick !== undefined ? c.upperWick : Math.max(0, c.high - Math.max(c.open, c.close));
    const wickPercent = Math.round((upperWick / range) * 100);
    const isEntryCandle = idx === entryIndex.value;
    const isSpike = c.isSpike || (c.open - c.low) >= 12.0;
    const hasRejectionWick = wickPercent >= 25;

    return {
      ...c,
      upperWick: Number(upperWick.toFixed(2)),
      wickPercent,
      isEntryCandle,
      isSpike,
      hasRejectionWick,
    };
  });
});

function formatTime(epoch) {
  if (!epoch) return '';
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initSnippetChart() {
  if (!snippetChartContainer.value || !snippetCandles.value.length) return;

  if (chart) {
    chart.remove();
    chart = null;
  }

  chart = createChart(snippetChartContainer.value, {
    width: snippetChartContainer.value.clientWidth,
    height: 240,
    layout: {
      background: { color: '#090d16' },
      textColor: '#94a3b8',
      fontFamily: "'Inter', sans-serif",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: '#1e293b', style: LineStyle.Dotted },
      horzLines: { color: '#1e293b', style: LineStyle.Dotted },
    },
    rightPriceScale: { borderColor: '#1e293b' },
    timeScale: {
      borderColor: '#1e293b',
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
  });

  const chartData = snippetCandles.value.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  candleSeries.setData(chartData);

  // Markers para entrada y spike
  const markers = [];
  snippetCandles.value.forEach((c, idx) => {
    if (idx === entryIndex.value) {
      markers.push({
        time: c.time,
        position: 'belowBar',
        color: '#f59e0b',
        shape: 'arrowUp',
        text: 'ENTRADA',
      });
    } else if (c.isSpike || (c.open - c.low) >= 12.0) {
      markers.push({
        time: c.time,
        position: 'aboveBar',
        color: '#c084fc',
        shape: 'arrowDown',
        text: 'SPIKE',
      });
    }
  });
  candleSeries.setMarkers(markers);

  // Línea del precio de entrada
  if (props.trade?.entryPrice) {
    candleSeries.createPriceLine({
      price: props.trade.entryPrice,
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Precio Entrada',
    });
  }

  chart.timeScale().fitContent();
}

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      nextTick(() => {
        setTimeout(() => {
          initSnippetChart();
        }, 150);
      });
    } else {
      if (chart) {
        chart.remove();
        chart = null;
      }
    }
  },
);

onBeforeUnmount(() => {
  if (chart) {
    chart.remove();
    chart = null;
  }
});
</script>

<style scoped>
.border-slate {
  border: 1px solid #1e293b;
}

.border-b-slate {
  border-bottom: 1px solid #1e293b;
}
</style>
