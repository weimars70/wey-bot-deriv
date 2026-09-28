<template>
  <div class="chart-wrapper">
    <!-- Header OHLC bar -->
    <div class="chart-header">
      <div class="chart-title">
        <span class="chart-dot" :class="{ 'chart-dot--live': hasData }"></span>
        <span class="chart-label">{{ hasData ? 'EN VIVO' : 'Sin datos' }}</span>
      </div>
      <div v-if="latestCandle" class="chart-price-info">
        <span class="price-open">O <b>{{ latestCandle.open }}</b></span>
        <span class="price-high">H <b>{{ latestCandle.high }}</b></span>
        <span class="price-low">L <b>{{ latestCandle.low }}</b></span>
        <span class="price-close" :class="priceDirection">C <b>{{ latestCandle.close }}</b></span>
      </div>
    </div>

    <!-- Lightweight chart canvas -->
    <div ref="root" class="chart-canvas"></div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, watch, ref, computed } from 'vue';
import { createChart } from 'lightweight-charts';

const props = defineProps({
  candles: { type: Array, default: () => [] },
  timezone: { type: String, default: 'local' },
});

const root = ref(null);
let chart = null;
let series = null;

// ─── computed helpers ────────────────────────────────────────────
const hasData = computed(() => (props.candles || []).length > 0);

const latestCandle = computed(() => {
  const data = props.candles || [];
  if (!data.length) return null;
  return data[data.length - 1];
});

const priceDirection = computed(() => {
  const c = latestCandle.value;
  if (!c) return '';
  return Number(c.close) >= Number(c.open) ? 'price--up' : 'price--down';
});

// ─── chart colors ────────────────────────────────────────────────
const C = {
  bg:        '#0f1117',
  text:      '#c9d1d9',
  grid:      '#1a1e2e',
  border:    '#2d3148',
  upColor:   '#26a69a',
  downColor: '#ef5350',
};

// ─── lifecycle ───────────────────────────────────────────────────
onMounted(() => {
  chart = createChart(root.value, {
    width:  root.value.clientWidth,
    height: root.value.clientHeight,
    layout: {
      background:  { color: C.bg },
      textColor:   C.text,
      fontFamily: "'Inter', 'Roboto', sans-serif",
      fontSize:   12,
    },
    grid: {
      vertLines: { color: C.grid, style: 1 },
      horzLines: { color: C.grid, style: 1 },
    },
    crosshair: {
      mode: 1,
      vertLine: { color: '#4c5282', width: 1, style: 2, labelBackgroundColor: '#4c5282' },
      horzLine: { color: '#4c5282', width: 1, style: 2, labelBackgroundColor: '#4c5282' },
    },
    rightPriceScale: { borderColor: C.border },
    timeScale: {
      borderColor:    C.border,
      timeVisible:    true,
      secondsVisible: false,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale:  { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  series = chart.addCandlestickSeries({
    upColor:        C.upColor,
    downColor:      C.downColor,
    borderUpColor:  C.upColor,
    borderDownColor: C.downColor,
    wickUpColor:    C.upColor,
    wickDownColor:  C.downColor,
  });

  updateSeries(props.candles || []);
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  if (chart) chart.remove();
});

watch(() => props.candles, (val) => updateSeries(val || []));

// ─── resize ──────────────────────────────────────────────────────
function handleResize() {
  if (chart && root.value) {
    chart.applyOptions({
      width:  root.value.clientWidth,
      height: root.value.clientHeight,
    });
  }
}

// ─── data update ─────────────────────────────────────────────────
let lastData = [];

function updateSeries(candles) {
  if (!series) return;

  const data = (candles || [])
    .map((c) => ({
      time:  Math.floor(Number(c.epoch)),
      open:  Number(c.open),
      high:  Number(c.high),
      low:   Number(c.low),
      close: Number(c.close),
    }))
    .sort((a, b) => a.time - b.time);

  if (lastData.length === 0 || data.length === 0 || data[0].time !== lastData[0].time) {
    series.setData(data);
    if (data.length) chart.timeScale().fitContent();
  } else {
    const lastKnownTime = lastData[lastData.length - 1].time;
    data.filter(d => d.time >= lastKnownTime).forEach(item => series.update(item));
  }

  lastData = data;
}
</script>

<style scoped>
/* ── wrapper ─────────────────────────────────────────────── */
.chart-wrapper {
  background:    #0f1117;
  border-radius: 12px;
  overflow:      hidden;
  border:        1px solid #1e2130;
  box-shadow:    0 8px 40px rgba(0, 0, 0, 0.5);
}

/* ── header ──────────────────────────────────────────────── */
.chart-header {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  padding:         10px 16px;
  background:      #12151f;
  border-bottom:   1px solid #1e2130;
  flex-wrap:       wrap;
  gap:             8px;
}

.chart-title {
  display:     flex;
  align-items: center;
  gap:         8px;
}

/* live dot */
.chart-dot {
  width:         8px;
  height:        8px;
  border-radius: 50%;
  background:    #3a3f5c;
  flex-shrink:   0;
}

.chart-dot--live {
  background: #26a69a;
  box-shadow: 0 0 8px #26a69a88;
  animation:  pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1;   transform: scale(1);   }
  50%       { opacity: 0.6; transform: scale(1.35); }
}

.chart-label {
  font-size:      11px;
  font-weight:    700;
  letter-spacing: 1.5px;
  color:          #6b7280;
  text-transform: uppercase;
}

.chart-dot--live ~ .chart-label {
  color: #26a69a;
}

/* OHLC prices */
.chart-price-info {
  display:   flex;
  gap:       14px;
  font-size: 12px;
  color:     #8892a4;
}

.chart-price-info b {
  font-weight: 600;
  color:       #c9d1d9;
}

.price-high b  { color: #26a69a; }
.price-low b   { color: #ef5350; }
.price--up b   { color: #26a69a; }
.price--down b { color: #ef5350; }

/* ── canvas ──────────────────────────────────────────────── */
.chart-canvas {
  width:  100%;
  height: 440px;
}
</style>
