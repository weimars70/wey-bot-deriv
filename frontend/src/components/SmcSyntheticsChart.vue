<template>
  <div class="smc-synth-chart-wrapper">
    <!-- Barra superior de controles del gráfico -->
    <div class="chart-toolbar row items-center justify-between q-pa-sm bg-slate-900 border-b-slate">
      <div class="row items-center q-gutter-xs">
        <span class="text-weight-bolder text-white font-mono text-subtitle2">{{ symbol }}</span>
        <q-badge
          :color="direction === 'BUY' ? 'green-7' : 'red-7'"
          :label="direction === 'BUY' ? '▲ BUY · COMPRA INSTITUCIONAL' : '▼ SELL · VENTA INSTITUCIONAL'"
          class="text-weight-bold q-ml-xs"
        />
        <q-badge outline color="cyan-4" label="M5 (SMC Puro)" class="q-ml-xs text-weight-bold" />
        <q-badge v-if="category" color="slate-7" :label="category" class="q-ml-xs text-weight-bold" />
      </div>

      <div class="row items-center q-gutter-sm text-caption">
        <!-- Leyendas activas -->
        <div class="row items-center q-gutter-xs text-slate-300">
          <span class="legend-chip bg-aqua-subtle text-cyan-3">■ Zona SMC ({{ smcZones.length }})</span>
          <span class="legend-chip bg-amber-subtle text-amber-3">-- CHoCH / Retest</span>
          <span class="legend-chip bg-indigo-subtle text-indigo-3">■ OB ({{ obZones.length }})</span>
          <span class="legend-chip bg-emerald-subtle text-emerald-3">■ FVG ({{ fvgZones.length }})</span>
        </div>
        <q-btn flat dense round icon="fit_screen" color="slate-4" size="sm" @click="fitChart">
          <q-tooltip>Ajustar gráfico</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Indicador de vela flotante (OHLC) -->
    <div class="ohlc-bar row items-center q-gutter-md q-px-md q-py-xs bg-slate-950 text-caption font-mono text-slate-400">
      <div>O: <span class="text-white">{{ activeCandle.open ?? '-' }}</span></div>
      <div>H: <span class="text-emerald-4">{{ activeCandle.high ?? '-' }}</span></div>
      <div>L: <span class="text-red-4">{{ activeCandle.low ?? '-' }}</span></div>
      <div>C: <span :class="(activeCandle.close >= activeCandle.open) ? 'text-emerald-4' : 'text-red-4'">{{ activeCandle.close ?? '-' }}</span></div>
      <div v-if="chartData?.atr" class="text-amber-4">ATR(14): {{ chartData.atr.toFixed(4) }}</div>
      <div v-if="chartData?.currentPrice" class="text-cyan-3">Precio: {{ chartData.currentPrice }}</div>
      <div v-if="entrySignals.length" class="text-emerald-4">SL: {{ entrySignals[0].sl }} | TP: {{ entrySignals[0].tp }}</div>
    </div>

    <!-- Contenedor del gráfico Lightweight Charts -->
    <div ref="chartContainer" class="chart-canvas-container" style="height: 480px; width: 100%;"></div>

    <!-- Panel inferior de detalles SMC identificados -->
    <div class="chart-footer q-pa-sm bg-slate-900 border-t-slate row items-center justify-between text-caption text-slate-300">
      <div class="row items-center q-gutter-md flex-wrap">
        <div>
          <span class="text-slate-500">Sesgo H1:</span>
          <span class="text-weight-bold q-ml-xs text-white" :class="htfBiasLabel === 'ALCISTA' ? 'text-green-4' : 'text-red-4'">{{ htfBiasLabel }}</span>
        </div>
        <div>
          <span class="text-slate-500">Swings detectados:</span>
          <span class="text-weight-bold q-ml-xs text-cyan-3">{{ swingPoints.length }} (HH/HL/LH/LL)</span>
        </div>
        <div v-if="activeSmcZone">
          <span class="text-slate-500">Zona SMC Activa:</span>
          <span class="text-weight-bold q-ml-xs text-amber-3">
            {{ activeSmcZone.bottom?.toFixed(4) }} - {{ activeSmcZone.top?.toFixed(4) }}
            ({{ activeSmcZone.reactions }} reacciones)
          </span>
        </div>
        <div v-if="activeSmcZone?.chochLevel">
          <span class="text-slate-500">Nivel CHoCH:</span>
          <span class="text-weight-bold q-ml-xs text-emerald-4">{{ activeSmcZone.chochLevel.toFixed(4) }}</span>
        </div>
      </div>
      <div v-if="entrySignals.length" class="row items-center q-gutter-xs text-emerald-4 text-weight-bolder">
        <q-icon name="campaign" size="18px" />
        <span>Entrada {{ entrySignals[0].direction }}: {{ entrySignals[0].type }} @ {{ entrySignals[0].price }} (SL: {{ entrySignals[0].sl.toFixed(4) }} | TP: {{ entrySignals[0].tp.toFixed(4) }})</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { createChart, LineStyle } from 'lightweight-charts';

const props = defineProps({
  symbol: { type: String, required: true },
  direction: { type: String, default: 'BUY' },
  category: { type: String, default: '' },
  chartData: { type: Object, default: null },
  htfBiasLabel: { type: String, default: 'NEUTRAL' },
});

const chartContainer = ref(null);
const hoveredCandle = ref(null);
let chart = null;
let candleSeries = null;
let activePriceLines = [];
let resizeObserver = null;

const smcZones = computed(() => props.chartData?.smcZones || []);
const swingPoints = computed(() => props.chartData?.swingPoints || []);
const obZones = computed(() => props.chartData?.obZones || []);
const fvgZones = computed(() => props.chartData?.fvgZones || []);
const entrySignals = computed(() => props.chartData?.entrySignals || []);

const activeSmcZone = computed(() => smcZones.value[0] || null);

const lastCandle = computed(() => {
  const c = props.chartData?.candles;
  return c && c.length ? c[c.length - 1] : {};
});

const activeCandle = computed(() => hoveredCandle.value || lastCandle.value || {});

function initChart() {
  if (!chartContainer.value) return;

  chart = createChart(chartContainer.value, {
    width: chartContainer.value.clientWidth,
    height: 480,
    layout: {
      background: { color: '#090d16' },
      textColor: '#94a3b8',
      fontSize: 11,
      fontFamily: 'monospace',
    },
    grid: {
      vertLines: { color: 'rgba(30, 41, 59, 0.5)' },
      horzLines: { color: 'rgba(30, 41, 59, 0.5)' },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: '#64748b', width: 1, style: LineStyle.Dashed },
      horzLine: { color: '#64748b', width: 1, style: LineStyle.Dashed },
    },
    rightPriceScale: {
      borderColor: '#1e293b',
      scaleMargins: { top: 0.1, bottom: 0.15 },
    },
    timeScale: {
      borderColor: '#1e293b',
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
  });

  chart.subscribeCrosshairMove((param) => {
    if (!param || !param.time || !param.seriesData) {
      hoveredCandle.value = null;
      return;
    }
    const data = param.seriesData.get(candleSeries);
    if (data) {
      hoveredCandle.value = {
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
      };
    }
  });

  renderChartData();

  resizeObserver = new ResizeObserver((entries) => {
    if (!entries.length || !chart) return;
    const { width } = entries[0].contentRect;
    chart.applyOptions({ width });
  });
  resizeObserver.observe(chartContainer.value);
}

function clearMarkersAndLines() {
  if (!candleSeries) return;
  activePriceLines.forEach((pl) => {
    try {
      candleSeries.removePriceLine(pl);
    } catch {}
  });
  activePriceLines = [];
}

function renderChartData() {
  if (!chart || !candleSeries || !props.chartData) return;

  clearMarkersAndLines();

  // Velas M5
  const rawCandles = props.chartData.candles || [];
  if (!rawCandles.length) return;

  const validCandles = rawCandles
    .filter((c) => c && c.time && !isNaN(c.close))
    .map((c) => ({
      time: Math.floor(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .sort((a, b) => a.time - b.time);

  // Deduplicar timestamps
  const uniqueCandles = [];
  const seenTimes = new Set();
  for (const c of validCandles) {
    if (!seenTimes.has(c.time)) {
      seenTimes.add(c.time);
      uniqueCandles.push(c);
    }
  }

  candleSeries.setData(uniqueCandles);

  // Marcadores de Swings, CHoCH y Señales
  const markers = [];

  // Swings
  (props.chartData.swingPoints || []).forEach((sw) => {
    if (sw && seenTimes.has(Math.floor(sw.time))) {
      markers.push({
        time: Math.floor(sw.time),
        position: sw.direction === 'HIGH' ? 'aboveBar' : 'belowBar',
        color: sw.direction === 'HIGH' ? '#f59e0b' : '#38bdf8',
        shape: sw.direction === 'HIGH' ? 'arrowDown' : 'arrowUp',
        text: sw.type,
      });
    }
  });

  // Señales de Entrada
  (props.chartData.entrySignals || []).forEach((sig) => {
    const t = Math.floor(sig.time);
    if (seenTimes.has(t)) {
      markers.push({
        time: t,
        position: sig.direction === 'BUY' ? 'belowBar' : 'aboveBar',
        color: sig.direction === 'BUY' ? '#10b981' : '#ef4444',
        shape: sig.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: `★ ENTRADA ${sig.direction} (${sig.type})`,
      });
    }
  });

  markers.sort((a, b) => a.time - b.time);
  if (markers.length) {
    candleSeries.setMarkers(markers);
  }

  // Líneas de Precios Clave
  // 1. Zona SMC Activa
  (props.chartData.smcZones || []).forEach((z) => {
    const isBuy = z.direction === 'BUY';
    const topPl = candleSeries.createPriceLine({
      price: z.top,
      color: isBuy ? 'rgba(56, 189, 248, 0.8)' : 'rgba(239, 68, 68, 0.8)',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `ZONA SMC TOP (${z.reactions}R)`,
    });
    const botPl = candleSeries.createPriceLine({
      price: z.bottom,
      color: isBuy ? 'rgba(56, 189, 248, 0.8)' : 'rgba(239, 68, 68, 0.8)',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: 'ZONA SMC BOTTOM',
    });
    activePriceLines.push(topPl, botPl);

    if (z.chochLevel) {
      const chochPl = candleSeries.createPriceLine({
        price: z.chochLevel,
        color: '#f59e0b',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `CHoCH CONFIRMADO: ${z.chochLevel.toFixed(4)}`,
      });
      activePriceLines.push(chochPl);
    }
  });

  // 2. Líneas de SL y TP
  (props.chartData.entrySignals || []).forEach((sig) => {
    if (sig.sl) {
      const slPl = candleSeries.createPriceLine({
        price: sig.sl,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `STOP LOSS: ${sig.sl.toFixed(4)}`,
      });
      activePriceLines.push(slPl);
    }
    if (sig.tp) {
      const tpPl = candleSeries.createPriceLine({
        price: sig.tp,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `TAKE PROFIT: ${sig.tp.toFixed(4)}`,
      });
      activePriceLines.push(tpPl);
    }
  });

  // 3. Nivel de Sesgo H1
  if (props.chartData.htfBiasLine) {
    const htfPl = candleSeries.createPriceLine({
      price: props.chartData.htfBiasLine,
      color: '#818cf8',
      lineWidth: 1,
      lineStyle: LineStyle.LargeDashed,
      axisLabelVisible: true,
      title: `ESTRUCTURA H1 (${props.htfBiasLabel})`,
    });
    activePriceLines.push(htfPl);
  }

  fitChart();
}

function fitChart() {
  if (!chart) return;
  chart.timeScale().fitContent();
}

watch(
  () => props.chartData,
  () => {
    renderChartData();
  },
  { deep: true },
);

onMounted(() => {
  initChart();
});

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect();
  if (chart) chart.remove();
});
</script>

<style scoped>
.smc-synth-chart-wrapper {
  background-color: #090d16;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #1e293b;
}

.chart-toolbar {
  background: #0f172a;
}
.border-b-slate {
  border-bottom: 1px solid #1e293b;
}
.border-t-slate {
  border-top: 1px solid #1e293b;
}

.legend-chip {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}
.bg-aqua-subtle { background: rgba(56, 189, 248, 0.15); }
.bg-amber-subtle { background: rgba(245, 158, 11, 0.15); }
.bg-indigo-subtle { background: rgba(99, 102, 241, 0.15); }
.bg-emerald-subtle { background: rgba(16, 185, 129, 0.15); }

.ohlc-bar {
  border-bottom: 1px solid #1e293b;
}
</style>
