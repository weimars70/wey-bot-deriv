<template>
  <q-page class="q-pa-lg ea-smc-page">

    <!-- ═══════════════════════════════════════════════════════════
         ENCABEZADO
    ════════════════════════════════════════════════════════════ -->
    <div class="page-header q-mb-lg row items-center justify-between flex-wrap q-gutter-y-sm">
      <div>
        <div class="row items-center q-gutter-sm">
          <div class="header-icon-box">
            <q-icon name="insights" size="26px" color="white" />
          </div>
          <div>
            <div class="row items-center q-gutter-xs">
              <h1 class="text-h5 text-weight-bolder text-slate-900 q-my-none">
                EA WEY SMC · Scanner
              </h1>
              <q-badge color="purple-7" label="SCANNER" class="text-weight-bold" />
            </div>
            <div class="text-caption text-slate-500 q-mt-xs">
              Escanea los 10 índices Crash &amp; Boom evaluando las condiciones del EA WEY SMC
              (zonas SMC, sesgo HTF, CHoCH, descuento/premium)
            </div>
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <!-- Resumen -->
        <div class="ready-summary-pill row items-center q-px-md q-py-xs">
          <q-icon name="check_circle" size="16px" color="green-7" class="q-mr-xs" />
          <span class="text-caption text-weight-bold text-slate-700">
            <span class="text-green-8 text-weight-bolder">{{ readyCount }}</span>/10 listos para operar
          </span>
        </div>
        <!-- Auto-refresh badge -->
        <q-badge outline color="purple-7" label="AUTO 30s" class="text-weight-bold" />
        <!-- Botón actualizar -->
        <q-btn
          unelevated
          color="purple-7"
          icon="refresh"
          label="ACTUALIZAR SCANNER"
          dense
          class="q-px-sm"
          :loading="loading"
          @click="loadScanner"
        />
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
         LOADING SKELETONS
    ════════════════════════════════════════════════════════════ -->
    <div v-if="loading && !results.length" class="row q-col-gutter-md">
      <div v-for="i in 10" :key="i" class="col-12 col-sm-6 col-lg-4">
        <q-skeleton type="rect" height="220px" style="border-radius:12px;" />
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
         GRID DE RESULTADOS
    ════════════════════════════════════════════════════════════ -->
    <div v-else class="row q-col-gutter-md">
      <div
        v-for="item in results"
        :key="item.symbol"
        class="col-12 col-sm-6 col-lg-4"
      >
        <q-card
          class="smc-card"
          :class="[
            item.direction === 'BUY' ? 'smc-card--boom' : 'smc-card--crash',
            item.ready ? 'smc-card--ready' : '',
          ]"
          flat bordered
        >
          <q-card-section class="q-pa-md">
            <!-- Header: Símbolo + Dirección + Badge LISTO/ESPERANDO -->
            <div class="row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <span class="smc-icon">{{ item.direction === 'BUY' ? '📈' : '📉' }}</span>
                <span class="smc-symbol">{{ item.name }}</span>
                <q-badge
                  :color="item.direction === 'BUY' ? 'green-8' : 'red-8'"
                  :label="item.direction"
                  class="text-weight-bold"
                />
              </div>
              <q-badge
                v-if="item.ready"
                color="green-7"
                label="LISTO ✓"
                class="text-weight-bold smc-ready-badge"
              />
              <q-badge
                v-else
                color="grey-6"
                label="ESPERANDO"
                class="text-weight-bold"
              />
            </div>

            <!-- Score: X/7 estrellas -->
            <div class="row items-center q-gutter-xs q-mb-sm">
              <span class="text-caption text-weight-bold text-slate-500">Score:</span>
              <span
                v-for="n in 7"
                :key="n"
                class="smc-star"
                :class="n <= item.score ? 'smc-star--active' : 'smc-star--empty'"
              >★</span>
              <span class="text-caption text-weight-bold text-slate-600">{{ item.score }}/7</span>
            </div>

            <!-- Checklist de condiciones -->
            <div class="smc-checklist q-mb-sm">
              <div class="smc-check-row">
                <span :class="item.conditions.htfBias ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.htfBias ? '✓' : '✗' }}
                </span>
                <span class="check-label">Sesgo HTF H1</span>
                <q-badge
                  outline
                  :color="item.conditions.htfBiasLabel === 'ALCISTA' ? 'green-7' : item.conditions.htfBiasLabel === 'BAJISTA' ? 'red-7' : 'grey-6'"
                  :label="item.conditions.htfBiasLabel"
                  class="q-ml-xs"
                />
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.hasActiveZone ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.hasActiveZone ? '✓' : '✗' }}
                </span>
                <span class="check-label">Zona SMC activa (≥3 reacciones)</span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.hasPullback ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.hasPullback ? '✓' : '✗' }}
                </span>
                <span class="check-label">Pullback hacia zona (≥1.5 ATR)</span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.hasChoCH ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.hasChoCH ? '✓' : '✗' }}
                </span>
                <span class="check-label">CHoCH / Rechazo confirmado</span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.inDiscountPremium ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.inDiscountPremium ? '✓' : '✗' }}
                </span>
                <span class="check-label">
                  {{ item.direction === 'BUY' ? 'Descuento (precio bajo)' : 'Premium (precio alto)' }}
                </span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.hasRecentSpike ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.hasRecentSpike ? '✓' : '✗' }}
                </span>
                <span class="check-label">Spike reciente (&lt;3h)</span>
              </div>
              <div class="smc-check-row">
                <span :class="item.conditions.notExhausted ? 'check-ok' : 'check-fail'">
                  {{ item.conditions.notExhausted ? '✓' : '✗' }}
                </span>
                <span class="check-label">Sin agotamiento (recorrido ≤45%)</span>
              </div>
            </div>

            <!-- Precio actual y posición -->
            <div class="row items-center justify-between q-mb-xs">
              <div>
                <div class="radar-label">Precio actual</div>
                <div class="radar-value">{{ item.currentPrice }}</div>
              </div>
              <div class="text-right">
                <div class="radar-label">Posición en rango</div>
                <div class="row items-center q-gutter-xs">
                  <q-linear-progress
                    :value="item.pricePosition / 100"
                    :color="item.direction === 'BUY' ? 'green-7' : 'red-7'"
                    class="smc-range-bar"
                    rounded
                  />
                  <span class="radar-value">{{ item.pricePosition }}%</span>
                </div>
              </div>
            </div>

            <!-- Razón / Motivo -->
            <div class="smc-reason text-caption q-mt-xs" :class="item.ready ? 'text-green-8' : 'text-slate-500'">
              {{ item.reason }}
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Última actualización -->
    <div v-if="lastUpdate" class="text-caption text-slate-400 text-center q-mt-lg">
      Última actualización: {{ lastUpdateTime }} · auto-refresh cada 30s
    </div>

  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { eaWeySMCService } from 'src/services/eaWeySMC.service.js';

const loading    = ref(false);
const results    = ref([]);
const lastUpdate = ref(null);
let refreshTimer = null;

const readyCount = computed(() => results.value.filter((r) => r.ready).length);

const lastUpdateTime = computed(() => {
  if (!lastUpdate.value) return '';
  return new Date(lastUpdate.value).toLocaleTimeString();
});

async function loadScanner() {
  loading.value = true;
  try {
    const data = await eaWeySMCService.scan();
    results.value = Array.isArray(data) ? data : [];
    lastUpdate.value = new Date().toISOString();
  } catch (err) {
    console.error('Error cargando EA WEY SMC scanner:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadScanner();
  refreshTimer = setInterval(loadScanner, 30_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.ea-smc-page {
  background-color: #f8fafc;
  min-height: 100vh;
}

/* ── Header ───────────────────────────────────────────────────── */
.page-header {
  border-bottom: 2px solid #d8b4fe;
  padding-bottom: 14px;
}

.header-icon-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.text-slate-900 { color: #0f172a; }
.text-slate-500 { color: #64748b; }
.text-slate-600 { color: #475569; }
.text-slate-400 { color: #94a3b8; }

/* ── Ready Summary ────────────────────────────────────────────── */
.ready-summary-pill {
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 8px;
}

/* ── Cards ────────────────────────────────────────────────────── */
.smc-card {
  border-radius: 14px;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.smc-card:hover {
  box-shadow: 0 4px 20px 0 rgba(124, 58, 237, 0.12);
}
.smc-card--crash {
  border-color: #fca5a5 !important;
  background: linear-gradient(135deg, #fff5f5 0%, #fff 100%);
}
.smc-card--boom {
  border-color: #86efac !important;
  background: linear-gradient(135deg, #f0fdf4 0%, #fff 100%);
}
.smc-card--ready {
  box-shadow: 0 0 0 2px #16a34a40;
}

.smc-symbol {
  font-size: 15px;
  font-weight: 800;
  color: #1e293b;
}
.smc-icon { font-size: 18px; }

.smc-ready-badge {
  animation: ready-pulse 2s ease-in-out infinite;
}
@keyframes ready-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.75; }
}

/* ── Estrellas ────────────────────────────────────────────────── */
.smc-star {
  font-size: 13px;
  line-height: 1;
}
.smc-star--active { color: #d97706; }
.smc-star--empty  { color: #cbd5e1; }

/* ── Checklist ────────────────────────────────────────────────── */
.smc-checklist {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.smc-check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
.check-ok   { color: #16a34a; font-weight: 800; font-size: 13px; min-width: 14px; }
.check-fail { color: #dc2626; font-weight: 800; font-size: 13px; min-width: 14px; }
.check-label { color: #334155; }

/* ── Barra de rango ───────────────────────────────────────────── */
.smc-range-bar {
  width: 60px;
  height: 6px;
}

/* ── Precio/Datos ─────────────────────────────────────────────── */
.radar-label {
  font-size: 9px;
  color: #94a3b8;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 1px;
}
.radar-value {
  font-size: 12px;
  font-weight: 700;
  color: #1e293b;
}

/* ── Razón ────────────────────────────────────────────────────── */
.smc-reason {
  font-style: italic;
  line-height: 1.4;
  border-top: 1px solid #f1f5f9;
  padding-top: 6px;
}
</style>
