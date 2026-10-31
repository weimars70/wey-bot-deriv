<template>
  <div class="ea-smc-chart-wrapper">
    <!-- Barra superior de controles del gráfico -->
    <div class="chart-toolbar row items-center justify-between q-pa-sm bg-slate-900 border-b-slate">
      <div class="row items-center q-gutter-xs">
        <span class="text-weight-bolder text-white font-mono text-subtitle2">{{ symbol }}</span>
        <q-badge
          :color="direction === 'BUY' ? 'green-7' : 'red-7'"
          :label="direction === 'BUY' ? 'BOOM · SOLO COMPRAS' : 'CRASH · SOLO VENTAS'"
          class="text-weight-bold q-ml-xs"
        />
        <q-badge outline color="purple-4" label="M5 (SMC)" class="q-ml-xs text-weight-bold" />
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
    </div>

    <!-- Contenedor del gráfico Lightweight Charts -->
    <div ref="chartContainer" class="chart-canvas-container" style="height: 480px; width: 100%;"></div>

    <!-- Panel inferior de detalles SMC identificados -->
    <div class="chart-footer q-pa-sm bg-slate-900 border-t-slate row items-center justify-between text-caption text-slate-300">
      <div class="row items-center q-gutter-md flex-wrap">
        <div>
          <span class="text-slate-500">Sesgo H1:</span>
          <span class="text-weight-bold q-ml-xs text-white">{{ htfBiasLabel }}</span>
        </div>
        <div>
          <span class="text-slate-500">Swings detectados:</span>
          <span class="text-weight-bold q-ml-xs text-cyan-3">{{ swingPoints.length }} (HH/HL/LH/LL)</span>
        </div>
        <div v-if="activeSmcZone">
          <span class="text-slate-500">Zona SMC Activa:</span>
          <span class="text-weight-bold q-ml-xs text-amber-3">
            {{ activeSmcZone.bottom?.toFixed(2) }} - {{ activeSmcZone.top?.toFixed(2) }}
            ({{ activeSmcZone.reactions }} reacciones)
          </span>
        </div>
        <div v-if="activeSmcZone?.chochLevel">
          <span class="text-slate-500">Nivel CHoCH:</span>
          <span class="text-weight-bold q-ml-xs text-emerald-4">{{ activeSmcZone.chochLevel.toFixed(2) }}</span>
        </div>
      </div>
      <div v-if="entrySignals.length" class="row items-center q-gutter-xs text-emerald-4 text-weight-bolder">
        <q-icon name="campaign" size="18px" />
        <span>Señal Activa: {{ entrySignals[0].type }} @ {{ entrySignals[0].price }} (SL: {{ entrySignals[0].sl.toFixed(2) }} | TP: {{ entrySignals[0].tp.toFixed(2) }})</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { createChart, LineStyle } from 'lightweight-charts';

const props = defineProps({
  symbol: { type: String, required: true },
  direction: { type: String, default: 'SELL' },
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
      fontFamily: "'Inter', monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: '#131d31', style: LineStyle.Dotted },
      horzLines: { color: '#131d31', style: LineStyle.Dotted },
    },
    crosshair: {
      mode: 1,
      vertLine: { color: '#475569', width: 1, style: LineStyle.Dashed },
      horzLine: { color: '#475569', width: 1, style: LineStyle.Dashed },
    },
    rightPriceScale: {
      borderColor: '#1e293b',
      scaleMargins: { top: 0.12, bottom: 0.12 },
    },
    timeScale: {
      borderColor: '#1e293b',
      timeVisible: true,
      secondsVisible: false,
    },
  });

  // Serie de Velas Japonesas
  candleSeries = chart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
  });

  chart.subscribeCrosshairMove((param) => {
    if (!param || !param.time) {
      hoveredCandle.value = null;
      return;
    }
    const c = param.seriesPrices?.get(candleSeries);
    if (c) {
      hoveredCandle.value = {
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      };
    }
  });

  resizeObserver = new ResizeObserver(() => {
    if (chart && chartContainer.value) {
      chart.applyOptions({ width: chartContainer.value.clientWidth });
    }
  });
  resizeObserver.observe(chartContainer.value);

  updateChart();
}

function clearPriceLines() {
  if (!candleSeries) return;
  for (const line of activePriceLines) {
    try {
      candleSeries.removePriceLine(line);
    } catch (_) {}
  }
  activePriceLines = [];
}

function updateChart() {
  if (!chart || !candleSeries || !props.chartData) return;

  const rawCandles = props.chartData.candles || [];
  if (!rawCandles.length) return;

  // 1. Cargar Velas con orden ASC estricto y timestamps únicos
  const sorted = [...rawCandles]
    .map(c => ({
      time: Math.floor(Number(c.time)),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter((c, idx, arr) => idx === 0 || c.time > arr[idx - 1].time);

  candleSeries.setData(sorted);

  // 2. Limpiar líneas previas
  clearPriceLines();

  // 3. Dibujar Zonas SMC (Top, Center, Bottom)
  for (const z of smcZones.value) {
    const isBoom = z.direction === 'BUY';
    const zoneColor = isBoom ? '#06b6d4' : '#f97316';

    const topLine = candleSeries.createPriceLine({
      price: z.top,
      color: zoneColor,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `SMC Top (${z.reactions}R)`,
    });
    const bottomLine = candleSeries.createPriceLine({
      price: z.bottom,
      color: zoneColor,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `SMC Bot`,
    });
    const centerLine = candleSeries.createPriceLine({
      price: z.center,
      color: '#38bdf8',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `SMC Nivel (${isBoom ? 'Soporte' : 'Resistencia'})`,
    });
    activePriceLines.push(topLine, bottomLine, centerLine);

    // Línea CHoCH si existe
    if (z.chochLevel) {
      const chochLine = candleSeries.createPriceLine({
        price: z.chochLevel,
        color: '#eab308',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `CHoCH Confirmado`,
      });
      activePriceLines.push(chochLine);
    }
  }

  // 4. Dibujar Niveles de Order Blocks recientes (top 3)
  for (const ob of obZones.value.slice(-3)) {
    const obColor = ob.direction === 'BUY' ? '#6366f1' : '#a855f7';
    const obLine = candleSeries.createPriceLine({
      price: (ob.top + ob.bottom) / 2,
      color: obColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: `OB ${ob.direction}`,
    });
    activePriceLines.push(obLine);
  }

  // 5. Señales de entrada (SL y TP)
  for (const sig of entrySignals.value) {
    const entryLine = candleSeries.createPriceLine({
      price: sig.price,
      color: '#22c55e',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `ENTRADA ${sig.direction}`,
    });
    const slLine = candleSeries.createPriceLine({
      price: sig.sl,
      color: '#ef4444',
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: `SL`,
    });
    const tpLine = candleSeries.createPriceLine({
      price: sig.tp,
      color: '#10b981',
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: `TP`,
    });
    activePriceLines.push(entryLine, slLine, tpLine);
  }

  // 6. Marcadores en velas (Swings HH, HL, LH, LL y Señal CHoCH)
  const markers = [];

  // Marcar swings M5
  for (const s of swingPoints.value) {
    const isHigh = s.direction === 'HIGH';
    markers.push({
      time: Math.floor(Number(s.time)),
      position: isHigh ? 'aboveBar' : 'belowBar',
      color: isHigh ? '#f43f5e' : '#06b6d4',
      shape: isHigh ? 'arrowDown' : 'arrowUp',
      text: s.type,
      size: 1,
    });
  }

  // Marcar señales de entrada
  for (const sig of entrySignals.value) {
    markers.push({
      time: Math.floor(Number(sig.time)),
      position: sig.direction === 'BUY' ? 'belowBar' : 'aboveBar',
      color: '#22c55e',
      shape: sig.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: `ENTRY ${sig.type}`,
      size: 2,
    });
  }

  // Los marcadores deben estar ordenados cronológicamente por time
  markers.sort((a, b) => a.time - b.time);
  candleSeries.setMarkers(markers);

  chart.timeScale().fitContent();
}

function fitChart() {
  if (chart) chart.timeScale().fitContent();
}

watch(() => props.chartData, () => {
  updateChart();
}, { deep: true });

onMounted(() => {
  initChart();
});

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect();
  if (chart) {
    chart.remove();
    chart = null;
  }
});
</script>

<style scoped>
.ea-smc-chart-wrapper {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #1e293b;
  background-color: #090d16;
}
.chart-canvas-container {
  position: relative;
}
.legend-chip {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}
.bg-aqua-subtle {
  background: rgba(6, 182, 212, 0.15);
}
.bg-amber-subtle {
  background: rgba(245, 158, 11, 0.15);
}
.bg-indigo-subtle {
  background: rgba(99, 102, 241, 0.15);
}
.bg-emerald-subtle {
  background: rgba(16, 185, 129, 0.15);
}
</style>
