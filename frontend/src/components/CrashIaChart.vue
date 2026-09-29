<template>
  <div class="crash-chart-wrapper">
    <!-- Barra de Leyenda de Niveles -->
    <div class="chart-legend-bar row items-center justify-between q-pa-sm bg-slate-50 border-b-slate">
      <div class="row items-center q-gutter-xs flex-wrap">
        <span class="text-caption text-weight-bolder text-slate-700 q-mr-xs">ZONAS:</span>
        <q-badge color="blue-1" text-color="blue-9" class="legend-pill font-mono">
          <span class="legend-dot bg-blue-7"></span>
          Línea H1: {{ formatNum(h1Price) }}
        </q-badge>
        <q-badge color="purple-1" text-color="purple-9" class="legend-pill font-mono">
          <span class="legend-dot bg-purple-7"></span>
          {{ isBoom ? 'Pico Λ:' : 'Base V:' }} {{ formatNum(vLinePrice) }}
        </q-badge>
        <q-badge :color="isBoom ? 'emerald-1' : 'amber-1'" :text-color="isBoom ? 'emerald-9' : 'amber-9'" class="legend-pill font-mono">
          <span class="legend-dot" :class="isBoom ? 'bg-emerald-7' : 'bg-amber-7'"></span>
          {{ isBoom ? '50% BUY:' : '50% SELL:' }} {{ formatNum(entryLevel50) }}
        </q-badge>
        <q-badge color="purple-1" text-color="purple-8" class="legend-pill font-mono">
          <span class="legend-dot bg-purple-4"></span>
          {{ isBoom ? 'Piso Caja:' : 'Techo Caja:' }} {{ formatNum(isBoom ? boxFloor : boxCeiling) }}
        </q-badge>
        <q-badge color="red-1" text-color="red-9" class="legend-pill font-mono">
          <span class="legend-dot bg-red-7"></span>
          SL: {{ formatNum(stopLossPrice) }}
        </q-badge>
        <q-badge v-if="h1StructuralPrice" color="cyan-1" text-color="cyan-9" class="legend-pill font-mono">
          <span class="legend-dot bg-cyan-7"></span>
          {{ isBoom ? 'Soporte H1:' : 'Estructural H1:' }} {{ formatNum(h1StructuralPrice) }}
        </q-badge>

        <!-- Puntos Order Block (OB) -->
        <template v-if="obMid50 && obMid50 > 0">
          <q-badge :color="isBoom ? 'emerald-1' : 'amber-1'" :text-color="isBoom ? 'emerald-10' : 'amber-10'" class="legend-pill font-mono" title="Mean Threshold / Punto de Mitigación Institucional">
            <span class="legend-dot" :class="isBoom ? 'bg-emerald-8' : 'bg-amber-8'"></span>
            OB 50%: {{ formatNum(obMid50) }}
          </q-badge>
          <q-badge color="orange-1" text-color="orange-9" class="legend-pill font-mono" :title="isBoom ? 'Inicio de zona de compra' : 'Inicio de zona de venta'">
            <span class="legend-dot bg-orange-6"></span>
            {{ isBoom ? 'OB Techo (Entrada):' : 'OB Base (Entrada):' }} {{ formatNum(isBoom ? obHigh : obLow) }}
          </q-badge>
          <q-badge color="deep-orange-1" text-color="deep-orange-9" class="legend-pill font-mono" title="Invalidación / Stop Loss del Order Block">
            <span class="legend-dot bg-deep-orange-7"></span>
            {{ isBoom ? 'OB Base (SL):' : 'OB Techo (SL):' }} {{ formatNum(isBoom ? obLow : obHigh) }}
          </q-badge>
        </template>

        <!-- Trade Activo (Bot / Estrategia) -->
        <q-badge
          v-if="activeTrade"
          :color="activeTrade.pnlPoints >= 0 ? 'emerald-7' : 'red-7'"
          text-color="white"
          class="legend-pill font-mono q-px-sm text-weight-bolder animate-pulse"
        >
          <q-icon :name="activeTrade.direction === 'BUY' ? 'arrow_circle_up' : 'arrow_circle_down'" size="16px" class="q-mr-xs" />
          TRADE {{ activeTrade.direction }} @ {{ formatNum(activeTrade.entryPrice) }} |
          {{ activeTrade.pnlPoints >= 0 ? '+' : '' }}{{ formatNum(activeTrade.pnlPoints) }} pts ({{ activeTrade.pnlPercent }}%)
        </q-badge>
      </div>

      <div class="row items-center q-gutter-xs">
        <!-- Botón para enfocar la vela del Order Block -->
        <q-btn
          v-if="obEpoch && obEpoch > 0"
          unelevated
          dense
          size="sm"
          color="amber-9"
          text-color="white"
          icon="my_location"
          label="Vela OB"
          class="text-weight-bolder q-px-xs"
          @click="goToObCandle"
        >
          <q-tooltip>🎯 Enfocar y hacer zoom directo sobre la vela del Order Block</q-tooltip>
        </q-btn>

        <!-- Botones de Zoom explícito -->
        <div class="row items-center q-gutter-none bg-slate-200 rounded-borders q-px-xs">
          <q-btn
            flat
            dense
            size="sm"
            color="slate-8"
            icon="zoom_in"
            @click="zoomIn"
          >
            <q-tooltip>Acercar zoom (+)</q-tooltip>
          </q-btn>
          <q-btn
            flat
            dense
            size="sm"
            color="slate-8"
            icon="zoom_out"
            @click="zoomOut"
          >
            <q-tooltip>Alejar zoom (-)</q-tooltip>
          </q-btn>
        </div>

        <q-btn
          flat
          dense
          size="sm"
          :color="showLabels ? 'primary' : 'grey-6'"
          :icon="showLabels ? 'label' : 'label_off'"
          :label="showLabels ? 'Nombres ON' : 'Nombres OFF'"
          class="text-weight-bold"
          @click="toggleLabels"
        >
          <q-tooltip>
            {{ showLabels ? 'Ocultar nombres sobre las líneas' : 'Mostrar nombres sobre las líneas' }}
          </q-tooltip>
        </q-btn>

        <q-btn
          flat
          dense
          size="sm"
          color="slate-7"
          icon="center_focus_strong"
          label="Centrar"
          class="text-weight-bold"
          @click="resetView"
        >
          <q-tooltip>Ajustar escala de precios y tiempo al tamaño completo (Doble clic en gráfico)</q-tooltip>
        </q-btn>

        <div class="text-caption text-slate-400 font-mono q-ml-xs">
          {{ candles.length }}v
        </div>
      </div>
    </div>

    <!-- Contenedor del gráfico Lightweight Charts -->
    <div class="chart-canvas-shell" @dblclick="resetView">
      <div ref="chartContainer" class="chart-canvas-container"></div>
      <div
        v-if="obOriginStyle"
        class="ob-origin-marker"
        :class="{ 'ob-origin-marker--boom': isBoom }"
        :style="obOriginStyle"
        aria-hidden="true"
      >
        <span class="ob-origin-marker__band"></span>
        <span class="ob-origin-marker__line"></span>
        <span class="ob-origin-marker__label">
          {{ isBoom ? 'Origen OB BUY' : 'Origen OB SELL' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { createChart, LineStyle } from 'lightweight-charts';

const props = defineProps({
  candles: {
    type: Array,
    default: () => [],
  },
  symbol: { type: String, default: '' },
  timeframe: { type: [Number, String], default: 5 },
  marketType: { type: String, default: 'CRASH' },
  operationType: { type: String, default: 'SELL' },
  h1Price: { type: Number, default: 0 },
  vLinePrice: { type: Number, default: 0 },
  boxFloor: { type: Number, default: 0 },
  boxCeiling: { type: Number, default: 0 },
  entryLevel50: { type: Number, default: 0 },
  stopLossPrice: { type: Number, default: 0 },
  h1StructuralPrice: { type: Number, default: null },
  obHigh: { type: Number, default: 0 },
  obMid50: { type: Number, default: 0 },
  obLow: { type: Number, default: 0 },
  obStatus: { type: String, default: '' },
  obEpoch: { type: Number, default: 0 },
  activeTrade: { type: Object, default: null },
});

const isBoom = computed(() => {
  return props.marketType === 'BOOM' ||
    props.operationType === 'BUY' ||
    (props.symbol && props.symbol.toUpperCase().startsWith('BOOM'));
});

const chartContainer    = ref(null);
const obOriginStyle     = ref(null);
const showLabels        = ref(false); // Por defecto desactivado para que NUNCA tape las velas
let chart               = null;
let candleSeries        = null;
let priceLines          = [];
let resizeObserver      = null;
let visibleRangeHandler = null;
let isFirstLoad         = true;
let lastRenderedSymbol  = '';

function formatNum(val) {
  if (!val && val !== 0) return '—';
  return Number(val).toFixed(2);
}

function toggleLabels() {
  showLabels.value = !showLabels.value;
  updatePriceLines();
}

/**
 * Resetea y auto-ajusta TANTO el eje de tiempo (horizontal) como la escala de precios (vertical).
 * Evita que el gráfico quede vacío o congelado en rangos de precios de otros índices.
 */
function resetView() {
  if (!chart) return;
  try {
    chart.priceScale('right').applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  } catch (e) {
    console.warn('Error resetting view:', e);
  }
}

function zoomIn() {
  if (!chart) return;
  try {
    chart.priceScale('right').applyOptions({ autoScale: true });
    const timeScale = chart.timeScale();
    const current = timeScale.options().barSpacing || 9;
    timeScale.applyOptions({ barSpacing: Math.min(current * 1.35, 45) });
  } catch (e) {}
}

function zoomOut() {
  if (!chart) return;
  try {
    chart.priceScale('right').applyOptions({ autoScale: true });
    const timeScale = chart.timeScale();
    const current = timeScale.options().barSpacing || 9;
    timeScale.applyOptions({ barSpacing: Math.max(current * 0.75, 2) });
  } catch (e) {}
}

function getTimeframeSeconds() {
  const tf = Number(props.timeframe);
  return Number.isFinite(tf) && tf > 0 ? tf * 60 : 300;
}

function findMatchingCandleTime(targetEpoch) {
  const target = Number(targetEpoch);
  if (!target || !props.candles.length) return null;
  const exact = props.candles.find((c) => Number(c.time) === target);
  if (exact) return Number(exact.time);

  const sorted = [...props.candles].sort((a, b) => Number(a.time) - Number(b.time));
  for (let i = 0; i < sorted.length; i++) {
    const curTime = Number(sorted[i].time);
    const nextTime = i < sorted.length - 1 ? Number(sorted[i + 1].time) : curTime + getTimeframeSeconds();
    if (target >= curTime && target < nextTime) {
      return curTime;
    }
  }
  return null;
}

function updateObOriginMarker() {
  obOriginStyle.value = null;
  if (!chart || !chartContainer.value || !props.obEpoch || !props.candles.length) return;

  const matchTime = findMatchingCandleTime(props.obEpoch);
  if (!matchTime) return;

  let x = null;
  try {
    x = chart.timeScale().timeToCoordinate(matchTime);
  } catch (e) {
    return;
  }

  const coordinate = Number(x);
  if (!Number.isFinite(coordinate)) return;

  const width = chartContainer.value.clientWidth || 0;
  if (coordinate < -28 || (width > 0 && coordinate > width + 28)) return;

  const barSpacing = Number(chart.timeScale().options().barSpacing || 9);
  const bandWidth = Math.max(8, Math.min(26, barSpacing * 1.8));
  obOriginStyle.value = {
    left: `${coordinate.toFixed(1)}px`,
    '--ob-origin-color': isBoom.value ? '#059669' : '#f59e0b',
    '--ob-origin-bg': isBoom.value ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.13)',
    '--ob-origin-width': `${bandWidth.toFixed(1)}px`,
  };
}

function updateMarkers() {
  if (!candleSeries) return;
  const markers = [];
  if (props.obEpoch && props.obMid50 && props.candles && props.candles.length) {
    const matchTime = findMatchingCandleTime(props.obEpoch);
    if (matchTime) {
      if (isBoom.value) {
        markers.push({
          time: matchTime,
          position: 'belowBar',
          color: '#10b981',
          shape: 'arrowUp',
          text: `VELA ORIGEN OB BUY (${formatNum(props.obMid50)})`,
          size: 2,
        });
      } else {
        markers.push({
          time: matchTime,
          position: 'aboveBar',
          color: '#f59e0b',
          shape: 'arrowDown',
          text: `VELA ORIGEN OB SELL (${formatNum(props.obMid50)})`,
          size: 2,
        });
      }
    }
  }

  // Marcador de Trade Activo en el Gráfico
  if (props.activeTrade && props.activeTrade.entryTime && props.candles && props.candles.length) {
    const matchTime = findMatchingCandleTime(Number(props.activeTrade.entryTime));
    if (matchTime) {
      const isBuy = props.activeTrade.direction === 'BUY';
      markers.push({
        time: matchTime,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#06b6d4' : '#f97316',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: `🚀 TRADE ${props.activeTrade.direction} @ ${formatNum(props.activeTrade.entryPrice)}`,
        size: 2,
      });
    }
  }

  try {
    candleSeries.setMarkers(markers);
  } catch (e) {
    console.warn('Error setting chart markers:', e);
  }
  updateObOriginMarker();
}

function goToObCandle(targetEpoch = null) {
  const epoch = targetEpoch || props.obEpoch;
  if (!chart || !epoch || !props.candles.length) return;
  const matchTime = findMatchingCandleTime(epoch);
  if (!matchTime) return;

  const sorted = [...props.candles].sort((a, b) => Number(a.time) - Number(b.time));
  const idx = sorted.findIndex((c) => Number(c.time) === matchTime);
  if (idx !== -1) {
    try {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, idx - 15),
        to: Math.min(sorted.length - 1 + 8, idx + 15),
      });
      setTimeout(updateObOriginMarker, 0);
    } catch (e) {}
  }
}

defineExpose({
  goToObCandle,
  zoomIn,
  zoomOut,
  resetView,
});

function clearPriceLines() {
  if (!candleSeries) return;
  for (const pl of priceLines) {
    try {
      candleSeries.removePriceLine(pl);
    } catch (e) {}
  }
  priceLines = [];
}

function updatePriceLines() {
  if (!candleSeries) return;
  clearPriceLines();

  const labelsOn = showLabels.value;
  const boom = isBoom.value;

  const addLine = (price, color, lineWidth, lineStyle, title) => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    try {
      priceLines.push(
        candleSeries.createPriceLine({
          price: p,
          color,
          lineWidth,
          lineStyle,
          axisLabelVisible: true,
          title: labelsOn ? title : '',
        })
      );
    } catch (e) {
      console.warn('Error creating price line:', e);
    }
  };

  // 1. Línea H1 (Azul / DodgerBlue)
  addLine(props.h1Price, '#2563eb', 2, LineStyle.Solid, 'Línea H1');

  // 2. Línea Morada V (Piso V en Crash / Pico Lambda en Boom)
  addLine(props.vLinePrice, '#9333ea', 2, LineStyle.Solid, boom ? 'Pico Λ' : 'Base V');

  // 3. Zona 50% Entrada
  addLine(props.entryLevel50, boom ? '#10b981' : '#d97706', 2, LineStyle.Dashed, boom ? '50% Entrada BUY' : '50% Entrada SELL');

  // 4. Extremo de la Caja (3 velas M5)
  const boxLimitPrice = boom ? props.boxFloor : props.boxCeiling;
  addLine(boxLimitPrice, '#c084fc', 1, LineStyle.Dashed, boom ? 'Piso Caja (-3v)' : 'Techo Caja (+3v)');

  // 5. Stop Loss (+1 vela M5 arriba en Crash / -1 vela M5 abajo en Boom)
  addLine(props.stopLossPrice, '#dc2626', 2, LineStyle.Solid, boom ? 'Stop Loss (-1v)' : 'Stop Loss (+1v)');

  // 6. Nivel Estructural H1 (Cian)
  addLine(props.h1StructuralPrice, '#0891b2', 2, LineStyle.Dotted, boom ? 'Soporte H1' : 'Estructural H1');

  // 7. Puntos Order Block (OB)
  if (props.obMid50 && props.obMid50 > 0) {
    addLine(props.obMid50, boom ? '#10b981' : '#f59e0b', 2, LineStyle.Solid, boom ? 'OB 50% (BUY)' : 'OB 50% (SELL)');
    const entryPrice = boom ? props.obHigh : props.obLow;
    addLine(entryPrice, boom ? '#34d399' : '#fbbf24', 1, LineStyle.Dashed, boom ? 'OB Techo (Entrada)' : 'OB Base (Entrada)');
    const invalidationPrice = boom ? props.obLow : props.obHigh;
    addLine(invalidationPrice, '#ea580c', 1, LineStyle.Dashed, boom ? 'OB Base (SL Inval.)' : 'OB Techo (SL Inval.)');
  }

  // 8. Líneas de Trade Activo (Bot / Estrategia)
  if (props.activeTrade && props.activeTrade.entryPrice > 0) {
    const t = props.activeTrade;
    addLine(
      t.entryPrice,
      '#06b6d4',
      2,
      LineStyle.Solid,
      `🚀 ENTRADA ${t.direction} (${formatNum(t.entryPrice)})`
    );
    if (t.stopLossPrice && t.stopLossPrice > 0) {
      addLine(
        t.stopLossPrice,
        '#ef4444',
        2,
        LineStyle.Dashed,
        `🛑 SL TRADE (${formatNum(t.stopLossPrice)})`
      );
    }
    if (t.takeProfitPrice && t.takeProfitPrice > 0) {
      addLine(
        t.takeProfitPrice,
        '#10b981',
        2,
        LineStyle.Dashed,
        `🎯 TP TRADE (${formatNum(t.takeProfitPrice)})`
      );
    }
  }
}

function updateChartData(forceFit = false) {
  if (!candleSeries || !chart) return;

  if (!props.candles || props.candles.length === 0) {
    clearPriceLines();
    obOriginStyle.value = null;
    try {
      candleSeries.setData([]);
    } catch (e) {}
    return;
  }

  const isSymbolChange = props.symbol && props.symbol !== lastRenderedSymbol;

  // 1. Limpiar siempre las líneas viejas antes de cargar nuevos precios
  clearPriceLines();

  // 2. Formatear, filtrar y ordenar estrictamente por time ascendente
  const formatted = props.candles
    .map((c) => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.time > 0 &&
        c.high >= c.low
    )
    .sort((a, b) => a.time - b.time);

  // Eliminar duplicados de time si existiesen
  const unique = [];
  const seenTimes = new Set();
  for (const c of formatted) {
    if (!seenTimes.has(c.time)) {
      seenTimes.add(c.time);
      unique.push(c);
    }
  }

  if (unique.length === 0) {
    obOriginStyle.value = null;
    return;
  }

  // 3. Forzar autoScale en la escala vertical de precios
  if (isSymbolChange || forceFit || isFirstLoad) {
    try {
      chart.priceScale('right').applyOptions({ autoScale: true });
    } catch (e) {}
  }

  // 4. Asignar los datos filtrados a la serie
  try {
    candleSeries.setData(unique);
  } catch (err) {
    console.warn('Error setting candle data:', err);
    return;
  }

  // 5. Crear las líneas de precio y marcadores
  updatePriceLines();
  updateMarkers();
  updateObOriginMarker();

  // 6. Si cambió de activo, o es primera carga o forceFit: ajustar vista completa
  if (isSymbolChange || forceFit || isFirstLoad) {
    try {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    } catch (e) {}
    lastRenderedSymbol = props.symbol;
    isFirstLoad = false;
  }
}

onMounted(() => {
  nextTick(() => {
    if (!chartContainer.value) return;

    const initialWidth = chartContainer.value.clientWidth || 800;

    chart = createChart(chartContainer.value, {
      width: initialWidth,
      height: 520,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#334155',
        fontSize: 12,
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      crosshair: {
        mode: 1, // Magnet
      },
      rightPriceScale: {
        borderColor: '#cbd5e1',
        scaleMargins: {
          top: 0.12,
          bottom: 0.12,
        },
        autoScale: true,
      },
      timeScale: {
        borderColor: '#cbd5e1',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 15, // Espacio para que las velas recientes respiren
        barSpacing: 9,
      },
    });

    visibleRangeHandler = () => updateObOriginMarker();
    chart.timeScale().subscribeVisibleLogicalRangeChange(visibleRangeHandler);

    candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#059669',
      borderDownColor: '#dc2626',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    updateChartData(true);

    // Auto-ajuste de tamaño responsivo
    resizeObserver = new ResizeObserver((entries) => {
      if (!entries.length || !chart) return;
      const { width } = entries[0].contentRect;
      if (width > 50) {
        chart.applyOptions({ width });
        updateObOriginMarker();
        if (isFirstLoad) {
          try {
            chart.priceScale('right').applyOptions({ autoScale: true });
            chart.timeScale().fitContent();
          } catch (e) {}
        }
      }
    });
    resizeObserver.observe(chartContainer.value);
  });
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chart) {
    if (visibleRangeHandler) {
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(visibleRangeHandler);
      } catch (e) {}
      visibleRangeHandler = null;
    }
    chart.remove();
    chart = null;
  }
});

watch(
  () => props.candles,
  (newCandles) => {
    // Si llegan velas y coincide con un cambio de símbolo pendiente, forzar autoScale
    const needFit = isFirstLoad || (props.symbol && props.symbol !== lastRenderedSymbol);
    updateChartData(needFit);
  },
  { deep: true }
);

watch(
  () => [props.symbol, props.timeframe],
  () => {
    isFirstLoad = true;
    clearPriceLines();
    obOriginStyle.value = null;
    if (chart) {
      try {
        chart.priceScale('right').applyOptions({ autoScale: true });
      } catch (e) {}
    }
  }
);

watch(
  () => [
    props.h1Price,
    props.vLinePrice,
    props.boxFloor,
    props.boxCeiling,
    props.entryLevel50,
    props.stopLossPrice,
    props.h1StructuralPrice,
    props.obHigh,
    props.obMid50,
    props.obLow,
    props.marketType,
    props.operationType,
  ],
  () => {
    updatePriceLines();
    updateMarkers();
    updateObOriginMarker();
  }
);

watch(
  () => props.obEpoch,
  () => {
    updateMarkers();
    updateObOriginMarker();
  }
);

watch(
  () => [props.activeTrade, props.activeTrade?.pnlPoints],
  () => {
    updatePriceLines();
    updateMarkers();
    updateObOriginMarker();
  },
  { deep: true }
);
</script>

<style scoped>
.crash-chart-wrapper {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}

.chart-legend-bar {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.legend-pill {
  font-weight: 700;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.chart-canvas-shell {
  position: relative;
  width: 100%;
  height: 520px;
}

.chart-canvas-container {
  width: 100%;
  height: 100%;
}

.ob-origin-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 8;
  width: 0;
  pointer-events: none;
}

.ob-origin-marker__band {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--ob-origin-width) / -2);
  width: var(--ob-origin-width);
  background: var(--ob-origin-bg);
  border-left: 1px solid rgba(255, 255, 255, 0.65);
  border-right: 1px solid rgba(255, 255, 255, 0.65);
}

.ob-origin-marker__line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -1px;
  border-left: 2px dashed var(--ob-origin-color);
  opacity: 0.95;
}

.ob-origin-marker__label {
  position: absolute;
  top: 18px;
  left: 8px;
  white-space: nowrap;
  border-radius: 6px;
  background: var(--ob-origin-color);
  color: white;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  padding: 5px 7px;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18);
}

.ob-origin-marker--boom .ob-origin-marker__label {
  top: auto;
  bottom: 18px;
}
</style>
