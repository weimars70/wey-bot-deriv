<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="950px">
    <q-card class="bg-slate-950 text-white border-slate shadow-24" style="width: 920px; max-width: 95vw;">
      <!-- Header del Modal -->
      <q-card-section class="row items-center justify-between bg-slate-900 border-b-slate q-py-sm">
        <div class="row items-center q-gutter-sm">
          <q-avatar size="36px" color="amber-10" text-color="amber-3" icon="lightbulb" />
          <div>
            <div class="text-subtitle1 text-weight-bolder text-white">
              Guía Maestra: Estrategia de Patrones Spike &amp; Zonas de Retesteo (Crash 600)
            </div>
            <div class="text-caption text-slate-400">
              Manual operativo basado en el análisis cuantitativo de 30 días y 2,315 spikes reales
            </div>
          </div>
        </div>
        <q-btn flat round dense icon="close" v-close-popup color="slate-4" />
      </q-card-section>

      <!-- Pestañas de la Guía -->
      <q-tabs
        v-model="helpTab"
        dense
        no-caps
        class="bg-slate-900 text-slate-400 border-b-slate"
        active-color="amber-3"
        active-bg-color="amber-10"
        indicator-color="amber-5"
      >
        <q-tab name="patterns" icon="psychology" label="1. Los 5 Patrones Clave" class="text-weight-bold" />
        <q-tab name="signals" icon="traffic" label="2. Semáforo de Decisiones" class="text-weight-bold" />
        <q-tab name="risk" icon="shield" label="3. Reglas de Stop Loss &amp; Riesgo" class="text-weight-bold" />
        <q-tab name="hours" icon="schedule" label="4. Horarios de Oro vs Trampa" class="text-weight-bold" />
      </q-tabs>

      <!-- Contenido de las Pestañas -->
      <q-card-section class="q-pa-md scroll" style="max-height: 70vh;">
        <!-- ════════════════════════════════════════════════════════════════ -->
        <!-- TAB 1: LOS 5 PATRONES CLAVE -->
        <!-- ════════════════════════════════════════════════════════════════ -->
        <div v-if="helpTab === 'patterns'" class="q-gutter-y-md">
          <!-- Banner Intro -->
          <div class="q-pa-sm bg-amber-950/30 rounded-borders border-amber-8 text-amber-2 text-caption">
            💡 <b>¿Por qué funciona esta estrategia?</b> Los índices sintéticos repiten patrones fractales. El sistema no adivina: evalúa confluencias matemáticas donde la probabilidad de una caída violenta supera el 70%.
          </div>

          <div class="row q-col-gutter-md">
            <!-- Patrón 1 -->
            <div class="col-12 col-md-6">
              <q-card flat class="bg-slate-900 border-slate q-pa-sm h-full">
                <div class="row items-center q-gutter-xs text-amber-4 text-weight-bold text-subtitle2 q-mb-xs">
                  <q-badge color="amber-8" text-color="black" label="1" class="text-weight-bolder" />
                  <span>Zonas de Retesteo (Techos Históricos)</span>
                </div>
                <div class="text-caption text-slate-300">
                  Cuando el índice sube a un nivel donde ya dio caídas anteriores (doble o triple techo), la oferta institucional reacciona con alta probabilidad.
                </div>
                <div class="q-mt-xs q-pa-xs bg-slate-950 rounded-borders font-mono text-caption text-emerald-4">
                  ✓ El sistema delinea estas líneas en la gráfica y las pone en <b>rojo brillante</b> cuando el precio actual las toca.
                </div>
              </q-card>
            </div>

            <!-- Patrón 2 -->
            <div class="col-12 col-md-6">
              <q-card flat class="bg-slate-900 border-slate q-pa-sm h-full">
                <div class="row items-center q-gutter-xs text-amber-4 text-weight-bold text-subtitle2 q-mb-xs">
                  <q-badge color="amber-8" text-color="black" label="2" class="text-weight-bolder" />
                  <span>Conteo de Carga M1 (Media: 9.9 Velas)</span>
                </div>
                <div class="text-caption text-slate-300">
                  En Crash 600, el precio acumula subiendo durante un promedio de <b>9.9 velas de 1 minuto consecutivas</b> (~10 minutos) antes de liberar la presión en un spike.
                </div>
                <div class="q-mt-xs q-pa-xs bg-slate-950 rounded-borders font-mono text-caption text-emerald-4">
                  ✓ <b>Gatillo óptimo:</b> Entrar cuando llevamos de 8 a 10 velas de subida continua.
                </div>
              </q-card>
            </div>

            <!-- Patrón 3 -->
            <div class="col-12 col-md-6">
              <q-card flat class="bg-slate-900 border-slate q-pa-sm h-full">
                <div class="row items-center q-gutter-xs text-amber-4 text-weight-bold text-subtitle2 q-mb-xs">
                  <q-badge color="amber-8" text-color="black" label="3" class="text-weight-bolder" />
                  <span>Zona V / Retroceso del 50% (Spikes en Cadena)</span>
                </div>
                <div class="text-caption text-slate-300">
                  El <b>60.2%</b> de las caídas producen un segundo spike en los siguientes 15 minutos al retestear entre el <b>38% y 65%</b> del recorrido de la caída previa (media áurea: <b>46.9%</b>).
                </div>
                <div class="q-mt-xs q-pa-xs bg-slate-950 rounded-borders font-mono text-caption text-emerald-4">
                  ✓ Permite cazar caídas secundarias de alta velocidad.
                </div>
              </q-card>
            </div>

            <!-- Patrón 4 -->
            <div class="col-12 col-md-6">
              <q-card flat class="bg-slate-900 border-slate q-pa-sm h-full">
                <div class="row items-center q-gutter-xs text-amber-4 text-weight-bold text-subtitle2 q-mb-xs">
                  <q-badge color="amber-8" text-color="black" label="4" class="text-weight-bolder" />
                  <span>Efecto Imán en EMA 50 (M5)</span>
                </div>
                <div class="text-caption text-slate-300">
                  El <b>52.1%</b> de los spikes detonan cuando el precio se encuentra a menos de <b>&plusmn;0.2%</b> de la media móvil exponencial de 50 períodos en temporalidad M5.
                </div>
                <div class="q-mt-xs q-pa-xs bg-slate-950 rounded-borders font-mono text-caption text-emerald-4">
                  ✓ Actúa como resistencia dinámica de rechazo.
                </div>
              </q-card>
            </div>

            <!-- Patrón 5 -->
            <div class="col-12">
              <q-card flat class="bg-slate-900 border-slate q-pa-sm">
                <div class="row items-center q-gutter-xs text-amber-4 text-weight-bold text-subtitle2 q-mb-xs">
                  <q-badge color="teal-8" label="5" class="text-weight-bolder" />
                  <span>Estrategia de 2 Velas con Mecha Superior (Absorción)</span>
                </div>
                <div class="text-caption text-slate-300">
                  Si las 2 velas previas al nivel dejan mechas superiores de rechazo (&ge; 25% del rango total de la vela), significa que los compradores intentaron empujar hacia arriba y fueron absorbidos por órdenes vendedoras. Es el detonante ideal para la caída.
                </div>
              </q-card>
            </div>
          </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════ -->
        <!-- TAB 2: SEMÁFORO DE DECISIONES -->
        <!-- ════════════════════════════════════════════════════════════════ -->
        <div v-if="helpTab === 'signals'" class="q-gutter-y-sm">
          <div class="text-caption text-slate-300 q-mb-sm">
            El sistema evalúa todos los factores anteriores y genera un puntaje de <b>0 a 100 puntos</b> y de <b>1 a 5 estrellas</b>:
          </div>

          <!-- Venta Confirmada -->
          <div class="q-pa-sm bg-emerald-950/30 rounded-borders border-emerald-5">
            <div class="row items-center justify-between q-mb-xs">
              <span class="text-subtitle2 text-weight-bolder text-emerald-4">
                🟢 VENTA_CONFIRMADA (Score &ge; 65-70 · 4 a 5 Estrellas)
              </span>
              <q-badge color="positive" label="DISPARAR ENTRADA" class="text-weight-bolder font-mono" />
            </div>
            <div class="text-caption text-slate-200">
              <b>Acción requerida:</b> Haz clic en <b>"🚀 Disparar Entrada Venta (SELL)"</b>. El precio está en una zona de retesteo activa o retroceso del 50%, la carga de velas M1 está completa y la confluencia es máxima.
            </div>
          </div>

          <!-- Preparando Gatillo -->
          <div class="q-pa-sm bg-amber-950/30 rounded-borders border-amber-5">
            <div class="row items-center justify-between q-mb-xs">
              <span class="text-subtitle2 text-weight-bolder text-amber-3">
                🟠 PREPARANDO_GATILLO (Score 40 a 64 · 2 a 3 Estrellas)
              </span>
              <q-badge color="amber-9" label="ATENCIÓN AL MERCADO" class="text-weight-bolder font-mono" />
            </div>
            <div class="text-caption text-slate-200">
              <b>Acción requerida:</b> No entres todavía. El precio ya está cerca del nivel de reacción, pero el conteo de velas M1 aún es bajo (ej. llevamos 4 o 5 velas de carga). Espera que complete el ciclo de 8 a 10 velas.
            </div>
          </div>

          <!-- Esperando Zona -->
          <div class="q-pa-sm bg-slate-900 rounded-borders border-slate">
            <div class="row items-center justify-between q-mb-xs">
              <span class="text-subtitle2 text-weight-bolder text-slate-300">
                🟡 ESPERANDO_ZONA (Score &lt; 40 · 1 Estrella)
              </span>
              <q-badge color="slate-8" text-color="slate-3" label="SIN ACCIÓN" class="font-mono" />
            </div>
            <div class="text-caption text-slate-400">
              El precio está a mitad de camino sin tocar ninguna zona de reacción ni nivel de retroceso. Mantenerse al margen.
            </div>
          </div>

          <!-- Bloqueo Hora -->
          <div class="q-pa-sm bg-red-950/30 rounded-borders border-red-5">
            <div class="row items-center justify-between q-mb-xs">
              <span class="text-subtitle2 text-weight-bolder text-rose-4">
                🔴 BLOQUEO_HORA (Hora Trampa)
              </span>
              <q-badge color="negative" label="BLOQUEADO" class="text-weight-bolder font-mono" />
            </div>
            <div class="text-caption text-slate-200">
              El mercado se encuentra en una hora histórica de acumulación alcista lenta. El sistema bloquea las entradas para evitar quemar stop loss innecesarios.
            </div>
          </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════ -->
        <!-- TAB 3: GESTIÓN DE RIESGO & STOP LOSS -->
        <!-- ════════════════════════════════════════════════════════════════ -->
        <div v-if="helpTab === 'risk'" class="q-gutter-y-md">
          <div class="q-pa-sm bg-rose-950/30 rounded-borders border-rose-8 text-rose-2 text-caption">
            ⚠️ <b>Regla de Oro en Crash:</b> La gestión de riesgo es más importante que la entrada. Un spike bien agarrado da grandes ganancias, pero quedarse esperando una caída infinita destruye la cuenta.
          </div>

          <q-list separator dark class="bg-slate-900 rounded-borders border-slate text-caption">
            <q-item>
              <q-item-section avatar><q-icon name="timer" color="amber-4" size="28px" /></q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-bolder text-amber-3 text-subtitle2">1. Stop Loss por Tiempo: 10 Minutos (10 Velas M1)</q-item-label>
                <q-item-label caption class="text-slate-300">
                  Si entraste al mercado y en <b>10 minutos (2 velas de M5 o 10 velas de M1)</b> no cayó el spike, **cierra la operación de inmediato**. Nuestro estudio demostró que si no cae en ese lapso, el mercado entró en tendencia de acumulación profunda.
                </q-item-label>
              </q-item-section>
            </q-item>

            <q-item>
              <q-item-section avatar><q-icon name="arrow_upward" color="rose-4" size="28px" /></q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-bolder text-rose-4 text-subtitle2">2. Stop Loss de Emergencia por Precio: +12 Puntos</q-item-label>
                <q-item-label caption class="text-slate-300">
                  Se coloca una orden de SL físico en MetaTrader a **+12 puntos** por encima de tu precio de entrada. Esto protege la cuenta si el precio rompe el techo con una vela extendida.
                </q-item-label>
              </q-item-section>
            </q-item>

            <q-item>
              <q-item-section avatar><q-icon name="calculate" color="sky-4" size="28px" /></q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-bolder text-sky-4 text-subtitle2">3. Lotaje Conservador: 0.30 Lotes</q-item-label>
                <q-item-label caption class="text-slate-300">
                  Crash 600 tiene un movimiento de puntos más agresivo que Crash 1000. Por eso, el lotaje predeterminado sugerido es **0.30** (un SL de 10 min representa ~$3.50 a $6.00 USD de riesgo, mientras que un spike promedio captura de $12.00 a $25.00 USD).
                </q-item-label>
              </q-item-section>
            </q-item>

            <q-item>
              <q-item-section avatar><q-icon name="price_check" color="emerald-4" size="28px" /></q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-bolder text-emerald-4 text-subtitle2">4. Salida Post-Spike: Mínimo $5.00 USD o Breakeven en Punto de Inicio</q-item-label>
                <q-item-label caption class="text-slate-300">
                  Tras detonar un spike, se espera <b>5 minutos</b>. Si la ganancia acumulada es <b>&ge; $5.00 USD</b>, se cierra asegurando el beneficio. Si la ganancia es menor a $5 USD, <b>se deja correr</b> para capturar caídas en cadena mayores. Si el precio retrocede hasta el <b>punto de inicio (precio de entrada)</b>, se cierra de inmediato en breakeven con <b>$0 pérdida</b>, evitando que un trade ganador se convierta en pérdida.
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <!-- ════════════════════════════════════════════════════════════════ -->
        <!-- TAB 4: HORARIOS DE ORO VS TRAMPA -->
        <!-- ════════════════════════════════════════════════════════════════ -->
        <div v-if="helpTab === 'hours'" class="q-gutter-y-sm">
          <div class="text-caption text-slate-300 q-mb-sm">
            Distribución horaria basada en el análisis de 2,315 spikes de Crash 600 (Horas en formato UTC):
          </div>

          <div class="row q-col-gutter-sm">
            <div class="col-12 col-md-6">
              <q-card flat class="bg-emerald-950/20 border-emerald-5 q-pa-sm h-full">
                <div class="text-subtitle2 text-weight-bolder text-emerald-4 q-mb-xs">
                  🟢 Horas Explosivas (Máxima Frecuencia de Spikes)
                </div>
                <div class="text-h6 font-mono text-emerald-3 text-weight-bold q-mb-xs">
                  05:00 · 06:00 · 11:00 · 13:00 · 15:00 UTC
                </div>
                <div class="text-caption text-slate-300">
                  Horarios donde el algoritmo de Deriv descarga la mayor cantidad de caídas en cadena y zonas V.
                </div>
              </q-card>
            </div>

            <div class="col-12 col-md-6">
              <q-card flat class="bg-red-950/20 border-red-5 q-pa-sm h-full">
                <div class="text-subtitle2 text-weight-bolder text-rose-4 q-mb-xs">
                  🔴 Horas Trampa (Acumulación Alcista Lenta)
                </div>
                <div class="text-h6 font-mono text-rose-3 text-weight-bold q-mb-xs">
                  01:00 · 08:00 · 09:00 · 18:00 · 21:00 UTC
                </div>
                <div class="text-caption text-slate-300">
                  Horarios con alta tasa de stop loss por falta de caídas; el índice sube de manera persistente sin soltar spikes.
                </div>
              </q-card>
            </div>
          </div>
        </div>
      </q-card-section>

      <!-- Footer -->
      <q-card-section class="bg-slate-900 border-t-slate row items-center justify-between q-py-xs">
        <span class="text-caption text-slate-400 font-mono">Deriv App · Estrategia Cuantitativa Crash 600</span>
        <q-btn flat dense color="amber-4" label="Entendido" v-close-popup class="text-weight-bold" />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  modelValue: { type: Boolean, default: false },
});

defineEmits(['update:modelValue']);

const helpTab = ref('patterns');
</script>

<style scoped>
.border-slate {
  border: 1px solid #1e293b;
}

.border-b-slate {
  border-bottom: 1px solid #1e293b;
}

.border-t-slate {
  border-top: 1px solid #1e293b;
}

.border-amber-8 {
  border: 1px solid rgba(245, 158, 11, 0.4);
}

.border-emerald-5 {
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.border-amber-5 {
  border: 1px solid rgba(245, 158, 11, 0.4);
}

.border-red-5 {
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.border-rose-8 {
  border: 1px solid rgba(244, 63, 94, 0.4);
}
</style>
