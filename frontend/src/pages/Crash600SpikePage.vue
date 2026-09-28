<template>
  <q-page class="q-pa-md bg-slate-950 text-white">
    <!-- ENCABEZADO Y TABS -->
    <div class="row items-center justify-between q-mb-md q-gutter-y-sm">
      <div class="row items-center q-gutter-sm">
        <q-avatar size="44px" color="amber-10" text-color="amber-3" icon="bolt" />
        <div>
          <div class="row items-center q-gutter-sm">
            <span class="text-h5 text-weight-bolder tracking-wide text-white">
              Patrones Spike IA
            </span>
            <!-- Selector de Índice PROMINENTE -->
            <q-btn-dropdown
              :label="selectedSymbolLabel"
              color="amber-9"
              text-color="white"
              icon="candlestick_chart"
              no-caps
              dense
              unelevated
              class="text-weight-bolder font-mono text-subtitle2"
            >
              <q-list dark class="bg-slate-900" style="min-width: 200px">
                <q-item-label header class="text-amber-4 text-weight-bold text-caption q-pb-xs">── CRASH (VENTA) ──</q-item-label>
                <q-item
                  v-for="opt in symbolOptions.filter(o => o.value.startsWith('CRASH'))"
                  :key="opt.value"
                  clickable
                  v-close-popup
                  :active="selectedSymbol === opt.value"
                  active-class="bg-amber-10 text-white"
                  class="text-slate-200"
                  @click="selectedSymbol = opt.value; onSymbolChange()"
                >
                  <q-item-section avatar>
                    <q-icon name="trending_down" color="red-4" size="18px" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="font-mono text-weight-bold">{{ opt.label }}</q-item-label>
                  </q-item-section>
                  <q-item-section side v-if="selectedSymbol === opt.value">
                    <q-icon name="check" color="amber-4" />
                  </q-item-section>
                </q-item>

                <q-separator dark class="q-my-xs" />
                <q-item-label header class="text-emerald-4 text-weight-bold text-caption q-pb-xs">── BOOM (COMPRA) ──</q-item-label>
                <q-item
                  v-for="opt in symbolOptions.filter(o => o.value.startsWith('BOOM'))"
                  :key="opt.value"
                  clickable
                  v-close-popup
                  :active="selectedSymbol === opt.value"
                  active-class="bg-emerald-10 text-white"
                  class="text-slate-200"
                  @click="selectedSymbol = opt.value; onSymbolChange()"
                >
                  <q-item-section avatar>
                    <q-icon name="trending_up" color="emerald-4" size="18px" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="font-mono text-weight-bold">{{ opt.label }}</q-item-label>
                  </q-item-section>
                  <q-item-section side v-if="selectedSymbol === opt.value">
                    <q-icon name="check" color="emerald-4" />
                  </q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>

            <q-badge color="amber-8" label="M1 + M5 + EMA50" class="text-weight-bold" />
          </div>
          <div class="text-caption text-slate-400">
            Ciclo de carga 10 min · Retroceso 50% · Confluencia EMA 50 · Zonas de Retesteo
          </div>
        </div>
      </div>

      <div class="row items-center q-gutter-sm">
        <q-btn
          outline
          color="amber-4"
          icon="help_outline"
          label="¿Cómo Funciona?"
          class="text-weight-bolder font-mono q-px-sm"
          @click="showHelpModal = true"
        >
          <q-tooltip>Abre la guía de patrones, zonas de retesteo y gestión de riesgo</q-tooltip>
        </q-btn>

        <q-tabs
          v-model="activeTab"
          dense
          no-caps
          class="bg-slate-900 text-slate-400 rounded-borders border-slate"
          active-color="amber-3"
          active-bg-color="amber-10"
          indicator-color="amber-5"
        >
          <q-tab name="live" icon="radar" label="Radar en Vivo &amp; Decisión" class="text-weight-bold q-px-md" />
          <q-tab name="backtest" icon="history_edu" label="Simulador (hasta 100 Días)" class="text-weight-bold q-px-md" />
        </q-tabs>
      </div>
    </div>


    <!-- ════════════════════════════════════════════════════════════════════════ -->
    <!-- ── PESTAÑA 1: RADAR EN VIVO & DECISIÓN DE ENTRADA ───────────────────── -->
    <!-- ════════════════════════════════════════════════════════════════════════ -->
    <div v-if="activeTab === 'live'">
      <!-- Tarjeta Principal de Decisión en Vivo -->
      <q-card flat class="q-pa-lg rounded-borders q-mb-md decision-card" :class="decisionClass">
        <div class="row items-center justify-between q-col-gutter-md">
          <!-- Columna Izquierda: Decisión y Score -->
          <div class="col-12 col-md-7">
            <div class="row items-center q-gutter-sm q-mb-xs">
              <q-badge :color="decisionBadgeColor" class="text-weight-bolder text-subtitle2 q-px-md q-py-xs font-mono">
                {{ decisionTitle }}
              </q-badge>
              <span class="text-caption text-slate-400 font-mono">
                Actualizado: {{ liveData?.dateStr || 'Conectando...' }}
              </span>
            </div>

            <div class="text-h4 text-weight-bolder font-mono q-my-sm" :class="decisionTextColor">
              {{ liveData?.decisionMessage || `Evaluando microestructura de ${selectedSymbolLabel}...` }}
            </div>

            <div class="row items-center q-gutter-md q-mt-sm">
              <div class="row items-center q-gutter-xs">
                <span class="text-caption text-slate-400">Score Confluencia:</span>
                <span class="text-h6 font-mono text-weight-bolder" :class="decisionTextColor">
                  {{ liveData?.score || 0 }} / 100
                </span>
              </div>
              <div class="row items-center q-gutter-xs">
                <span class="text-caption text-slate-400">Calidad:</span>
                <span class="text-amber-4 text-h6 font-mono text-weight-bold">
                  {{ '★'.repeat(liveData?.stars || 1) }}{{ '☆'.repeat(5 - (liveData?.stars || 1)) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Columna Derecha: Acciones Rápidas y Disparo -->
          <div class="col-12 col-md-5">
            <div class="bg-slate-900 q-pa-md rounded-borders border-slate">
              <div class="row items-center justify-between q-mb-sm">
                <div class="row items-center q-gutter-xs">
                  <q-icon name="psychology" color="amber-4" size="20px" />
                  <span class="text-subtitle2 text-weight-bold">Auto-Trading IA:</span>
                </div>
                <div class="row items-center q-gutter-xs">
                  <q-toggle
                    v-model="autoTrading"
                    dense
                    color="emerald-5"
                    @update:model-value="toggleAutoTrading"
                  />
                  <q-badge :color="autoTrading ? 'emerald-8' : 'grey-8'" :label="autoTrading ? 'ACTIVO' : 'PAUSADO'" />
                </div>
              </div>

              <div class="row items-center q-col-gutter-sm q-mb-sm">
                <div class="col-6">
                  <q-input
                    v-model.number="tradeLot"
                    type="number"
                    step="0.05"
                    min="0.10"
                    dense
                    outlined
                    dark
                    label="Lote MT5"
                    color="amber-5"
                    class="font-mono"
                  />
                </div>
                <div class="col-6">
                  <q-btn
                    unelevated
                    color="amber-9"
                    text-color="white"
                    icon="refresh"
                    label="Refrescar"
                    class="full-width font-mono text-weight-bold"
                    :loading="loadingLive"
                    @click="loadLiveEvaluation"
                  />
                </div>
              </div>

              <q-btn
                unelevated
                color="red-8"
                icon="bolt"
                :label="`🚀 Disparar Entrada ${isBoomSymbol ? 'COMPRA (BUY)' : 'Venta (SELL)'}`"
                class="full-width text-weight-bolder q-py-sm text-subtitle2 shadow-8"
                :loading="executingTrade"
                @click="executeTrade"
              >
                <q-tooltip>Envía orden directa de {{ isBoomSymbol ? 'Compra (BUY)' : 'Venta (SELL)' }} con lote {{ tradeLot }} a MetaTrader 5 en {{ selectedSymbolLabel }}</q-tooltip>
              </q-btn>
            </div>
          </div>
        </div>
      </q-card>

      <!-- 4 Tarjetas de Diagnóstico de Microestructura -->
      <div class="row q-col-gutter-md q-mb-md">
        <!-- 1. Ciclo de Carga M1 -->
        <div class="col-12 col-sm-6 col-md-3">
          <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
            <div class="row items-center justify-between">
              <span class="text-caption text-weight-bold text-slate-400">1. CICLO DE CARGA (M1)</span>
              <q-icon name="trending_up" color="emerald-4" size="22px" />
            </div>
            <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-white">
              {{ liveData?.greenRunM1 || 0 }} <span class="text-subtitle1 text-slate-500">/ 10 velas</span>
            </div>
            <div class="q-mt-xs">
              <q-linear-progress
                :value="Math.min(1, (liveData?.greenRunM1 || 0) / 10)"
                size="8px"
                rounded
                :color="(liveData?.greenRunM1 || 0) >= 8 ? 'emerald-5' : 'amber-5'"
                track-color="slate-800"
              />
            </div>
            <div class="text-caption text-slate-400 q-mt-xs font-mono">
              Promedio pre-spike: <b>9.9 velas (~10 min)</b>
            </div>
          </q-card>
        </div>

        <!-- 2. Zona V (Retroceso 50%) -->
        <div class="col-12 col-sm-6 col-md-3">
          <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
            <div class="row items-center justify-between">
              <span class="text-caption text-weight-bold text-slate-400">2. RETROCESO ZONA V</span>
              <q-icon name="timeline" color="amber-4" size="22px" />
            </div>
            <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-amber-3">
              {{ liveData?.retracePercent || 0 }}%
            </div>
            <div class="q-mt-xs">
              <q-badge
                :color="liveData?.isInRetraceZone ? 'emerald-9' : 'slate-800'"
                :text-color="liveData?.isInRetraceZone ? 'emerald-2' : 'slate-400'"
                :label="liveData?.isInRetraceZone ? '✓ EN ZONA 38% - 65%' : 'FUERA DE ZONA'"
                class="text-weight-bold font-mono"
              />
            </div>
            <div class="text-caption text-slate-400 q-mt-xs font-mono">
              Zona Áurea: <b>46.9% media</b>
            </div>
          </q-card>
        </div>

        <!-- 3. Confluencia EMA 50 -->
        <div class="col-12 col-sm-6 col-md-3">
          <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
            <div class="row items-center justify-between">
              <span class="text-caption text-weight-bold text-slate-400">3. IMÁN EMA 50 (M5)</span>
              <q-icon name="all_inclusive" color="sky-4" size="22px" />
            </div>
            <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-sky-3">
              {{ liveData?.distToEma50Pct || 0 }}%
            </div>
            <div class="q-mt-xs">
              <q-badge
                :color="liveData?.isAtEma50 ? 'emerald-9' : 'slate-800'"
                :text-color="liveData?.isAtEma50 ? 'emerald-2' : 'slate-400'"
                :label="liveData?.isAtEma50 ? '✓ EN ZONA MAGNÉTICA' : 'DISTANTE DE EMA 50'"
                class="text-weight-bold font-mono"
              />
            </div>
            <div class="text-caption text-slate-400 q-mt-xs font-mono">
              EMA 50: <b>{{ liveData?.ema50M5?.toFixed(1) || '—' }}</b>
            </div>
          </q-card>
        </div>

        <!-- 4. Filtro Horario -->
        <div class="col-12 col-sm-6 col-md-3">
          <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
            <div class="row items-center justify-between">
              <span class="text-caption text-weight-bold text-slate-400">4. FILTRO HORARIO</span>
              <q-icon name="schedule" color="indigo-4" size="22px" />
            </div>
            <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-white">
              {{ String(liveData?.currentHour || 0).padStart(2, '0') }}:00 <span class="text-caption text-slate-500">UTC</span>
            </div>
            <div class="q-mt-xs">
              <q-badge
                :color="liveData?.hourType === 'EXPLOSIVA' ? 'emerald-9' : liveData?.hourType === 'TRAMPA' ? 'red-9' : 'slate-800'"
                :text-color="liveData?.hourType === 'EXPLOSIVA' ? 'emerald-2' : liveData?.hourType === 'TRAMPA' ? 'red-2' : 'slate-300'"
                :label="liveData?.hourType === 'EXPLOSIVA' ? 'HORA EXPLOSIVA 🟢' : liveData?.hourType === 'TRAMPA' ? 'HORA TRAMPA 🔴' : 'HORA NEUTRAL ⚪'"
                class="text-weight-bold font-mono"
              />
            </div>
            <div class="text-caption text-slate-400 q-mt-xs font-mono">
              Top: 05, 06, 11, 13, 15h
            </div>
          </q-card>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════════════ -->
      <!-- ── GRÁFICO INTERACTIVO DE VELAS & ZONAS DE RETESTEO (LIGHTWEIGHT) ────── -->
      <!-- ════════════════════════════════════════════════════════════════════════ -->
      <div class="q-mb-md">
        <CrashSpikeChart
          :candles="liveData?.chartCandles || []"
          :retest-zones="liveData?.retestZones || []"
          :active-zone="liveData?.activeRetestZone || null"
          :sl-price="liveData?.recommendedSlPrice || 0"
          :tp-price="liveData?.recommendedTpPrice || 0"
          :timeframe="selectedTimeframe"
          :symbol="selectedSymbol"
          @change-timeframe="handleTimeframeChange"
        />
      </div>

      <!-- ZONAS DE RETESTEO DETECTADAS (TECHOS DONDE HUBO MÚLTIPLES SPIKES) -->
      <div class="q-mb-md">
        <q-card flat class="bg-slate-900 border-slate q-pa-md">
          <div class="row items-center justify-between q-mb-sm">
            <div class="row items-center q-gutter-xs">
              <q-icon name="layers" color="amber-4" size="20px" />
              <span class="text-subtitle1 text-weight-bolder text-white">
                Zonas de Retesteo Identificadas (Niveles con Múltiples Caídas Históricas)
              </span>
            </div>
            <q-badge color="amber-9" :label="`${liveData?.retestZones?.length || 0} zonas detectadas`" class="font-mono" />
          </div>

          <div v-if="!liveData?.retestZones || liveData?.retestZones.length === 0" class="text-caption text-slate-500 q-pa-sm">
            Mapeando velas históricas para detectar zonas de concentración de spikes...
          </div>

          <div v-else class="row q-col-gutter-sm">
            <div
              v-for="zone in liveData.retestZones"
              :key="zone.id"
              class="col-12 col-sm-6 col-md-3"
            >
              <q-card
                flat
                class="q-pa-sm border-slate rounded-borders"
                :class="zone.isRetestingNow ? 'bg-red-10 border-red-5 shadow-8' : 'bg-slate-950'"
              >
                <div class="row items-center justify-between">
                  <span class="font-mono text-weight-bolder text-body2" :class="zone.isRetestingNow ? 'text-white' : 'text-amber-3'">
                    {{ zone.level }} pts
                  </span>
                  <q-badge
                    :color="zone.isRetestingNow ? 'negative' : 'amber-9'"
                    :label="`${zone.spikeCount} Spikes`"
                    class="text-weight-bolder font-mono"
                  />
                </div>
                <div class="text-caption q-mt-xs font-mono" :class="zone.isRetestingNow ? 'text-red-2' : 'text-slate-400'">
                  Caída prom: <b class="text-emerald-4">-{{ zone.avgDrop }} pts</b> (Max: -{{ zone.maxDrop }} pts)
                </div>
                <div class="row items-center justify-between text-caption font-mono q-mt-xs">
                  <span :class="zone.isRetestingNow ? 'text-white text-weight-bold animate-pulse' : 'text-slate-400'">
                    {{ zone.isRetestingNow ? '🎯 RETESTEANDO AHORA' : `Dist: ${zone.distToCurrentPts > 0 ? '+' : ''}${zone.distToCurrentPts} pts` }}
                  </span>
                  <span class="text-slate-500">{{ zone.lastReactionDateStr }}</span>
                </div>
              </q-card>
            </div>
          </div>
        </q-card>
      </div>

      <!-- Detalle Técnico del Último Spike y Niveles de Proyección -->
      <div class="row q-col-gutter-md q-mb-md">
        <div class="col-12 col-md-6">
          <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
            <div class="row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <q-icon name="history" color="amber-4" size="20px" />
                <span class="text-subtitle1 text-weight-bolder text-white">Último Spike Registrado</span>
              </div>
              <q-badge color="amber-9" :label="`${liveData?.lastSpike?.minutesAgo || 0} min atrás`" class="font-mono" />
            </div>

            <div v-if="liveData?.lastSpike" class="q-gutter-y-xs font-mono">
              <div class="row justify-between text-caption text-slate-300 py-1 border-b-slate">
                <span>Magnitud de la Caída:</span>
                <b class="text-emerald-4 text-subtitle2">-{{ liveData.lastSpike.dropPoints }} puntos</b>
              </div>
              <div class="row justify-between text-caption text-slate-300 py-1 border-b-slate">
                <span>Hora del Spike:</span>
                <span>{{ liveData.lastSpike.dateStr }}</span>
              </div>
              <div class="row justify-between text-caption text-slate-300 py-1 border-b-slate">
                <span>Punto de Origen (Techo):</span>
                <span>{{ liveData.lastSpike.high.toFixed(3) }}</span>
              </div>
              <div class="row justify-between text-caption text-slate-300 py-1 border-b-slate">
                <span>Piso del Spike (Mínimo):</span>
                <span>{{ liveData.lastSpike.low.toFixed(3) }}</span>
              </div>
              <div class="row justify-between text-caption text-slate-300 py-1">
                <span>Velas M1 transcurridas:</span>
                <b class="text-amber-3">{{ liveData.candlesM1SinceLastSpike }} velas</b>
              </div>
            </div>
            <div v-else class="text-caption text-slate-500 q-pa-md text-center">
              Sin registro reciente de spike en la ventana actual.
            </div>
          </q-card>
        </div>

        <div class="col-12 col-md-6">
          <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
            <div class="row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <q-icon name="tune" color="indigo-4" size="20px" />
                <span class="text-subtitle1 text-weight-bolder text-white">Niveles de Gestión Recomendados</span>
              </div>
              <q-badge color="indigo-9" :label="selectedSymbolLabel" class="font-mono" />
            </div>

            <div class="q-gutter-y-xs font-mono">
              <div class="row justify-between text-caption text-slate-300 py-1 border-b-slate">
                <span>Precio Actual:</span>
                <b class="text-white text-subtitle2">{{ liveData?.currentPrice?.toFixed(3) || '—' }}</b>
              </div>
              <div class="row justify-between text-caption text-slate-300 py-1 border-b-slate">
                <span>Stop Loss por Tiempo:</span>
                <b class="text-amber-4">10 minutos (10 velas M1)</b>
              </div>
              <div class="row justify-between text-caption text-slate-300 py-1 border-b-slate">
                <span>Stop Loss Emergencia (Precio):</span>
                <b class="text-red-4">{{ liveData?.recommendedSlPrice?.toFixed(3) || '—' }}</b>
              </div>
              <div class="row justify-between text-caption text-slate-300 py-1 border-b-slate">
                <span>Take Profit Proyectado:</span>
                <b class="text-emerald-4">{{ liveData?.recommendedTpPrice?.toFixed(3) || '—' }}</b>
              </div>
              <div class="row justify-between text-caption text-slate-300 py-1">
                <span>Lotaje Recomendado:</span>
                <b class="text-sky-4">{{ liveData?.recommendedLot || 0.30 }} lotes</b>
              </div>
            </div>
          </q-card>
        </div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════════ -->
    <!-- ── PESTAÑA 2: SIMULADOR HISTÓRICO (HASTA 100 DÍAS) ──────────────────── -->
    <!-- ════════════════════════════════════════════════════════════════════════ -->
    <div v-if="activeTab === 'backtest'">
      <!-- Panel de Controles -->
      <q-card flat class="bg-slate-900 border-slate q-pa-md q-mb-md">
        <div class="row items-center justify-between q-mb-md">
          <div class="row items-center q-gutter-xs">
            <q-icon name="biotech" color="amber-4" size="24px" />
            <span class="text-subtitle1 text-weight-bolder text-white">
              Backtesting Histórico del Patrón Pre-Spike (hasta 100 Días)
            </span>
          </div>
          <q-badge color="amber-9" text-color="amber-2" label="Escalable 100 Días" class="text-weight-bold" />
        </div>

        <div class="row q-col-gutter-md items-center">
          <div class="col-12 col-sm-6 col-md-4">
            <q-select
              v-model="backtestDays"
              :options="[
                { label: '7 Días (1 Semana)', value: 7 },
                { label: '30 Días (1 Mes Completo)', value: 30 },
                { label: '60 Días (2 Meses)', value: 60 },
                { label: '100 Días (Auditoría Profunda)', value: 100 }
              ]"
              emit-value
              map-options
              dense
              outlined
              dark
              label="Período de Análisis"
              color="amber-5"
              class="font-mono"
            />
          </div>

          <div class="col-12 col-sm-6 col-md-4">
            <q-select
              v-model="minScore"
              :options="[
                { label: '≥ 60 pts (Moderado)', value: 60 },
                { label: '≥ 65 pts (Estándar Recomendado)', value: 65 },
                { label: '≥ 75 pts (Alta Confluencia)', value: 75 }
              ]"
              emit-value
              map-options
              dense
              outlined
              dark
              label="Filtro de Score Mínimo"
              color="amber-5"
              class="font-mono"
            />
          </div>

          <div class="col-12 col-md-4">
            <q-btn
              unelevated
              color="amber-9"
              icon="science"
              label="Ejecutar Simulación"
              class="full-width text-weight-bold q-py-sm"
              :loading="runningBacktest"
              @click="runBacktest"
            />
          </div>
        </div>
      </q-card>

      <!-- Resultados del Backtest -->
      <div v-if="backtestResult && !runningBacktest">
        <!-- KPIs -->
        <div class="row q-col-gutter-md q-mb-md">
          <div class="col-12 col-sm-6 col-md-3">
            <q-card flat class="bg-slate-900 border-slate q-pa-md">
              <div class="text-caption text-weight-bold text-slate-400">WIN RATE HISTÓRICO</div>
              <div class="text-h4 font-mono text-weight-bolder text-amber-3 q-mt-xs">
                {{ backtestResult.winRatePct }}%
              </div>
              <div class="text-caption text-slate-400 q-mt-xs font-mono">
                {{ backtestResult.wins }} Buenas / {{ backtestResult.losses }} Malas
              </div>
            </q-card>
          </div>

          <div class="col-12 col-sm-6 col-md-3">
            <q-card flat class="bg-slate-900 border-slate q-pa-md">
              <div class="text-caption text-weight-bold text-slate-400">BENEFICIO NETO (USD)</div>
              <div
                class="text-h4 font-mono text-weight-bolder q-mt-xs"
                :class="backtestResult.netProfitUsd >= 0 ? 'text-emerald-4' : 'text-red-4'"
              >
                {{ backtestResult.netProfitUsd >= 0 ? '+' : '' }}${{ backtestResult.netProfitUsd.toFixed(2) }}
              </div>
              <div class="text-caption text-slate-400 q-mt-xs font-mono">
                Lote: 0.30 USD
              </div>
            </q-card>
          </div>

          <div class="col-12 col-sm-6 col-md-3">
            <q-card flat class="bg-slate-900 border-slate q-pa-md">
              <div class="text-caption text-weight-bold text-slate-400">PROFIT FACTOR</div>
              <div class="text-h4 font-mono text-weight-bolder text-sky-3 q-mt-xs">
                {{ backtestResult.profitFactor }}
              </div>
              <div class="text-caption text-slate-400 q-mt-xs font-mono">
                Ratio Ganancia / Pérdida
              </div>
            </q-card>
          </div>

          <div class="col-12 col-sm-6 col-md-3">
            <q-card flat class="bg-slate-900 border-slate q-pa-md">
              <div class="text-caption text-weight-bold text-slate-400">TOTAL OPERACIONES</div>
              <div class="text-h4 font-mono text-weight-bolder text-white q-mt-xs">
                {{ backtestResult.totalTrades }}
              </div>
              <div class="text-caption text-slate-400 q-mt-xs font-mono">
                En {{ backtestResult.days }} días evaluados
              </div>
            </q-card>
          </div>
        </div>

        <!-- Tabla de Operaciones Simuladas -->
        <q-card flat class="bg-slate-900 border-slate q-pa-md">
          <div class="row items-center justify-between q-mb-sm">
            <div class="row items-center q-gutter-xs">
              <q-icon name="list_alt" color="amber-4" size="22px" />
              <span class="text-subtitle1 text-weight-bolder text-white">Operaciones Históricas Simuladas</span>
            </div>
            <span class="text-caption text-slate-400 font-mono">
              Total: <b>{{ backtestResult.trades.length }}</b>
            </span>
          </div>

          <q-table
            :rows="backtestResult.trades"
            :columns="backtestColumns"
            row-key="id"
            flat
            dark
            dense
            class="trades-report-table bg-transparent font-mono"
            :pagination="{ rowsPerPage: 15 }"
          >
            <template #body-cell-result="props">
              <q-td :props="props">
                <q-badge
                  :color="props.row.result === 'WIN' ? 'emerald-9' : 'red-9'"
                  :text-color="props.row.result === 'WIN' ? 'emerald-2' : 'red-2'"
                  :label="props.row.result === 'WIN' ? '🟢 WIN (SPIKE)' : '🔴 LOSS (10 MIN)'"
                  class="text-weight-bold"
                />
              </q-td>
            </template>

            <template #body-cell-pattern="props">
              <q-td :props="props">
                <div class="row items-center q-gutter-xs">
                  <span class="text-amber-3 text-weight-bold">{{ props.row.patternDetected || 'Retroceso 50%' }}</span>
                  <q-badge v-if="props.row.hasTwoWicks" color="teal-8" label="2 VELAS" class="text-weight-bolder" />
                  <q-badge v-if="props.row.hasRetestPattern" color="purple-8" label="RETESTEO" class="text-weight-bolder" />
                </div>
              </q-td>
            </template>

            <template #body-cell-actions="props">
              <q-td :props="props" align="center">
                <q-btn
                  flat
                  dense
                  color="amber-4"
                  icon="visibility"
                  label="Ver Velas"
                  size="sm"
                  class="text-weight-bold"
                  @click="inspectTradeCandles(props.row)"
                >
                  <q-tooltip>Inspeccionar el gráfico y secuencia de velas antes del spike</q-tooltip>
                </q-btn>
              </q-td>
            </template>
          </q-table>
        </q-card>
      </div>
    </div>

    <!-- Modal Inspector de Velas y Patrón del Spike -->
    <CrashTradeCandlesModal
      v-model="showCandlesModal"
      :trade="selectedTradeForCandles"
    />

    <!-- Modal de Ayuda y Explicación Completa de la Estrategia -->
    <CrashStrategyHelpModal
      v-model="showHelpModal"
    />
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useQuasar } from 'quasar';
import crashSpikeService, { SUPPORTED_SYMBOLS, SYMBOL_LABELS } from 'src/services/crashSpike.service';
import CrashSpikeChart from 'src/components/CrashSpikeChart.vue';
import CrashTradeCandlesModal from 'src/components/CrashTradeCandlesModal.vue';
import CrashStrategyHelpModal from 'src/components/CrashStrategyHelpModal.vue';

const $q = useQuasar();
const activeTab = ref('live');
const loadingLive = ref(false);
const executingTrade = ref(false);
const runningBacktest = ref(false);
const autoTrading = ref(false);
const tradeLot = ref(0.30);
const liveData = ref(null);
let pollTimer = null;

// Selector de índice
const selectedSymbol = ref('CRASH600');
const symbolOptions = SUPPORTED_SYMBOLS.map((s) => ({ label: SYMBOL_LABELS[s] || s, value: s }));
const selectedSymbolLabel = computed(() => SYMBOL_LABELS[selectedSymbol.value] || selectedSymbol.value);
const isBoomSymbol = computed(() => selectedSymbol.value.startsWith('BOOM'));

function onSymbolChange() {
  backtestResult.value = null;
  loadLiveEvaluation();
}

// Modal de Ayuda Explicativa
const showHelpModal = ref(false);

// Modal de Inspección de Velas
const selectedTradeForCandles = ref(null);
const showCandlesModal = ref(false);

function inspectTradeCandles(trade) {
  selectedTradeForCandles.value = trade;
  showCandlesModal.value = true;
}

// Parámetros de Backtest
const backtestDays = ref(30);
const minScore = ref(65);
const backtestResult = ref(null);

const backtestColumns = [
  { name: 'entryDateStr', label: 'Hora Entrada', field: 'entryDateStr', align: 'left' },
  { name: 'symbol', label: 'Índice', field: 'symbol', align: 'left' },
  { name: 'pattern', label: 'Patrón IA', field: 'patternDetected', align: 'left' },
  { name: 'entryPrice', label: 'Entrada', field: 'entryPrice', align: 'right' },
  { name: 'exitPrice', label: 'Salida', field: 'exitPrice', align: 'right' },
  { name: 'durationMin', label: 'Duración (m)', field: 'durationMin', align: 'center' },
  { name: 'result', label: 'Resultado', field: 'result', align: 'center' },
  { name: 'pnlUsd', label: 'PnL USD', field: 'pnlUsd', align: 'right' },
  { name: 'actions', label: 'Velas / Patrón', field: 'id', align: 'center' },
];

const decisionClass = computed(() => {
  const d = liveData.value?.decision;
  if (d === 'VENTA_CONFIRMADA') return 'border-emerald-glow bg-emerald-950/20';
  if (d === 'PREPARANDO_GATILLO') return 'border-amber-glow bg-amber-950/20';
  if (d === 'BLOQUEO_HORA') return 'border-red-glow bg-red-950/20';
  return 'border-slate bg-slate-900';
});

const decisionTitle = computed(() => {
  const d = liveData.value?.decision;
  if (d === 'VENTA_CONFIRMADA') return '🟢 ¡DISPARAR VENTA AHORA (SELL)!';
  if (d === 'PREPARANDO_GATILLO') return '🟠 EN ZONA - CARGANDO GATILLO';
  if (d === 'BLOQUEO_HORA') return '🔴 BLOQUEADO: HORA DE ACUMULACIÓN';
  return '🟡 ESPERANDO RETROCESO A ZONA';
});

const decisionBadgeColor = computed(() => {
  const d = liveData.value?.decision;
  if (d === 'VENTA_CONFIRMADA') return 'emerald-9';
  if (d === 'PREPARANDO_GATILLO') return 'amber-9';
  if (d === 'BLOQUEO_HORA') return 'red-9';
  return 'slate-800';
});

const decisionTextColor = computed(() => {
  const d = liveData.value?.decision;
  if (d === 'VENTA_CONFIRMADA') return 'text-emerald-4';
  if (d === 'PREPARANDO_GATILLO') return 'text-amber-3';
  if (d === 'BLOQUEO_HORA') return 'text-red-4';
  return 'text-slate-200';
});

const selectedTimeframe = ref(300);

function handleTimeframeChange(tf) {
  selectedTimeframe.value = tf;
  loadLiveEvaluation();
}

async function loadLiveEvaluation() {
  loadingLive.value = true;
  try {
    const data = await crashSpikeService.getLiveEvaluation(selectedTimeframe.value, selectedSymbol.value);
    liveData.value = data;
    autoTrading.value = Boolean(data.autoTradingActive);
  } catch (err) {
    console.error('Error cargando evaluación live:', err);
  } finally {
    loadingLive.value = false;
  }
}

async function executeTrade() {
  executingTrade.value = true;
  try {
    const res = await crashSpikeService.executeTrade(tradeLot.value, selectedSymbol.value);
    if (res && res.ok) {
      $q.notify({
        type: 'positive',
        message: `🚀 Orden ${isBoomSymbol.value ? 'COMPRA (BUY)' : 'VENTA (SELL)'} enviada a MetaTrader 5 (${selectedSymbolLabel.value}, Lote ${tradeLot.value})`,
      });
      loadLiveEvaluation();
    }
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: 'Error al ejecutar orden en MetaTrader 5',
    });
  } finally {
    executingTrade.value = false;
  }
}

async function toggleAutoTrading(val) {
  try {
    const res = await crashSpikeService.setAutoTradingStatus(val);
    autoTrading.value = res.active;
    $q.notify({
      type: 'positive',
      message: `Auto-Trading ${res.active ? 'ACTIVADO' : 'PAUSADO'} para ${selectedSymbolLabel.value}`,
    });
  } catch (err) {
    $q.notify({ type: 'negative', message: 'Error al cambiar auto-trading' });
  }
}

async function runBacktest() {
  runningBacktest.value = true;
  try {
    const res = await crashSpikeService.runBacktest(backtestDays.value, minScore.value, selectedSymbol.value);
    backtestResult.value = res;
    $q.notify({
      type: 'positive',
      message: `Simulación completada: ${res.totalTrades} operaciones en ${selectedSymbolLabel.value} (${res.winRatePct}% Win Rate)`,
    });
  } catch (err) {
    $q.notify({ type: 'negative', message: 'Error al ejecutar el simulador histórico' });
  } finally {
    runningBacktest.value = false;
  }
}

onMounted(() => {
  loadLiveEvaluation();
  pollTimer = setInterval(loadLiveEvaluation, 4000); // Polling cada 4 segundos
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.border-slate {
  border: 1px solid rgba(148, 163, 184, 0.15);
}
.border-b-slate {
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}
.decision-card {
  transition: all 0.3s ease;
}
.border-emerald-glow {
  border: 2px solid #10b981;
  box-shadow: 0 0 25px rgba(16, 185, 129, 0.25);
}
.border-amber-glow {
  border: 2px solid #f59e0b;
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.20);
}
.border-red-glow {
  border: 2px solid #ef4444;
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.20);
}
</style>
