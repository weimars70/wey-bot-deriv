<template>
  <q-page class="h1-strategy-page q-pa-lg">
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ── 1. HEADER HERO ────────────────────────────────────────────────── -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div class="row items-center justify-between q-mb-md flex-wrap q-gutter-y-md">
      <div>
        <div class="row items-center q-gutter-sm">
          <q-icon name="candlestick_chart" size="34px" color="indigo-7" />
          <div>
            <div class="row items-center q-gutter-xs">
              <h1 class="text-h5 text-weight-bolder text-slate-900 q-ma-none">
                Estrategia H1
              </h1>
              <q-badge color="indigo-1" text-color="indigo-9" label="MARUBOZU H1" class="text-weight-bold" />
            </div>
            <div class="text-caption text-slate-500 q-mt-xs">
              Monitoreo continuo en tiempo real de velas horarias y estadísticas históricas de acierto en la siguiente vela.
            </div>
          </div>
        </div>
      </div>

      <!-- Controles de cabecera -->
      <div class="row items-center q-gutter-sm flex-wrap">
        <!-- Reloj de cuenta regresiva al cambio de hora -->
        <div class="countdown-clock-pill row items-center q-px-md q-py-sm">
          <q-icon name="hourglass_top" size="18px" class="q-mr-xs text-indigo-7" />
          <div>
            <div class="text-caption text-slate-500 text-weight-medium" style="line-height:1;">Próximo cierre H1:</div>
            <div class="text-body2 text-weight-bolder text-indigo-9">
              {{ countdownText }} <span class="text-caption text-slate-600 font-normal">({{ nextHourTime }})</span>
            </div>
          </div>
        </div>

        <!-- Toggle Alerta Sonora y Voz sincronizados -->
        <q-toggle
          v-model="soundModel"
          color="indigo-7"
          dense
          label="Sonido H1"
          class="text-caption text-weight-bold text-slate-700 bg-white q-px-sm q-py-xs rounded-borders border-slate"
        >
          <q-tooltip>Emite timbre acústico si al cerrar la hora un índice queda sin mecha</q-tooltip>
        </q-toggle>

        <q-toggle
          v-model="voiceModel"
          color="purple-7"
          dense
          label="Voz Alta"
          class="text-caption text-weight-bold text-slate-700 bg-white q-px-sm q-py-xs rounded-borders border-slate"
        >
          <q-tooltip>Anuncia con voz en español al detectar vela H1 sin mecha</q-tooltip>
        </q-toggle>

        <!-- Botón probar sonido y voz -->
        <q-btn
          flat
          dense
          color="indigo-7"
          icon="volume_up"
          label="Probar Audio"
          class="q-px-xs text-caption text-weight-bold"
          @click="testAudio"
        />

        <!-- Bot H1 Auto-trading -->
        <q-btn
          :color="tradingStore.config.h1AutoEnabled ? 'emerald-7' : 'grey-7'"
          :icon="tradingStore.config.h1AutoEnabled ? 'smart_toy' : 'pause_circle'"
          :label="tradingStore.config.h1AutoEnabled ? 'Bot H1: ACTIVO' : 'Bot H1: PAUSADO'"
          unelevated
          dense
          class="q-px-sm text-caption text-weight-bold"
          @click="tradingStore.toggleStrategy('h1')"
        >
          <q-tooltip>Apertura automática de trades cuando una vela H1 cierre sin mechas</q-tooltip>
        </q-btn>

        <!-- Límite de Trades por Índice -->
        <q-chip
          dense
          size="sm"
          color="indigo-9"
          text-color="white"
          class="text-weight-bolder font-mono q-px-sm"
        >
          <q-icon name="pin" size="13px" class="q-mr-xs" />
          Máx 2 trades / activo
        </q-chip>

        <!-- Botón refrescar -->
        <q-btn
          unelevated
          color="indigo-7"
          icon="sync"
          label="Actualizar"
          dense
          class="q-px-sm"
          :loading="activeMainTab === 'live' ? loading : statsLoading"
          @click="refreshCurrentView"
        />
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ── NAVEGACIÓN PRINCIPAL: RADAR EN VIVO vs ESTADÍSTICAS & RENDIMIENTO -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div class="row items-center justify-between q-mb-lg flex-wrap q-gutter-sm">
      <q-tabs
        v-model="activeMainTab"
        dense
        class="main-navigation-tabs text-slate-700 bg-white rounded-borders border-slate shadow-1"
        active-color="indigo-8"
        active-bg-color="indigo-1"
        indicator-color="indigo-7"
        align="left"
        narrow-indicator
        @update:model-value="onMainTabChange"
      >
        <q-tab name="live" icon="radar" label="Radar en Vivo & Scanner (24h)">
          <q-badge
            v-if="summaryData.activeAlerts && summaryData.activeAlerts.length > 0"
            color="red-6"
            floating
            label="!"
          />
        </q-tab>
        <q-tab name="stats" icon="analytics" label="📊 Estadísticas & Rendimiento Histórico">
          <q-badge color="indigo-7" text-color="white" label="PROFIT & WIN RATE" class="q-ml-xs text-weight-bolder" />
        </q-tab>
      </q-tabs>

      <div v-if="activeMainTab === 'stats'" class="text-caption text-slate-500 font-mono">
        Muestra histórica: <b class="text-indigo-9">{{ statsData.summary?.totalSignals || 0 }}</b> velas sin mecha procesadas
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ── VISTA 1: RADAR EN VIVO & SCANNER 24H ──────────────────────────── -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div v-if="activeMainTab === 'live'">
      <!-- Banner de Alerta Activa en último cambio de hora -->
      <transition-group appear enter-active-class="animated fadeInDown" leave-active-class="animated fadeOutUp">
        <div
          v-if="summaryData.activeAlerts && summaryData.activeAlerts.length > 0"
          key="active-alerts-banner"
          class="active-alerts-banner q-pa-md q-mb-lg row items-center justify-between"
        >
          <div class="row items-center q-gutter-md">
            <div class="alert-pulse-circle">
              <q-icon name="notifications_active" size="28px" color="white" />
            </div>
            <div>
              <div class="row items-center q-gutter-xs">
                <span class="text-subtitle1 text-weight-bolder text-white">
                  ¡ALERTA ACTIVA DETECTADA EN EL ÚLTIMO CAMBIO DE HORA!
                </span>
                <q-badge color="white" text-color="red-9" label="ACCIÓN INMEDIATA" class="text-weight-bold" />
              </div>
              <div class="text-body2 text-red-1 q-mt-xs">
                <span v-for="a in summaryData.activeAlerts" :key="a.symbol" class="q-mr-md">
                  🎯 <b>{{ a.mercado }}</b> cerró vela <b>{{ a.direction }}</b> sin mechas a las {{ formatHour(a.closedAt) }} (Cuerpo: {{ a.body }} pts).
                  <b v-if="a.h4AgainstTrade"> H4 {{ a.h4Trend }} EN CONTRA: evaluar bien.</b>
                  <b v-if="a.historicalReaction?.found">
                    Reacción histórica: {{ a.historicalReaction.count === 1 ? '1 vez' : `${a.historicalReaction.count} veces` }} cerca de {{ a.historicalReaction.level }};
                    última {{ a.historicalReaction.lastDirection }} de {{ a.historicalReaction.lastMovePoints }} puntos. Señal apta para auto-trade H1.
                  </b>
                </span>
              </div>
            </div>
          </div>
          <q-btn
            unelevated
            color="white"
            text-color="red-9"
            label="Ver Detalles"
            class="text-weight-bold q-px-md"
            @click="selectSymbol(summaryData.activeAlerts[0]?.symbol)"
          />
        </div>
      </transition-group>

      <!-- Banner de Trades Activos H1 -->
      <div v-if="tradingStore.h1Trades.length > 0" class="q-mb-lg">
        <div
          v-for="t in tradingStore.h1Trades"
          :key="t.id"
          class="q-pa-md q-mb-sm rounded-borders text-white row items-center justify-between shadow-2"
          :style="{
            background: t.pnlPoints >= 0
              ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
              : 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)'
          }"
        >
          <div class="row items-center q-gutter-md">
            <q-avatar size="40px" color="white" :text-color="t.pnlPoints >= 0 ? 'emerald-9' : 'indigo-9'" icon="rocket_launch" />
            <div>
              <div class="row items-center q-gutter-xs">
                <span class="text-subtitle1 text-weight-bolder">
                  TRADE H1 EN CURSO: {{ t.mercado }} ({{ t.direction }})
                </span>
                <q-badge
                  color="white"
                  :text-color="t.pnlPoints >= 0 ? 'emerald-9' : 'amber-10'"
                  :label="t.pnlPoints >= 0 ? 'EN PROFIT · CIERRE AL CAMBIO DE HORA 🎯' : 'EN ESPERA DE PROFIT ⏳'"
                  class="text-weight-bolder"
                />
              </div>
              <div class="text-caption q-mt-xs font-mono">
                Entrada: <b>{{ t.entryPrice }}</b> |
                Actual: <b>{{ t.currentPrice }}</b> |
                SL Protección: <b>{{ t.stopLossPrice || '10 min (10 velas M1)' }}</b> |
                Cierre automático si hay profit: a las <b>{{ nextHourTime }}</b> (en {{ countdownText }})
              </div>
            </div>
          </div>

          <div class="row items-center q-gutter-md">
            <div class="text-right">
              <div class="text-h6 text-weight-bolder font-mono" style="line-height: 1;">
                {{ t.pnlPoints >= 0 ? '+' : '' }}{{ t.pnlPoints }} pts
              </div>
              <div class="text-caption text-weight-bold">
                {{ t.pnlPercent >= 0 ? '+' : '' }}{{ t.pnlPercent }}%
              </div>
            </div>
            <q-btn
              unelevated
              color="white"
              :text-color="t.pnlPoints >= 0 ? 'emerald-9' : 'indigo-9'"
              label="Cerrar Trade"
              icon="close"
              size="sm"
              class="text-weight-bold"
              @click="tradingStore.closeTrade(t.id)"
            />
          </div>
        </div>
      </div>

      <!-- KPIs Resumen 24 Horas -->
      <div class="row q-col-gutter-md q-mb-lg">
        <div class="col-12 col-sm-6 col-md-3">
          <div class="kpi-card">
            <div class="kpi-icon bg-indigo-1 text-indigo-7">
              <q-icon name="query_stats" size="24px" />
            </div>
            <div>
              <div class="kpi-value text-slate-900">{{ summaryData.indices?.length || 0 }}</div>
              <div class="kpi-label">Índices Monitoreados H1</div>
            </div>
          </div>
        </div>

        <div class="col-12 col-sm-6 col-md-3">
          <div class="kpi-card" :class="{ 'kpi-card--alert': summaryData.activeAlerts?.length > 0 }">
            <div class="kpi-icon" :class="summaryData.activeAlerts?.length > 0 ? 'bg-red-1 text-red-7' : 'bg-emerald-1 text-emerald-7'">
              <q-icon :name="summaryData.activeAlerts?.length > 0 ? 'warning' : 'check_circle'" size="24px" />
            </div>
            <div>
              <div class="kpi-value" :class="summaryData.activeAlerts?.length > 0 ? 'text-red-7' : 'text-emerald-7'">
                {{ summaryData.activeAlerts?.length || 0 }}
              </div>
              <div class="kpi-label">Alertas en Cambio de Hora</div>
            </div>
          </div>
        </div>

        <div class="col-12 col-sm-6 col-md-3">
          <div class="kpi-card">
            <div class="kpi-icon bg-amber-1 text-amber-8">
              <q-icon name="stars" size="24px" />
            </div>
            <div>
              <div class="kpi-value text-amber-9">{{ totalNoWickCount24h }}</div>
              <div class="kpi-label">Velas Sin Mecha (Últimas 24h)</div>
            </div>
          </div>
        </div>

        <div class="col-12 col-sm-6 col-md-3">
          <div class="kpi-card">
            <div class="kpi-icon bg-blue-1 text-blue-7">
              <q-icon name="leaderboard" size="24px" />
            </div>
            <div>
              <div class="kpi-value text-blue-9">{{ topIndexName }}</div>
              <div class="kpi-label">Índice con Mayor Frecuencia</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Selector de Índices (Pills) -->
      <div class="index-nav-pills row items-center q-gutter-xs q-mb-md">
        <q-btn
          :flat="selectedSymbol !== 'ALL'"
          :unelevated="selectedSymbol === 'ALL'"
          :color="selectedSymbol === 'ALL' ? 'indigo-7' : 'white'"
          :text-color="selectedSymbol === 'ALL' ? 'white' : 'slate-800'"
          dense
          class="index-nav-btn text-weight-bold"
          @click="selectedSymbol = 'ALL'"
        >
          <span class="q-mr-xs">⭐ TODOS LOS ÍNDICES</span>
          <q-badge
            color="amber-8"
            :label="`${totalNoWickCount24h}v`"
            class="q-ml-xs text-weight-bold"
          />
        </q-btn>

        <q-btn
          v-for="idx in summaryData.indices"
          :key="idx.symbol"
          :flat="selectedSymbol !== idx.symbol"
          :unelevated="selectedSymbol === idx.symbol"
          :color="selectedSymbol === idx.symbol ? 'indigo-7' : 'white'"
          :text-color="selectedSymbol === idx.symbol ? 'white' : 'slate-800'"
          dense
          class="index-nav-btn text-weight-bold"
          @click="selectedSymbol = idx.symbol"
        >
          <span class="q-mr-xs">{{ idx.mercado }}</span>
          <q-badge
            :color="idx.hasActiveAlert ? 'red-6' : idx.noWickCount24h > 0 ? 'amber-8' : 'grey-5'"
            :label="idx.hasActiveAlert ? '🚨 ALERTA' : `${idx.noWickCount24h}v`"
            class="q-ml-xs text-weight-bold"
          />
        </q-btn>
      </div>

      <!-- Contenido del resumen / índice seleccionado -->
      <div class="bg-white rounded-borders q-pa-lg border-slate q-mb-xl">
        <div class="row items-center justify-between q-mb-md flex-wrap">
          <div>
            <div class="row items-center q-gutter-sm">
              <span class="text-h6 text-weight-bolder text-slate-900">
                {{ selectedSymbol === 'ALL' ? 'Resumen Consolidado · Velas Sin Mecha (24h)' : currentIndex?.mercado }}
              </span>
              <span v-if="selectedSymbol !== 'ALL' && currentIndex" class="text-caption text-slate-500 font-mono">
                ({{ currentIndex.symbol }})
              </span>
              <q-badge
                v-if="selectedSymbol !== 'ALL' && currentIndex?.hasActiveAlert"
                color="red-7"
                label="🚨 ALERTA EN ESTE CAMBIO DE HORA"
                class="text-weight-bold q-py-xs"
              />
            </div>
            <div class="text-caption text-slate-500 q-mt-xs">
              Mostrando exclusivamente las velas que <b>cerraron sin mecha (Marubozu)</b> en las últimas 24 horas.
              Total: <b class="text-amber-9 font-mono">{{ filteredCandles.length }} vela(s)</b>.
            </div>
          </div>
        </div>

        <!-- Línea de tiempo visual de 24 horas -->
        <div v-if="selectedSymbol !== 'ALL' && currentIndex" class="timeline-container q-mb-lg">
          <div class="text-caption text-weight-bold text-slate-600 q-mb-xs">
            Línea de Tiempo 24h (Cada bloque representa 1 hora H1):
          </div>
          <div class="timeline-bar row items-center no-wrap">
            <div
              v-for="c in currentIndex.candles24h"
              :key="c.epoch"
              class="timeline-block col"
              :class="[
                c.isBullish ? 'block--bull' : 'block--bear',
                c.isNoWickBoth ? 'block--nowick' : '',
                c.isInProgress ? 'block--current' : ''
              ]"
              :title="`${c.hourStr}: ${c.isBullish ? 'Alcista' : 'Bajista'} | Sup: ${c.upperWick}, Inf: ${c.lowerWick} ${c.isNoWickBoth ? '⭐ SIN MECHA' : ''} ${c.isInProgress ? '(En curso)' : ''}`"
            >
              <span class="block-hour">{{ c.hourStr }}</span>
              <span v-if="c.isNoWickBoth" class="block-star">⭐</span>
            </div>
          </div>
          <div class="row items-center justify-between text-caption text-slate-400 q-mt-xs">
            <span>Hace 24 horas</span>
            <span>🟢 Alcista · 🔴 Bajista · ⭐ Sin Mecha (Marubozu)</span>
            <span>Hora Actual (En curso)</span>
          </div>
        </div>

        <!-- Tabla detallada 24h -->
        <q-table
          flat
          dense
          :rows="filteredCandles"
          :columns="tableColumns"
          row-key="rowKey"
          :pagination="{ rowsPerPage: 25 }"
          class="h1-candles-table"
        >
          <template #body-cell-mercado="props">
            <q-td :props="props">
              <div
                class="row items-center q-gutter-xs cursor-pointer text-indigo-7 text-weight-bold"
                @click="selectedSymbol = props.row.symbol"
              >
                <span>{{ props.row.mercado }}</span>
                <q-badge color="indigo-1" text-color="indigo-9" :label="props.row.symbol" class="text-caption" />
              </div>
            </q-td>
          </template>

          <template #body-cell-type="props">
            <q-td :props="props">
              <q-badge
                :color="props.row.isBullish ? 'green-1' : 'red-1'"
                :text-color="props.row.isBullish ? 'green-9' : 'red-9'"
                :label="props.row.isBullish ? 'ALCISTA 🟢' : 'BAJISTA 🔴'"
                class="text-weight-bold"
              />
            </q-td>
          </template>

          <template #body-cell-status="props">
            <q-td :props="props">
              <q-badge
                color="amber-1"
                text-color="amber-10"
                label="⭐ SIN MECHA (MARUBOZU)"
                class="text-weight-bolder border-amber q-py-xs"
              />
            </q-td>
          </template>

          <template #body-cell-upperWick="props">
            <q-td :props="props">
              <span class="text-positive text-weight-bold">
                {{ props.row.upperWick }} ✓
              </span>
            </q-td>
          </template>

          <template #body-cell-lowerWick="props">
            <q-td :props="props">
              <span class="text-positive text-weight-bold">
                {{ props.row.lowerWick }} ✓
              </span>
            </q-td>
          </template>

          <template #no-data>
            <div class="full-width row flex-center q-pa-lg text-slate-400">
              <q-icon name="check_circle_outline" size="28px" class="q-mr-sm text-slate-300" />
              <span>No se registraron velas cerradas sin mecha en las últimas 24 horas para este filtro.</span>
            </div>
          </template>
        </q-table>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ── VISTA 2: ESTADÍSTICAS & RENDIMIENTO HISTÓRICO ─────────────────── -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="activeMainTab === 'stats'">
      <!-- ── BARRA DE FILTROS INTERACTIVOS ──────────────────────────────── -->
      <div class="stats-filter-card q-pa-md q-mb-lg rounded-borders border-slate shadow-1">
        <div class="row items-center justify-between q-mb-sm flex-wrap q-gutter-xs">
          <div class="row items-center q-gutter-xs">
            <q-icon name="tune" size="20px" color="indigo-7" />
            <span class="text-subtitle2 text-weight-bolder text-slate-800">Filtros de Análisis Histórico</span>
          </div>
          <div class="row items-center q-gutter-xs">
            <q-btn
              flat
              dense
              size="sm"
              color="indigo-7"
              icon="restart_alt"
              label="Restablecer Filtros"
              @click="resetStatsFilters"
            />
          </div>
        </div>

        <div class="row q-col-gutter-sm items-center">
          <!-- Filtro Mes -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-select
              v-model="selectedMonth"
              :options="availableMonthOptions"
              emit-value
              map-options
              dense
              outlined
              bg-white
              label="Filtrar por Mes"
              class="stats-filter-select"
              @update:model-value="onMonthChange"
            >
              <template #prepend>
                <q-icon name="calendar_month" color="indigo-7" size="18px" />
              </template>
            </q-select>
          </div>

          <!-- Filtro Semana -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-select
              v-model="selectedWeek"
              :options="availableWeekOptions"
              emit-value
              map-options
              dense
              outlined
              bg-white
              label="Filtrar por Semana"
              class="stats-filter-select"
              @update:model-value="onWeekChange"
            >
              <template #prepend>
                <q-icon name="view_week" color="indigo-7" size="18px" />
              </template>
            </q-select>
          </div>

          <!-- Filtro Índice / Activo -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-select
              v-model="statsSelectedSymbol"
              :options="availableSymbolOptions"
              emit-value
              map-options
              dense
              outlined
              bg-white
              label="Filtrar por Índice"
              class="stats-filter-select"
              @update:model-value="onSymbolChange"
            >
              <template #prepend>
                <q-icon name="show_chart" color="indigo-7" size="18px" />
              </template>
            </q-select>
          </div>

          <!-- Tolerancia de Mecha -->
          <div class="col-12 col-sm-6 col-md-3">
            <div class="row items-center no-wrap justify-between bg-white q-px-sm q-py-xs rounded-borders border-slate">
              <span class="text-caption text-weight-bold text-slate-600 q-mr-xs">Tolerancia:</span>
              <q-btn-toggle
                v-model="selectedTolerance"
                dense
                unelevated
                toggle-color="indigo-7"
                toggle-text-color="white"
                color="grey-2"
                text-color="slate-700"
                size="sm"
                :options="[
                  { label: '0.2%', value: 0.2 },
                  { label: '0.5%', value: 0.5 },
                  { label: '1.0%', value: 1.0 },
                  { label: '2.0%', value: 2.0 }
                ]"
                @update:model-value="onToleranceChange"
              />
            </div>
          </div>

          <!-- Ventana de meses -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-select
              v-model="selectedRealMonths"
              :options="[{ label: 'Último 1 mes', value: 1 }, { label: 'Últimos 2 meses', value: 2 }, { label: 'Últimos 3 meses', value: 3 }]"
              emit-value
              map-options
              dense
              outlined
              bg-white
              label="Simular ventana"
              class="stats-filter-select"
              @update:model-value="onRealMonthsChange"
            >
              <template #prepend>
                <q-icon name="calendar_view_month" color="indigo-7" size="18px" />
              </template>
            </q-select>
          </div>
        </div>

        <!-- Criterio de Profit & Botón Actualizar -->
        <div class="row items-center justify-between q-mt-sm pt-2 border-top-slate flex-wrap q-gutter-sm">
          <div class="row items-center q-gutter-sm">
            <span class="text-caption text-weight-bold text-slate-700">Criterio de Evaluación de Profit:</span>
            <q-btn-toggle
              v-model="profitCriterion"
              dense
              unelevated
              toggle-color="indigo-8"
              toggle-text-color="white"
              color="grey-2"
              text-color="slate-700"
              size="sm"
              :options="[
                { label: 'Al Cierre de Vela H1 (Estricto)', value: 'close' },
                { label: 'Pico Máximo Intradía H1 (Flexible)', value: 'peak' }
              ]"
            />
            <q-icon name="info" size="16px" color="slate-400">
              <q-tooltip class="bg-indigo-9 text-caption">
                <b>Al Cierre:</b> Evalúa si la siguiente hora cerró con ganancia neta respecto al precio de entrada.<br>
                <b>Pico Máximo:</b> Evalúa si en algún momento durante la siguiente hora el precio alcanzó ganancia favorable.
              </q-tooltip>
            </q-icon>
          </div>

          <div class="row items-center q-gutter-sm">
            <q-btn
              unelevated
              color="indigo-7"
              icon="sync"
              label="Aplicar & Recargar"
              dense
              class="q-px-md text-weight-bold"
              :loading="statsLoading"
              @click="loadStatistics"
            />
          </div>
        </div>
      </div>

      <div class="q-mb-lg">
        <div class="row items-center justify-between q-mb-sm">
          <div class="text-subtitle1 text-weight-bolder text-slate-800">Resumen real por índice H1</div>
          <div class="text-caption text-slate-500">Ventana: {{ selectedRealMonths }} mes{{ selectedRealMonths > 1 ? 'es' : '' }}</div>
        </div>

        <q-card flat bordered class="bg-white">
          <q-table
            flat
            dense
            :rows="realSummaryRows"
            :columns="realSummaryColumns"
            row-key="symbol"
            :loading="realSummaryLoading"
            :pagination="{ rowsPerPage: 10 }"
          >
            <template #body-cell-symbol="props">
              <q-td :props="props">
                <span class="text-weight-bold text-indigo-9">{{ props.row.symbol }}</span>
                <div class="text-caption text-slate-500">{{ props.row.mercado }}</div>
              </q-td>
            </template>

            <template #body-cell-firstCandleWinRatePct="props">
              <q-td :props="props">
                <span :class="props.row.firstCandleWinRatePct >= 50 ? 'text-positive text-weight-bold' : 'text-negative text-weight-bold'">
                  {{ props.row.firstCandleWinRatePct }}%
                </span>
              </q-td>
            </template>

            <template #body-cell-secondCandleWinRatePct="props">
              <q-td :props="props">
                <span :class="props.row.secondCandleWinRatePct >= 50 ? 'text-positive text-weight-bold' : 'text-negative text-weight-bold'">
                  {{ props.row.secondCandleWinRatePct }}%
                </span>
              </q-td>
            </template>

            <template #body-cell-continuationRatePct="props">
              <q-td :props="props">
                <span class="text-indigo-7 text-weight-bold">{{ props.row.continuationRatePct }}%</span>
              </q-td>
            </template>

            <template #body-cell-totalPnlPoints="props">
              <q-td :props="props">
                <span :class="props.row.totalPnlPoints >= 0 ? 'text-positive text-weight-bold' : 'text-negative text-weight-bold'">
                  {{ props.row.totalPnlPoints >= 0 ? '+' : '' }}{{ props.row.totalPnlPoints }}
                </span>
              </q-td>
            </template>
          </q-table>
        </q-card>
      </div>

      <!-- ── 5 HERO KPIS DE RENDIMIENTO ─────────────────────────────────── -->
      <div class="row q-col-gutter-md q-mb-lg">
        <!-- 1. Total Velas Sin Mecha -->
        <div class="col-12 col-sm-6 col-md-2-4">
          <div class="stats-kpi-card">
            <div class="stats-kpi-header">
              <span class="stats-kpi-title">Velas Sin Mecha (H1)</span>
              <div class="stats-kpi-icon-wrap bg-amber-1 text-amber-9">
                <q-icon name="candlestick_chart" size="20px" />
              </div>
            </div>
            <div class="stats-kpi-main font-mono text-slate-900">
              {{ statsSummary.totalSignals }}
            </div>
            <div class="stats-kpi-sub text-slate-500">
              Oportunidades identificadas
            </div>
          </div>
        </div>

        <!-- 2. Aciertos con Profit (Wins) -->
        <div class="col-12 col-sm-6 col-md-2-4">
          <div class="stats-kpi-card">
            <div class="stats-kpi-header">
              <span class="stats-kpi-title">
                {{ profitCriterion === 'close' ? 'Aciertos al Cierre' : 'Aciertos por Pico' }}
              </span>
              <div class="stats-kpi-icon-wrap bg-emerald-1 text-emerald-7">
                <q-icon name="check_circle" size="20px" />
              </div>
            </div>
            <div class="stats-kpi-main font-mono text-emerald-7">
              {{ statsSummary.winCount }}
            </div>
            <div class="stats-kpi-sub text-slate-500">
              vs <b class="text-red-7 font-mono">{{ statsSummary.lossCount }}</b> en contra
            </div>
          </div>
        </div>

        <!-- 3. Tasa de Efectividad % (Win Rate) -->
        <div class="col-12 col-sm-6 col-md-2-4">
          <div class="stats-kpi-card">
            <div class="stats-kpi-header">
              <span class="stats-kpi-title">Efectividad Global</span>
              <div
                class="stats-kpi-icon-wrap"
                :class="statsSummary.winRatePct >= 60 ? 'bg-emerald-1 text-emerald-7' : statsSummary.winRatePct >= 50 ? 'bg-amber-1 text-amber-8' : 'bg-red-1 text-red-7'"
              >
                <q-icon name="percent" size="20px" />
              </div>
            </div>
            <div
              class="stats-kpi-main font-mono"
              :class="statsSummary.winRatePct >= 60 ? 'text-emerald-7' : statsSummary.winRatePct >= 50 ? 'text-amber-8' : 'text-red-7'"
            >
              {{ statsSummary.winRatePct }}%
            </div>
            <q-linear-progress
              :value="statsSummary.winRatePct / 100"
              rounded
              size="6px"
              class="q-my-xs"
              :color="statsSummary.winRatePct >= 60 ? 'emerald-6' : statsSummary.winRatePct >= 50 ? 'amber-6' : 'red-6'"
              track-color="grey-3"
            />
            <div class="stats-kpi-sub text-slate-500">
              {{ profitCriterion === 'close' ? 'En cierre siguiente vela' : 'Alcanzó pico de ganancia' }}
            </div>
          </div>
        </div>

        <!-- 4. Puntos Netos Acumulados -->
        <div class="col-12 col-sm-6 col-md-2-4">
          <div class="stats-kpi-card">
            <div class="stats-kpi-header">
              <span class="stats-kpi-title">Puntos Netos Totales</span>
              <div
                class="stats-kpi-icon-wrap"
                :class="statsSummary.totalPnlPoints >= 0 ? 'bg-indigo-1 text-indigo-7' : 'bg-red-1 text-red-7'"
              >
                <q-icon name="trending_up" size="20px" />
              </div>
            </div>
            <div
              class="stats-kpi-main font-mono"
              :class="statsSummary.totalPnlPoints >= 0 ? 'text-indigo-9' : 'text-red-7'"
            >
              {{ statsSummary.totalPnlPoints >= 0 ? '+' : '' }}{{ statsSummary.totalPnlPoints }}
            </div>
            <div class="stats-kpi-sub text-slate-500 font-mono">
              Promedio: <b>{{ statsSummary.avgPnlPoints >= 0 ? '+' : '' }}{{ statsSummary.avgPnlPoints }}</b> pts/op
            </div>
          </div>
        </div>

        <!-- 5. Mejor Índice del Período -->
        <div class="col-12 col-sm-6 col-md-2-4">
          <div class="stats-kpi-card">
            <div class="stats-kpi-header">
              <span class="stats-kpi-title">Mejor Índice</span>
              <div class="stats-kpi-icon-wrap bg-purple-1 text-purple-7">
                <q-icon name="emoji_events" size="20px" />
              </div>
            </div>
            <div class="stats-kpi-main text-purple-9 text-truncate" style="font-size: 19px;">
              {{ statsSummary.bestSymbol?.mercado || '—' }}
            </div>
            <div class="stats-kpi-sub text-slate-500">
              <span v-if="statsSummary.bestSymbol" class="font-mono">
                <b class="text-emerald-7">{{ statsSummary.bestSymbol.winRatePct }}%</b> win rate ({{ statsSummary.bestSymbol.winCount }}/{{ statsSummary.bestSymbol.totalSignals }})
              </span>
              <span v-else>Sin datos en rango</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── SUB-TABS: POR ÍNDICE / POR SEMANA / MATRIZ / REGISTRO ───────── -->
      <div class="bg-white rounded-borders border-slate q-pa-md q-mb-xl shadow-1">
        <q-tabs
          v-model="statsSubTab"
          dense
          class="sub-tabs-bar text-slate-600 q-mb-md border-slate rounded-borders"
          active-color="indigo-8"
          active-bg-color="indigo-1"
          indicator-color="indigo-7"
          align="left"
        >
          <q-tab name="lastDay" icon="today" label="Resumen Último Día (24h)">
            <q-badge color="teal-1" text-color="teal-9" :label="`${lastDayEvents.length}`" class="q-ml-xs text-weight-bolder" />
            <q-badge color="red-8" text-color="white" label="VERIFICACIÓN" class="q-ml-xs text-weight-bolder" />
          </q-tab>
          <q-tab name="byIndex" icon="leaderboard" label="Desempeño por Índice">
            <q-badge color="indigo-1" text-color="indigo-9" :label="`${statsBySymbol.length}`" class="q-ml-xs text-weight-bold" />
          </q-tab>
          <q-tab name="byWeek" icon="calendar_view_week" label="Evolución por Semana">
            <q-badge color="indigo-1" text-color="indigo-9" :label="`${statsByWeek.length}`" class="q-ml-xs text-weight-bold" />
          </q-tab>
          <q-tab name="matrix" icon="grid_view" label="Matriz Índice × Semana">
            <q-badge color="amber-1" text-color="amber-9" label="HEATMAP" class="q-ml-xs text-weight-bold" />
          </q-tab>
          <q-tab name="events" icon="history" label="Registro Histórico de Señales">
            <q-badge color="indigo-1" text-color="indigo-9" :label="`${statsData.events?.length || 0}`" class="q-ml-xs text-weight-bold" />
          </q-tab>
        </q-tabs>

        <!-- ── TAB 0: RESUMEN ÚLTIMO DÍA (24h) ─────────────────────────────── -->
        <div v-if="statsSubTab === 'lastDay'">
          <!-- Banner de info -->
          <div class="last-day-banner row items-center q-pa-md q-mb-lg rounded-borders">
            <q-icon name="today" size="28px" color="teal-7" class="q-mr-md" />
            <div class="col">
              <div class="text-subtitle1 text-weight-bolder text-teal-9">Resumen Detallado — Últimas 24 Horas</div>
              <div class="text-caption text-teal-8">
                Listado de cada vela H1 sin mecha detectada en las <b>últimas 24 horas</b> con resultado de la vela siguiente.
                Tolerancia activa: <b>{{ selectedTolerance }}%</b> · Generado: <b>{{ lastDayGeneratedAt }}</b>
              </div>
              <!-- Aviso si el criterio global es PICO: aclarar que esta vista siempre muestra cierre -->
              <div class="text-caption text-amber-9 text-weight-bold q-mt-xs" v-if="profitCriterion === 'peak'">
                ⚠️ Esta vista usa siempre <b>"Al Cierre"</b> para verificación real. El criterio "Pico" que tienes activo en filtros solo aplica en los otros tabs.
              </div>
            </div>
            <div class="row q-gutter-md q-ml-md">
              <div class="text-center">
                <div class="text-h6 font-mono text-weight-bolder text-teal-9">{{ lastDayEvents.length }}</div>
                <div class="text-caption text-teal-7">Señales 24h</div>
              </div>
              <!-- CIERRE: siempre fijo -->
              <div class="text-center">
                <div class="text-h6 font-mono text-weight-bolder text-emerald-7">{{ lastDayWinsClose }}</div>
                <div class="text-caption text-emerald-6">✓ Cierre</div>
              </div>
              <div class="text-center">
                <div class="text-h6 font-mono text-weight-bolder text-red-7">{{ lastDayLossesClose }}</div>
                <div class="text-caption text-red-6">✗ Cierre</div>
              </div>
              <div class="text-center">
                <div
                  class="text-h6 font-mono text-weight-bolder"
                  :class="lastDayWinRateClose >= 60 ? 'text-emerald-7' : lastDayWinRateClose >= 50 ? 'text-amber-8' : 'text-red-7'"
                >
                  {{ lastDayWinRateClose }}%
                </div>
                <div class="text-caption text-slate-500">% Al Cierre</div>
              </div>
              <!-- PICO: separado -->
              <div class="text-center border-left-slate q-pl-md">
                <div class="text-h6 font-mono text-weight-bolder text-blue-7">{{ lastDayWinsPeak }}</div>
                <div class="text-caption text-blue-6">✓ Pico</div>
              </div>
              <div class="text-center">
                <div class="text-h6 font-mono text-weight-bolder text-blue-8">{{ lastDayWinRatePeak }}%</div>
                <div class="text-caption text-slate-500">% Pico</div>
              </div>
            </div>
          </div>

          <div class="row q-col-gutter-sm q-mb-lg" v-if="lastDayBySymbol.length > 0">
            <div
              v-for="sym in lastDayBySymbol"
              :key="sym.symbol"
              class="col-12 col-sm-6 col-md-3"
            >
              <div
                class="last-day-sym-card rounded-borders q-pa-sm"
                :class="sym.winRateClose >= 60 ? 'card-win' : sym.winRateClose >= 50 ? 'card-mid' : 'card-loss'"
              >
                <div class="row items-center justify-between q-mb-xs">
                  <div>
                    <div class="text-caption text-weight-bolder text-slate-700">{{ sym.mercado }}</div>
                    <div class="text-caption text-slate-500 font-mono">{{ sym.symbol }}</div>
                  </div>
                  <div class="text-right">
                    <q-badge
                      :color="sym.winRateClose >= 60 ? 'emerald-1' : sym.winRateClose >= 50 ? 'amber-1' : 'red-1'"
                      :text-color="sym.winRateClose >= 60 ? 'emerald-9' : sym.winRateClose >= 50 ? 'amber-9' : 'red-9'"
                      :label="`${sym.winRateClose}% cierre`"
                      class="text-weight-bolder font-mono"
                    />
                    <div class="text-caption text-blue-7 font-mono q-mt-xs">
                      Pico: {{ sym.winRatePeak }}%
                    </div>
                  </div>
                </div>
                <div class="row items-center q-gutter-xs">
                  <span class="text-caption text-slate-500">{{ sym.total }} señal(es):</span>
                  <span class="text-caption text-emerald-7 text-weight-bold">{{ sym.winsClose }}✓</span>
                  <span class="text-caption text-red-7 text-weight-bold">{{ sym.lossesClose }}✗</span>
                </div>
                <q-linear-progress
                  :value="sym.winRateClose / 100"
                  rounded
                  size="4px"
                  class="q-mt-xs"
                  :color="sym.winRateClose >= 60 ? 'emerald-5' : sym.winRateClose >= 50 ? 'amber-5' : 'red-5'"
                  track-color="grey-3"
                />
              </div>
            </div>
          </div>

          <!-- Tabla de verificación manual señal por señal -->
          <div class="row items-center justify-between q-mb-sm flex-wrap q-gutter-sm">
            <div>
              <div class="text-subtitle2 text-weight-bolder text-slate-900">Verificación Manual Señal por Señal</div>
              <div class="text-caption text-slate-500">
                Cada fila = una vela H1 sin mecha. La columna <b>"Vela Siguiente"</b> muestra el precio de apertura y cierre de la vela siguiente para que puedas confirmar el resultado.
              </div>
            </div>
            <div class="row items-center q-gutter-xs">
              <q-btn-toggle
                v-model="lastDayFilter"
                dense
                unelevated
                toggle-color="teal-7"
                toggle-text-color="white"
                color="grey-2"
                text-color="slate-700"
                size="sm"
                :options="[
                  { label: 'Todos', value: 'all' },
                  { label: 'Solo Aciertos ✓', value: 'wins' },
                  { label: 'Solo Pérdidas ✗', value: 'losses' }
                ]"
              />
            </div>
          </div>

          <q-table
            flat
            dense
            :rows="filteredLastDayEvents"
            :columns="lastDayTableColumns"
            row-key="id"
            :pagination="{ rowsPerPage: 50, sortBy: 'signalEpoch', descending: true }"
            class="last-day-verify-table"
          >
            <!-- Hora de la Vela Sin Mecha -->
            <template #body-cell-signalTime="props">
              <q-td :props="props">
                <div class="text-weight-bolder font-mono text-slate-900" style="font-size: 13px;">{{ props.row.signalTimeStr }}</div>
                <div class="text-caption text-slate-400 font-mono">epoch: {{ props.row.signalEpoch }}</div>
              </q-td>
            </template>

            <!-- Índice -->
            <template #body-cell-mercado="props">
              <q-td :props="props">
                <div class="row items-center q-gutter-xs">
                  <q-badge
                    :color="props.row.marketType === 'BOOM' ? 'green-1' : 'red-1'"
                    :text-color="props.row.marketType === 'BOOM' ? 'green-9' : 'red-9'"
                    :label="props.row.marketType"
                    class="text-caption text-weight-bolder"
                  />
                  <span class="text-weight-bolder text-indigo-9">{{ props.row.mercado }}</span>
                </div>
              </q-td>
            </template>

            <!-- Dirección -->
            <template #body-cell-direction="props">
              <q-td :props="props" class="text-center">
                <q-badge
                  :color="props.row.direction === 'BUY' ? 'green-1' : 'red-1'"
                  :text-color="props.row.direction === 'BUY' ? 'green-9' : 'red-9'"
                  :label="props.row.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL'"
                  class="text-weight-bolder font-mono"
                />
              </q-td>
            </template>

            <!-- Vela Sin Mecha: OHLC -->
            <template #body-cell-signalCandle="props">
              <q-td :props="props">
                <div class="font-mono text-caption">
                  <div class="row items-center q-gutter-xs">
                    <span class="text-slate-500">O:</span><span class="text-weight-bold">{{ props.row.signalCandle?.open?.toFixed(3) }}</span>
                    <span class="text-slate-500">H:</span><span class="text-weight-bold text-emerald-7">{{ props.row.signalCandle?.high?.toFixed(3) }}</span>
                    <span class="text-slate-500">L:</span><span class="text-weight-bold text-red-7">{{ props.row.signalCandle?.low?.toFixed(3) }}</span>
                    <span class="text-slate-500">C:</span><span class="text-weight-bold text-indigo-9">{{ props.row.signalCandle?.close?.toFixed(3) }}</span>
                  </div>
                  <div class="text-slate-400">Cuerpo: {{ props.row.signalCandle?.body?.toFixed(3) }} | Mecha↑: {{ props.row.signalCandle?.upperWick?.toFixed(4) }} ↓: {{ props.row.signalCandle?.lowerWick?.toFixed(4) }}</div>
                </div>
              </q-td>
            </template>

            <!-- Precio de Entrada -->
            <template #body-cell-entryPrice="props">
              <q-td :props="props" class="text-right font-mono text-weight-bolder text-indigo-9">
                {{ props.row.entryPrice }}
              </q-td>
            </template>

            <!-- Vela Siguiente: OHLC para verificar manualmente -->
            <template #body-cell-nextCandle="props">
              <q-td :props="props">
                <div class="font-mono text-caption">
                  <div class="row items-center q-gutter-xs">
                    <span class="text-slate-500">O:</span><span class="text-weight-bold">{{ props.row.nextCandle?.open?.toFixed(3) }}</span>
                    <span class="text-slate-500">H:</span><span class="text-weight-bold text-emerald-7">{{ props.row.nextCandle?.high?.toFixed(3) }}</span>
                    <span class="text-slate-500">L:</span><span class="text-weight-bold text-red-7">{{ props.row.nextCandle?.low?.toFixed(3) }}</span>
                    <span class="text-slate-500">C:</span><span class="text-weight-bold text-indigo-9">{{ props.row.nextCandle?.close?.toFixed(3) }}</span>
                  </div>
                  <div class="text-slate-400">{{ props.row.nextCandle?.timeStr }} | Cuerpo: {{ props.row.nextCandle?.body?.toFixed(3) }}</div>
                </div>
              </q-td>
            </template>

            <!-- Resultado al Cierre -->
            <template #body-cell-resultClose="props">
              <q-td :props="props">
                <div class="text-center">
                  <q-badge
                    :color="props.row.isProfitClose ? 'emerald-1' : 'red-1'"
                    :text-color="props.row.isProfitClose ? 'emerald-9' : 'red-9'"
                    :label="props.row.isProfitClose ? '✓ PROFIT' : '✗ PÉRDIDA'"
                    class="text-weight-bolder font-mono text-caption"
                  />
                  <div
                    class="font-mono text-weight-bolder q-mt-xs"
                    style="font-size: 13px;"
                    :class="props.row.pnlClosePoints >= 0 ? 'text-emerald-7' : 'text-red-7'"
                  >
                    {{ props.row.pnlClosePoints >= 0 ? '+' : '' }}{{ props.row.pnlClosePoints?.toFixed(3) }} pts
                  </div>
                </div>
              </q-td>
            </template>

            <!-- Pico Favorable Máximo -->
            <template #body-cell-maxProfit="props">
              <q-td :props="props" class="text-center">
                <div class="font-mono text-emerald-7 text-weight-bold" style="font-size: 13px;">
                  +{{ props.row.maxProfitPoints?.toFixed(3) }}
                </div>
                <div class="text-caption text-slate-400">pts pico</div>
              </q-td>
            </template>

            <!-- Drawdown Máximo -->
            <template #body-cell-maxDrawdown="props">
              <q-td :props="props" class="text-center">
                <div class="font-mono text-red-7 text-weight-bold" style="font-size: 13px;">
                  -{{ props.row.maxDrawdownPoints?.toFixed(3) }}
                </div>
                <div class="text-caption text-slate-400">pts en contra</div>
              </q-td>
            </template>

            <template #no-data>
              <div class="full-width row flex-center q-pa-xl text-slate-400">
                <q-icon name="today" size="36px" class="q-mb-sm text-slate-300" />
                <div>No hay señales en las últimas 24 horas con los filtros seleccionados.</div>
              </div>
            </template>
          </q-table>

          <!-- Leyenda de verificación -->
          <div class="verify-legend q-mt-md q-pa-sm rounded-borders">
            <div class="text-caption text-weight-bold text-slate-700 q-mb-xs">
              <q-icon name="help_outline" size="14px" class="q-mr-xs" />
              ¿Cómo verificar manualmente?
            </div>
            <ul class="text-caption text-slate-600 q-ma-none q-pl-md" style="line-height: 1.8;">
              <li>Busca la vela H1 en tu plataforma usando la <b>Hora Cierre</b> (epoch si necesitas exactitud).</li>
              <li>Confirma que Open, High, Low, Close de la vela coincidan con los datos mostrados.</li>
              <li>Mira la vela siguiente (siguiente hora) y compara su cierre con la columna <b>C: (cierre)</b> de "Vela Siguiente".</li>
              <li>Para <b>PROFIT al cierre</b>: si direction = BUY → siguiente cierre > entrada. Si SELL → siguiente cierre &lt; entrada.</li>
              <li>El <b>Pico Favorable</b> es el mejor precio alcanzado (High para BUY, Low para SELL) en la vela siguiente.</li>
            </ul>
          </div>
        </div>

        <!-- ── TAB 1: DESEMPEÑO POR ÍNDICE ───────────────────────────────── -->
        <div v-if="statsSubTab === 'byIndex'">
          <div class="row items-center justify-between q-mb-sm flex-wrap">
            <div>
              <div class="text-subtitle1 text-weight-bolder text-slate-900">
                Ranking de Índices Sintéticos (Velas Sin Mecha H1)
              </div>
              <div class="text-caption text-slate-500">
                Muestra por cada índice cuántas velas cerraron sin mecha, cuántas dieron ganancia en la siguiente vela y el porcentaje de efectividad.
              </div>
            </div>
            <div class="text-caption text-slate-500 font-mono">
              Criterio activo: <b>{{ profitCriterion === 'close' ? 'Cierre de Vela' : 'Pico Máximo Intradía' }}</b>
            </div>
          </div>

          <q-table
            flat
            dense
            :rows="statsBySymbol"
            :columns="indexTableColumns"
            row-key="symbol"
            :pagination="{ rowsPerPage: 20, sortBy: 'winRatePct', descending: true }"
            class="stats-data-table"
          >
            <!-- Símbolo / Mercado -->
            <template #body-cell-mercado="props">
              <q-td :props="props">
                <div class="row items-center q-gutter-xs">
                  <q-badge
                    :color="props.row.marketType === 'BOOM' ? 'green-1' : 'red-1'"
                    :text-color="props.row.marketType === 'BOOM' ? 'green-9' : 'red-9'"
                    :label="props.row.marketType"
                    class="text-caption text-weight-bold"
                  />
                  <span class="text-weight-bolder text-slate-900">{{ props.row.mercado }}</span>
                  <span class="text-caption text-slate-500 font-mono">({{ props.row.symbol }})</span>
                </div>
              </q-td>
            </template>

            <!-- Dirección de Estrategia -->
            <template #body-cell-direction="props">
              <q-td :props="props">
                <q-badge
                  :color="props.row.marketType === 'BOOM' ? 'green-2' : 'red-2'"
                  :text-color="props.row.marketType === 'BOOM' ? 'green-10' : 'red-10'"
                  :label="props.row.marketType === 'BOOM' ? 'BUY (Alcista)' : 'SELL (Bajista)'"
                  class="text-weight-bold font-mono"
                />
              </q-td>
            </template>

            <!-- Total Sin Mecha -->
            <template #body-cell-totalSignals="props">
              <q-td :props="props" class="text-weight-bolder font-mono text-center">
                <q-badge color="amber-1" text-color="amber-10" :label="`${props.row.totalSignals} velas`" class="text-weight-bold" />
              </q-td>
            </template>

            <!-- Ganadas (Wins) -->
            <template #body-cell-winCount="props">
              <q-td :props="props" class="text-weight-bolder font-mono text-center text-emerald-7">
                {{ props.row.winCount }} ✓
              </q-td>
            </template>

            <!-- Perdidas (Losses) -->
            <template #body-cell-lossCount="props">
              <q-td :props="props" class="text-weight-bold font-mono text-center text-red-7">
                {{ props.row.lossCount }} ✗
              </q-td>
            </template>

            <!-- Win Rate % -->
            <template #body-cell-winRatePct="props">
              <q-td :props="props">
                <div class="row items-center q-gutter-xs no-wrap justify-center">
                  <div style="width: 70px;">
                    <q-linear-progress
                      :value="props.row.winRatePct / 100"
                      rounded
                      size="6px"
                      :color="props.row.winRatePct >= 60 ? 'emerald-6' : props.row.winRatePct >= 50 ? 'amber-6' : 'red-6'"
                      track-color="grey-2"
                    />
                  </div>
                  <q-badge
                    :color="props.row.winRatePct >= 60 ? 'emerald-1' : props.row.winRatePct >= 50 ? 'amber-1' : 'red-1'"
                    :text-color="props.row.winRatePct >= 60 ? 'emerald-9' : props.row.winRatePct >= 50 ? 'amber-9' : 'red-9'"
                    :label="`${props.row.winRatePct}%`"
                    class="text-weight-bolder font-mono text-caption"
                  />
                </div>
              </q-td>
            </template>

            <!-- Puntos Netos -->
            <template #body-cell-totalPnlPoints="props">
              <q-td :props="props" class="font-mono text-weight-bolder text-right">
                <span :class="props.row.totalPnlPoints >= 0 ? 'text-indigo-9' : 'text-red-7'">
                  {{ props.row.totalPnlPoints >= 0 ? '+' : '' }}{{ props.row.totalPnlPoints }} pts
                </span>
              </q-td>
            </template>

            <!-- Promedio Pts / Operación -->
            <template #body-cell-avgPnlPoints="props">
              <q-td :props="props" class="font-mono text-right text-slate-700">
                {{ props.row.avgPnlPoints >= 0 ? '+' : '' }}{{ props.row.avgPnlPoints }} pts
              </q-td>
            </template>

            <!-- Efectividad Pico Intradía -->
            <template #body-cell-winRatePeakPct="props">
              <q-td :props="props" class="font-mono text-center">
                <q-badge color="blue-1" text-color="blue-9" :label="`${props.row.winRatePeakPct}%`" class="text-weight-bold" />
              </q-td>
            </template>

            <!-- Acciones -->
            <template #body-cell-actions="props">
              <q-td :props="props" class="text-center">
                <q-btn
                  flat
                  dense
                  size="sm"
                  color="indigo-7"
                  icon="visibility"
                  label="Ver Señales"
                  class="text-caption text-weight-bold"
                  @click="viewSymbolEvents(props.row.symbol)"
                />
              </q-td>
            </template>
          </q-table>
        </div>

        <!-- ── TAB 2: EVOLUCIÓN POR SEMANA ───────────────────────────────── -->
        <div v-if="statsSubTab === 'byWeek'">
          <div class="row items-center justify-between q-mb-md flex-wrap">
            <div>
              <div class="text-subtitle1 text-weight-bolder text-slate-900">
                Rendimiento Semana a Semana (Desglose Temporal)
              </div>
              <div class="text-caption text-slate-500">
                Analiza la consistencia de la estrategia por semana calendario (lunes a domingo). Despliega cada semana para ver el detalle por índice.
              </div>
            </div>
            <div class="text-caption text-slate-500 font-mono">
              Total semanas registradas: <b>{{ statsByWeek.length }}</b>
            </div>
          </div>

          <div class="q-gutter-y-md">
            <q-expansion-item
              v-for="w in statsByWeek"
              :key="w.weekKey"
              group="week-accordion"
              class="week-expansion-card rounded-borders border-slate overflow-hidden bg-white"
              header-class="q-pa-md bg-slate-50 hover-bg-slate-100"
            >
              <template #header>
                <div class="row items-center justify-between full-width flex-wrap q-gutter-sm">
                  <div class="row items-center q-gutter-sm">
                    <q-avatar size="36px" color="indigo-1" text-color="indigo-7" icon="event" />
                    <div>
                      <div class="text-subtitle2 text-weight-bolder text-slate-900">
                        {{ w.weekLabel }}
                      </div>
                      <div class="text-caption text-slate-500 font-mono">
                        Clave ISO: {{ w.weekKey }} | Mes: {{ w.monthKey }}
                      </div>
                    </div>
                  </div>

                  <div class="row items-center q-gutter-md flex-wrap">
                    <!-- Total Velas -->
                    <div class="text-center">
                      <div class="text-caption text-slate-500">Total Sin Mecha</div>
                      <div class="text-body2 text-weight-bolder font-mono text-slate-900">
                        {{ w.totalSignals }}
                      </div>
                    </div>

                    <!-- Ganadas vs Perdidas -->
                    <div class="text-center">
                      <div class="text-caption text-slate-500">Ganadas / Perdidas</div>
                      <div class="text-body2 text-weight-bolder font-mono">
                        <span class="text-emerald-7">{{ w.winCount }}</span> /
                        <span class="text-red-7">{{ w.lossCount }}</span>
                      </div>
                    </div>

                    <!-- Win Rate % -->
                    <div class="text-center">
                      <div class="text-caption text-slate-500">% Efectividad</div>
                      <q-badge
                        :color="w.winRatePct >= 60 ? 'emerald-1' : w.winRatePct >= 50 ? 'amber-1' : 'red-1'"
                        :text-color="w.winRatePct >= 60 ? 'emerald-9' : w.winRatePct >= 50 ? 'amber-9' : 'red-9'"
                        :label="`${w.winRatePct}%`"
                        class="text-weight-bolder font-mono text-subtitle2"
                      />
                    </div>

                    <!-- Puntos Netos -->
                    <div class="text-right">
                      <div class="text-caption text-slate-500">Puntos Netos</div>
                      <div
                        class="text-body2 text-weight-bolder font-mono"
                        :class="w.totalPnlPoints >= 0 ? 'text-indigo-9' : 'text-red-7'"
                      >
                        {{ w.totalPnlPoints >= 0 ? '+' : '' }}{{ w.totalPnlPoints }} pts
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <q-card class="bg-white q-pa-md border-top-slate">
                <div class="text-caption text-weight-bold text-slate-700 q-mb-sm">
                  Desglose de Índices en {{ w.weekLabel }}:
                </div>
                <q-table
                  flat
                  dense
                  :rows="w.bySymbol"
                  :columns="weekSubTableColumns"
                  row-key="symbol"
                  :pagination="{ rowsPerPage: 15 }"
                  class="stats-sub-table"
                >
                  <template #body-cell-symbol="subProps">
                    <q-td :props="subProps">
                      <span class="text-weight-bolder text-slate-900">{{ subProps.row.mercado }}</span>
                      <span class="text-caption text-slate-500 q-ml-xs">({{ subProps.row.symbol }})</span>
                    </q-td>
                  </template>

                  <template #body-cell-winRatePct="subProps">
                    <q-td :props="subProps" class="text-center">
                      <q-badge
                        :color="subProps.row.winRatePct >= 60 ? 'emerald-1' : subProps.row.winRatePct >= 50 ? 'amber-1' : 'red-1'"
                        :text-color="subProps.row.winRatePct >= 60 ? 'emerald-9' : subProps.row.winRatePct >= 50 ? 'amber-9' : 'red-9'"
                        :label="`${subProps.row.winRatePct}%`"
                        class="text-weight-bolder font-mono text-caption"
                      />
                    </q-td>
                  </template>

                  <template #body-cell-totalPnlPoints="subProps">
                    <q-td :props="subProps" class="text-right font-mono text-weight-bold">
                      <span :class="subProps.row.totalPnlPoints >= 0 ? 'text-indigo-9' : 'text-red-7'">
                        {{ subProps.row.totalPnlPoints >= 0 ? '+' : '' }}{{ subProps.row.totalPnlPoints }} pts
                      </span>
                    </q-td>
                  </template>
                </q-table>
              </q-card>
            </q-expansion-item>

            <div v-if="statsByWeek.length === 0" class="text-center q-pa-xl text-slate-400">
              <q-icon name="calendar_today" size="36px" class="q-mb-sm text-slate-300" />
              <div>No hay semanas registradas para los filtros seleccionados.</div>
            </div>
          </div>
        </div>

        <!-- ── TAB 3: MATRIZ CRUZADA ÍNDICE × SEMANA (HEATMAP) ──────────── -->
        <div v-if="statsSubTab === 'matrix'">
          <div class="row items-center justify-between q-mb-md flex-wrap">
            <div>
              <div class="text-subtitle1 text-weight-bolder text-slate-900">
                Matriz Comparativa Índice × Semana (Heatmap de Efectividad)
              </div>
              <div class="text-caption text-slate-500">
                Visualiza el % de aciertos de cada activo semana a semana. Cada celda muestra: Ganadas / Total (% Win Rate).
              </div>
            </div>
            <div class="row items-center q-gutter-xs text-caption">
              <span class="text-weight-bold text-slate-600 q-mr-xs">Escala:</span>
              <q-badge color="emerald-1" text-color="emerald-9" label="≥ 60% Alta" class="text-weight-bold" />
              <q-badge color="amber-1" text-color="amber-9" label="50% - 59% Media" class="text-weight-bold" />
              <q-badge color="red-1" text-color="red-9" label="< 50% Baja" class="text-weight-bold" />
            </div>
          </div>

          <div class="matrix-table-container overflow-auto border-slate rounded-borders">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th class="matrix-th sticky-col">Índice Sintético</th>
                  <th v-for="col in matrixColumns" :key="col.key" class="matrix-th text-center">
                    {{ col.label }}
                  </th>
                  <th class="matrix-th text-center bg-indigo-50 text-indigo-9">Total General</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in matrixRows" :key="row.symbol">
                  <td class="matrix-td sticky-col text-weight-bold">
                    <div class="row items-center q-gutter-xs no-wrap">
                      <q-badge
                        :color="row.marketType === 'BOOM' ? 'green-1' : 'red-1'"
                        :text-color="row.marketType === 'BOOM' ? 'green-9' : 'red-9'"
                        :label="row.marketType"
                        class="text-caption text-weight-bold"
                      />
                      <span>{{ row.mercado }}</span>
                    </div>
                  </td>
                  <td
                    v-for="col in matrixColumns"
                    :key="col.key"
                    class="matrix-td text-center"
                    :class="getCellClass(row.weeks[col.key])"
                  >
                    <div v-if="row.weeks[col.key]" class="font-mono">
                      <div class="text-weight-bolder" style="font-size: 13px;">
                        {{ row.weeks[col.key].winRatePct }}%
                      </div>
                      <div class="text-caption text-slate-500" style="font-size: 10px;">
                        {{ row.weeks[col.key].winCount }}/{{ row.weeks[col.key].total }}
                      </div>
                    </div>
                    <span v-else class="text-slate-300">—</span>
                  </td>
                  <td class="matrix-td text-center bg-indigo-50 font-mono text-weight-bolder">
                    <div :class="row.overallWinRate >= 60 ? 'text-emerald-7' : row.overallWinRate >= 50 ? 'text-amber-8' : 'text-red-7'">
                      {{ row.overallWinRate }}%
                    </div>
                    <div class="text-caption text-slate-500" style="font-size: 10px;">
                      {{ row.overallWins }}/{{ row.overallTotal }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ── TAB 4: REGISTRO HISTÓRICO DE SEÑALES ──────────────────────── -->
        <div v-if="statsSubTab === 'events'">
          <div class="row items-center justify-between q-mb-md flex-wrap q-gutter-sm">
            <div>
              <div class="text-subtitle1 text-weight-bolder text-slate-900">
                Auditoría y Bitácora Histórica de Señales H1
              </div>
              <div class="text-caption text-slate-500">
                Listado completo y trazable de cada vela sin mecha detectada y el resultado de la siguiente hora.
              </div>
            </div>
            <div class="row items-center q-gutter-sm">
              <q-input
                v-model="eventSearch"
                dense
                outlined
                placeholder="Buscar índice, fecha..."
                class="bg-white"
                clearable
              >
                <template #prepend>
                  <q-icon name="search" size="18px" color="slate-400" />
                </template>
              </q-input>
            </div>
          </div>

          <q-table
            flat
            dense
            :rows="filteredEventList"
            :columns="eventTableColumns"
            row-key="id"
            :pagination="{ rowsPerPage: 25 }"
            class="stats-events-table"
          >
            <!-- Hora Señal -->
            <template #body-cell-signalTime="props">
              <q-td :props="props">
                <div class="text-weight-bold font-mono text-slate-900">
                  {{ props.row.signalTimeStr }}
                </div>
                <div class="text-caption text-slate-500 font-mono">
                  {{ props.row.weekLabel }}
                </div>
              </q-td>
            </template>

            <!-- Índice -->
            <template #body-cell-mercado="props">
              <q-td :props="props">
                <div class="row items-center q-gutter-xs">
                  <span class="text-weight-bolder text-indigo-9">{{ props.row.mercado }}</span>
                  <q-badge
                    :color="props.row.marketType === 'BOOM' ? 'green-1' : 'red-1'"
                    :text-color="props.row.marketType === 'BOOM' ? 'green-9' : 'red-9'"
                    :label="props.row.marketType"
                    class="text-caption"
                  />
                </div>
              </q-td>
            </template>

            <!-- Dirección -->
            <template #body-cell-direction="props">
              <q-td :props="props" class="text-center">
                <q-badge
                  :color="props.row.direction === 'BUY' ? 'green-1' : 'red-1'"
                  :text-color="props.row.direction === 'BUY' ? 'green-9' : 'red-9'"
                  :label="props.row.direction === 'BUY' ? 'BUY 🟢' : 'SELL 🔴'"
                  class="text-weight-bolder font-mono"
                />
              </q-td>
            </template>

            <!-- Precios Entrada / Salida -->
            <template #body-cell-entryPrice="props">
              <q-td :props="props" class="font-mono text-right">
                {{ props.row.entryPrice }}
              </q-td>
            </template>

            <template #body-cell-exitPrice="props">
              <q-td :props="props" class="font-mono text-right">
                {{ props.row.exitPrice }}
              </q-td>
            </template>

            <!-- Resultado Cierre -->
            <template #body-cell-resultClose="props">
              <q-td :props="props" class="text-center">
                <q-badge
                  :color="props.row.isProfitClose ? 'emerald-1' : 'red-1'"
                  :text-color="props.row.isProfitClose ? 'emerald-9' : 'red-9'"
                  :label="props.row.isProfitClose ? 'WIN 🎯' : 'LOSS ❌'"
                  class="text-weight-bolder font-mono"
                />
                <div
                  class="font-mono text-caption text-weight-bold q-mt-xs"
                  :class="props.row.pnlClosePoints >= 0 ? 'text-emerald-7' : 'text-red-7'"
                >
                  {{ props.row.pnlClosePoints >= 0 ? '+' : '' }}{{ props.row.pnlClosePoints }} pts
                </div>
              </q-td>
            </template>

            <!-- Pico Máximo -->
            <template #body-cell-maxProfitPoints="props">
              <q-td :props="props" class="text-right font-mono text-emerald-7 text-weight-bold">
                +{{ props.row.maxProfitPoints }} pts
              </q-td>
            </template>

            <!-- Resultado Pico -->
            <template #body-cell-resultPeak="props">
              <q-td :props="props" class="text-center">
                <q-badge
                  :color="props.row.isProfitPeak ? 'blue-1' : 'red-1'"
                  :text-color="props.row.isProfitPeak ? 'blue-9' : 'red-9'"
                  :label="props.row.isProfitPeak ? 'PICO OK 🚀' : 'SIN PICO'"
                  class="text-weight-bold font-mono"
                />
              </q-td>
            </template>

            <template #no-data>
              <div class="full-width row flex-center q-pa-lg text-slate-400">
                <q-icon name="info" size="24px" class="q-mr-sm text-slate-300" />
                <span>No se encontraron eventos para el filtro seleccionado.</span>
              </div>
            </template>
          </q-table>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { h1StrategyService } from 'src/services/h1Strategy.service';
import { useAlertsStore } from 'stores/alerts.store';
import { useTradingStore } from 'stores/trading.store';

const alertsStore         = useAlertsStore();
const tradingStore        = useTradingStore();

// ── Navegación Principal ─────────────────────────────────────────────────────
const activeMainTab       = ref('live');
const loading             = ref(false);
const summaryData         = ref({ indices: [], activeAlerts: [], nextHourChangeAt: '', secondsToNextHour: 0 });
const selectedSymbol      = ref('ALL');
const countdownText       = ref('00:00');
const nextHourTime        = ref('');
let timerInterval         = null;

// ── Estado de Estadísticas ──────────────────────────────────────────────────
const statsSubTab         = ref('byIndex');
const statsLoading        = ref(false);
const realSummaryLoading  = ref(false);
const selectedMonth       = ref('ALL');
const selectedWeek        = ref('ALL');
const statsSelectedSymbol = ref('ALL');
const selectedRealMonths   = ref(3);
const profitCriterion     = ref('close'); // 'close' | 'peak'
const selectedTolerance   = ref(0.2);
const eventSearch         = ref('');
const lastDayFilter       = ref('all'); // 'all' | 'wins' | 'losses'
const realSummaryData     = ref({ generatedAt: '', filterApplied: {}, bySymbol: [] });

const statsData = ref({
  summary: {
    totalSignals: 0,
    winCloseCount: 0,
    winPeakCount: 0,
    lossCloseCount: 0,
    winRateClosePct: 0,
    winRatePeakPct: 0,
    totalPnlPoints: 0,
    avgPnlPoints: 0,
    bestSymbol: null,
    mostActiveSymbol: null,
  },
  bySymbol: [],
  byWeek: [],
  availableMonths: [],
  availableWeeks: [],
  events: [],
});

// ── Modelos de Audio Sincronizados ──────────────────────────────────────────
const soundModel = computed({
  get: () => alertsStore.soundEnabled,
  set: (v) => alertsStore.setSoundEnabled(v),
});

const voiceModel = computed({
  get: () => alertsStore.voiceEnabled,
  set: (v) => alertsStore.setVoiceEnabled(v),
});

function testAudio() {
  alertsStore.testAudioAlert();
}

function onMainTabChange(tab) {
  if (tab === 'stats') {
    if (!statsData.value.bySymbol || statsData.value.bySymbol.length === 0) {
      loadStatistics();
    }
  }
}

function refreshCurrentView() {
  if (activeMainTab.value === 'live') {
    loadData();
  } else {
    loadStatistics();
  }
}

// ── Métodos de Filtros de Estadísticas ───────────────────────────────────────
function onMonthChange() {
  // Si el mes cambió y la semana seleccionada no pertenece a ese mes, resetear semana
  if (selectedMonth.value !== 'ALL' && selectedWeek.value !== 'ALL') {
    const weekObj = statsData.value.availableWeeks.find((w) => w.key === selectedWeek.value);
    if (weekObj && weekObj.monthKey !== selectedMonth.value) {
      selectedWeek.value = 'ALL';
    }
  }
  loadStatistics();
  loadRealSummary();
}

function onWeekChange() {
  loadStatistics();
  loadRealSummary();
}

function onSymbolChange() {
  loadStatistics();
  loadRealSummary();
}

function onToleranceChange() {
  loadStatistics();
  loadRealSummary();
}

function onRealMonthsChange() {
  loadRealSummary();
}

function resetStatsFilters() {
  selectedMonth.value = 'ALL';
  selectedWeek.value = 'ALL';
  statsSelectedSymbol.value = 'ALL';
  selectedTolerance.value = 0.2;
  selectedRealMonths.value = 3;
  profitCriterion.value = 'close';
  eventSearch.value = '';
  loadStatistics();
  loadRealSummary();
}

function viewSymbolEvents(sym) {
  statsSelectedSymbol.value = sym;
  statsSubTab.value = 'events';
  loadStatistics();
}

// ── Opciones de Selectores ───────────────────────────────────────────────────
const availableMonthOptions = computed(() => {
  const list = [{ label: '⭐ Todos los Meses', value: 'ALL' }];
  (statsData.value.availableMonths || []).forEach((m) => {
    list.push({ label: m.label, value: m.key });
  });
  return list;
});

const availableWeekOptions = computed(() => {
  const list = [{ label: '⭐ Todas las Semanas', value: 'ALL' }];
  let weeks = statsData.value.availableWeeks || [];
  if (selectedMonth.value && selectedMonth.value !== 'ALL') {
    weeks = weeks.filter((w) => w.monthKey === selectedMonth.value);
  }
  weeks.forEach((w) => {
    list.push({ label: w.label, value: w.key });
  });
  return list;
});

const availableSymbolOptions = computed(() => {
  const list = [{ label: '⭐ Todos los Índices', value: 'ALL' }];
  const known = [
    { symbol: 'CRASH300N', label: 'Crash 300 Index' },
    { symbol: 'CRASH1000', label: 'Crash 1000 Index' },
    { symbol: 'CRASH900',  label: 'Crash 900 Index' },
    { symbol: 'CRASH600',  label: 'Crash 600 Index' },
    { symbol: 'CRASH500',  label: 'Crash 500 Index' },
    { symbol: 'BOOM300N',   label: 'Boom 300 Index' },
    { symbol: 'BOOM1000',  label: 'Boom 1000 Index' },
    { symbol: 'BOOM900',   label: 'Boom 900 Index' },
    { symbol: 'BOOM600',   label: 'Boom 600 Index' },
    { symbol: 'BOOM500',   label: 'Boom 500 Index' },
  ];
  known.forEach((k) => list.push({ label: `${k.label} (${k.symbol})`, value: k.symbol }));
  return list;
});

// ── Resumen de Estadísticas Dinámico según Criterio (Cierre vs Pico) ────────
const statsSummary = computed(() => {
  const s = statsData.value.summary || {
    totalSignals: 0,
    winCloseCount: 0,
    winPeakCount: 0,
    lossCloseCount: 0,
    winRateClosePct: 0,
    winRatePeakPct: 0,
    totalPnlPoints: 0,
    avgPnlPoints: 0,
    bestSymbol: null,
  };

  const isClose = profitCriterion.value === 'close';
  const winCount = isClose ? (s.winCloseCount || 0) : (s.winPeakCount || 0);
  const totalSignals = s.totalSignals || 0;
  const lossCount = totalSignals - winCount;
  const winRatePct = isClose ? (s.winRateClosePct || 0) : (s.winRatePeakPct || 0);

  // Mejor símbolo calculado según criterio activo
  let best = null;
  if (statsBySymbol.value && statsBySymbol.value.length > 0) {
    const sorted = [...statsBySymbol.value].sort((a, b) => b.winRatePct - a.winRatePct || b.totalSignals - a.totalSignals);
    const top = sorted[0];
    if (top && top.totalSignals > 0) {
      best = {
        symbol: top.symbol,
        mercado: top.mercado,
        winRatePct: top.winRatePct,
        winCount: top.winCount,
        totalSignals: top.totalSignals,
      };
    }
  }

  return {
    totalSignals,
    winCount,
    lossCount,
    winRatePct,
    totalPnlPoints: s.totalPnlPoints || 0,
    avgPnlPoints: s.avgPnlPoints || 0,
    bestSymbol: best,
  };
});

// ── Lista por Símbolo con Valores Adaptados al Criterio ──────────────────────
const statsBySymbol = computed(() => {
  const isClose = profitCriterion.value === 'close';
  return (statsData.value.bySymbol || []).map((s) => {
    const winCount = isClose ? s.winCloseCount : s.winPeakCount;
    const lossCount = s.totalSignals - winCount;
    const winRatePct = isClose ? s.winRateClosePct : s.winRatePeakPct;
    return {
      ...s,
      winCount,
      lossCount,
      winRatePct,
    };
  });
});

// ── Lista por Semana con Valores Adaptados al Criterio ───────────────────────
const statsByWeek = computed(() => {
  const isClose = profitCriterion.value === 'close';
  return (statsData.value.byWeek || []).map((w) => {
    const winCount = isClose ? w.winCloseCount : w.winPeakCount;
    const lossCount = w.totalSignals - winCount;
    const winRatePct = isClose ? w.winRateClosePct : w.winRatePeakPct;

    const bySymbolList = (w.bySymbol || []).map((sym) => {
      const sWin = isClose ? sym.winCloseCount : (sym.winPeakCount ?? sym.winCloseCount);
      const sWinRate = sym.totalSignals > 0 ? parseFloat(((sWin / sym.totalSignals) * 100).toFixed(1)) : 0;
      return {
        ...sym,
        winCount: sWin,
        lossCount: sym.totalSignals - sWin,
        winRatePct: sWinRate,
      };
    }).sort((a, b) => b.winRatePct - a.winRatePct);

    return {
      ...w,
      winCount,
      lossCount,
      winRatePct,
      bySymbol: bySymbolList,
    };
  });
});

// ── Matriz Cruzada (Heatmap) ────────────────────────────────────────────────
const matrixColumns = computed(() => {
  return (statsData.value.byWeek || []).map((w) => ({
    key: w.weekKey,
    label: w.weekKey.replace('2026-', ''),
    fullLabel: w.weekLabel,
  }));
});

const matrixRows = computed(() => {
  const isClose = profitCriterion.value === 'close';
  return (statsData.value.bySymbol || []).map((sym) => {
    const weekMap = {};
    let overallWins = 0;
    let overallTotal = 0;

    (statsData.value.byWeek || []).forEach((w) => {
      const match = (w.bySymbol || []).find((s) => s.symbol === sym.symbol);
      if (match && match.totalSignals > 0) {
        const wins = isClose ? match.winCloseCount : (match.winPeakCount ?? match.winCloseCount);
        const winRate = parseFloat(((wins / match.totalSignals) * 100).toFixed(1));
        weekMap[w.weekKey] = {
          winCount: wins,
          total: match.totalSignals,
          winRatePct: winRate,
        };
        overallWins += wins;
        overallTotal += match.totalSignals;
      }
    });

    const overallWinRate = overallTotal > 0 ? parseFloat(((overallWins / overallTotal) * 100).toFixed(1)) : 0;

    return {
      symbol: sym.symbol,
      mercado: sym.mercado,
      marketType: sym.marketType,
      weeks: weekMap,
      overallWins,
      overallTotal,
      overallWinRate,
    };
  });
});

function getCellClass(cell) {
  if (!cell || cell.total === 0) return '';
  if (cell.winRatePct >= 60) return 'cell--high-win';
  if (cell.winRatePct >= 50) return 'cell--mid-win';
  return 'cell--low-win';
}

// ── Registro de Señales Filtrado por Búsqueda ───────────────────────────────
const filteredEventList = computed(() => {
  const list = statsData.value.events || [];
  if (!eventSearch.value) return list;
  const q = eventSearch.value.toLowerCase().trim();
  return list.filter((e) =>
    (e.mercado && e.mercado.toLowerCase().includes(q)) ||
    (e.symbol && e.symbol.toLowerCase().includes(q)) ||
    (e.signalTimeStr && e.signalTimeStr.toLowerCase().includes(q)) ||
    (e.direction && e.direction.toLowerCase().includes(q)) ||
    (e.weekLabel && e.weekLabel.toLowerCase().includes(q))
  );
});

// ── ÚLTIMO DÍA (24h): filtrado de eventos recientes para verificación manual ─
const lastDayEvents = computed(() => {
  const now = Date.now();
  const oneDayAgo = now / 1000 - 86400; // epoch en segundos, hace 24h
  const list = statsData.value.events || [];
  return list
    .filter((e) => e.signalEpoch && Number(e.signalEpoch) >= oneDayAgo)
    .sort((a, b) => Number(b.signalEpoch) - Number(a.signalEpoch));
});

const lastDayBySymbol = computed(() => {
  const map = new Map();
  for (const ev of lastDayEvents.value) {
    const cur = map.get(ev.symbol) || {
      symbol: ev.symbol,
      mercado: ev.mercado,
      marketType: ev.marketType,
      total: 0,
      winsClose: 0,
      lossesClose: 0,
      winsPeak: 0,
    };
    cur.total++;
    // SIEMPRE calculamos ambos criterios de forma independiente
    if (ev.isProfitClose) cur.winsClose++; else cur.lossesClose++;
    if (ev.isProfitPeak) cur.winsPeak++;
    map.set(ev.symbol, cur);
  }
  return Array.from(map.values())
    .map((s) => ({
      ...s,
      winRateClose: s.total > 0 ? parseFloat(((s.winsClose / s.total) * 100).toFixed(1)) : 0,
      winRatePeak:  s.total > 0 ? parseFloat(((s.winsPeak  / s.total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.total - a.total);
});

// Métricas del tab Último Día: SIEMPRE usan criterio CIERRE (verificable en plataforma)
const lastDayWinsClose = computed(() =>
  lastDayEvents.value.filter((e) => e.isProfitClose).length
);

const lastDayLossesClose = computed(() =>
  lastDayEvents.value.length - lastDayWinsClose.value
);

const lastDayWinRateClose = computed(() => {
  const total = lastDayEvents.value.length;
  if (total === 0) return 0;
  return parseFloat(((lastDayWinsClose.value / total) * 100).toFixed(1));
});

const lastDayWinsPeak = computed(() =>
  lastDayEvents.value.filter((e) => e.isProfitPeak).length
);

const lastDayWinRatePeak = computed(() => {
  const total = lastDayEvents.value.length;
  if (total === 0) return 0;
  return parseFloat(((lastDayWinsPeak.value / total) * 100).toFixed(1));
});

// Alias para compatibilidad con otros usos (usamos siempre close aquí)
const lastDayWins = lastDayWinsClose;
const lastDayLosses = lastDayLossesClose;
const lastDayWinRate = lastDayWinRateClose;

const lastDayGeneratedAt = computed(() => {
  return new Date().toLocaleString('es', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
});

// Filtro en la tabla: SIEMPRE usa isProfitClose para verificación manual real
const filteredLastDayEvents = computed(() => {
  if (lastDayFilter.value === 'wins') {
    return lastDayEvents.value.filter((e) => e.isProfitClose);
  }
  if (lastDayFilter.value === 'losses') {
    return lastDayEvents.value.filter((e) => !e.isProfitClose);
  }
  return lastDayEvents.value;
});


const lastDayTableColumns = [
  { name: 'signalTime',   label: 'Hora Vela Sin Mecha', field: 'signalEpoch', align: 'left',   sortable: true },
  { name: 'mercado',      label: 'Índice',              field: 'mercado',     align: 'left',   sortable: true },
  { name: 'direction',    label: 'Dirección',           field: 'direction',   align: 'center', sortable: true },
  { name: 'signalCandle', label: 'Vela Sin Mecha OHLC', field: 'signalCandle',align: 'left' },
  { name: 'entryPrice',   label: 'Entrada (Cierre)',    field: 'entryPrice',  align: 'right',  sortable: true },
  { name: 'nextCandle',   label: 'Vela Siguiente OHLC', field: 'nextCandle',  align: 'left' },
  { name: 'resultClose',  label: 'Resultado al Cierre', field: 'isProfitClose',align: 'center',sortable: true },
  { name: 'maxProfit',    label: 'Pico Favorable',      field: 'maxProfitPoints', align: 'center', sortable: true },
  { name: 'maxDrawdown',  label: 'Drawdown Máx',        field: 'maxDrawdownPoints', align: 'center', sortable: true },
];

// ── Columnas de Tablas ──────────────────────────────────────────────────────

const indexTableColumns = [
  { name: 'mercado', label: 'Índice Sintético', field: 'mercado', align: 'left', sortable: true },
  { name: 'direction', label: 'Estrategia', field: 'marketType', align: 'center', sortable: true },
  { name: 'totalSignals', label: 'Velas Sin Mecha', field: 'totalSignals', align: 'center', sortable: true },
  { name: 'winCount', label: 'Ganadas (Profit)', field: 'winCount', align: 'center', sortable: true },
  { name: 'lossCount', label: 'En Contra', field: 'lossCount', align: 'center', sortable: true },
  { name: 'winRatePct', label: '% Efectividad', field: 'winRatePct', align: 'center', sortable: true },
  { name: 'totalPnlPoints', label: 'Puntos Netos', field: 'totalPnlPoints', align: 'right', sortable: true },
  { name: 'avgPnlPoints', label: 'Promedio pts/op', field: 'avgPnlPoints', align: 'right', sortable: true },
  { name: 'winRatePeakPct', label: 'Pico Máx %', field: 'winRatePeakPct', align: 'center', sortable: true },
  { name: 'actions', label: 'Detalle', align: 'center' },
];

const weekSubTableColumns = [
  { name: 'symbol', label: 'Índice', field: 'mercado', align: 'left' },
  { name: 'totalSignals', label: 'Velas Sin Mecha', field: 'totalSignals', align: 'center' },
  { name: 'winCount', label: 'Ganadas', field: 'winCount', align: 'center' },
  { name: 'winRatePct', label: '% Win Rate', field: 'winRatePct', align: 'center' },
  { name: 'totalPnlPoints', label: 'Puntos Netos', field: 'totalPnlPoints', align: 'right' },
];

const eventTableColumns = [
  { name: 'signalTime', label: 'Hora Vela Sin Mecha', field: 'signalEpoch', align: 'left', sortable: true },
  { name: 'mercado', label: 'Índice', field: 'mercado', align: 'left', sortable: true },
  { name: 'direction', label: 'Dirección', field: 'direction', align: 'center', sortable: true },
  { name: 'entryPrice', label: 'Precio Entrada (Cierre H1)', field: 'entryPrice', align: 'right', sortable: true },
  { name: 'exitPrice', label: 'Precio Cierre (Sig. Vela)', field: 'exitPrice', align: 'right', sortable: true },
  { name: 'resultClose', label: 'Resultado al Cierre', field: 'isProfitClose', align: 'center', sortable: true },
  { name: 'maxProfitPoints', label: 'Pico Favorable', field: 'maxProfitPoints', align: 'right', sortable: true },
  { name: 'resultPeak', label: 'Resultado Pico', field: 'isProfitPeak', align: 'center', sortable: true },
];

const realSummaryColumns = [
  { name: 'symbol', label: 'Índice', field: 'symbol', align: 'left', sortable: true },
  { name: 'signalCount', label: 'Señales', field: 'signalCount', align: 'center', sortable: true },
  { name: 'firstCandleWinRatePct', label: '1era vela %', field: 'firstCandleWinRatePct', align: 'center', sortable: true },
  { name: 'secondCandleWinRatePct', label: '2da vela %', field: 'secondCandleWinRatePct', align: 'center', sortable: true },
  { name: 'continuationRatePct', label: 'Continuación %', field: 'continuationRatePct', align: 'center', sortable: true },
  { name: 'totalPnlPoints', label: 'PnL total', field: 'totalPnlPoints', align: 'right', sortable: true },
];

const realSummaryRows = computed(() => {
  return (realSummaryData.value.bySymbol || []).map((row) => ({
    ...row,
    signalCount: Number(row.signalCount || 0),
    firstCandleWinRatePct: Number(row.firstCandleWinRatePct || 0),
    secondCandleWinRatePct: Number(row.secondCandleWinRatePct || 0),
    continuationRatePct: Number(row.continuationRatePct || 0),
    totalPnlPoints: Number(row.totalPnlPoints || 0),
  }));
});

// ── Carga de Estadísticas desde Backend ──────────────────────────────────────
async function loadStatistics() {
  statsLoading.value = true;
  try {
    const params = {
      month: selectedMonth.value,
      week: selectedWeek.value,
      symbol: statsSelectedSymbol.value,
      tolerancePct: selectedTolerance.value,
    };
    const res = await h1StrategyService.getStatisticsPublic(params);
    if (res) {
      statsData.value = res;
    }
    await loadRealSummary();
  } catch (err) {
    console.error('Error cargando estadísticas H1:', err);
  } finally {
    statsLoading.value = false;
  }
}

async function loadRealSummary() {
  realSummaryLoading.value = true;
  try {
    const params = {
      month: selectedMonth.value,
      week: selectedWeek.value,
      symbol: statsSelectedSymbol.value,
      tolerance: selectedTolerance.value,
      months: selectedRealMonths.value,
    };
    const res = await h1StrategyService.getRealSummary(params);
    if (res) {
      realSummaryData.value = res;
    }
  } catch (err) {
    console.error('Error cargando resumen real H1:', err);
  } finally {
    realSummaryLoading.value = false;
  }
}

// ── Lógica Existente para Vista en Vivo 24h ─────────────────────────────────
const currentIndex = computed(() => {
  if (!summaryData.value?.indices || selectedSymbol.value === 'ALL') return null;
  return summaryData.value.indices.find((i) => i.symbol === selectedSymbol.value) || null;
});

const totalNoWickCount24h = computed(() => {
  if (!summaryData.value?.indices) return 0;
  return summaryData.value.indices.reduce((sum, i) => sum + (i.noWickCount24h || 0), 0);
});

const topIndexName = computed(() => {
  if (!summaryData.value?.indices || !summaryData.value.indices.length) return '—';
  const sorted = [...summaryData.value.indices].sort((a, b) => (b.noWickCount24h || 0) - (a.noWickCount24h || 0));
  const top = sorted[0];
  return top && top.noWickCount24h > 0 ? `${top.mercado} (${top.noWickCount24h}v)` : '—';
});

const filteredCandles = computed(() => {
  if (selectedSymbol.value === 'ALL') {
    const list = [];
    (summaryData.value?.indices || []).forEach((idx) => {
      (idx.candles24h || []).forEach((c) => {
        if (c.isNoWickBoth && !c.isInProgress) {
          list.push({
            ...c,
            rowKey: `${idx.symbol}-${c.epoch}`,
            symbol: idx.symbol,
            mercado: idx.mercado,
          });
        }
      });
    });
    return list.sort((a, b) => b.epoch - a.epoch);
  }

  if (!currentIndex.value) return [];
  return (currentIndex.value.candles24h || [])
    .filter((c) => c.isNoWickBoth && !c.isInProgress)
    .map((c) => ({
      ...c,
      rowKey: `${currentIndex.value.symbol}-${c.epoch}`,
      symbol: currentIndex.value.symbol,
      mercado: currentIndex.value.mercado,
    }))
    .reverse();
});

const tableColumns = computed(() => {
  const cols = [];
  if (selectedSymbol.value === 'ALL') {
    cols.push({ name: 'mercado', label: 'Índice', field: 'mercado', align: 'left', sortable: true });
  }
  cols.push(
    { name: 'timeStr', label: 'Hora Cierre', field: 'timeStr', align: 'left', sortable: true },
    { name: 'type', label: 'Tipo', field: 'isBullish', align: 'center' },
    { name: 'open', label: 'Apertura', field: 'open', align: 'right', format: (val) => val?.toFixed(3) },
    { name: 'high', label: 'Máximo', field: 'high', align: 'right', format: (val) => val?.toFixed(3) },
    { name: 'low', label: 'Mínimo', field: 'low', align: 'right', format: (val) => val?.toFixed(3) },
    { name: 'close', label: 'Cierre', field: 'close', align: 'right', format: (val) => val?.toFixed(3) },
    { name: 'upperWick', label: 'Mecha Sup.', field: 'upperWick', align: 'right' },
    { name: 'lowerWick', label: 'Mecha Inf.', field: 'lowerWick', align: 'right' },
    { name: 'body', label: 'Cuerpo (pts)', field: 'body', align: 'right' },
    { name: 'status', label: 'Estrategia Sin Mecha', field: 'isNoWickBoth', align: 'center' }
  );
  return cols;
});

function selectSymbol(sym) {
  if (sym) selectedSymbol.value = sym;
}

function formatHour(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const closeDate = new Date(date.getTime() + 60 * 60 * 1000);
  return closeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateCountdown() {
  const now = new Date();
  const targetDate = new Date(now);
  targetDate.setHours(now.getHours() + 1, 0, 0, 0);

  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 1000) {
    countdownText.value = '00:00';
    if (activeMainTab.value === 'live') loadData();
    return;
  }

  const totalSec = Math.floor(diffMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  countdownText.value = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  nextHourTime.value = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatPronounceableMarket(symbol) {
  const s = (symbol || '').toUpperCase();
  if (s.includes('CRASH1000')) return 'Crash mil';
  if (s.includes('CRASH900'))  return 'Crash novecientos';
  if (s.includes('CRASH600'))  return 'Crash seiscientos';
  if (s.includes('CRASH500'))  return 'Crash quinientos';
  if (s.includes('CRASH300'))  return 'Crash trescientos';
  if (s.includes('CRASH200'))  return 'Crash doscientos';
  if (s.includes('BOOM1000'))  return 'Boom mil';
  if (s.includes('BOOM900'))   return 'Boom novecientos';
  if (s.includes('BOOM600'))   return 'Boom seiscientos';
  if (s.includes('BOOM500'))   return 'Boom quinientos';
  if (s.includes('BOOM300'))   return 'Boom trescientos';
  if (s.includes('BOOM200'))   return 'Boom doscientos';
  return s;
}

async function loadData() {
  loading.value = true;
  try {
    const res = await h1StrategyService.getAnalysisPublic(2);
    if (res) {
      summaryData.value = res;
      if (res.activeAlerts && res.activeAlerts.length > 0) {
        for (const alert of res.activeAlerts) {
          const pronounce = formatPronounceableMarket(alert.symbol);
          const dir = (alert.direction || '').toUpperCase() === 'ALCISTA' ? 'alcista' : 'bajista';
          const h4Warning = alert.h4AgainstTrade
            ? ` La tendencia Hache cuatro ${String(alert.h4Trend || '').toLowerCase()} esta en contra. Evalua bien antes de operar.`
            : '';
          const reactionInfo = alert.historicalReaction?.found
            ? ` El indice ya reacciono ${alert.historicalReaction.count === 1 ? 'una vez' : `${alert.historicalReaction.count} veces`} cerca de este nivel. La ultima reaccion fue ${String(alert.historicalReaction.lastDirection || '').toLowerCase()} y recorrio ${alert.historicalReaction.lastMovePoints} puntos.`
            : '';
          alertsStore.triggerNotification({
            type: 'H1_NO_WICK',
            symbol: alert.symbol,
            title: `🕯️ ¡Alerta H1 Sin Mecha en ${alert.mercado}! (${alert.direction})`,
            message: alert.message || `Vela ${alert.direction} cerrada sin mechas (Cuerpo: ${alert.body} pts).`,
            speechText: `¡Atención! Alerta de estrategia Hache uno en ${pronounce}. Vela ${dir} cerrada sin mechas.${h4Warning}${reactionInfo}`,
            targetPath: '/h1-strategy',
            routeQuery: { symbol: alert.symbol },
            severity: 'warning',
            dedupeKey: `${alert.symbol}_H1_${alert.closedAt || ''}`,
          });
        }
      }
    }
  } catch (err) {
    console.error('Error cargando estrategia H1 en vivo:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadData();
  loadStatistics();
  loadRealSummary();
  updateCountdown();
  timerInterval = setInterval(updateCountdown, 1000);
});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
});
</script>

<style scoped>
.h1-strategy-page {
  background-color: #f8fafc;
  min-height: 100vh;
}

.text-slate-900 { color: #0f172a; }
.text-slate-800 { color: #1e293b; }
.text-slate-700 { color: #334155; }
.text-slate-600 { color: #475569; }
.text-slate-500 { color: #64748b; }
.text-slate-400 { color: #94a3b8; }
.bg-slate-50    { background-color: #f8fafc; }
.border-slate   { border: 1px solid #e2e8f0; }
.border-top-slate { border-top: 1px solid #e2e8f0; }

.countdown-clock-pill {
  background:    #ede9fe;
  border:        1px solid #c4b5fd;
  border-radius: 10px;
}

.main-navigation-tabs {
  border-radius: 10px;
  overflow: hidden;
}

.active-alerts-banner {
  background:    linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
  border-radius: 14px;
  box-shadow:    0 8px 24px -4px rgba(220, 38, 38, 0.4);
  animation:     alert-glow 2.5s infinite alternate;
}

@keyframes alert-glow {
  0%   { box-shadow: 0 0 10px rgba(220, 38, 38, 0.4); }
  100% { box-shadow: 0 0 25px rgba(220, 38, 38, 0.8); }
}

.alert-pulse-circle {
  width:           48px;
  height:          48px;
  border-radius:   50%;
  background:      rgba(255, 255, 255, 0.2);
  display:         flex;
  align-items:     center;
  justify-content: center;
}

/* ── KPI Cards (Live) ─────────────────────────────────────────────────────── */
.kpi-card {
  background:    #ffffff;
  border:        1px solid #e2e8f0;
  border-radius: 12px;
  padding:       16px;
  display:       flex;
  align-items:   center;
  gap:           14px;
}

.kpi-card--alert {
  border-color: #fca5a5;
  background:   #fff5f5;
}

.kpi-icon {
  width:           44px;
  height:          44px;
  border-radius:   10px;
  display:         flex;
  align-items:     center;
  justify-content: center;
  flex-shrink:     0;
}

.kpi-value {
  font-size:   24px;
  font-weight: 800;
  line-height: 1.1;
}

.kpi-label {
  font-size:  11px;
  color:      #64748b;
  margin-top: 2px;
}

/* ── Index Nav Pills ──────────────────────────────────────────────────────── */
.index-nav-btn {
  border-radius: 8px;
  padding: 6px 12px;
  border: 1px solid #e2e8f0;
}

/* ── Timeline ─────────────────────────────────────────────────────────────── */
.timeline-container {
  background:    #f8fafc;
  padding:       14px;
  border-radius: 10px;
  border:        1px solid #e2e8f0;
}

.timeline-bar {
  display: flex;
  gap:     4px;
  width:   100%;
  height:  38px;
}

.timeline-block {
  height:          100%;
  border-radius:   4px;
  display:         flex;
  flex-direction:  column;
  align-items:     center;
  justify-content: center;
  cursor:          pointer;
  transition:      transform 0.15s;
  position:        relative;
}
.timeline-block:hover {
  transform: scaleY(1.1);
  z-index: 2;
}

.block--bull {
  background: #dcfce7;
  border:     1px solid #86efac;
  color:      #15803d;
}

.block--bear {
  background: #fee2e2;
  border:     1px solid #fca5a5;
  color:      #b91c1c;
}

.block--nowick {
  border:     2px solid #f59e0b !important;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.6);
}

.block--current {
  opacity:       0.6;
  border-style:  dashed !important;
}

.block-hour {
  font-size:   8px;
  font-weight: 700;
}

.block-star {
  font-size:  8px;
  line-height: 1;
}

.border-amber {
  border: 1px solid #fde68a;
}

/* ── ESTILOS ESPECÍFICOS DE LA VISTA DE ESTADÍSTICAS ──────────────────────── */
.stats-filter-card {
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
}

.stats-kpi-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
  transition: transform 0.2s, box-shadow 0.2s;
}

.stats-kpi-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 14px -3px rgba(0, 0, 0, 0.08);
}

.stats-kpi-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.stats-kpi-title {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stats-kpi-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stats-kpi-main {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  margin-bottom: 4px;
}

.stats-kpi-sub {
  font-size: 11px;
}

.col-md-2-4 {
  width: 20%;
}

@media (max-width: 1024px) {
  .col-md-2-4 {
    width: 33.3333%;
  }
}

@media (max-width: 600px) {
  .col-md-2-4 {
    width: 100%;
  }
}

/* ── Matriz Heatmap ───────────────────────────────────────────────────────── */
.matrix-table-container {
  max-height: 520px;
}

.matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.matrix-th {
  background: #f1f5f9;
  color: #334155;
  font-weight: 700;
  padding: 10px 8px;
  border: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 10;
  white-space: nowrap;
}

.matrix-td {
  padding: 8px 6px;
  border: 1px solid #e2e8f0;
  white-space: nowrap;
  transition: background-color 0.15s;
}

.sticky-col {
  position: sticky;
  left: 0;
  background: #ffffff;
  z-index: 5;
  box-shadow: 2px 0 4px rgba(0, 0, 0, 0.04);
}

.matrix-th.sticky-col {
  z-index: 15;
  background: #f1f5f9;
}

.cell--high-win {
  background-color: #dcfce7 !important;
  color: #15803d !important;
}

.cell--mid-win {
  background-color: #fef3c7 !important;
  color: #b45309 !important;
}

.cell--low-win {
  background-color: #fee2e2 !important;
  color: #b91c1c !important;
}

/* ── Tablas de Estadísticas ───────────────────────────────────────────────── */
.stats-data-table :deep(th),
.stats-events-table :deep(th) {
  font-weight: 700;
  color: #475569;
  background: #f8fafc;
}

.stats-data-table :deep(tr:hover),
.stats-events-table :deep(tr:hover) {
  background-color: #f1f5f9;
}

.week-expansion-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

/* ── Último Día (24h) Verification Tab ────────────────────────────────────── */
.last-day-banner {
  background: linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%);
  border: 1px solid #99f6e4;
  gap: 0;
}

.last-day-sym-card {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  transition: box-shadow 0.15s;
}

.last-day-sym-card:hover {
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.07);
}

.card-win {
  border-left: 3px solid #059669;
  background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%);
}

.card-mid {
  border-left: 3px solid #d97706;
  background: linear-gradient(135deg, #fffbeb 0%, #ffffff 100%);
}

.card-loss {
  border-left: 3px solid #dc2626;
  background: linear-gradient(135deg, #fef2f2 0%, #ffffff 100%);
}

.border-left-slate {
  border-left: 2px solid #e2e8f0;
}

.verify-legend {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
}

.last-day-verify-table :deep(th) {
  font-weight: 700;
  color: #475569;
  background: #f0fdfa;
  border-bottom: 2px solid #99f6e4;
}

.last-day-verify-table :deep(tr:hover) {
  background-color: #f0fdfa;
}
</style>
