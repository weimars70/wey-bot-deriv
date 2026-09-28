<template>
  <div class="signal-card" :class="[dirClass, classTheme]">
    <!-- Accent stripe top -->
    <div class="card-stripe"></div>

    <!-- Header -->
    <div class="signal-header">
      <div class="signal-symbol">
        <span class="symbol-icon">{{ symbolIcon }}</span>
        {{ signal.symbol }}
      </div>
      <div class="signal-badge" :class="dirClass">
        {{ signal.direction }}
      </div>
    </div>

    <!-- Insufficient data notice -->
    <div v-if="signal.insufficientData" class="insufficient-notice">
      <q-icon name="hourglass_empty" size="14px" />
      Sin datos suficientes — suscríbete a este símbolo
    </div>

    <template v-else>
      <!-- Stars + R/B + Recorrido -->
      <div class="signal-meta">
        <span class="signal-stars">
          <span v-for="i in 4" :key="i" class="star" :class="{ 'star--on': i <= signal.stars }">★</span>
        </span>
        <span class="signal-pill">R/B {{ signal.rb }}</span>
        <span class="signal-pill">recorrido {{ signal.recorrido }}%</span>
      </div>

      <!-- Entry / SL / TP -->
      <div class="signal-levels">
        <span>entrada <b>{{ signal.entry }}</b></span>
        <span class="signal-sep">·</span>
        <span>sl <b class="level-sl">{{ signal.sl }}</b></span>
        <span class="signal-sep">·</span>
        <span>tp <b class="level-tp">{{ signal.tp }}</b></span>
      </div>

      <!-- MTF Alignment label -->
      <div class="signal-alignment" :class="alignClass">
        <q-icon :name="alignIcon" size="12px" />
        {{ signal.alignment }}
      </div>

      <!-- MTF detail badges -->
      <div class="signal-mtf">
        <span
          v-for="(dir, tf) in signal.alignmentDetail"
          :key="tf"
          class="mtf-badge"
          :class="dir === 'COMPRA' ? 'mtf--up' : dir === 'VENTA' ? 'mtf--down' : 'mtf--neutral'"
        >
          {{ tf }}
          <span class="mtf-arrow">{{ dir === 'COMPRA' ? '▲' : dir === 'VENTA' ? '▼' : '—' }}</span>
        </span>
      </div>
    </template>

    <!-- Footer -->
    <div class="signal-footer">
      {{ granularityLabel }}
      <template v-if="!signal.insufficientData"> · RSI {{ signal.rsi }} · {{ timeAgo }}</template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  signal: { type: Object, required: true },
});

const dirClass = computed(() => {
  if (props.signal.direction === 'COMPRA') return 'dir--buy';
  if (props.signal.direction === 'VENTA')  return 'dir--sell';
  return 'dir--neutral';
});

// Extra theme based on symbolClass: crash gets red tones, boom gets green tones
const classTheme = computed(() => {
  const c = props.signal.symbolClass;
  if (c === 'crash') return 'theme--crash';
  if (c === 'boom')  return 'theme--boom';
  return '';
});

const symbolIcon = computed(() => {
  const c = props.signal.symbolClass;
  if (c === 'crash') return '💥';
  if (c === 'boom')  return '🚀';
  return '📈';
});

const alignClass = computed(() => {
  const a = props.signal.alignment ?? '';
  if (a === 'ALINEADO')  return 'align--ok';
  if (a === 'PARCIAL')   return 'align--partial';
  return 'align--mixed';
});

const alignIcon = computed(() => {
  const a = props.signal.alignment ?? '';
  if (a === 'ALINEADO')  return 'check_circle';
  if (a === 'PARCIAL')   return 'warning';
  return 'shuffle';
});

const granularityLabel = computed(() => {
  const g = props.signal.granularity;
  const map = { 60: '1m', 300: '5m', 600: '10m', 900: '15m', 3600: '1h', 14400: '4h' };
  return map[g] ?? `${g}s`;
});

const timeAgo = computed(() => {
  if (!props.signal.computedAt) return '';
  const diff = Math.floor((Date.now() - new Date(props.signal.computedAt).getTime()) / 1000);
  if (diff < 60) return `hace ${diff}s`;
  return `hace ${Math.floor(diff / 60)}m`;
});
</script>

<style scoped>
/* ── Card shell ───────────────────────────────────────────── */
.signal-card {
  background:    #ffffff;
  border:        1px solid #e2e8f0;
  border-radius: 12px;
  padding:       0 16px 14px;
  display:       flex;
  flex-direction: column;
  gap:           8px;
  transition:    box-shadow 0.25s, border-color 0.25s, transform 0.2s;
  position:      relative;
  overflow:      hidden;
  box-shadow:    0 2px 10px rgba(0, 0, 0, 0.06);
}

.signal-card:hover {
  border-color: #cbd5e1;
  box-shadow:   0 8px 24px rgba(0, 0, 0, 0.1);
  transform:    translateY(-2px);
}

/* ── Accent stripe (top) ──────────────────────────────────── */
.card-stripe {
  height:       4px;
  margin:       0 -16px 6px;
  border-radius: 12px 12px 0 0;
  transition:   background 0.3s;
}

.dir--buy  .card-stripe { background: linear-gradient(90deg, #10b981, #059669); }
.dir--sell .card-stripe { background: linear-gradient(90deg, #ef4444, #dc2626); }
.dir--neutral .card-stripe { background: #94a3b8; }

/* Symbol-class themed border */
.theme--crash { border-color: #fecaca; }
.theme--boom  { border-color: #a7f3d0; }

/* ── Header ───────────────────────────────────────────────── */
.signal-header {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  padding-top:     2px;
}

.signal-symbol {
  font-size:    14px;
  font-weight:  800;
  color:        #0f172a;
  display:      flex;
  align-items:  center;
  gap:          6px;
}

.symbol-icon { font-size: 16px; }

.signal-badge {
  font-size:      11px;
  font-weight:    800;
  letter-spacing: 1.2px;
  padding:        3px 10px;
  border-radius:  20px;
}

.dir--buy  .signal-badge { color: #065f46; border: 1px solid #6ee7b7; background: #d1fae5; }
.dir--sell .signal-badge { color: #991b1b; border: 1px solid #fca5a5; background: #fee2e2; }
.dir--neutral .signal-badge { color: #334155; border: 1px solid #cbd5e1; background: #e2e8f0; }

/* ── Insufficient notice ──────────────────────────────────── */
.insufficient-notice {
  font-size:   11px;
  color:       #64748b;
  display:     flex;
  align-items: center;
  gap:         5px;
  padding:     6px 0;
}

/* ── Stars + pills ────────────────────────────────────────── */
.signal-meta {
  display:     flex;
  align-items: center;
  gap:         10px;
  flex-wrap:   wrap;
}

.signal-stars { display: flex; gap: 2px; }

.star { font-size: 14px; color: #cbd5e1; transition: color 0.15s; }
.star--on { color: #f59e0b; }

.signal-pill {
  font-size:    11px;
  font-weight:  700;
  background:   #f8fafc;
  color:        #475569;
  border-radius: 99px;
  padding:      2px 9px;
  border:       1px solid #e2e8f0;
}

/* ── Levels ───────────────────────────────────────────────── */
.signal-levels {
  font-size:   12px;
  font-weight: 600;
  color:       #64748b;
  display:     flex;
  flex-wrap:   wrap;
  gap:         6px;
  align-items: center;
  background:  #f8fafc;
  padding:     6px 10px;
  border-radius: 8px;
  border:      1px solid #e2e8f0;
}

.signal-levels b { color: #0f172a; font-weight: 700; }
.signal-sep     { color: #cbd5e1; }
.level-sl       { color: #dc2626 !important; }
.level-tp       { color: #059669 !important; }

/* ── Alignment ────────────────────────────────────────────── */
.signal-alignment {
  font-size:      11px;
  font-weight:    700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  display:        flex;
  align-items:    center;
  gap:            4px;
}

.align--ok      { color: #059669; }
.align--partial { color: #d97706; }
.align--mixed   { color: #64748b; }

/* ── MTF badges ───────────────────────────────────────────── */
.signal-mtf {
  display:  flex;
  gap:      6px;
  flex-wrap: wrap;
}

.mtf-badge {
  font-size:   10px;
  font-weight: 700;
  padding:     2px 7px;
  border-radius: 5px;
  display:     flex;
  align-items: center;
  gap:         3px;
  letter-spacing: 0.3px;
}

.mtf--up      { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.mtf--down    { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.mtf--neutral { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; }

.mtf-arrow { font-size: 8px; }

/* ── Footer ───────────────────────────────────────────────── */
.signal-footer {
  font-size:      10px;
  font-weight:    600;
  color:          #64748b;
  margin-top:     2px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}
</style>
