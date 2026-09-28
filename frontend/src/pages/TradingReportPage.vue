<template>
  <q-page class="q-pa-md bg-slate-950 text-white">
    <!-- ── ENCABEZADO PRINCIPAL ───────────────────────────────────────────── -->
    <div class="row items-center justify-between q-mb-md q-gutter-y-sm">
      <div class="row items-center q-gutter-sm">
        <q-avatar size="44px" color="indigo-10" text-color="indigo-3" icon="query_stats" />
        <div>
          <div class="text-h5 text-weight-bolder tracking-wide text-white">
            Auditoría, Rendimiento y Optimización IA
          </div>
          <div class="text-caption text-slate-400">
            Análisis de efectividad cuantitativa, comparativas horarias (mañana vs tarde) y simulador de Backtesting.
          </div>
        </div>
      </div>

      <!-- Selector de Pestañas -->
      <q-tabs
        v-model="activeTab"
        dense
        no-caps
        class="bg-slate-900 text-slate-400 rounded-borders border-slate"
        active-color="indigo-3"
        active-bg-color="indigo-10"
        indicator-color="indigo-5"
      >
        <q-tab name="live" icon="analytics" label="Informe Diario en Vivo" class="text-weight-bold q-px-md" />
        <q-tab name="backtest" icon="biotech" label="Simulador & Backtesting IA" class="text-weight-bold q-px-md" />
      </q-tabs>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <!-- ── PESTAÑA 1: INFORME DIARIO EN VIVO ─────────────────────────────── -->
    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <div v-if="activeTab === 'live'">
      <!-- Controles de Fecha (Uno o Varios Días) y Switch Adaptativo -->
      <div class="q-card bg-slate-900 border-slate q-pa-md q-mb-md rounded-borders">
        <div class="row items-center justify-between flex-wrap q-gutter-y-sm">
          <div>
            <div class="row items-center q-gutter-xs">
              <q-icon name="calendar_month" color="indigo-4" size="20px" />
              <span class="text-subtitle2 text-weight-bolder text-white">Período de Auditoría</span>
              <q-badge color="indigo-9" text-color="indigo-2" :label="reportPeriodLabel" class="text-weight-bold font-mono q-ml-xs" />
            </div>
            <div class="text-caption text-slate-400 q-mt-xs">
              Selecciona uno o varios días para evaluar cada estrategia y sus índices.
            </div>
          </div>

          <div class="row items-center flex-wrap q-gutter-sm">
            <!-- Botones de selección rápida -->
            <q-btn-group unelevated class="bg-slate-950 border-slate">
              <q-btn
                size="sm"
                :color="dateFilterMode === 'TODAY' ? 'indigo-7' : 'slate-900'"
                :text-color="dateFilterMode === 'TODAY' ? 'white' : 'slate-300'"
                label="Hoy"
                class="text-weight-bold"
                @click="setDateFilter('TODAY')"
              />
              <q-btn
                size="sm"
                :color="dateFilterMode === 'YESTERDAY' ? 'indigo-7' : 'slate-900'"
                :text-color="dateFilterMode === 'YESTERDAY' ? 'white' : 'slate-300'"
                label="Ayer"
                class="text-weight-bold"
                @click="setDateFilter('YESTERDAY')"
              />
              <q-btn
                size="sm"
                :color="dateFilterMode === '3DAYS' ? 'indigo-7' : 'slate-900'"
                :text-color="dateFilterMode === '3DAYS' ? 'white' : 'slate-300'"
                label="Últimos 3 Días"
                class="text-weight-bold"
                @click="setDateFilter('3DAYS')"
              />
              <q-btn
                size="sm"
                :color="dateFilterMode === '7DAYS' ? 'indigo-7' : 'slate-900'"
                :text-color="dateFilterMode === '7DAYS' ? 'white' : 'slate-300'"
                label="Últimos 7 Días"
                class="text-weight-bold"
                @click="setDateFilter('7DAYS')"
              />
              <q-btn
                size="sm"
                :color="dateFilterMode === 'MONTH' ? 'indigo-7' : 'slate-900'"
                :text-color="dateFilterMode === 'MONTH' ? 'white' : 'slate-300'"
                label="Este Mes"
                class="text-weight-bold"
                @click="setDateFilter('MONTH')"
              />
            </q-btn-group>

            <!-- Rango personalizado Desde / Hasta -->
            <div class="row items-center q-gutter-xs bg-slate-950 q-px-sm py-1 rounded-borders border-slate">
              <span class="text-caption text-slate-400 font-mono">Desde:</span>
              <input
                v-model="startDate"
                type="date"
                class="bg-slate-900 text-white font-mono rounded border-none q-px-xs text-caption"
                style="color-scheme: dark; outline: none; border: 1px solid #334155; padding: 2px 6px; border-radius: 4px;"
                @change="onCustomDateChange"
              />
              <span class="text-caption text-slate-400 font-mono">Hasta:</span>
              <input
                v-model="endDate"
                type="date"
                class="bg-slate-900 text-white font-mono rounded border-none q-px-xs text-caption"
                style="color-scheme: dark; outline: none; border: 1px solid #334155; padding: 2px 6px; border-radius: 4px;"
                @change="onCustomDateChange"
              />
            </div>

            <!-- Switch Motor Adaptativo IA -->
            <div class="row items-center q-px-sm py-1 bg-slate-950 rounded-borders border-slate q-gutter-xs">
              <span class="text-caption text-weight-bold text-slate-300">Feedback IA:</span>
              <q-toggle
                v-model="adaptiveEnabled"
                dense
                color="emerald-5"
                :loading="loadingToggle"
                @update:model-value="toggleAdaptiveFeedback"
              >
                <q-tooltip>
                  Cuando está activo, el bot aprende de rachas y horarios desfavorables para proteger el capital.
                </q-tooltip>
              </q-toggle>
              <q-badge :color="adaptiveEnabled ? 'emerald-8' : 'grey-8'" :label="adaptiveEnabled ? 'ACTIVO' : 'PAUSADO'" class="text-weight-bold" />
            </div>

            <q-btn
              unelevated
              color="indigo-7"
              icon="refresh"
              label="Consultar"
              class="text-weight-bold"
              :loading="loading"
              @click="fetchReport"
            />
          </div>
        </div>
      </div>

      <!-- ── 1. TARJETAS KPI DE RENDIMIENTO GLOBAL ────────────────────────── -->
      <div class="row q-col-gutter-md q-mb-md">
        <!-- Beneficio Neto -->
        <div class="col-12 col-sm-6 col-md-3">
          <q-card flat class="kpi-card bg-slate-900 border-slate q-pa-md">
            <div class="row items-center justify-between">
              <span class="text-caption text-weight-bold text-slate-400">BENEFICIO NETO (USD)</span>
              <q-icon
                :name="summary.netProfit >= 0 ? 'trending_up' : 'trending_down'"
                :color="summary.netProfit >= 0 ? 'emerald-4' : 'red-4'"
                size="24px"
              />
            </div>
            <div
              class="text-h4 font-mono text-weight-bolder q-mt-xs"
              :class="summary.netProfit >= 0 ? 'text-emerald-4' : 'text-red-4'"
            >
              {{ summary.netProfit >= 0 ? '+' : '' }}${{ summary.netProfit.toFixed(2) }}
            </div>
            <div class="row items-center justify-between text-caption text-slate-400 q-mt-xs font-mono">
              <span class="text-emerald-3">+$ {{ summary.totalGain.toFixed(2) }}</span>
              <span class="text-red-3">-$ {{ summary.totalLoss.toFixed(2) }}</span>
            </div>
          </q-card>
        </div>

        <!-- Tasa de Acierto (WinRate) -->
        <div class="col-12 col-sm-6 col-md-3">
          <q-card flat class="kpi-card bg-slate-900 border-slate q-pa-md">
            <div class="row items-center justify-between">
              <span class="text-caption text-weight-bold text-slate-400">TASA DE ACIERTO (WIN RATE)</span>
              <q-icon name="percent" color="indigo-4" size="24px" />
            </div>
            <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-indigo-3">
              {{ summary.winRatePct }}%
            </div>
            <div class="q-mt-xs">
              <q-linear-progress
                :value="summary.winRatePct / 100"
                rounded
                size="8px"
                :color="summary.winRatePct >= 50 ? 'emerald-5' : 'red-5'"
                track-color="slate-800"
              />
            </div>
          </q-card>
        </div>

        <!-- Total de Operaciones (Buenas vs Malas) -->
        <div class="col-12 col-sm-6 col-md-3">
          <q-card flat class="kpi-card bg-slate-900 border-slate q-pa-md">
            <div class="row items-center justify-between">
              <span class="text-caption text-weight-bold text-slate-400">OPERACIONES (BUENAS / MALAS)</span>
              <q-icon name="balance" color="amber-4" size="24px" />
            </div>
            <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-white">
              <span class="text-emerald-4">{{ summary.wins }}</span>
              <span class="text-slate-500 q-px-xs">/</span>
              <span class="text-red-4">{{ summary.losses }}</span>
              <span v-if="summary.breakevens > 0" class="text-caption text-slate-400 q-ml-xs">({{ summary.breakevens }} BE)</span>
            </div>
            <div class="text-caption text-slate-400 q-mt-xs font-mono">
              Total cerradas: <b>{{ summary.closedTrades }}</b> ({{ summary.openTrades }} abiertas)
            </div>
          </q-card>
        </div>

        <!-- Factor de Beneficio & Duración -->
        <div class="col-12 col-sm-6 col-md-3">
          <q-card flat class="kpi-card bg-slate-900 border-slate q-pa-md">
            <div class="row items-center justify-between">
              <span class="text-caption text-weight-bold text-slate-400">PROFIT FACTOR & TIEMPO</span>
              <q-icon name="timer" color="sky-4" size="24px" />
            </div>
            <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-sky-3">
              {{ summary.profitFactor }}
            </div>
            <div class="text-caption text-slate-400 q-mt-xs font-mono">
              Duración media: <b>{{ summary.avgDurationMin }} min</b>
            </div>
          </q-card>
        </div>
      </div>

      <!-- ── 2. CUADRO RESUMEN DE ESTRATEGIAS POR ÍNDICE (BUENAS vs MALAS) ── -->
      <div class="q-mb-md">
        <q-card flat class="bg-slate-900 border-slate q-pa-md">
          <div class="row items-center justify-between q-mb-md flex-wrap q-gutter-y-sm">
            <div>
              <div class="row items-center q-gutter-xs">
                <q-icon name="dashboard_customize" color="amber-4" size="24px" />
                <span class="text-h6 text-weight-bolder text-white">
                  Resumen de Estrategias por Cada Índice
                </span>
                <q-badge color="amber-10" text-color="amber-3" label="Buenas vs Malas" class="text-weight-bold q-ml-xs" />
              </div>
              <div class="text-caption text-slate-400 q-mt-xs">
                Evaluación cuantitativa de cuándo entró cada trade, total de operaciones ganadas/perdidas y porcentaje de efectividad.
              </div>
            </div>

            <!-- Filtro de Estrategia -->
            <div class="row items-center q-gutter-xs">
              <q-btn
                v-for="tabOpt in strategyTabs"
                :key="tabOpt.value"
                size="sm"
                dense
                unelevated
                :color="selectedStrategyFilter === tabOpt.value ? 'amber-8' : 'slate-950'"
                :text-color="selectedStrategyFilter === tabOpt.value ? 'black' : 'slate-300'"
                :label="tabOpt.label"
                class="q-px-sm text-weight-bold"
                @click="selectedStrategyFilter = tabOpt.value"
              />
            </div>
          </div>

          <!-- Si no hay operaciones en el periodo -->
          <div v-if="filteredStrategies.length === 0 || totalFilteredTrades === 0" class="q-pa-lg text-center text-slate-500 bg-slate-950 rounded-borders">
            <q-icon name="event_busy" size="40px" class="q-mb-xs" />
            <div class="text-weight-bold text-slate-400">No hay operaciones registradas en el período seleccionado.</div>
            <div class="text-caption text-slate-500">Prueba seleccionando "Últimos 3 días", "Últimos 7 días" o amplía el rango de fechas.</div>
          </div>

          <!-- Tarjetas de Estrategias -->
          <div v-else class="column q-gutter-md">
            <div
              v-for="strat in filteredStrategies"
              :key="strat.strategy"
              class="strategy-summary-card bg-slate-950 rounded-borders border-slate overflow-hidden"
            >
              <!-- Cabecera de la Estrategia -->
              <div class="row items-center justify-between q-pa-md bg-slate-900 border-b-slate flex-wrap q-gutter-y-xs">
                <div class="row items-center q-gutter-sm">
                  <q-avatar size="36px" :color="strat.color || 'indigo-9'" text-color="white" :icon="strat.icon || 'bolt'" />
                  <div>
                    <div class="text-subtitle1 text-weight-bolder text-white row items-center q-gutter-xs">
                      <span>{{ strat.label }}</span>
                      <q-badge color="slate-800" text-color="slate-300" :label="`${strat.total} trades`" class="font-mono" />
                    </div>
                    <div class="text-caption text-slate-400">
                      Evaluando {{ strat.symbols.length }} índices con entradas ejecutadas en este periodo
                    </div>
                  </div>
                </div>

                <!-- Métricas Globales de la Estrategia -->
                <div class="row items-center q-gutter-md">
                  <div class="row items-center q-gutter-xs text-caption font-mono">
                    <span class="text-slate-400">Balance:</span>
                    <span class="text-weight-bolder text-emerald-4">🟢 {{ strat.wins }} Buenas</span>
                    <span class="text-slate-500">/</span>
                    <span class="text-weight-bolder text-red-4">🔴 {{ strat.losses }} Malas</span>
                    <span v-if="strat.breakevens > 0" class="text-slate-400">({{ strat.breakevens }} BE)</span>
                  </div>

                  <div class="row items-center q-gutter-xs">
                    <q-badge
                      :color="strat.winRatePct >= 50 ? 'emerald-9' : strat.total > 0 ? 'red-9' : 'slate-800'"
                      :text-color="strat.winRatePct >= 50 ? 'emerald-2' : strat.total > 0 ? 'red-2' : 'slate-400'"
                      class="text-weight-bolder font-mono text-subtitle2 q-px-sm"
                    >
                      🎯 {{ strat.winRatePct }}% Acierto
                    </q-badge>
                  </div>

                  <div class="font-mono text-subtitle2 text-weight-bolder" :class="strat.netProfit >= 0 ? 'text-emerald-4' : 'text-red-4'">
                    {{ strat.netProfit >= 0 ? '+' : '' }}${{ strat.netProfit.toFixed(2) }}
                  </div>
                </div>
              </div>

              <!-- Tabla de Índices de esta Estrategia -->
              <div class="q-pa-sm">
                <q-table
                  :rows="strat.symbols"
                  :columns="strategySymbolColumns"
                  row-key="symbol"
                  flat
                  dark
                  dense
                  hide-pagination
                  :pagination="{ rowsPerPage: 50 }"
                  class="bg-transparent font-mono"
                >
                  <!-- Celda Índice -->
                  <template #body-cell-symbol="props">
                    <q-td :props="props">
                      <div class="row items-center q-gutter-xs">
                        <span class="text-weight-bold text-white">{{ props.row.mercado }}</span>
                        <q-badge
                          :color="props.row.symbol.startsWith('BOOM') ? 'green-9' : 'purple-9'"
                          :label="props.row.symbol.startsWith('BOOM') ? 'BUY' : 'SELL'"
                          class="text-weight-bolder q-ml-xs text-caption"
                        />
                      </div>
                    </q-td>
                  </template>

                  <!-- Celda Buenas -->
                  <template #body-cell-wins="props">
                    <q-td :props="props">
                      <q-badge color="emerald-9" text-color="emerald-2" class="text-weight-bold q-px-sm">
                        🟢 {{ props.row.wins }}
                      </q-badge>
                    </q-td>
                  </template>

                  <!-- Celda Malas -->
                  <template #body-cell-losses="props">
                    <q-td :props="props">
                      <q-badge color="red-9" text-color="red-2" class="text-weight-bold q-px-sm">
                        🔴 {{ props.row.losses }}
                      </q-badge>
                    </q-td>
                  </template>

                  <!-- Celda Win Rate -->
                  <template #body-cell-winRatePct="props">
                    <q-td :props="props">
                      <div class="row items-center q-gutter-xs no-wrap">
                        <span
                          class="text-weight-bolder q-mr-xs"
                          :class="props.row.winRatePct >= 50 ? 'text-emerald-4' : props.row.total > 0 ? 'text-red-4' : 'text-slate-400'"
                        >
                          {{ props.row.winRatePct }}%
                        </span>
                        <q-linear-progress
                          :value="props.row.total > 0 ? props.row.winRatePct / 100 : 0"
                          rounded
                          size="6px"
                          style="width: 60px;"
                          :color="props.row.winRatePct >= 50 ? 'emerald-5' : 'red-5'"
                          track-color="slate-800"
                        />
                      </div>
                    </q-td>
                  </template>

                  <!-- Celda % con Spike -->
                  <template #body-cell-spikeRatePct="props">
                    <q-td :props="props" class="text-center font-mono">
                      <q-badge
                        :color="props.row.spikeRatePct >= 50 ? 'amber-9' : 'slate-800'"
                        :text-color="props.row.spikeRatePct >= 50 ? 'amber-2' : 'slate-400'"
                        :label="`⚡ ${props.row.spikeRatePct}% (${props.row.spikes || 0})`"
                        class="text-weight-bold"
                      />
                    </q-td>
                  </template>

                  <!-- Celda PnL -->
                  <template #body-cell-netProfit="props">
                    <q-td :props="props" class="text-weight-bolder">
                      <span :class="props.row.netProfit >= 0 ? 'text-emerald-4' : 'text-red-4'">
                        {{ props.row.netProfit >= 0 ? '+' : '' }}${{ props.row.netProfit.toFixed(2) }}
                      </span>
                    </q-td>
                  </template>

                  <!-- Celda Acción / Desplegar trades -->
                  <template #body-cell-actions="props">
                    <q-td :props="props" class="text-right">
                      <q-btn
                        size="xs"
                        dense
                        outline
                        :color="isSymbolExpanded(strat.strategy, props.row.symbol) ? 'amber-4' : 'indigo-4'"
                        :icon="isSymbolExpanded(strat.strategy, props.row.symbol) ? 'expand_less' : 'visibility'"
                        :label="isSymbolExpanded(strat.strategy, props.row.symbol) ? 'Ocultar' : `Ver ${props.row.trades.length} entradas`"
                        class="text-weight-bold"
                        @click="toggleSymbolExpand(strat.strategy, props.row.symbol)"
                      />
                    </q-td>
                  </template>
                </q-table>

                <!-- DETALLE EXPANDIBLE DE OPERACIONES PARA EL ÍNDICE -->
                <template v-for="sym in strat.symbols" :key="'detail_' + sym.symbol">
                  <div
                    v-if="isSymbolExpanded(strat.strategy, sym.symbol)"
                    class="q-my-sm q-pa-sm bg-slate-900 rounded-borders border-slate"
                  >
                    <div class="row items-center justify-between q-mb-xs">
                      <div class="row items-center q-gutter-xs text-caption font-mono text-slate-300">
                        <q-icon name="list" color="amber-4" />
                        <span class="text-weight-bolder text-white">Historial de entradas: {{ sym.mercado }} ({{ strat.label }})</span>
                        <span>· {{ sym.trades.length }} operaciones</span>
                      </div>
                      <q-btn
                        size="xs"
                        flat
                        dense
                        color="slate-4"
                        icon="close"
                        @click="toggleSymbolExpand(strat.strategy, sym.symbol)"
                      />
                    </div>

                    <div style="overflow-x: auto;">
                      <table class="q-table q-table--dark q-table--dense bg-transparent font-mono text-caption full-width">
                        <thead>
                          <tr class="text-slate-400 text-left">
                            <th class="q-pa-xs">Cuándo Entró</th>
                            <th class="q-pa-xs">Lado</th>
                            <th class="q-pa-xs text-right">Precio Entrada</th>
                            <th class="q-pa-xs text-right">Precio Salida</th>
                            <th class="q-pa-xs text-center">Evaluación</th>
                            <th class="q-pa-xs text-center">Spike</th>
                            <th class="q-pa-xs text-right">PnL (USD)</th>
                            <th class="q-pa-xs">Motivo Cierre</th>
                            <th class="q-pa-xs text-center">Duración</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="t in sym.trades"
                            :key="t.id"
                            :class="t.result === 'WIN' ? 'bg-emerald-10/20' : t.result === 'LOSS' ? 'bg-red-10/20' : ''"
                          >
                            <td class="q-pa-xs text-weight-bold text-slate-200">{{ t.entryDateStr }}</td>
                            <td class="q-pa-xs">
                              <q-badge
                                size="xs"
                                :color="t.direction === 'BUY' ? 'green-9' : 'purple-9'"
                                :label="t.direction"
                              />
                            </td>
                            <td class="q-pa-xs text-right font-mono">{{ t.entryPrice ? t.entryPrice.toFixed(3) : '-' }}</td>
                            <td class="q-pa-xs text-right font-mono">{{ t.exitPrice ? t.exitPrice.toFixed(3) : '-' }}</td>
                            <td class="q-pa-xs text-center">
                              <q-badge
                                :color="t.result === 'WIN' ? 'emerald-9' : t.result === 'LOSS' ? 'red-9' : 'slate-700'"
                                :text-color="t.result === 'WIN' ? 'emerald-2' : t.result === 'LOSS' ? 'red-2' : 'white'"
                                :label="t.result === 'WIN' ? '🟢 BUENA' : t.result === 'LOSS' ? '🔴 MALA' : '⚪ BE'"
                                class="text-weight-bold"
                              />
                            </td>
                            <td class="q-pa-xs text-center">
                              <q-badge
                                :color="t.hadSpike ? 'amber-9' : 'slate-800'"
                                :text-color="t.hadSpike ? 'amber-2' : 'slate-400'"
                                :label="t.hadSpike ? (t.spikeCount > 1 ? `⚡ SÍ (${t.spikeCount})` : '⚡ SÍ') : 'NO'"
                                class="text-weight-bold"
                              />
                            </td>
                            <td class="q-pa-xs text-right font-mono text-weight-bolder" :class="t.pnlUsd >= 0 ? 'text-emerald-4' : 'text-red-4'">
                              {{ t.pnlUsd >= 0 ? '+' : '' }}${{ t.pnlUsd.toFixed(2) }}
                            </td>
                            <td class="q-pa-xs text-slate-400 text-caption">{{ formatExitReason(t.exitReason) }}</td>
                            <td class="q-pa-xs text-center text-slate-400">{{ t.durationMin }}m</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </q-card>
      </div>

      <!-- ── 3. ANÁLISIS DE EFECTIVIDAD POR HORARIOS Y SESIONES ────────────── -->
      <div class="row q-col-gutter-md q-mb-md">
        <!-- Comparativa de Sesiones: Mañana vs Tarde vs Noche -->
        <div class="col-12 col-lg-5">
          <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
            <div class="row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <q-icon name="wb_twilight" color="amber-4" size="20px" />
                <span class="text-subtitle1 text-weight-bolder text-white">
                  Comparativa por Sesión (Mañana vs Tarde)
                </span>
              </div>
            </div>
            <div class="text-caption text-slate-400 q-mb-md">
              Permite identificar si el mercado respondió con mejores spikes en la mañana que en la tarde.
            </div>

            <div class="column q-gutter-sm">
              <div
                v-for="s in bySession"
                :key="s.session"
                class="q-pa-sm rounded-borders bg-slate-950 border-slate"
              >
                <div class="row items-center justify-between">
                  <span class="text-caption text-weight-bold text-slate-300">{{ s.label }}</span>
                  <q-badge
                    :color="s.winRatePct >= 50 ? 'emerald-9' : s.total > 0 ? 'red-9' : 'slate-800'"
                    :text-color="s.winRatePct >= 50 ? 'emerald-2' : s.total > 0 ? 'red-2' : 'slate-400'"
                    class="text-weight-bold font-mono"
                  >
                    {{ s.winRatePct }}% Win Rate
                  </q-badge>
                </div>
                <div class="row items-center justify-between text-caption font-mono text-slate-400 q-mt-xs">
                  <span>Trades: <b>{{ s.total }}</b> (<span class="text-emerald-4">{{ s.wins }}W</span> - <span class="text-red-4">{{ s.losses }}L</span>)</span>
                  <span :class="s.netProfit >= 0 ? 'text-emerald-4 text-weight-bold' : 'text-red-4 text-weight-bold'">
                    {{ s.netProfit >= 0 ? '+' : '' }}${{ s.netProfit.toFixed(2) }}
                  </span>
                </div>
                <div class="q-mt-xs">
                  <q-linear-progress
                    :value="s.total > 0 ? s.winRatePct / 100 : 0"
                    size="5px"
                    rounded
                    :color="s.winRatePct >= 50 ? 'emerald-5' : 'red-5'"
                    track-color="slate-800"
                  />
                </div>
              </div>
            </div>
          </q-card>
        </div>

        <!-- Mapa Horario (0h a 23h) -->
        <div class="col-12 col-lg-7">
          <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
            <div class="row items-center justify-between q-mb-sm">
              <div class="row items-center q-gutter-xs">
                <q-icon name="schedule" color="indigo-4" size="20px" />
                <span class="text-subtitle1 text-weight-bolder text-white">
                  Distribución y Rendimiento Hora por Hora (0:00 - 23:00)
                </span>
              </div>
            </div>
            <div class="text-caption text-slate-400 q-mb-md">
              Barras de efectividad por hora. La IA utiliza estas métricas para suspender operaciones en horarios de baja probabilidad.
            </div>

            <!-- Gráfico visual de barras por hora -->
            <div class="hourly-bar-container row items-end q-col-gutter-xs">
              <div
                v-for="h in byHour"
                :key="h.hour"
                class="col text-center hourly-bar-col"
              >
                <div
                  class="hourly-bar-fill rounded-borders"
                  :style="{
                    height: h.total > 0 ? Math.max(14, (h.winRatePct / 100) * 80) + 'px' : '4px',
                    backgroundColor: h.total === 0 ? '#1e293b' : h.winRatePct >= 50 ? '#10b981' : '#ef4444'
                  }"
                  :title="`${h.label}: ${h.wins}W / ${h.losses}L (${h.winRatePct}%) PnL: $${h.netProfit}`"
                />
                <div class="hour-label text-slate-500 font-mono q-mt-xs">
                  {{ String(h.hour).padStart(2, '0') }}
                </div>
              </div>
            </div>

            <div class="row items-center justify-center q-gutter-md q-mt-md text-caption text-slate-400">
              <span class="row items-center q-gutter-xs">
                <span class="q-badge bg-emerald-5" style="width: 10px; height: 10px; padding: 0;" />
                <span>Horas Ganadoras (&ge;50% WinRate)</span>
              </span>
              <span class="row items-center q-gutter-xs">
                <span class="q-badge bg-red-5" style="width: 10px; height: 10px; padding: 0;" />
                <span>Horas Desfavorables (&lt;50% WinRate)</span>
              </span>
              <span class="row items-center q-gutter-xs">
                <span class="q-badge bg-slate-800" style="width: 10px; height: 10px; padding: 0;" />
                <span>Sin operaciones</span>
              </span>
            </div>
          </q-card>
        </div>
      </div>

      <!-- ── 3. ESTADO DEL MOTOR ADAPTATIVO POR ÍNDICE ─────────────────────── -->
      <div class="q-mb-md">
        <q-card flat class="bg-slate-900 border-slate q-pa-md">
          <div class="row items-center justify-between q-mb-sm">
            <div class="row items-center q-gutter-xs">
              <q-icon name="psychology" color="emerald-4" size="24px" />
              <span class="text-subtitle1 text-weight-bolder text-white">
                Diagnóstico del Motor de Retroalimentación IA
              </span>
            </div>
            <q-badge color="emerald-9" text-color="emerald-3" label="Circuit Breaker y Filtros Activos" class="text-weight-bold" />
          </div>
          <div class="text-caption text-slate-400 q-mb-md">
            El sistema previene pérdidas pausando índices que acumulan 2 SL seguidos o cuya franja horaria actual presente ciclos adversos.
          </div>

          <div class="row q-col-gutter-sm">
            <div
              v-for="item in adaptiveStatus.symbols"
              :key="item.symbol"
              class="col-12 col-sm-6 col-md-3"
            >
              <div
                class="symbol-status-box q-pa-sm rounded-borders bg-slate-950"
                :class="getStatusBorderClass(item.status)"
              >
                <div class="row items-center justify-between">
                  <span class="text-subtitle2 text-weight-bolder font-mono text-white">{{ item.symbol }}</span>
                  <q-badge
                    :color="getStatusBadgeColor(item.status)"
                    :label="item.status"
                    class="text-weight-bold"
                  />
                </div>
                <div class="text-caption text-slate-400 q-mt-xs">
                  {{ item.statusMessage }}
                </div>
                <div class="row items-center justify-between text-caption font-mono text-slate-400 q-mt-xs">
                  <span>Racha pérdidas: <b :class="item.consecutiveLosses >= 2 ? 'text-red-4' : 'text-slate-200'">{{ item.consecutiveLosses }}</b></span>
                  <span v-if="item.currentHourWinRate !== null">Hora actual: <b>{{ item.currentHourWinRate.toFixed(0) }}%</b></span>
                </div>
              </div>
            </div>
          </div>
        </q-card>
      </div>

      <!-- ── 4. TABLA DE OPERACIONES DEL DÍA ───────────────────────────────── -->
      <q-card flat class="bg-slate-900 border-slate q-pa-md">
        <div class="row items-center justify-between q-mb-sm">
          <div class="row items-center q-gutter-xs">
            <q-icon name="receipt_long" color="sky-4" size="22px" />
            <span class="text-subtitle1 text-weight-bolder text-white">
              Registro Detallado de Operaciones del Día
            </span>
          </div>
          <div class="text-caption text-slate-400 font-mono">
            Total registradas: <b>{{ trades.length }}</b>
          </div>
        </div>

        <q-table
          :rows="trades"
          :columns="tradeColumns"
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
                :color="props.row.result === 'WIN' ? 'emerald-9' : props.row.result === 'LOSS' ? 'red-9' : 'slate-700'"
                :text-color="props.row.result === 'WIN' ? 'emerald-2' : props.row.result === 'LOSS' ? 'red-2' : 'white'"
                :label="props.row.result === 'WIN' ? '🟢 BUENA (WIN)' : props.row.result === 'LOSS' ? '🔴 MALA (SL)' : '⚪ BREAKEVEN'"
                class="text-weight-bold"
              />
            </q-td>
          </template>

          <template #body-cell-pnl="props">
            <q-td :props="props" class="text-weight-bolder">
              <span :class="props.row.pnl >= 0 ? 'text-emerald-4' : 'text-red-4'">
                {{ props.row.pnl >= 0 ? '+' : '' }}${{ props.row.pnl.toFixed(2) }}
              </span>
            </q-td>
          </template>

          <template #body-cell-symbol="props">
            <q-td :props="props">
              <span class="text-weight-bold text-white">{{ props.row.symbol }}</span>
              <q-badge
                :color="props.row.direction === 'BUY' ? 'teal-9' : 'purple-9'"
                :label="props.row.direction"
                class="q-ml-xs text-caption"
              />
            </q-td>
          </template>

          <template #body-cell-exitReason="props">
            <q-td :props="props">
              <span class="text-caption text-slate-300">{{ formatExitReason(props.row.exitReason) }}</span>
            </q-td>
          </template>
        </q-table>
      </q-card>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <!-- ── PESTAÑA 2: SIMULADOR & BACKTESTING IA ─────────────────────────── -->
    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="activeTab === 'backtest'">
      <!-- Panel de Configuración y Ejecución del Backtest -->
      <q-card flat class="bg-slate-900 border-slate q-pa-md q-mb-md">
        <div class="row items-center justify-between q-mb-md">
          <div class="row items-center q-gutter-xs">
            <q-icon name="science" color="indigo-4" size="24px" />
            <span class="text-subtitle1 text-weight-bolder text-white">
              Parámetros de Simulación Histórica (Estrategia Wey 4H / 1H / 15M / 5M)
            </span>
          </div>
          <q-badge color="indigo-9" text-color="indigo-2" label="Simulación Cuantitativa Paso a Paso" class="text-weight-bold" />
        </div>

        <div class="row q-col-gutter-md items-center">
          <!-- Selector de Índice -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-select
              v-model="backtestSymbol"
              :options="backtestSymbolsList"
              option-value="symbol"
              option-label="label"
              emit-value
              map-options
              dense
              outlined
              dark
              label="Índice a Evaluar"
              color="indigo-5"
              class="font-mono"
            />
          </div>

          <!-- Selector de Días Históricos -->
          <div class="col-12 col-sm-6 col-md-2">
            <q-select
              v-model="backtestDays"
              :options="[
                { label: '3 Días (Rápido)', value: 3 },
                { label: '7 Días (1 Semana)', value: 7 },
                { label: '14 Días (2 Semanas)', value: 14 },
                { label: '30 Días (1 Mes)', value: 30 },
              ]"
              emit-value
              map-options
              dense
              outlined
              dark
              label="Período"
              color="indigo-5"
              class="font-mono"
            />
          </div>

          <!-- Filtro de Estrellas -->
          <div class="col-12 col-sm-6 col-md-2">
            <q-select
              v-model="backtestMinStars"
              :options="[
                { label: '≥ 3 Estrellas (Estándar)', value: 3 },
                { label: 'Solo 4 Estrellas (Alta Confluencia)', value: 4 },
              ]"
              emit-value
              map-options
              dense
              outlined
              dark
              label="Filtro de Estrellas"
              color="indigo-5"
              class="font-mono"
            />
          </div>

          <!-- Toggle Solo Viables -->
          <div class="col-12 col-sm-6 col-md-3">
            <div class="row items-center q-px-sm py-1 bg-slate-950 rounded-borders border-slate">
              <q-toggle
                v-model="backtestOnlyViable"
                dense
                color="emerald-5"
                label="Solo Entradas Viables (4H + M15)"
                class="text-caption text-weight-bold text-slate-300"
              />
            </div>
          </div>

          <!-- Botón de Lanzar Backtest -->
          <div class="col-12 col-md-2">
            <q-btn
              unelevated
              color="indigo-7"
              icon="play_arrow"
              label="Ejecutar Backtest"
              class="full-width text-weight-bold q-py-sm"
              :loading="backtestLoading"
              @click="runBacktestSimulation"
            />
          </div>
        </div>
      </q-card>

      <!-- Estado Inicial Sin Resultados -->
      <div v-if="!backtestResult && !backtestLoading" class="q-pa-xl text-center bg-slate-900 border-slate rounded-borders q-mb-md">
        <q-icon name="model_training" size="64px" color="slate-600" />
        <div class="text-h6 text-slate-400 q-mt-md">Simulador Histórico Listo</div>
        <div class="text-caption text-slate-500 q-mt-xs">
          Selecciona el índice y los días que deseas evaluar para descubrir qué horas del día son ganadoras y cuáles evitar.
        </div>
        <q-btn
          unelevated
          color="indigo-7"
          icon="science"
          label="Lanzar Simulación (7 Días)"
          class="q-mt-md text-weight-bold"
          @click="runBacktestSimulation"
        />
      </div>

      <!-- Spinner durante la simulación -->
      <div v-if="backtestLoading" class="q-pa-xl text-center bg-slate-900 border-slate rounded-borders q-mb-md">
        <q-spinner-cube color="indigo-5" size="56px" />
        <div class="text-subtitle1 text-weight-bold text-white q-mt-md">
          Descargando velas de Deriv y simulando operaciones...
        </div>
        <div class="text-caption text-slate-400 q-mt-xs">
          Evaluando 4H macro, estructura 1H, EMA 50 en 15M y conteo de reacción en 5M.
        </div>
      </div>

      <!-- Resultados del Backtest -->
      <div v-if="backtestResult && !backtestLoading">
        <!-- ── 1. TARJETAS KPI BACKTEST ── -->
        <div class="row q-col-gutter-md q-mb-md">
          <!-- Win Rate -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-card flat class="kpi-card bg-slate-900 border-slate q-pa-md">
              <div class="row items-center justify-between">
                <span class="text-caption text-weight-bold text-slate-400">WIN RATE HISTÓRICO</span>
                <q-icon name="military_tech" color="indigo-4" size="24px" />
              </div>
              <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-indigo-3">
                {{ backtestResult.winRatePct }}%
              </div>
              <div class="q-mt-xs">
                <q-linear-progress
                  :value="backtestResult.winRatePct / 100"
                  rounded
                  size="8px"
                  :color="backtestResult.winRatePct >= 45 ? 'emerald-5' : 'red-5'"
                  track-color="slate-800"
                />
              </div>
            </q-card>
          </div>

          <!-- Beneficio Neto Proyectado -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-card flat class="kpi-card bg-slate-900 border-slate q-pa-md">
              <div class="row items-center justify-between">
                <span class="text-caption text-weight-bold text-slate-400">BENEFICIO SIMULADO (USD)</span>
                <q-icon
                  :name="backtestResult.netProfitUsd >= 0 ? 'payments' : 'money_off'"
                  :color="backtestResult.netProfitUsd >= 0 ? 'emerald-4' : 'red-4'"
                  size="24px"
                />
              </div>
              <div
                class="text-h4 font-mono text-weight-bolder q-mt-xs"
                :class="backtestResult.netProfitUsd >= 0 ? 'text-emerald-4' : 'text-red-4'"
              >
                {{ backtestResult.netProfitUsd >= 0 ? '+' : '' }}${{ backtestResult.netProfitUsd.toFixed(2) }}
              </div>
              <div class="row items-center justify-between text-caption text-slate-400 q-mt-xs font-mono">
                <span class="text-emerald-3">+$ {{ backtestResult.totalGainUsd.toFixed(2) }}</span>
                <span class="text-red-3">-$ {{ backtestResult.totalLossUsd.toFixed(2) }}</span>
              </div>
            </q-card>
          </div>

          <!-- Trades Ganadas vs Perdidas -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-card flat class="kpi-card bg-slate-900 border-slate q-pa-md">
              <div class="row items-center justify-between">
                <span class="text-caption text-weight-bold text-slate-400">TRADES SIMULADOS</span>
                <q-icon name="query_builder" color="amber-4" size="24px" />
              </div>
              <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-white">
                <span class="text-emerald-4">{{ backtestResult.wins }}</span>
                <span class="text-slate-500 q-px-xs">/</span>
                <span class="text-red-4">{{ backtestResult.losses }}</span>
              </div>
              <div class="text-caption text-slate-400 q-mt-xs font-mono">
                Total: <b>{{ backtestResult.totalTrades }}</b> · Duración media: <b>{{ backtestResult.avgDurationMin }}m</b>
              </div>
            </q-card>
          </div>

          <!-- Profit Factor -->
          <div class="col-12 col-sm-6 col-md-3">
            <q-card flat class="kpi-card bg-slate-900 border-slate q-pa-md">
              <div class="row items-center justify-between">
                <span class="text-caption text-weight-bold text-slate-400">PROFIT FACTOR</span>
                <q-icon name="trending_up" color="sky-4" size="24px" />
              </div>
              <div class="text-h4 font-mono text-weight-bolder q-mt-xs text-sky-3">
                {{ backtestResult.profitFactor }}
              </div>
              <div class="text-caption text-slate-400 q-mt-xs font-mono">
                Eval: <b>{{ backtestResult.days }} días</b> · {{ backtestResult.symbol }}
              </div>
            </q-card>
          </div>
        </div>

        <!-- ── 2. RECOMENDACIONES DE LA IA ── -->
        <q-card flat class="bg-slate-900 border-indigo q-pa-md q-mb-md" style="border-left: 4px solid #6366f1;">
          <div class="row items-center q-gutter-xs q-mb-sm">
            <q-icon name="auto_awesome" color="indigo-3" size="22px" />
            <span class="text-subtitle1 text-weight-bolder text-white">
              Conclusiones y Recomendaciones de la IA
            </span>
          </div>
          <div class="column q-gutter-xs">
            <div
              v-for="(rec, idx) in backtestResult.aiRecommendations"
              :key="idx"
              class="q-pa-sm rounded-borders bg-slate-950 text-body2 text-slate-200"
            >
              {{ rec }}
            </div>
          </div>
        </q-card>

        <!-- ── 3. MAPA HORARIO DE EFECTIVIDAD (0H A 23H) ── -->
        <q-card flat class="bg-slate-900 border-slate q-pa-md q-mb-md">
          <div class="row items-center justify-between q-mb-sm">
            <div class="row items-center q-gutter-xs">
              <q-icon name="schedule" color="indigo-4" size="22px" />
              <span class="text-subtitle1 text-weight-bolder text-white">
                Rendimiento Histórico Hora por Hora (0:00 - 23:00)
              </span>
            </div>
            <div class="text-caption text-slate-400 font-mono">
              Verde: Ganadoras (&ge;50%) | Rojo: Perdedoras (&lt;50%)
            </div>
          </div>

          <div class="hourly-bar-container row items-end q-col-gutter-xs q-my-sm">
            <div
              v-for="h in backtestResult.hourlyStats"
              :key="h.hour"
              class="col text-center hourly-bar-col"
            >
              <div
                class="hourly-bar-fill rounded-borders"
                :style="{
                  height: h.total > 0 ? Math.max(14, (h.winRatePct / 100) * 80) + 'px' : '4px',
                  backgroundColor: h.total === 0 ? '#1e293b' : h.winRatePct >= 50 ? '#10b981' : '#ef4444'
                }"
                :title="`${h.label}: ${h.wins}W / ${h.losses}L (${h.winRatePct}%) Net: $${h.netProfit}`"
              />
              <div class="hour-label text-slate-400 font-mono q-mt-xs">
                {{ String(h.hour).padStart(2, '0') }}
              </div>
            </div>
          </div>
        </q-card>

        <!-- ── 4. COMPARATIVA POR SESIÓN & POR ÍNDICE ── -->
        <div class="row q-col-gutter-md q-mb-md">
          <!-- Sesiones -->
          <div class="col-12 col-md-5">
            <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
              <div class="text-subtitle2 text-weight-bold text-white q-mb-xs">
                Efectividad por Sesión (Mañana vs Tarde)
              </div>
              <div class="column q-gutter-xs q-mt-sm">
                <div
                  v-for="s in backtestResult.sessionStats"
                  :key="s.session"
                  class="q-pa-sm rounded-borders bg-slate-950 border-slate"
                >
                  <div class="row items-center justify-between">
                    <span class="text-caption text-weight-bold text-slate-300">{{ s.label }}</span>
                    <q-badge
                      :color="s.winRatePct >= 50 ? 'emerald-9' : s.total > 0 ? 'red-9' : 'slate-800'"
                      :text-color="s.winRatePct >= 50 ? 'emerald-2' : s.total > 0 ? 'red-2' : 'slate-400'"
                      class="text-weight-bold font-mono"
                    >
                      {{ s.winRatePct }}% Win Rate
                    </q-badge>
                  </div>
                  <div class="row items-center justify-between text-caption font-mono text-slate-400 q-mt-xs">
                    <span>Trades: <b>{{ s.total }}</b> (<span class="text-emerald-4">{{ s.wins }}W</span> - <span class="text-red-4">{{ s.losses }}L</span>)</span>
                    <span :class="s.netProfit >= 0 ? 'text-emerald-4 font-bold' : 'text-red-4 font-bold'">
                      {{ s.netProfit >= 0 ? '+' : '' }}${{ s.netProfit.toFixed(2) }}
                    </span>
                  </div>
                </div>
              </div>
            </q-card>
          </div>

          <!-- Índices -->
          <div class="col-12 col-md-7">
            <q-card flat class="bg-slate-900 border-slate q-pa-md h-full">
              <div class="text-subtitle2 text-weight-bold text-white q-mb-xs">
                Rendimiento por Índice Sintético
              </div>
              <div class="row q-col-gutter-xs q-mt-sm">
                <div
                  v-for="sym in backtestResult.symbolStats"
                  :key="sym.symbol"
                  class="col-12 col-sm-6"
                >
                  <div class="q-pa-sm rounded-borders bg-slate-950 border-slate">
                    <div class="row items-center justify-between">
                      <span class="text-caption text-weight-bolder text-white">{{ sym.mercado }}</span>
                      <q-badge
                        :color="sym.winRatePct >= 45 ? 'emerald-9' : sym.total > 0 ? 'red-9' : 'slate-800'"
                        class="text-weight-bold font-mono"
                      >
                        {{ sym.winRatePct }}%
                      </q-badge>
                    </div>
                    <div class="row items-center justify-between text-caption font-mono text-slate-400 q-mt-xs">
                      <span>{{ sym.wins }}W / {{ sym.losses }}L ({{ sym.total }}t)</span>
                      <span :class="sym.netProfit >= 0 ? 'text-emerald-4' : 'text-red-4'">
                        {{ sym.netProfit >= 0 ? '+' : '' }}${{ sym.netProfit.toFixed(2) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </q-card>
          </div>
        </div>

        <!-- ── 5. REGISTRO DE TRADES SIMULADOS ── -->
        <q-card flat class="bg-slate-900 border-slate q-pa-md">
          <div class="row items-center justify-between q-mb-sm">
            <div class="row items-center q-gutter-xs">
              <q-icon name="list_alt" color="sky-4" size="22px" />
              <span class="text-subtitle1 text-weight-bolder text-white">
                Operaciones Históricas Simuladas
              </span>
            </div>
            <div class="text-caption text-slate-400 font-mono">
              Total: <b>{{ backtestResult.trades.length }}</b>
            </div>
          </div>

          <q-table
            :rows="backtestResult.trades"
            :columns="backtestTradeColumns"
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
                  :label="props.row.result === 'WIN' ? '🟢 WIN' : '🔴 LOSS'"
                  class="text-weight-bold"
                />
              </q-td>
            </template>

            <template #body-cell-pnlUsd="props">
              <q-td :props="props" class="text-weight-bolder">
                <span :class="props.row.pnlUsd >= 0 ? 'text-emerald-4' : 'text-red-4'">
                  {{ props.row.pnlUsd >= 0 ? '+' : '' }}${{ props.row.pnlUsd.toFixed(2) }}
                </span>
              </q-td>
            </template>

            <template #body-cell-symbol="props">
              <q-td :props="props">
                <span class="text-weight-bold text-white">{{ props.row.mercado }}</span>
                <q-badge
                  :color="props.row.direction === 'COMPRA' ? 'teal-9' : 'purple-9'"
                  :label="props.row.direction"
                  class="q-ml-xs text-caption"
                />
              </q-td>
            </template>

            <template #body-cell-stars="props">
              <q-td :props="props">
                <span class="text-amber-5 text-weight-bold">
                  {{ '★'.repeat(props.row.stars) }}
                </span>
              </q-td>
            </template>

            <template #body-cell-exitReason="props">
              <q-td :props="props">
                <span class="text-caption text-slate-300">{{ formatExitReason(props.row.exitReason) }}</span>
              </q-td>
            </template>
          </q-table>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useQuasar } from 'quasar';
import { tradingService } from 'src/services/trading.service';
import { backtestService } from 'src/services/backtest.service';

const $q = useQuasar();

const activeTab = ref('live');

// ── Estado del Informe Diario y Rango de Fechas ──
const loading = ref(false);
const loadingToggle = ref(false);
const dateFilterMode = ref('TODAY');
const startDate = ref(new Date().toISOString().slice(0, 10));
const endDate = ref(new Date().toISOString().slice(0, 10));
const adaptiveEnabled = ref(true);

// ── Filtros y Detalle de Estrategias e Índices ──
const selectedStrategyFilter = ref('ALL');
const expandedSymbols = ref({});

const strategyTabs = [
  { label: 'Todas las Estrategias', value: 'ALL' },
  { label: 'Dos Velas con Mecha (M5)', value: 'DOUBLE_WICK_MECHA' },
  { label: 'Crash & Boom IA (Zonas)', value: 'CRASH_BOOM_IA' },
  { label: 'H1 Sin Mecha', value: 'H1_NO_WICK' },
  { label: 'Puntos Vigilados (Real)', value: 'WATCHED_LEVEL' },
  { label: 'Puntos Vigilados (Backtesting)', value: 'WATCHED_LEVEL_BT' },
  { label: 'Manuales', value: 'MANUAL_APP' },
];

const strategySymbolColumns = [
  { name: 'symbol', label: 'Índice Sintético', field: 'symbol', align: 'left' },
  { name: 'total', label: 'Total Entradas', field: 'total', align: 'center' },
  { name: 'wins', label: 'Buenas (Wins)', field: 'wins', align: 'center' },
  { name: 'losses', label: 'Malas (Losses)', field: 'losses', align: 'center' },
  { name: 'winRatePct', label: '% Efectividad', field: 'winRatePct', align: 'left' },
  { name: 'spikeRatePct', label: '% con Spike', field: 'spikeRatePct', align: 'center' },
  { name: 'netProfit', label: 'Beneficio Neto', field: 'netProfit', align: 'right' },
  { name: 'actions', label: 'Historial', field: 'actions', align: 'right' },
];

const filteredStrategies = computed(() => {
  if (!byStrategy.value || !byStrategy.value.length) return [];
  if (selectedStrategyFilter.value === 'ALL') {
    return byStrategy.value.filter(
      (s) => s.total > 0 || ['DOUBLE_WICK_MECHA', 'CRASH_BOOM_IA', 'H1_NO_WICK', 'WATCHED_LEVEL', 'WATCHED_LEVEL_BT'].includes(s.strategy),
    );
  }
  return byStrategy.value.filter((s) => s.strategy === selectedStrategyFilter.value);
});

const totalFilteredTrades = computed(() => {
  return filteredStrategies.value.reduce((acc, s) => acc + (s.total || 0), 0);
});

const reportPeriodLabel = computed(() => {
  if (startDate.value === endDate.value) {
    const today = new Date().toISOString().slice(0, 10);
    return startDate.value === today ? 'Hoy' : startDate.value;
  }
  return `${startDate.value}  ➔  ${endDate.value}`;
});

function isSymbolExpanded(stratKey, symKey) {
  return !!expandedSymbols.value[`${stratKey}_${symKey}`];
}

function toggleSymbolExpand(stratKey, symKey) {
  const k = `${stratKey}_${symKey}`;
  expandedSymbols.value[k] = !expandedSymbols.value[k];
}

function setDateFilter(mode) {
  dateFilterMode.value = mode;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  if (mode === 'TODAY') {
    startDate.value = todayStr;
    endDate.value = todayStr;
  } else if (mode === 'YESTERDAY') {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yestStr = yest.toISOString().slice(0, 10);
    startDate.value = yestStr;
    endDate.value = yestStr;
  } else if (mode === '3DAYS') {
    const d3 = new Date(now);
    d3.setDate(d3.getDate() - 2);
    startDate.value = d3.toISOString().slice(0, 10);
    endDate.value = todayStr;
  } else if (mode === '7DAYS') {
    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 6);
    startDate.value = d7.toISOString().slice(0, 10);
    endDate.value = todayStr;
  } else if (mode === 'MONTH') {
    const dMonth = new Date(now);
    dMonth.setDate(1);
    startDate.value = dMonth.toISOString().slice(0, 10);
    endDate.value = todayStr;
  }
  fetchReport();
}

function onCustomDateChange() {
  dateFilterMode.value = 'CUSTOM';
  if (startDate.value && endDate.value) {
    if (startDate.value > endDate.value) {
      endDate.value = startDate.value;
    }
    fetchReport();
  }
}

const summary = ref({
  totalTrades: 0,
  openTrades: 0,
  closedTrades: 0,
  wins: 0,
  losses: 0,
  breakevens: 0,
  winRatePct: 0,
  netProfit: 0,
  totalGain: 0,
  totalLoss: 0,
  profitFactor: 0,
  avgDurationMin: 0,
});

const bySession = ref([]);
const bySymbol = ref([]);
const byHour = ref([]);
const byStrategy = ref([]);
const trades = ref([]);
const adaptiveStatus = ref({ symbols: [] });

// ── Estado del Simulador Backtest ──
const backtestLoading = ref(false);
const backtestSymbol = ref('ALL');
const backtestDays = ref(7);
const backtestMinStars = ref(3);
const backtestOnlyViable = ref(true);
const backtestSymbolsList = ref([
  { symbol: 'ALL', label: 'Todos los Índices Activos' },
  { symbol: 'CRASH300N', label: 'Crash 300' },
  { symbol: 'CRASH500', label: 'Crash 500' },
  { symbol: 'CRASH600', label: 'Crash 600' },
  { symbol: 'CRASH900', label: 'Crash 900' },
  { symbol: 'CRASH1000', label: 'Crash 1000' },
  { symbol: 'BOOM300N', label: 'Boom 300' },
  { symbol: 'BOOM500', label: 'Boom 500' },
  { symbol: 'BOOM600', label: 'Boom 600' },
  { symbol: 'BOOM900', label: 'Boom 900' },
  { symbol: 'BOOM1000', label: 'Boom 1000' },
]);
const backtestResult = ref(null);

const tradeColumns = [
  { name: 'entryTimeFormatted', label: 'Hora Entrada', field: 'entryTimeFormatted', align: 'left' },
  { name: 'symbol', label: 'Índice', field: 'symbol', align: 'left' },
  { name: 'strategy', label: 'Estrategia', field: 'strategy', align: 'left' },
  { name: 'entryPrice', label: 'Entrada', field: 'entryPrice', align: 'right' },
  { name: 'exitPrice', label: 'Salida', field: 'exitPrice', align: 'right' },
  { name: 'result', label: 'Resultado', field: 'result', align: 'center' },
  { name: 'pnl', label: 'PnL (USD)', field: 'pnl', align: 'right' },
  { name: 'durationMin', label: 'Duración (min)', field: 'durationMin', align: 'center' },
  { name: 'exitReason', label: 'Motivo Cierre', field: 'exitReason', align: 'left' },
];

const backtestTradeColumns = [
  { name: 'entryDateStr', label: 'Hora Entrada', field: 'entryDateStr', align: 'left' },
  { name: 'symbol', label: 'Índice', field: 'symbol', align: 'left' },
  { name: 'direction', label: 'Lado', field: 'direction', align: 'center' },
  { name: 'stars', label: 'Estrellas', field: 'stars', align: 'center' },
  { name: 'entryPrice', label: 'Entrada', field: 'entryPrice', align: 'right' },
  { name: 'exitPrice', label: 'Salida', field: 'exitPrice', align: 'right' },
  { name: 'durationMin', label: 'Duración (m)', field: 'durationMin', align: 'center' },
  { name: 'result', label: 'Resultado', field: 'result', align: 'center' },
  { name: 'pnlUsd', label: 'PnL USD', field: 'pnlUsd', align: 'right' },
  { name: 'exitReason', label: 'Motivo Cierre', field: 'exitReason', align: 'left' },
];

async function fetchReport() {
  loading.value = true;
  try {
    const res = await tradingService.getDailyReport(startDate.value, endDate.value);
    if (res) {
      summary.value = res.summary || summary.value;
      bySession.value = res.bySession || [];
      bySymbol.value = res.bySymbol || [];
      byHour.value = res.byHour || [];
      byStrategy.value = res.byStrategy || [];
      trades.value = (res.trades || []).map((t) => {
        const dt = new Date(Number(t.entryTime) * 1000);
        return {
          ...t,
          entryTimeFormatted:
            dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) +
            ' ' +
            dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          pnl: Number(t.pnlUsd || t.pnlPoints || 0),
          durationMin: t.durationSec ? Math.round(t.durationSec / 60) : 0,
        };
      });
    }

    const adaptRes = await tradingService.getAdaptiveStatus();
    if (adaptRes) {
      adaptiveEnabled.value = adaptRes.enabled;
      adaptiveStatus.value = adaptRes;
    }
  } catch (err) {
    console.error('Error cargando informe diario:', err);
    $q.notify({
      type: 'negative',
      message: 'No se pudo cargar el informe de operaciones.',
    });
  } finally {
    loading.value = false;
  }
}

async function toggleAdaptiveFeedback(val) {
  loadingToggle.value = true;
  try {
    const res = await tradingService.toggleAdaptive(val);
    if (res && res.ok) {
      adaptiveEnabled.value = res.enabled;
      $q.notify({
        type: 'positive',
        message: `Motor de retroalimentación ${res.enabled ? 'activado' : 'pausado'}.`,
      });
    }
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: 'Error al cambiar estado de retroalimentación.',
    });
  } finally {
    loadingToggle.value = false;
  }
}

async function runBacktestSimulation() {
  backtestLoading.value = true;
  try {
    const res = await backtestService.runBacktest({
      symbol: backtestSymbol.value,
      days: backtestDays.value,
      minStars: backtestMinStars.value,
      onlyViable: backtestOnlyViable.value,
    });
    backtestResult.value = res;
    $q.notify({
      type: 'positive',
      message: `Simulación completada: ${res.totalTrades} operaciones (${res.winRatePct}% Win Rate)`,
    });
  } catch (err) {
    console.error('Error en backtest:', err);
    $q.notify({
      type: 'negative',
      message: 'Error al ejecutar la simulación de backtesting.',
    });
  } finally {
    backtestLoading.value = false;
  }
}

function getStatusBorderClass(status) {
  if (status === 'BLOQUEADO_HORA') return 'border-red';
  if (status === 'CIRCUIT_BREAKER') return 'border-amber';
  return 'border-emerald';
}

function getStatusBadgeColor(status) {
  if (status === 'BLOQUEADO_HORA') return 'red-9';
  if (status === 'CIRCUIT_BREAKER') return 'amber-9';
  return 'emerald-9';
}

function formatExitReason(reason) {
  if (!reason) return '—';
  if (reason.includes('TAKE_PROFIT')) return '🎯 Take Profit';
  if (reason.includes('SPIKE')) return '⚡ Spike Capturado';
  if (reason.includes('STOP_LOSS')) return '🛑 Stop Loss';
  if (reason.includes('TIMEOUT')) return '⏱️ Timeout tiempo límite';
  if (reason.includes('MT5')) return '📊 Sincronizado MT5';
  return reason;
}

onMounted(() => {
  fetchReport();
});
</script>

<style scoped>
.kpi-card {
  border-radius: 12px;
  transition: transform 0.2s, box-shadow 0.2s;
}
.kpi-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.5);
}

.border-slate {
  border: 1px solid #334155;
}
.border-emerald {
  border: 1px solid #059669;
}
.border-red {
  border: 1px solid #dc2626;
}
.border-amber {
  border: 1px solid #d97706;
}
.border-indigo {
  border: 1px solid #4f46e5;
}

.date-input {
  width: 155px;
}

.hourly-bar-container {
  height: 120px;
  padding-bottom: 4px;
}
.hourly-bar-col {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.hourly-bar-fill {
  width: 100%;
  min-height: 6px;
  transition: height 0.3s ease, background-color 0.3s ease;
}
.hourly-bar-fill:hover {
  filter: brightness(1.25);
}
.hour-label {
  font-size: 9px;
}

.symbol-status-box {
  border-radius: 8px;
  transition: border-color 0.2s;
}
</style>
