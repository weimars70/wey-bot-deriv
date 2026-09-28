<template>
  <div class="apex-card" :class="dirClass">
    <!-- ── Header: mercado + dirección ──────────────────────── -->
    <div class="apex-card__header">
      <span class="apex-card__market">{{ signal.mercado }}</span>
      <span class="apex-card__dir-badge" :class="dirClass">
        {{ signal.direccion }}
      </span>
    </div>

    <!-- ── Stars + rb + recorrido ─────────────────────────── -->
    <div class="apex-card__meta">
      <span class="apex-card__stars" :title="`${signal.estrellas} estrellas`">
        <span
          v-for="i in 4"
          :key="i"
          class="apex-card__star"
          :class="{ active: i <= signal.estrellas }"
        >★</span>
      </span>
      <span class="apex-card__rb">
        <span class="apex-card__label">R/B</span>
        <span class="apex-card__value rb-value">{{ signal.rb }}</span>
      </span>
      <span class="apex-card__recorrido">
        <span class="apex-card__label">recorrido</span>
        <span class="apex-card__value">{{ signal.recorrido }}</span>
      </span>
    </div>

    <!-- ── Niveles: entrada / sl / tp ─────────────────────── -->
    <div class="apex-card__levels">
      <div class="apex-card__level">
        <span class="apex-card__level-label">entrada</span>
        <span class="apex-card__level-val">{{ fmt(signal.entrada) }}</span>
      </div>
      <span class="apex-card__sep">·</span>
      <div class="apex-card__level">
        <span class="apex-card__level-label sl">sl</span>
        <span class="apex-card__level-val sl">{{ fmt(signal.sl) }}</span>
      </div>
      <span class="apex-card__sep">·</span>
      <div class="apex-card__level">
        <span class="apex-card__level-label tp">tp</span>
        <span class="apex-card__level-val tp">{{ fmt(signal.tp) }}</span>
      </div>
    </div>

    <!-- ── Sesgo / alineación ─────────────────────────────── -->
    <div v-if="signal.sesgo" class="apex-card__sesgo" :class="sesgoClass">
      {{ signal.sesgo }}
    </div>

    <!-- ── Footer: timestamp ──────────────────────────────── -->
    <div class="apex-card__footer">
      <q-icon name="schedule" size="10px" />
      {{ timeAgo }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  signal: { type: Object, required: true },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const timeAgo = computed(() => {
  if (!props.signal.capturedAt) return '';
  const diff = Date.now() - new Date(props.signal.capturedAt).getTime();
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)  return `hace ${sec}s`;
  const min  = Math.floor(sec / 60);
  return `hace ${min}m`;
});
</script>

<style scoped>
/* ── Card base ─────────────────────────────────────────────────────────────── */
.apex-card {
  background:    #ffffff;
  border:        1px solid #e2e8f0;
  border-radius: 12px;
  padding:       14px 16px;
  position:      relative;
  overflow:      hidden;
  transition:    border-color 0.2s, box-shadow 0.2s, transform 0.2s;
  box-shadow:    0 2px 10px rgba(0, 0, 0, 0.06);
}

.apex-card::before {
  content:  '';
  position: absolute;
  top:      0;
  left:     0;
  right:    0;
  height:   4px;
  border-radius: 12px 12px 0 0;
}

.apex-card.compra::before { background: linear-gradient(90deg, #10b981, #059669); }
.apex-card.venta::before  { background: linear-gradient(90deg, #ef4444, #dc2626); }
.apex-card.neutral::before { background: #94a3b8; }

.apex-card.compra { border-color: #a7f3d0; }
.apex-card.venta  { border-color: #fecaca; }

.apex-card:hover {
  border-color: #cbd5e1;
  box-shadow:   0 8px 24px rgba(0, 0, 0, 0.1);
  transform:    translateY(-2px);
}

/* ── Header ────────────────────────────────────────────────────────────────── */
.apex-card__header {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  margin-bottom:   10px;
}

.apex-card__market {
  font-size:      15px;
  font-weight:    800;
  color:          #0f172a;
  letter-spacing: 0.3px;
}

.apex-card__dir-badge {
  font-size:      11px;
  font-weight:    800;
  padding:        3px 10px;
  border-radius:  20px;
  letter-spacing: 1.2px;
}

.apex-card__dir-badge.compra {
  background: #d1fae5;
  color:      #065f46;
  border:     1px solid #6ee7b7;
}

.apex-card__dir-badge.venta {
  background: #fee2e2;
  color:      #991b1b;
  border:     1px solid #fca5a5;
}

.apex-card__dir-badge.neutral {
  background: #e2e8f0;
  color:      #334155;
  border:     1px solid #cbd5e1;
}

/* ── Stars / meta ──────────────────────────────────────────────────────────── */
.apex-card__meta {
  display:       flex;
  align-items:   center;
  gap:           12px;
  margin-bottom: 10px;
  flex-wrap:     wrap;
}

.apex-card__stars {
  display: flex;
  gap:     1px;
}

.apex-card__star {
  font-size:  13px;
  color:      #cbd5e1;
  transition: color 0.1s;
}
.apex-card__star.active { color: #f59e0b; }

.apex-card__rb,
.apex-card__recorrido {
  display:     flex;
  align-items: baseline;
  gap:         5px;
}

.apex-card__label {
  font-size:      10px;
  font-weight:    700;
  color:          #64748b;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.apex-card__value {
  font-size:   13px;
  font-weight: 700;
  color:       #1e293b;
}

.rb-value {
  color:     #b45309;
  font-size: 14px;
}

/* ── Levels ────────────────────────────────────────────────────────────────── */
.apex-card__levels {
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

.apex-card__level {
  display:        flex;
  flex-direction: column;
  align-items:    center;
}

.apex-card__level-label {
  font-size:      9px;
  font-weight:    700;
  color:          #64748b;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom:  1px;
}

.apex-card__level-val {
  font-size:   12px;
  font-weight: 700;
  color:       #0f172a;
}

.apex-card__level-val.sl   { color: #dc2626; }
.apex-card__level-val.tp   { color: #059669; }
.apex-card__level-label.sl { color: #dc2626; }
.apex-card__level-label.tp { color: #059669; }

.apex-card__sep {
  color:     #cbd5e1;
  font-size: 14px;
}

/* ── Sesgo ─────────────────────────────────────────────────────────────────── */
.apex-card__sesgo {
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

/* ── Footer ────────────────────────────────────────────────────────────────── */
.apex-card__footer {
  display:     flex;
  align-items: center;
  gap:         4px;
  font-size:   10px;
  font-weight: 600;
  color:       #64748b;
  margin-top:  2px;
}
</style>
