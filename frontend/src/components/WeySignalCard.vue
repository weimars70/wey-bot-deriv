<template>
  <div class="wey-card" :class="dirClass">
    <!-- ── Header: mercado + dirección ──────────────────────── -->
    <div class="wey-card__header">
      <div class="row items-center q-gutter-xs">
        <span class="wey-card__market">{{ signal.mercado }}</span>
        <span class="wey-badge-pill">WEY</span>
      </div>
      <span class="wey-card__dir-badge" :class="dirClass">
        {{ signal.direccion }}
      </span>
    </div>

    <!-- ── Stars + rb + recorrido ─────────────────────────── -->
    <div class="wey-card__meta">
      <span class="wey-card__stars" :title="`${signal.estrellas} estrellas`">
        <span
          v-for="i in 4"
          :key="i"
          class="wey-card__star"
          :class="{ active: i <= signal.estrellas }"
        >★</span>
      </span>
      <span class="wey-card__rb">
        <span class="wey-card__label">R/B</span>
        <span class="wey-card__value rb-value">{{ signal.rb }}</span>
      </span>
      <span class="wey-card__recorrido">
        <span class="wey-card__label">recorrido</span>
        <span class="wey-card__value">{{ signal.recorrido }}</span>
      </span>
    </div>

    <!-- ── Niveles: entrada / sl / tp ─────────────────────── -->
    <div class="wey-card__levels">
      <div class="wey-card__level">
        <span class="wey-card__level-label">entrada</span>
        <span class="wey-card__level-val">{{ fmt(signal.entrada) }}</span>
      </div>
      <span class="wey-card__sep">·</span>
      <div class="wey-card__level">
        <span class="wey-card__level-label sl">sl</span>
        <span class="wey-card__level-val sl">{{ fmt(signal.sl) }}</span>
      </div>
      <span class="wey-card__sep">·</span>
      <div class="wey-card__level">
        <span class="wey-card__level-label tp">tp</span>
        <span class="wey-card__level-val tp">{{ fmt(signal.tp) }}</span>
      </div>
    </div>

    <!-- ── Viabilidad y Estadística de Reacción de Spikes ─── -->
    <div class="wey-card__viability row items-center justify-between q-mt-xs q-mb-xs">
      <div class="row items-center q-gutter-xs">
        <span
          class="wey-viability-badge"
          :class="signal.viable ? 'viable--yes' : 'viable--no'"
          :title="signal.viabilityReason || ''"
        >
          <q-icon :name="signal.viable ? 'check_circle' : 'schedule'" size="11px" class="q-mr-xs" />
          {{ signal.viable ? 'VIABLE' : 'NO VIABLE' }}
        </span>
        <span v-if="signal.macroTrendH4" class="wey-trend-badge" :class="macroTrendH4Class" title="Tendencia Macro 4 Horas">
          4H: {{ signal.macroTrendH4 }}
        </span>
        <span v-if="signal.macroTrend" class="wey-trend-badge" :class="macroTrendClass" title="Tendencia 15 Minutos (EMA 50)">
          15M: {{ signal.macroTrend }}
        </span>
      </div>
      <div class="row items-center q-gutter-xs">
        <div
          v-if="signal.historicalReactionFrames !== undefined"
          class="wey-reaction-stat"
          :title="historyContextTitle"
        >
          <span class="text-caption text-weight-bold text-slate-700">
            Hist {{ signal.historicalReactionFrames }}/4
          </span>
        </div>
        <div
          v-if="signal.avgReactionCandles"
          class="wey-reaction-stat"
          :title="`Velas 5M acumuladas sin spike (${signal.candlesSinceLastSpike}) vs media histórica (${signal.avgReactionCandles})`"
        >
          <span class="text-caption text-weight-bold text-slate-700">
            {{ signal.candlesSinceLastSpike }} / {{ signal.avgReactionCandles }}v
          </span>
        </div>
      </div>
    </div>

    <!-- ── Confluencia MTF (4H · 1H · 30M · 15M) ─────────────── -->
    <div v-if="signal.alignmentDetail" class="wey-card__mtf row items-center justify-between q-my-xs">
      <span class="text-caption text-weight-bold text-slate-500">Marcos:</span>
      <div class="row items-center q-gutter-xs">
        <span
          v-for="tf in ['4h', '1h', '30m', '15m']"
          :key="tf"
          class="mtf-chip"
          :class="getMtfChipClass(tf)"
          :title="`Temporalidad ${tf.toUpperCase()}: ${signal.alignmentDetail[tf] || 'Sin datos'}`"
        >
          {{ tf.toUpperCase() }}
          <q-icon :name="getMtfIcon(tf)" size="11px" class="q-ml-xs" />
        </span>
      </div>
    </div>

    <!-- Motivo si no es viable -->
    <div v-if="!signal.viable && signal.viabilityReason" class="wey-card__reason text-caption text-negative q-mb-xs">
      ⚠️ {{ signal.viabilityReason }}
    </div>

    <!-- ── Sesgo / alineación ─────────────────────────────── -->
    <div v-if="signal.sesgo" class="wey-card__sesgo" :class="sesgoClass">
      {{ signal.sesgo }}
    </div>

    <!-- ── Footer: timestamp + info ───────────────────────── -->
    <div class="wey-card__footer row items-center justify-between">
      <div class="row items-center q-gutter-xs">
        <q-icon name="schedule" size="11px" />
        <span>{{ timeAgo }}</span>
      </div>
      <div v-if="signal.rsi" class="wey-card__tech">
        5M: RSI {{ signal.rsi }} · ATR {{ signal.atr }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  signal: { type: Object, required: true },
});

function fmt(n) {
  if (!n) return '—';
  return Number(n).toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

const dirClass = computed(() => {
  const d = (props.signal.direccion ?? '').toUpperCase();
  if (d === 'COMPRA') return 'compra';
  if (d === 'VENTA')  return 'venta';
  return 'neutral';
});

const sesgoClass = computed(() => {
  const s = (props.signal.sesgo ?? '').toUpperCase();
  if (s.includes('ALCISTA'))   return 'sesgo--bull';
  if (s.includes('BAJISTA'))   return 'sesgo--bear';
  if (s.includes('MEZCLADO'))  return 'sesgo--mixed';
  return 'sesgo--neutral';
});

const macroTrendClass = computed(() => {
  const t = (props.signal.macroTrend ?? '').toUpperCase();
  if (t === 'ALCISTA') return 'trend--bull';
  if (t === 'BAJISTA') return 'trend--bear';
  return 'trend--neutral';
});

const macroTrendH4Class = computed(() => {
  const t = (props.signal.macroTrendH4 ?? '').toUpperCase();
  if (t === 'ALCISTA') return 'trend--bull';
  if (t === 'BAJISTA') return 'trend--bear';
  return 'trend--neutral';
});

const historyContextTitle = computed(() => {
  const context = props.signal.historyContext || {};
  return ['4h', '1h', '30m', '15m']
    .map((tf) => {
      const item = context[tf];
      if (!item) return `${tf.toUpperCase()}: sin datos`;
      const age = item.recentReactionAgeHours === null
        ? 'sin reacción'
        : `última reacción hace ${item.recentReactionAgeHours}h`;
      return `${tf.toUpperCase()}: ${item.daysAnalyzed} días, ${item.reactionCount} reacciones, ${age}`;
    })
    .join(' · ');
});

function getMtfChipClass(tf) {
  const detail = props.signal.alignmentDetail || {};
  const dir = (detail[tf] || '').toUpperCase();
  const baseDir = (props.signal.direccion || '').toUpperCase();
  const isMatch = dir === baseDir && dir !== 'NEUTRAL';
  let cls = '';
  if (dir === 'COMPRA') cls = 'mtf-chip--bull';
  else if (dir === 'VENTA') cls = 'mtf-chip--bear';
  else cls = 'mtf-chip--neutral';

  if (isMatch) cls += ' mtf-chip--active-match';
  return cls;
}

function getMtfIcon(tf) {
  const detail = props.signal.alignmentDetail || {};
  const dir = (detail[tf] || '').toUpperCase();
  if (dir === 'COMPRA') return 'north';
  if (dir === 'VENTA') return 'south';
  return 'remove';
}

const timeAgo = computed(() => {
  if (!props.signal.capturedAt) return 'en vivo';
  const diff = Date.now() - new Date(props.signal.capturedAt).getTime();
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)  return `hace ${sec}s`;
  const min  = Math.floor(sec / 60);
  return `hace ${min}m`;
});
</script>

<style scoped>
/* ── Card base ─────────────────────────────────────────────────────────────── */
.wey-card {
  background:    #ffffff;
  border:        1px solid #e2e8f0;
  border-radius: 12px;
  padding:       14px 16px;
  position:      relative;
  overflow:      hidden;
  transition:    border-color 0.2s, box-shadow 0.2s, transform 0.2s;
  box-shadow:    0 2px 10px rgba(0, 0, 0, 0.05);
}

.wey-card::before {
  content:  '';
  position: absolute;
  top:      0;
  left:     0;
  right:    0;
  height:   4px;
  border-radius: 12px 12px 0 0;
}

.wey-card.compra::before { background: linear-gradient(90deg, #10b981, #059669); }
.wey-card.venta::before  { background: linear-gradient(90deg, #ef4444, #dc2626); }
.wey-card.neutral::before { background: #94a3b8; }

.wey-card.compra { border-color: #a7f3d0; }
.wey-card.venta  { border-color: #fecaca; }

.wey-card:hover {
  border-color: #cbd5e1;
  box-shadow:   0 8px 24px rgba(0, 0, 0, 0.09);
  transform:    translateY(-2px);
}

/* ── Header ────────────────────────────────────────────────────────────────── */
.wey-card__header {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  margin-bottom:   10px;
}

.wey-card__market {
  font-size:      15px;
  font-weight:    800;
  color:          #0f172a;
  letter-spacing: 0.3px;
}

.wey-badge-pill {
  font-size:      9px;
  font-weight:    800;
  background:     #e0e7ff;
  color:          #4338ca;
  padding:        1px 6px;
  border-radius:  4px;
  letter-spacing: 0.5px;
}

.wey-card__dir-badge {
  font-size:      11px;
  font-weight:    800;
  padding:        3px 10px;
  border-radius:  20px;
  letter-spacing: 1.2px;
}

.wey-card__dir-badge.compra {
  background: #d1fae5;
  color:      #065f46;
  border:     1px solid #6ee7b7;
}

.wey-card__dir-badge.venta {
  background: #fee2e2;
  color:      #991b1b;
  border:     1px solid #fca5a5;
}

.wey-card__dir-badge.neutral {
  background: #e2e8f0;
  color:      #334155;
  border:     1px solid #cbd5e1;
}

/* ── Stars / meta ──────────────────────────────────────────────────────────── */
.wey-card__meta {
  display:       flex;
  align-items:   center;
  gap:           12px;
  margin-bottom: 10px;
  flex-wrap:     wrap;
}

.wey-card__stars {
  display: flex;
  gap:     1px;
}

.wey-card__star {
  font-size:  13px;
  color:      #cbd5e1;
  transition: color 0.1s;
}
.wey-card__star.active { color: #f59e0b; }

.wey-card__rb,
.wey-card__recorrido {
  display:     flex;
  align-items: baseline;
  gap:         5px;
}

.wey-card__label {
  font-size:      10px;
  font-weight:    700;
  color:          #64748b;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.wey-card__value {
  font-size:   13px;
  font-weight: 700;
  color:       #1e293b;
}

.rb-value {
  color:     #b45309;
  font-size: 14px;
}

/* ── Levels ────────────────────────────────────────────────────────────────── */
.wey-card__levels {
  display:          flex;
  align-items:      center;
  justify-content:  space-between;
  gap:              6px;
  margin-bottom:    10px;
  background:       #f8fafc;
  padding:          8px 12px;
  border-radius:    8px;
  border:           1px solid #e2e8f0;
}

.wey-card__level {
  display:        flex;
  flex-direction: column;
  align-items:    center;
}

.wey-card__level-label {
  font-size:      9px;
  font-weight:    700;
  color:          #64748b;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom:  1px;
}

.wey-card__level-val {
  font-size:   12px;
  font-weight: 700;
  color:       #0f172a;
}

.wey-card__level-val.sl   { color: #dc2626; }
.wey-card__level-val.tp   { color: #059669; }
.wey-card__level-label.sl { color: #dc2626; }
.wey-card__level-label.tp { color: #059669; }

.wey-card__sep {
  color:     #cbd5e1;
  font-size: 14px;
}

/* ── Sesgo ─────────────────────────────────────────────────────────────────── */
.wey-card__sesgo {
  font-size:      10px;
  font-weight:    700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  padding:        3px 9px;
  border-radius:  5px;
  display:        inline-block;
  margin-bottom:  8px;
}

.sesgo--bull    { color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; }
.sesgo--bear    { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; }
.sesgo--mixed   { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; }
.sesgo--neutral { color: #475569; background: #f8fafc; border: 1px solid #e2e8f0; }

/* ── Viabilidad & Tendencia ───────────────────────────────────────────────── */
.wey-viability-badge {
  font-size:      9px;
  font-weight:    800;
  letter-spacing: 0.5px;
  padding:        2px 6px;
  border-radius:  4px;
  display:        inline-flex;
  align-items:    center;
}
.viable--yes { color: #065f46; background: #d1fae5; border: 1px solid #6ee7b7; }
.viable--no  { color: #9a3412; background: #ffedd5; border: 1px solid #fdba74; }

.wey-trend-badge {
  font-size:      9px;
  font-weight:    700;
  padding:        2px 5px;
  border-radius:  4px;
  letter-spacing: 0.4px;
}
.trend--bull    { color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; }
.trend--bear    { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; }
.trend--neutral { color: #475569; background: #f1f5f9; border: 1px solid #cbd5e1; }

.wey-reaction-stat {
  font-size:   10px;
  background:  #f1f5f9;
  padding:     2px 6px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}

/* ── MTF Chips ─────────────────────────────────────────────────────────────── */
.wey-card__mtf {
  background: #f8fafc;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.mtf-chip {
  font-size: 9px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.mtf-chip--bull {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}
.mtf-chip--bear {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.mtf-chip--neutral {
  background: #f1f5f9;
  color: #64748b;
  border: 1px solid #e2e8f0;
}
.mtf-chip--active-match {
  box-shadow: 0 0 0 1px currentColor;
}

.wey-card__reason {
  font-size: 9px;
  background: #fef2f2;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid #fecaca;
  line-height: 1.2;
}

/* ── Footer ────────────────────────────────────────────────────────────────── */
.wey-card__footer {
  font-size:   10px;
  font-weight: 600;
  color:       #64748b;
  margin-top:  2px;
}

.wey-card__tech {
  font-size:   9px;
  color:       #94a3b8;
  font-family: ui-monospace, monospace;
}
</style>
