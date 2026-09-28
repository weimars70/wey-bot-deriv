<template>
  <div class="crash-chart-wrapper bg-slate-950 rounded-borders overflow-hidden border-slate">
    <!-- Header de Información de Velas y Zonas -->
    <div class="row items-center justify-between q-pa-sm bg-slate-900 text-white border-b-slate">
      <div class="row items-center q-gutter-sm">
        <q-badge color="amber-8" text-color="black" :label="`${symbol} · M${timeframe / 60}`" class="text-weight-bolder" />
        <q-btn-toggle
          :model-value="timeframe"
          dense
          rounded
          size="xs"
          color="slate-800"
          toggle-color="amber-9"
          text-color="slate-300"
          :options="[
            { label: 'M5', value: 300 },
            { label: 'M15', value: 900 }
          ]"
          @update:model-value="$emit('changeTimeframe', $event)"
        />
        <span class="text-caption text-slate-400 font-mono">Últimas 120 velas</span>
        <div v-if="activeZone" class="row items-center q-gutter-xs">
          <q-badge color="negative" class="text-weight-bold animate-pulse">
            🎯 EN ZONA DE RETESTEO ({{ activeZone.spikeCount }} Spikes)
          </q-badge>
        </div>
      </div>

      <!-- Barra OHLC dinámica al posar el ratón o última vela -->
      <div class="row items-center q-gutter-md text-caption font-mono text-slate-300">
        <template v-if="hoverCandle || lastCandle">
          <div>O: <span class="text-white text-weight-bold">{{ displayCandle.open }}</span></div>
          <div>H: <span class="text-white text-weight-bold">{{ displayCandle.high }}</span></div>
          <div>L: <span class="text-white text-weight-bold">{{ displayCandle.low }}</span></div>
          <div>C: <span :class="displayCandle.close >= displayCandle.open ? 'text-emerald-4' : 'text-rose-4'" class="text-weight-bold">{{ displayCandle.close }}</span></div>
          <div v-if="displayCandle.upperWick !== undefined" class="text-amber-3 text-weight-medium">
            Mecha Sup: {{ displayCandle.upperWick }} pts
          </div>
        </template>
        <!-- SL y TP visibles siempre en la barra, no en el eje -->
        <div v-if="slPrice > 0" class="row items-center q-gutter-xs">
          <q-badge color="red-8" text-color="white" label="SL" class="text-weight-bolder font-mono" />
          <span class="text-red-4 text-weight-bold">{{ slPrice.toFixed(3) }}</span>
        </div>
        <div v-if="tpPrice > 0" class="row items-center q-gutter-xs">
          <q-badge color="emerald-8" text-color="white" label="TP" class="text-weight-bolder font-mono" />
          <span class="text-emerald-4 text-weight-bold">{{ tpPrice.toFixed(3) }}</span>
        </div>
      </div>
    </div>

    <!-- Canvas de Lightweight Charts -->
    <div ref="chartContainer" class="chart-canvas" style="height: 380px; width: 100%;"></div>

    <!-- Leyenda inferior de Zonas de Retesteo -->
    <div v-if="retestZones && retestZones.length > 0" class="q-pa-xs bg-slate-900 border-t-slate">
      <div class="row items-center q-gutter-xs no-wrap overflow-hidden">
        <q-icon name="layers" color="amber-4" size="16px" class="q-flex-none" />
        <span class="text-caption text-weight-bold text-slate-300 q-flex-none">Zonas:</span>
        <div class="row items-center q-gutter-xs" style="overflow-x: auto; flex-wrap: nowrap">
          <q-chip
            v-for="z in retestZones.slice(0, 6)"
            :key="z.id"
            dense
            size="sm"
            :color="z.isRetestingNow ? 'negative' : 'amber-10'"
            :text-color="z.isRetestingNow ? 'white' : 'amber-3'"
            class="font-mono text-weight-bold q-ma-none"
            style="white-space: nowrap; flex-shrink: 0"
          >
            {{ z.level }} ({{ z.spikeCount }}x · -{{ z.avgDrop }}pts)
          </q-chip>
        </div>
        <q-btn flat dense size="xs" color="slate-4" icon="crop_free" class="q-ml-auto q-flex-none" @click="fitContent" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { createChart, LineStyle } from 'lightweight-charts';

const props = defineProps({
  candles: {
    type: Array,
    default: () => [],
  },
  retestZones: {
    type: Array,
    default: () => [],
  },
  activeZone: {
    type: Object,
    default: null,
  },
  slPrice: {
    type: Number,
    default: 0,
  },
  tpPrice: {
    type: Number,
    default: 0,
  },
  timeframe: {
    type: Number,
    default: 300,
  },
  symbol: {
    type: String,
    default: 'CRASH600',
  },
});

defineEmits(['changeTimeframe']);

const chartContainer = ref(null);
const hoverCandle = ref(null);
let chart = null;
let candleSeries = null;
let zonePriceLines = [];
let slLine = null;
let tpLine = null;
let resizeObserver = null;

const lastCandle = computed(() => {
  if (!props.candles || props.candles.length === 0) return null;
  return props.candles[props.candles.length - 1];
});

const displayCandle = computed(() => hoverCandle.value || lastCandle.value || {});

function initChart() {
  if (!chartContainer.value) return;

  chart = createChart(chartContainer.value, {
    width: chartContainer.value.clientWidth,
    height: 380,
    layout: {
      background: { color: '#090d16' },
      textColor: '#94a3b8',
      fontFamily: "'Inter', sans-serif",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: '#172033', style: LineStyle.Dotted },
      horzLines: { color: '#172033', style: LineStyle.Dotted },
    },
    crosshair: {
      mode: 1,
      vertLine: { color: '#64748b', width: 1, style: LineStyle.Dashed },
      horzLine: { color: '#64748b', width: 1, style: LineStyle.Dashed },
    },
    rightPriceScale: {
      borderColor: '#1e293b',
      scaleMargins: { top: 0.1, bottom: 0.1 },
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
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
  });

  // Crosshair move handler
  chart.subscribeCrosshairMove((param) => {
    if (!param || !param.time || !param.seriesPrices) {
      hoverCandle.value = null;
      return;
    }
    const price = param.seriesPrices.get(candleSeries);
    if (price) {
      const match = (props.candles || []).find((c) => c.time === param.time);
      hoverCandle.value = {
        open: price.open,
        high: price.high,
        low: price.low,
        close: price.close,
        upperWick: match?.upperWick,
      };
    }
  });

  renderData();

  resizeObserver = new ResizeObserver((entries) => {
    if (entries.length > 0 && chart) {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height: height || 380 });
    }
  });
  resizeObserver.observe(chartContainer.value);
}

function renderData() {
  if (!candleSeries || !props.candles || props.candles.length === 0) return;

  // 1. Convertir velas a formato lightweight-charts
  const data = props.candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  candleSeries.setData(data);

  // 2. Colocar marcadores en caídas (spikes >= 12 pts)
  const markers = [];
  props.candles.forEach((c) => {
    if (c.isSpike) {
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

  // 3. Renderizar Zonas de Retesteo (líneas horizontales en el gráfico)
  zonePriceLines.forEach((line) => {
    try {
      candleSeries.removePriceLine(line);
    } catch (e) {}
  });
  zonePriceLines = [];

  const topZones = (props.retestZones || []).slice(0, 5);
  topZones.forEach((z) => {
    const isNow = z.isRetestingNow;
    const pLine = candleSeries.createPriceLine({
      price: z.level,
      color: isNow ? '#ef4444' : '#f59e0b55', // semitransparente si no es activa
      lineWidth: isNow ? 2 : 1,
      lineStyle: isNow ? LineStyle.Solid : LineStyle.Dashed,
      // Solo la zona ACTIVA muestra label en el eje derecho
      // Las demás NO muestran nada en el eje para evitar el apilamiento
      axisLabelVisible: isNow,
      title: isNow ? `🎯 ${z.spikeCount}x` : '',
    });
    zonePriceLines.push(pLine);
  });

  // 4. Línea de SL
  if (slLine) {
    try {
      candleSeries.removePriceLine(slLine);
    } catch (e) {}
    slLine = null;
  }
  if (props.slPrice && props.slPrice > 0) {
    slLine = candleSeries.createPriceLine({
      price: props.slPrice,
      color: '#f43f5e',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,  // El valor se muestra en la barra superior, no en el eje
      title: '',
    });
  }

  // 5. Línea de TP
  if (tpLine) {
    try {
      candleSeries.removePriceLine(tpLine);
    } catch (e) {}
    tpLine = null;
  }
  if (props.tpPrice && props.tpPrice > 0) {
    tpLine = candleSeries.createPriceLine({
      price: props.tpPrice,
      color: '#10b981',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,  // El valor se muestra en la barra superior, no en el eje
      title: '',
    });
  }

  chart.timeScale().fitContent();
}

function fitContent() {
  if (chart) chart.timeScale().fitContent();
}

watch(
  () => [props.candles, props.retestZones, props.slPrice, props.tpPrice],
  () => {
    renderData();
  },
  { deep: true },
);

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
.crash-chart-wrapper {
  position: relative;
  background-color: #090d16;
}

.border-slate {
  border: 1px solid #1e293b;
}

.border-b-slate {
  border-bottom: 1px solid #1e293b;
}

.border-t-slate {
  border-top: 1px solid #1e293b;
}

.animate-pulse {
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.02); }
}
</style>
