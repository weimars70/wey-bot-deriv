<template>
  <q-page class="q-pa-md dashboard-page">
    <div class="section-header wey-section-header q-mb-md row items-center justify-between">
      <div class="row items-center q-gutter-sm">
        <span class="live-pulse-dot wey-pulse active" />
        <div>
          <div class="wey-title row items-center q-gutter-xs">
            <span>⚡ Wey Trading · Sala de Operaciones</span>
            <span class="wey-tag">MOTOR LOCAL</span>
          </div>
          <div class="section-sub">
            Contexto de hasta 90 días · 4H, 1H, 30M y 15M · ordenado por estrellas
            <span v-if="lastWeyUpdate" class="q-ml-xs">
              · calculado {{ lastWeyUpdateTime }}
            </span>
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <!-- Reloj anticipado dos minutos antes de cada cuarto de hora -->
        <div class="evaluation-clock-pill row items-center q-px-sm q-py-xs">
          <q-icon name="timer" size="14px" class="q-mr-xs text-indigo-7" />
          <span class="text-caption text-weight-bold text-slate-700">
            Próxima evaluación: <span class="text-indigo-9 text-weight-bolder">{{ countdownText }}</span> ({{ nextEvaluationTime }})
          </span>
          <q-tooltip>Evaluación anticipada a las :13, :28 y :43</q-tooltip>
        </div>

        <q-toggle
          v-model="onlyViable"
          color="positive"
          dense
          label="Solo Viables"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Oculta entradas sin confluencia macro, reacción histórica o enfriamiento suficiente</q-tooltip>
        </q-toggle>

        <q-toggle
          v-model="onlyThreeStars"
          color="indigo-7"
          dense
          label="Solo 3★ o más"
          class="text-caption text-weight-bold text-slate-700"
        >
          <q-tooltip>Mostrar solo señales locales con 3 o 4 estrellas</q-tooltip>
        </q-toggle>

        <q-btn
          unelevated
          color="indigo-7"
          icon="sync"
          label="Recalcular"
          dense
          class="q-px-sm"
          :loading="weyLoading"
          @click="loadWeySignals"
        />

        <q-btn
          flat
          dense
          color="indigo-7"
          icon="candlestick_chart"
          label="Estrategia H1 (24h)"
          to="/h1-strategy"
        >
          <q-tooltip>Abrir monitor de velas H1 sin mecha y alertas</q-tooltip>
        </q-btn>

      </div>
    </div>

    <!-- Wey loading skeletons -->
    <div v-if="weyLoading && !weySignalsList.length" class="row q-col-gutter-md q-mb-xl">
      <div v-for="i in 4" :key="i" class="col-12 col-sm-6 col-lg-3">
        <q-skeleton type="rect" height="175px" style="border-radius:12px;" />
      </div>
    </div>

    <!-- Wey empty state -->
    <div
      v-else-if="!weySignalsList.length"
      class="empty-box q-pa-xl text-center q-mb-xl"
    >
      <q-icon name="stars" size="44px" color="amber-7" />
      <div class="text-subtitle1 text-weight-bold text-slate-800 q-mt-sm">
        No hay señales Wey viables en este momento
      </div>
      <div class="text-caption text-slate-500 q-mt-xs">
        El motor Wey verifica tendencia macro M15 (EMA 50), estructura y enfriamiento de spikes. Las entradas no viables se ocultan para proteger tu capital.
      </div>
      <div class="row items-center justify-center q-gutter-sm q-mt-md">
        <q-btn
          v-if="onlyViable"
          outline
          dense
          color="primary"
          label="Ver todas (incluyendo no viables)"
          class="q-px-sm text-weight-bold"
          @click="onlyViable = false"
        />
        <q-btn
          v-if="onlyThreeStars"
          flat
          dense
          color="slate-700"
          label="Mostrar también 1★ y 2★"
          class="q-px-sm text-weight-bold"
          @click="onlyThreeStars = false"
        />
      </div>
    </div>

    <!-- Wey Signal Cards Grid (identicas a Apex, ordenadas por estrellas desc) -->
    <div v-else class="row q-col-gutter-md q-mb-xl">
      <div
        v-for="s in weySignalsList"
        :key="s.symbol"
        class="col-12 col-sm-6 col-lg-3"
      >
        <WeySignalCard :signal="s" />
      </div>
    </div>

  </q-page>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { weySignalsService } from 'src/services/weySignals.service';
import WeySignalCard from 'src/components/WeySignalCard.vue';

const weyLoading        = ref(false);
const rawWeySignals     = ref([]);
const lastWeyUpdate     = ref(null);
const onlyThreeStars    = ref(true);
const onlyViable        = ref(true);
const countdownText     = ref('00:00');
const nextEvaluationTime = ref('');
let countdownTimer       = null;
let lastScheduledEvaluationKey = null;

const lastWeyUpdateTime = computed(() => {
  if (!lastWeyUpdate.value) return '';
  return new Date(lastWeyUpdate.value).toLocaleTimeString();
});

function updateCountdown() {
  const now = new Date();
  const evaluationMinutes = [13, 28, 43, 58];
  const minutes = now.getMinutes();

  if (evaluationMinutes.includes(minutes) && now.getSeconds() <= 1) {
    const evaluationKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${minutes}`;
    if (lastScheduledEvaluationKey !== evaluationKey) {
      lastScheduledEvaluationKey = evaluationKey;
      loadWeySignals();
    }
  }

  const nextTargetMinute = evaluationMinutes.find((minute) => minute > minutes);
  const targetDate = new Date(now);
  if (nextTargetMinute === undefined) {
    targetDate.setHours(now.getHours() + 1, evaluationMinutes[0], 0, 0);
  } else {
    targetDate.setMinutes(nextTargetMinute, 0, 0);
  }

  const diffMs = targetDate.getTime() - now.getTime();
  const totalSec = Math.floor(diffMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  countdownText.value = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  nextEvaluationTime.value = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Señales locales Wey ordenadas por estrellas de mayor a menor (4★ → 3★)
const weySignalsList = computed(() => {
  let list = rawWeySignals.value;
  if (onlyViable.value) {
    list = list.filter((s) => s.viable);
  }
  if (onlyThreeStars.value) {
    list = list.filter((s) => (s.estrellas ?? 0) >= 3);
  }
  return [...list].sort((a, b) => {
    // Ordenar de mayor a menor estrellas
    if ((b.estrellas ?? 0) !== (a.estrellas ?? 0)) {
      return (b.estrellas ?? 0) - (a.estrellas ?? 0);
    }
    // Si empatan, mayor R:B
    if ((b.rb ?? 0) !== (a.rb ?? 0)) {
      return (b.rb ?? 0) - (a.rb ?? 0);
    }
    return a.mercado.localeCompare(b.mercado);
  });
});

async function loadWeySignals() {
  weyLoading.value = true;
  try {
    const res = await weySignalsService.getSignals(0, false);
    if (res && Array.isArray(res.signals)) {
      rawWeySignals.value = res.signals;
      lastWeyUpdate.value = res.lastUpdated || new Date().toISOString();
    }
  } catch (err) {
    console.error('Error al cargar señales Wey:', err);
  } finally {
    weyLoading.value = false;
  }
}

onMounted(() => {
  loadWeySignals();
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
});

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});
</script>

<style scoped>
.dashboard-page {
  background-color: #f8fafc;
  min-height: 100vh;
}

.text-slate-900 { color: #0f172a; }
.text-slate-800 { color: #1e293b; }
.text-slate-700 { color: #334155; }
.text-slate-500 { color: #64748b; }
.text-slate-400 { color: #94a3b8; }

/* ── Section Headers ─────────────────────────────────────────────────────── */
.section-header {
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 12px;
}

.wey-section-header {
  border-top:    1px solid #e2e8f0;
  padding-top:   24px;
}

.wey-title {
  font-size:      17px;
  font-weight:    800;
  color:          #4338ca;
  letter-spacing: 0.3px;
}

.wey-tag {
  font-size:      9px;
  font-weight:    800;
  background:     #e0e7ff;
  color:          #4338ca;
  padding:        2px 6px;
  border-radius:  4px;
  letter-spacing: 0.8px;
}

.section-sub {
  font-size:  11px;
  color:      #64748b;
  margin-top: 2px;
}

/* ── Live Pulse Dots ─────────────────────────────────────────────────────── */
.live-pulse-dot {
  display:       inline-block;
  width:         8px;
  height:        8px;
  border-radius: 50%;
  background:    #cbd5e1;
  flex-shrink:   0;
  transition:    background 0.3s;
}

.wey-pulse.active {
  background: #6366f1;
  box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6);
  animation:  wey-pulse-anim 2s ease-in-out infinite;
}

@keyframes wey-pulse-anim {
  0%   { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.7); }
  70%  { box-shadow: 0 0 0 7px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}

.empty-box {
  background:    #ffffff;
  border:        1px dashed #e2e8f0;
  border-radius: 12px;
}

.evaluation-clock-pill {
  background: #ede9fe;
  border: 1px solid #c4b5fd;
  border-radius: 8px;
}

</style>
