<template>
  <q-page class="q-pa-lg crash-ia-page">
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ── 1. ENCABEZADO DE LA ESTRATEGIA ───────────────────────────────── -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div class="page-header q-mb-lg row items-center justify-between flex-wrap q-gutter-y-sm">
      <div>
        <div class="row items-center q-gutter-sm">
          <div class="header-icon-box" :class="isBoom ? 'header-icon-box--boom' : 'header-icon-box--crash'">
            <q-icon name="candlestick_chart" size="26px" color="white" />
          </div>
          <div>
            <div class="row items-center q-gutter-xs">
              <h1 class="text-h5 text-weight-bolder text-slate-900 q-my-none">
                Estrategia Crash &amp; Boom IA · Zonas V y H1
              </h1>
              <q-badge
                :color="isBoom ? 'emerald-1' : 'indigo-1'"
                :text-color="isBoom ? 'emerald-9' : 'indigo-9'"
                :label="isBoom ? 'BOOM BUY ZONAS' : 'CRASH SELL ZONAS'"
                class="text-weight-bold"
              />
            </div>
            <div class="text-caption text-slate-500 q-mt-xs">
              Visualización de velas, demarcación institucional de zonas (Línea H1, V / Λ, Caja M5, SL y Order Blocks) y filtros en tiempo real.
            </div>
          </div>
        </div>
      </div>

      <!-- Controles de Temporalidad y Actualización -->
      <div class="row items-center q-gutter-sm">
        <span class="text-caption text-weight-bold text-slate-500">Temporalidad:</span>
        <q-btn-toggle
          v-model="selectedTimeframe"
          :toggle-color="isBoom ? 'emerald-7' : 'indigo-7'"
          flat
          dense
          :options="[
            { label: 'M1', value: 1 },
            { label: 'M5 (Estrategia)', value: 5 },
            { label: 'M15', value: 15 },
            { label: 'H1', value: 60 },
          ]"
          class="timeframe-toggle"
          @update:model-value="loadEvaluation"
        />

        <q-btn
          flat
          dense
          round
          :icon="alertsStore.soundEnabled ? 'volume_up' : 'volume_off'"
          :color="alertsStore.soundEnabled ? 'amber-8' : 'grey-5'"
          @click="alertsStore.testAudioAlert()"
        >
          <q-tooltip>🔊 Probar Alerta Sonora y Voz a Alto Volumen</q-tooltip>
        </q-btn>

        <q-btn
          :color="tradingStore.config.crashBoomAutoEnabled ? 'emerald-7' : 'grey-7'"
          :icon="tradingStore.config.crashBoomAutoEnabled ? 'smart_toy' : 'pause_circle'"
          :label="tradingStore.config.crashBoomAutoEnabled ? 'Bot Zonas: ON' : 'Bot Zonas: OFF'"
          unelevated
          class="text-weight-bold"
          @click="tradingStore.toggleStrategy('crashBoom')"
        >
          <q-tooltip>Activa o pausa la apertura automática de trades entre la línea morada y punteada</q-tooltip>
        </q-btn>

        <!-- Límite de Trades por Índice (Máximo 2) -->
        <q-chip
          dense
          size="md"
          :color="tradingStore.getTradesCountForSymbol(selectedSymbol) >= 2 ? 'deep-orange-9' : 'indigo-9'"
          text-color="white"
          class="text-weight-bolder font-mono shadow-1"
        >
          <q-icon name="pin" size="14px" class="q-mr-xs" />
          Trades hoy: {{ tradingStore.getTradesCountForSymbol(selectedSymbol) }} / 2
          <q-tooltip>Regla activa: Máximo 2 trades por índice</q-tooltip>
          <q-btn
            v-if="tradingStore.getTradesCountForSymbol(selectedSymbol) >= 2"
            flat
            round
            dense
            size="xs"
            icon="restart_alt"
            color="white"
            class="q-ml-xs"
            @click.stop="tradingStore.resetSymbolCount(selectedSymbol)"
          >
            <q-tooltip>Reiniciar límite para {{ selectedSymbol }}</q-tooltip>
          </q-btn>
        </q-chip>

        <!-- Sincronización en Tiempo Real con MetaTrader 5 -->
        <q-chip
          dense
          size="md"
          :color="tradingStore.mt5Status.connected ? 'teal-9' : 'grey-8'"
          text-color="white"
          class="text-weight-bolder font-mono shadow-1"
        >
          <q-icon :name="tradingStore.mt5Status.connected ? 'laptop_chromebook' : 'phonelink_off'" size="14px" class="q-mr-xs" />
          MT5: {{ tradingStore.mt5Status.connected ? `${tradingStore.mt5Status.positionsCount} en mercado` : 'Desconectado' }}
          <q-tooltip>
            {{ tradingStore.mt5Status.connected
              ? `MetaTrader 5 Sincronizado en tiempo real. ${tradingStore.mt5Status.positionsCount} posiciones abiertas en terminal.`
              : 'Esperando que MetaTrader 5 active el EA DerivApp_Bridge_EA' }}
          </q-tooltip>
        </q-chip>

        <q-btn
          unelevated
          :color="isBoom ? 'emerald-7' : 'indigo-7'"
          icon="refresh"
          label="Actualizar"
          :loading="loading"
          class="text-weight-bold"
          @click="loadEvaluation"
        />
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ── 2. SELECTOR DE FAMILIA (CRASH / BOOM) E ÍNDICES ───────────────── -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div class="market-family-bar row items-center justify-between q-mb-sm flex-wrap q-gutter-sm">
      <!-- Pestañas Crash vs Boom -->
      <q-btn-toggle
        v-model="marketTab"
        :toggle-color="marketTab === 'BOOM' ? 'emerald-8' : 'indigo-8'"
        flat
        dense
        :options="[
          { label: '🔴 Índices CRASH (Venta)', value: 'CRASH' },
          { label: '🟢 Índices BOOM (Compra)', value: 'BOOM' },
        ]"
        class="market-type-toggle text-weight-bolder"
        @update:model-value="onMarketTabChange"
      />

      <div class="text-caption text-slate-500 font-mono">
        Modo actual: <b :class="isBoom ? 'text-emerald-8' : 'text-indigo-8'">{{ isBoom ? 'COMPRAS (BUY)' : 'VENTAS (SELL)' }}</b>
      </div>
    </div>

    <!-- Botones de selección de índice según la familia activa -->
    <div class="index-nav-pills row items-center q-gutter-xs q-mb-md">
      <q-btn
        v-for="sym in activeSymbolsList"
        :key="sym.symbol"
        :flat="selectedSymbol !== sym.symbol"
        :unelevated="selectedSymbol === sym.symbol"
        :class="[
          'index-nav-btn text-weight-bold',
          selectedSymbol === sym.symbol
            ? (isBoom ? 'index-nav-btn--active-boom' : 'index-nav-btn--active-crash')
            : 'index-nav-btn--inactive'
        ]"
        dense
        @click="switchSymbol(sym.symbol)"
      >
        <span class="index-nav-title q-mr-xs">{{ sym.name }}</span>
        <q-badge
          :color="getStatusBadgeColor(summaryMap[sym.symbol]?.status)"
          :label="summaryMap[sym.symbol]?.statusLabel || 'Consultando...'"
          class="q-ml-xs text-weight-bold"
        />
      </q-btn>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ── 3. BANNER DE ESTADO Y OPORTUNIDAD EN ZONA ─────────────────────── -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div v-if="evaluation" class="q-mb-md">
      <!-- Oportunidad de COMPRA activa en Boom -->
      <div
        v-if="isBoom && evaluation.canBuy"
        class="alert-banner alert-banner--buy row items-center justify-between q-pa-md q-mb-sm"
      >
        <div class="row items-center q-gutter-md">
          <div class="alert-pulse-circle">
            <q-icon name="shopping_cart" size="28px" color="white" />
          </div>
          <div>
            <div class="text-subtitle1 text-weight-bolder text-white">
              🎯 ¡OPORTUNIDAD DE COMPRA CONFIRMADA EN {{ evaluation.mercado.toUpperCase() }}!
            </div>
            <div class="text-caption text-emerald-1">
              El precio está en la zona del 50% inferior / descuento ({{ formatNum(evaluation.currentPrice) }}). Tendencia M15 alcista y enfriamiento de velas rojas completado.
            </div>
          </div>
        </div>
        <div class="row items-center q-gutter-sm">
          <q-btn
            unelevated
            color="white"
            text-color="emerald-9"
            icon="rocket_launch"
            label="🚀 ENVIAR BUY A MT5"
            class="text-weight-bolder text-subtitle2 q-px-md shadow-2"
            :loading="isExecutingManualTrade"
            @click="sendOrderToMt5('BUY')"
          />
          <q-badge color="white" text-color="emerald-9" label="COMPRA INMEDIATA (BUY)" class="text-weight-bolder text-subtitle2 q-pa-sm" />
        </div>
      </div>

      <!-- Oportunidad de VENTA activa en Crash -->
      <div
        v-else-if="!isBoom && evaluation.canSell"
        class="alert-banner alert-banner--sell row items-center justify-between q-pa-md q-mb-sm"
      >
        <div class="row items-center q-gutter-md">
          <div class="alert-pulse-circle">
            <q-icon name="point_of_sale" size="28px" color="white" />
          </div>
          <div>
            <div class="text-subtitle1 text-weight-bolder text-white">
              🎯 ¡OPORTUNIDAD DE VENTA CONFIRMADA EN {{ evaluation.mercado.toUpperCase() }}!
            </div>
            <div class="text-caption text-emerald-1">
              El precio está en la zona del 50% superior ({{ formatNum(evaluation.currentPrice) }}). Tendencia M15 bajista y acumulación de velas verdes completada.
            </div>
          </div>
        </div>
        <div class="row items-center q-gutter-sm">
          <q-btn
            unelevated
            color="white"
            text-color="red-9"
            icon="rocket_launch"
            label="🚀 ENVIAR SELL A MT5"
            class="text-weight-bolder text-subtitle2 q-px-md shadow-2"
            :loading="isExecutingManualTrade"
            @click="sendOrderToMt5('SELL')"
          />
          <q-badge color="white" text-color="emerald-9" label="VENTA INMEDIATA (SELL)" class="text-weight-bolder text-subtitle2 q-pa-sm" />
        </div>
      </div>

      <!-- En zona pero esperando algún filtro o en retesteo -->
      <div
        v-else-if="evaluation.status === 'EN_ZONA_50' || evaluation.status === 'EN_BASE_CAJA' || evaluation.status === 'EN_RETESTEO'"
        class="alert-banner alert-banner--waiting row items-center justify-between q-pa-md q-mb-sm"
      >
        <div class="row items-center q-gutter-md">
          <q-icon :name="evaluation.status === 'EN_RETESTEO' ? 'motion_photos_paused' : 'hourglass_top'" size="28px" color="white" />
          <div>
            <div class="text-subtitle1 text-weight-bolder text-white">
              <span v-if="evaluation.status === 'EN_RETESTEO'">
                ⏳ {{ evaluation.mercado }}: En Zona de Retesteo / Consolidación Lateral M5
              </span>
              <span v-else>
                ⏳ {{ evaluation.mercado }} está dentro de la caja {{ isBoom ? 'Λ' : 'V' }}, pero esperando confirmación
              </span>
            </div>
            <div class="text-caption text-amber-1">
              <span v-if="evaluation.m5Viability && !evaluation.m5Viability.isViable">
                🔍 <b>TF M5:</b> {{ evaluation.m5Viability.reason }}
              </span>
              <span v-else>
                Estado: {{ evaluation.statusLabel }}. Verifica la lista de filtros en el panel lateral antes de ingresar.
              </span>
            </div>
          </div>
        </div>
        <div class="row items-center q-gutter-sm">
          <q-btn
            outline
            color="white"
            text-color="white"
            size="sm"
            icon="bolt"
            :label="isBoom ? 'Comprar en MT5' : 'Vender en MT5'"
            class="text-weight-bold"
            :loading="isExecutingManualTrade"
            @click="sendOrderToMt5(isBoom ? 'BUY' : 'SELL')"
          />
          <q-badge color="white" text-color="amber-9" label="EN SEGUIMIENTO" class="text-weight-bolder q-pa-xs" />
        </div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- ── 4. CUERPO PRINCIPAL: GRÁFICO + PANEL DE DIAGNÓSTICO ──────────── -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <div class="row q-col-gutter-lg q-mb-xl">
      <!-- Columna Izquierda: Gráfico Financiero de Velas y Zonas -->
      <div class="col-12 col-lg-8" style="position: relative;">
        <!-- AVISO DE LÍMITE DE TRADES ALCANZADO HOY PARA ESTE ÍNDICE -->
        <div
          v-if="tradingStore.getTradesCountForSymbol(selectedSymbol) >= 2 && !activeTradeForSelected"
          class="bg-amber-1 border-amber rounded-borders q-pa-sm q-mb-md row items-center justify-between"
        >
          <div class="row items-center q-gutter-xs text-caption text-amber-10 font-medium">
            <q-icon name="shield" color="amber-9" size="18px" />
            <span>
              <b>Límite diario alcanzado para {{ selectedSymbol }} ({{ tradingStore.getTradesCountForSymbol(selectedSymbol) }} / 2 trades hoy):</b>
              Nuevas órdenes pausadas en MT5 por gestión de riesgo.
            </span>
          </div>
          <q-btn
            unelevated
            dense
            size="sm"
            color="amber-9"
            text-color="white"
            icon="restart_alt"
            label="Reiniciar límite"
            class="text-weight-bold"
            @click="tradingStore.resetSymbolCount(selectedSymbol)"
          />
        </div>

        <!-- BANNER DE TRADE ACTIVO (BOT TRADING) -->
        <transition appear enter-active-class="animated fadeInDown" leave-active-class="animated fadeOutUp">
          <div
            v-if="activeTradeForSelected"
            class="q-pa-md q-mb-md rounded-borders text-white row items-center justify-between shadow-2"
            :style="{
              background: activeTradeForSelected.pnlPoints >= 0
                ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
                : 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)'
            }"
          >
            <div class="row items-center q-gutter-md">
              <q-avatar size="38px" color="white" :text-color="activeTradeForSelected.pnlPoints >= 0 ? 'emerald-9' : 'red-9'" icon="rocket_launch" />
              <div>
                <div class="row items-center q-gutter-xs">
                  <span class="text-subtitle2 text-weight-bolder">
                    TRADE EN CURSO: {{ activeTradeForSelected.mercado }} ({{ activeTradeForSelected.direction }})
                  </span>
                  <q-badge color="white" :text-color="activeTradeForSelected.pnlPoints >= 0 ? 'emerald-9' : 'red-9'" label="EN MERCADO" class="text-weight-bold" />
                  <q-badge v-if="activeTradeForSelected.maxProfitPoints > 0.5" color="amber-3" text-color="amber-10" label="🛡️ 70% PROTEGIDO" class="text-weight-bold" />
                </div>
                <div class="text-caption q-mt-xs font-mono">
                  Entrada: <b>{{ formatNum(activeTradeForSelected.entryPrice) }}</b> |
                  SL: <b>{{ activeTradeForSelected.stopLossPrice ? formatNum(activeTradeForSelected.stopLossPrice) : '10 min (10 velas M1)' }}</b> |
                  Actual: <b>{{ formatNum(activeTradeForSelected.currentPrice) }}</b>
                  <span v-if="activeTradeForSelected.maxProfitPoints > 0"> | Pico Máx: <b class="text-amber-3">+{{ formatNum(activeTradeForSelected.maxProfitPoints) }} pts</b></span>
                  <span v-if="activeTradeForSelected.maxProfitPoints >= 0.5"> | Piso 70%: <b class="text-green-3">+{{ formatNum(activeTradeForSelected.maxProfitPoints * 0.70) }} pts</b></span>
                </div>
              </div>
            </div>

            <div class="row items-center q-gutter-md">
              <div class="text-right">
                <div class="text-h6 text-weight-bolder font-mono" style="line-height: 1;">
                  {{ activeTradeForSelected.pnlPoints >= 0 ? '+' : '' }}{{ formatNum(activeTradeForSelected.pnlPoints) }} pts
                </div>
                <div class="text-caption text-weight-bold">
                  {{ activeTradeForSelected.pnlPercent >= 0 ? '+' : '' }}{{ activeTradeForSelected.pnlPercent }}%
                </div>
              </div>
              <q-btn
                unelevated
                color="white"
                :text-color="activeTradeForSelected.pnlPoints >= 0 ? 'emerald-9' : 'red-9'"
                label="Cerrar Trade"
                icon="close"
                size="sm"
                class="text-weight-bold"
                @click="tradingStore.closeTrade(activeTradeForSelected.id)"
              />
            </div>
          </div>
        </transition>

        <CrashIaChart
          ref="chartRef"
          :candles="currentEvaluation?.chartCandles || []"
          :symbol="selectedSymbol"
          :timeframe="selectedTimeframe"
          :market-type="currentEvaluation?.marketType || (isBoom ? 'BOOM' : 'CRASH')"
          :operation-type="currentEvaluation?.operationType || (isBoom ? 'BUY' : 'SELL')"
          :h1-price="currentEvaluation?.h1LinePrice || 0"
          :v-line-price="currentEvaluation?.vLinePrice || 0"
          :box-floor="currentEvaluation?.boxFloor || 0"
          :box-ceiling="currentEvaluation?.boxCeiling || 0"
          :entry-level50="currentEvaluation?.entryLevel50 || 0"
          :stop-loss-price="currentEvaluation?.stopLossPrice || 0"
          :h1-structural-price="currentEvaluation?.h1StructuralPrice || null"
          :ob-high="currentEvaluation?.activeOrderBlock?.high || 0"
          :ob-mid50="currentEvaluation?.activeOrderBlock?.mid50 || 0"
          :ob-low="currentEvaluation?.activeOrderBlock?.low || 0"
          :ob-status="currentEvaluation?.activeOrderBlock?.status || ''"
          :ob-epoch="currentEvaluation?.activeOrderBlock?.epoch || 0"
          :active-trade="activeTradeForSelected"
        />
        <q-inner-loading :showing="loading && !currentEvaluation" color="primary" label="Cargando velas..." />

        <!-- Resumen explicativo inferior -->
        <div class="bg-white rounded-borders q-pa-md border-slate q-mt-md">
          <div class="row items-center q-gutter-xs text-weight-bold text-slate-800 q-mb-xs">
            <q-icon name="info" :color="isBoom ? 'emerald-7' : 'indigo-7'" size="18px" />
            <span>Cómo interpreta la estrategia estas zonas en {{ isBoom ? 'BOOM (Compras)' : 'CRASH (Ventas)' }}:</span>
          </div>

          <div v-if="!isBoom" class="text-caption text-slate-600 q-gutter-y-xs">
            <div>• <b>Línea Azul (H1):</b> Cierre de la última hora completada. Define la base de referencia institucional.</div>
            <div>• <b>Línea Morada (Base V):</b> Piso de la vela roja del patrón V en M5 más cercano y por encima de la línea azul.</div>
            <div>• <b>Caja Morada (+3 velas M5):</b> Espacio estimado de subida del retroceso antes de caer el spike bajista.</div>
            <div>• <b>50% Superior (Línea Ámbar):</b> Zona con mejor relación riesgo/beneficio para vender.</div>
            <div>• <b>Stop Loss Rojo:</b> Situado a 1 vela M5 por encima de la caja (protegido por la regla NoSlInZone).</div>
            <div>• <b>Bearish Order Block (OB):</b> Última vela verde previa al spike de caída. Su 50% es el punto óptimo de reacción para VENTA.</div>
          </div>

          <div v-else class="text-caption text-slate-600 q-gutter-y-xs">
            <div>• <b>Línea Azul (H1):</b> Cierre de la última hora completada. Define el nivel institucional de soporte/resistencia.</div>
            <div>• <b>Línea Morada (Pico Λ):</b> Máximo de la vela verde del spike previo en M5 pegado bajo la línea azul.</div>
            <div>• <b>Caja Morada (-3 velas M5):</b> Proyección hacia abajo del retroceso lento de velas rojas antes del spike alcista.</div>
            <div>• <b>50% Inferior (Línea Verde):</b> Zona con descuento institucional óptimo para COMPRAR.</div>
            <div>• <b>Stop Loss Rojo:</b> Situado a 1 vela M5 por debajo de la caja (protegido por la regla NoSlInZone).</div>
            <div>• <b>Bullish Order Block (OB):</b> Última vela roja previa al spike de subida. Su 50% es el punto óptimo de entrada en COMPRA.</div>
          </div>
        </div>
      </div>

      <!-- Columna Derecha: Diagnóstico y Niveles Exactos -->
      <div class="col-12 col-lg-4" v-if="evaluation">
        <!-- ── TARJETA: PUNTOS ORDER BLOCK (OB) ─────────────────────────── -->
        <div class="bg-white rounded-borders q-pa-lg border-slate q-mb-md" v-if="evaluation.activeOrderBlock">
          <div class="row items-center justify-between q-mb-sm border-b-slate q-pb-sm">
            <div class="row items-center q-gutter-xs">
              <q-icon name="account_balance" :color="isBoom ? 'emerald-8' : 'amber-9'" size="20px" />
              <span class="text-subtitle1 text-weight-bolder text-slate-900">
                {{ isBoom ? 'Puntos Bullish OB (Compra)' : 'Puntos Bearish OB (Venta)' }}
              </span>
            </div>
            <q-badge
              :color="evaluation.activeOrderBlock.status === 'FRESCO' ? 'green-1' : evaluation.activeOrderBlock.status === 'EN_ZONA' ? 'amber-2' : 'grey-2'"
              :text-color="evaluation.activeOrderBlock.status === 'FRESCO' ? 'green-9' : evaluation.activeOrderBlock.status === 'EN_ZONA' ? 'amber-10' : 'grey-8'"
              :label="evaluation.activeOrderBlock.statusLabel"
              class="font-mono text-weight-bold"
            />
          </div>

          <div class="text-caption text-slate-500 q-mb-md">
            Última vela {{ isBoom ? 'bajista (roja)' : 'alcista (verde)' }} en {{ evaluation.activeOrderBlock.timeframe }} ({{ evaluation.activeOrderBlock.timeStr }}) previa al spike de <b>{{ evaluation.activeOrderBlock.drop }} pts</b>.
          </div>

          <!-- Los 3 Puntos Clave del Order Block -->
          <div class="q-gutter-y-sm">
            <!-- 1. OB 50% (Punto Institucional Óptimo) -->
            <div class="ob-point-box q-pa-sm rounded-borders row items-center justify-between"
                 :class="isBoom ? 'bg-emerald-50 border-emerald' : 'bg-amber-50 border-amber'">
              <div>
                <div class="text-caption text-weight-bolder" :class="isBoom ? 'text-emerald-10' : 'text-amber-10'">
                  🎯 OB 50% ({{ isBoom ? 'Gatillo BUY' : 'Gatillo SELL' }})
                </div>
                <div class="text-caption text-slate-500" style="font-size: 10px;">Mean Threshold / Nivel de Reacción</div>
              </div>
              <span class="font-mono text-weight-bolder text-subtitle1" :class="isBoom ? 'text-emerald-10' : 'text-amber-10'">
                {{ formatNum(evaluation.activeOrderBlock.mid50) }}
              </span>
            </div>

            <!-- 2. Entrada a la zona -->
            <div class="level-row row items-center justify-between q-pa-xs rounded-borders"
                 :class="isBoom ? 'bg-emerald-50' : 'bg-orange-50'">
              <span class="level-label text-weight-bold" :class="isBoom ? 'text-emerald-9' : 'text-orange-9'">
                {{ isBoom ? '🟢 OB Techo (Entrada Zona):' : '🟡 OB Base (Inicio Zona):' }}
              </span>
              <span class="level-value font-mono text-weight-bolder" :class="isBoom ? 'text-emerald-9' : 'text-orange-9'">
                {{ formatNum(isBoom ? evaluation.activeOrderBlock.high : evaluation.activeOrderBlock.low) }}
              </span>
            </div>

            <!-- 3. Invalidación / Stop Loss del OB -->
            <div class="level-row row items-center justify-between bg-deep-orange-50 q-pa-xs rounded-borders">
              <span class="level-label text-deep-orange-9 text-weight-bold">
                {{ isBoom ? '🔴 OB Base (Invalidación / SL):' : '🔴 OB Techo (Invalidación / SL):' }}
              </span>
              <span class="level-value font-mono text-weight-bolder text-deep-orange-9">
                {{ formatNum(isBoom ? evaluation.activeOrderBlock.low : evaluation.activeOrderBlock.high) }}
              </span>
            </div>

            <!-- Diagnóstico de distancia respecto al precio actual -->
            <div class="q-mt-sm q-pa-xs rounded-borders text-caption text-center font-mono"
                 :class="evaluation.activeOrderBlock.inZone ? 'bg-green-1 text-green-9 text-weight-bold' : 'bg-slate-50 text-slate-600'">
              <span v-if="evaluation.activeOrderBlock.inZone">
                ⚡ ¡El precio actual está DENTRO de la zona del Order Block!
              </span>
              <span v-else-if="evaluation.activeOrderBlock.distToPrice > 0">
                Distancia al OB 50%: <b>{{ formatNum(evaluation.activeOrderBlock.distToPrice) }} pts</b> {{ isBoom ? 'por encima (esperando caída)' : 'por debajo' }}
              </span>
              <span v-else>
                Precio superó el 50% por <b>{{ formatNum(Math.abs(evaluation.activeOrderBlock.distToPrice)) }} pts</b>
              </span>
            </div>

            <!-- Botón para enfocar la vela del Order Block -->
            <q-btn
              unelevated
              :color="isBoom ? 'emerald-8' : 'amber-9'"
              text-color="white"
              icon="my_location"
              label="🎯 Enfocar Vela OB en Gráfico"
              class="full-width q-mt-sm text-weight-bolder"
              @click="focusObCandle()"
            >
              <q-tooltip>Llevar la vista del gráfico directamente a la vela del Order Block con zoom</q-tooltip>
            </q-btn>
          </div>

          <!-- Historial de Order Blocks Recientes -->
          <div v-if="evaluation.recentOrderBlocks && evaluation.recentOrderBlocks.length > 1" class="q-mt-md border-t-slate q-pt-sm">
            <div class="text-caption text-weight-bold text-slate-700 q-mb-xs">Bloques detectados hoy (clic para enfocar):</div>
            <div class="recent-ob-list q-gutter-y-xs">
              <div
                v-for="(ob, idx) in evaluation.recentOrderBlocks.slice(0, 4)"
                :key="idx"
                class="row items-center justify-between text-caption font-mono q-py-xs border-b-slate-light cursor-pointer hover-bg-slate"
                @click="focusObCandle(ob.epoch)"
              >
                <div class="row items-center q-gutter-xs">
                  <q-icon name="gps_fixed" size="14px" :color="isBoom ? 'emerald-7' : 'amber-8'" />
                  <span class="text-slate-600">{{ ob.timeStr }} (M5)</span>
                </div>
                <span class="text-weight-bold">{{ formatNum(ob.mid50) }}</span>
                <q-badge
                  size="xs"
                  :color="ob.status === 'FRESCO' ? 'green-1' : ob.status === 'EN_ZONA' ? 'amber-2' : ob.status === 'MITIGADO' ? 'blue-1' : 'grey-2'"
                  :text-color="ob.status === 'FRESCO' ? 'green-9' : ob.status === 'EN_ZONA' ? 'amber-10' : ob.status === 'MITIGADO' ? 'blue-9' : 'grey-7'"
                  :label="ob.status"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- ── TARJETA: NIVELES EXACTOS DE OPERACIÓN ─────────────────────── -->
        <div class="bg-white rounded-borders q-pa-lg border-slate q-mb-md">
          <div class="row items-center justify-between q-mb-md border-b-slate q-pb-sm">
            <div class="row items-center q-gutter-xs">
              <q-icon name="tune" :color="isBoom ? 'emerald-7' : 'indigo-7'" size="20px" />
              <span class="text-subtitle1 text-weight-bolder text-slate-900">Niveles de Operación</span>
            </div>
            <q-badge :color="isBoom ? 'emerald-1' : 'indigo-1'" :text-color="isBoom ? 'emerald-9' : 'indigo-9'" :label="evaluation.symbol" class="font-mono text-weight-bold" />
          </div>

          <!-- Grid de precios -->
          <div class="levels-list q-gutter-y-sm">
            <div class="level-row row items-center justify-between">
              <span class="level-label text-slate-600 font-medium">Precio Actual:</span>
              <span class="level-value font-mono text-weight-bolder text-slate-900 text-subtitle2">
                {{ formatNum(evaluation.currentPrice) }}
              </span>
            </div>

            <!-- Entrada 50% -->
            <div class="level-row row items-center justify-between q-pa-xs rounded-borders"
                 :class="isBoom ? 'bg-emerald-50' : 'bg-amber-50'">
              <span class="level-label text-weight-bold" :class="isBoom ? 'text-emerald-9' : 'text-amber-9'">
                {{ isBoom ? '🟢 Entrada 50% (BUY):' : '🟡 Entrada 50% (SELL):' }}
              </span>
              <span class="level-value font-mono text-weight-bolder text-subtitle2" :class="isBoom ? 'text-emerald-9' : 'text-amber-9'">
                {{ formatNum(evaluation.entryLevel50) }}
              </span>
            </div>

            <!-- Stop Loss -->
            <div class="level-row row items-center justify-between bg-red-50 q-pa-xs rounded-borders">
              <div class="row items-center">
                <span class="level-label text-red-9 text-weight-bold">
                  {{ isBoom ? '🔴 Stop Loss (Soporte):' : '🔴 Stop Loss (Resistencia):' }}
                </span>
                <span v-if="evaluation.stopLossPrice && evaluation.currentPrice" class="text-caption text-red-7 font-mono q-ml-xs text-weight-bolder">
                  ({{ Math.abs(evaluation.stopLossPrice - evaluation.currentPrice).toFixed(1) }} pts)
                </span>
              </div>
              <span class="level-value font-mono text-weight-bolder text-red-9 text-subtitle2">
                {{ formatNum(evaluation.stopLossPrice) }}
              </span>
            </div>

            <!-- Lotaje de Operativa -->
            <div class="level-row row items-center justify-between bg-indigo-50 q-pa-xs rounded-borders">
              <span class="level-label text-indigo-9 text-weight-bold">
                🎯 Lotaje Asignado:
              </span>
              <span class="level-value font-mono text-weight-bolder text-indigo-9 text-subtitle2">
                {{ getLotSizeForSymbol(selectedSymbol) }} Lote
              </span>
            </div>

            <!-- Límite de la Caja -->
            <div class="level-row row items-center justify-between">
              <span class="level-label text-slate-500">
                {{ isBoom ? 'Piso Caja (-3v M5):' : 'Techo Caja (+3v M5):' }}
              </span>
              <span class="level-value font-mono text-purple-7 text-weight-bold">
                {{ formatNum(isBoom ? evaluation.boxFloor : evaluation.boxCeiling) }}
              </span>
            </div>

            <!-- Nivel V / Lambda -->
            <div class="level-row row items-center justify-between">
              <span class="level-label text-slate-500">
                {{ isBoom ? 'Pico Línea Λ (Morada):' : 'Base Línea V (Morada):' }}
              </span>
              <span class="level-value font-mono text-purple-9 text-weight-bold">
                {{ formatNum(evaluation.vLinePrice) }}
              </span>
            </div>

            <!-- Cierre H1 -->
            <div class="level-row row items-center justify-between">
              <span class="level-label text-slate-500">Línea Cierre H1 (Azul):</span>
              <span class="level-value font-mono text-blue-8 text-weight-bold">
                {{ formatNum(evaluation.h1LinePrice) }}
              </span>
            </div>

            <!-- Nivel Estructural -->
            <div class="level-row row items-center justify-between" v-if="evaluation.h1StructuralPrice">
              <span class="level-label text-slate-500">
                {{ isBoom ? 'Soporte Estructural H1:' : 'Resistencia Estructural H1:' }}
              </span>
              <span class="level-value font-mono text-cyan-8 text-weight-bold">
                {{ formatNum(evaluation.h1StructuralPrice) }}
              </span>
            </div>

            <div class="level-row row items-center justify-between text-caption text-slate-400">
              <span>Altura mediana vela M5:</span>
              <span class="font-mono">{{ formatNum(evaluation.m5CandleHeight) }} pts</span>
            </div>
          </div>
        </div>

        <!-- ── TARJETA: CHECKLIST DE FILTROS DE ENTRADA ──────────────────── -->
        <div class="bg-white rounded-borders q-pa-lg border-slate">
          <div class="row items-center justify-between q-mb-md border-b-slate q-pb-sm">
            <div class="row items-center q-gutter-xs">
              <q-icon name="verified_user" :color="isBoom ? 'emerald-7' : 'indigo-7'" size="20px" />
              <span class="text-subtitle1 text-weight-bolder text-slate-900">Checklist de Filtros</span>
            </div>
          </div>

          <div class="checklist-items q-gutter-y-md">
            <!-- Filtro 1: Tendencia Macro M15 -->
            <div class="checklist-item row items-center justify-between">
              <div>
                <div class="text-caption text-weight-bold text-slate-800">1. Tendencia Macro (EMA 50 en M15)</div>
                <div class="text-caption text-slate-500">
                  {{ isBoom ? 'Precio >= EMA 50' : 'Precio <= EMA 50' }} ({{ formatNum(evaluation.filters.ema50_M15) }})
                </div>
              </div>
              <q-badge
                :color="evaluation.filters.trendOk ? 'green-1' : 'red-1'"
                :text-color="evaluation.filters.trendOk ? 'green-9' : 'red-9'"
                :label="evaluation.filters.trendOk ? (isBoom ? 'ALCISTA ✅' : 'BAJISTA ✅') : (isBoom ? 'BAJISTA ❌' : 'ALCISTA ❌')"
                class="text-weight-bold"
              />
            </div>

            <!-- Filtro 2: RSI 14 M5 -->
            <div class="checklist-item row items-center justify-between">
              <div>
                <div class="text-caption text-weight-bold text-slate-800">
                  {{ isBoom ? '2. Sobreventa RSI 14 (M5)' : '2. Sobrecompra RSI 14 (M5)' }}
                </div>
                <div class="text-caption text-slate-500">
                  RSI actual: {{ evaluation.filters.rsi_M5 }} ({{ isBoom ? 'Máximo: 35.0' : 'Mínimo: 65.0' }})
                </div>
              </div>
              <q-badge
                :color="evaluation.filters.rsiOk ? 'green-1' : 'grey-2'"
                :text-color="evaluation.filters.rsiOk ? 'green-9' : 'grey-8'"
                :label="evaluation.filters.rsiOk ? (isBoom ? 'SOBREVENTA ✅' : 'SOBRECOMPRA ✅') : 'NORMAL ⏳'"
                class="text-weight-bold"
              />
            </div>

            <!-- Filtro 3: Enfriamiento tras Spike -->
            <div class="checklist-item row items-center justify-between">
              <div>
                <div class="text-caption text-weight-bold text-slate-800">3. Enfriamiento M1 tras Spike</div>
                <div class="text-caption text-slate-500">
                  {{ isBoom ? `Velas rojas: ${evaluation.filters.consecutiveRedM1}` : `Velas verdes: ${evaluation.filters.consecutiveGreenM1}` }} de {{ evaluation.filters.minGreenRequired }} mín.
                </div>
              </div>
              <q-badge
                :color="evaluation.filters.greenOk ? 'green-1' : 'amber-1'"
                :text-color="evaluation.filters.greenOk ? 'green-9' : 'amber-9'"
                :label="evaluation.filters.greenOk ? `${isBoom ? evaluation.filters.consecutiveRedM1 : evaluation.filters.consecutiveGreenM1}v ✅` : 'ENFRIAMIENTO ⏳'"
                class="text-weight-bold"
              />
            </div>

            <!-- Filtro 4: Vela Amiga H1 -->
            <div class="checklist-item row items-center justify-between">
              <div>
                <div class="text-caption text-weight-bold text-slate-800">4. Filtro Vela Amiga H1</div>
                <div class="text-caption text-slate-500">{{ evaluation.filters.velaAmigaMsg }}</div>
              </div>
              <q-badge
                :color="evaluation.filters.velaAmigaOk ? 'green-1' : 'red-1'"
                :text-color="evaluation.filters.velaAmigaOk ? 'green-9' : 'red-9'"
                :label="evaluation.filters.velaAmigaOk ? 'APROBADA ✅' : 'BLOQUEADA ❌'"
                class="text-weight-bold"
              />
            </div>

            <!-- Filtro 5: Validación Estricta en TF M5 -->
            <div class="checklist-item row items-center justify-between border-t-slate q-pt-sm" v-if="evaluation.m5Viability">
              <div>
                <div class="text-caption text-weight-bold text-slate-800">5. Viabilidad en TF M5 (Order Block / Soporte)</div>
                <div class="text-caption text-slate-500">
                  {{ evaluation.m5Viability.reason }}
                </div>
              </div>
              <q-badge
                :color="evaluation.m5Viability.isViable ? 'green-1' : 'amber-1'"
                :text-color="evaluation.m5Viability.isViable ? 'green-9' : 'amber-9'"
                :label="evaluation.m5Viability.isViable ? 'M5 CONFIRMADO ✅' : 'ESPERANDO M5 ⏳'"
                class="text-weight-bold"
              />
            </div>

            <!-- Regla NoSlInZone -->
            <div class="checklist-item row items-center justify-between border-t-slate q-pt-sm">
              <div>
                <div class="text-caption text-weight-bold text-slate-800">Protección NoSlInZone</div>
                <div class="text-caption text-slate-500">No cerrar mientras esté dentro de la zona</div>
              </div>
              <q-badge :color="isBoom ? 'emerald-1' : 'indigo-1'" :text-color="isBoom ? 'emerald-9' : 'indigo-9'" label="ACTIVO 🛡️" class="text-weight-bold" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { Notify } from 'quasar';
import { crashIaStrategyService } from 'src/services/crashIaStrategy.service';
import { useAlertsStore } from 'stores/alerts.store';
import { useTradingStore } from 'stores/trading.store';
import CrashIaChart from 'src/components/CrashIaChart.vue';

const isExecutingManualTrade = ref(false);

async function sendOrderToMt5(dir) {
  if (isExecutingManualTrade.value) return;
  isExecutingManualTrade.value = true;
  try {
    const sl = evaluation.value?.stopLossPrice || 0;
    await tradingStore.executeTrade({
      symbol: selectedSymbol.value,
      direction: dir,
      stopLossPrice: sl,
    });
    Notify.create({
      type: 'positive',
      position: 'top',
      icon: 'rocket_launch',
      message: `¡Orden ${dir} enviada a MetaTrader 5 para ${selectedSymbol.value}!`,
      caption: `SL enviado: ${sl ? sl : 'Mercado Directo'}. Monitoreando posición en MT5.`,
    });
    await loadEvaluation();
  } catch (err) {
    Notify.create({
      type: 'negative',
      position: 'top',
      icon: 'warning',
      message: `Error al enviar orden a MT5: ${err?.message || err}`,
    });
  } finally {
    isExecutingManualTrade.value = false;
  }
}

const route = useRoute();
const alertsStore = useAlertsStore();
const tradingStore = useTradingStore();

const crashSymbols = [
  { symbol: 'CRASH300N', name: 'Crash 300' },
  { symbol: 'CRASH500',  name: 'Crash 500' },
  { symbol: 'CRASH600',  name: 'Crash 600' },
  { symbol: 'CRASH900',  name: 'Crash 900' },
  { symbol: 'CRASH1000', name: 'Crash 1000' },
];

const boomSymbols = [
  { symbol: 'BOOM300N', name: 'Boom 300' },
  { symbol: 'BOOM500',  name: 'Boom 500' },
  { symbol: 'BOOM600',  name: 'Boom 600' },
  { symbol: 'BOOM900',  name: 'Boom 900' },
  { symbol: 'BOOM1000', name: 'Boom 1000' },
];

const initialSym = route.query.symbol ? route.query.symbol.toUpperCase() : 'CRASH1000';
const marketTab         = ref(initialSym.startsWith('BOOM') ? 'BOOM' : 'CRASH');
const chartRef          = ref(null);
const selectedSymbol    = ref(initialSym);
const selectedTimeframe = ref(5); // 5 min por defecto (estrategia)
const loading           = ref(false);
const evaluation        = ref(null);
const summaryMap        = ref({});
let refreshTimer        = null;

const currentEvaluation = computed(() => {
  if (evaluation.value && evaluation.value.symbol === selectedSymbol.value) {
    return evaluation.value;
  }
  return null;
});

const activeTradeForSelected = computed(() => {
  const norm = (str) =>
    (str || '').toUpperCase().replace(/\s+/g, '').replace('INDEX', '').replace(/N$/, '');
  const selNorm = norm(selectedSymbol.value);

  const localTrade = (tradingStore.activeTrades || []).find(
    (t) => norm(t.symbol) === selNorm && t.status === 'OPEN',
  );
  if (localTrade) return localTrade;

  // Si MetaTrader 5 tiene una posición abierta real en este símbolo, reflejarla
  if (tradingStore.mt5Status?.positions?.length) {
    const mt5Pos = tradingStore.mt5Status.positions.find((p) => norm(p.symbol) === selNorm);
    if (mt5Pos) {
      return {
        id: `mt5_${mt5Pos.ticket}`,
        symbol: selectedSymbol.value,
        mercado: selectedSymbol.value,
        direction: mt5Pos.type,
        entryPrice: mt5Pos.openPrice,
        currentPrice: mt5Pos.currentPrice,
        stopLossPrice: mt5Pos.sl,
        takeProfitPrice: mt5Pos.tp,
        pnlPoints: mt5Pos.profit,
        pnlPercent: Number(
          ((mt5Pos.profit / (mt5Pos.openPrice * (mt5Pos.volume || 0.2))) * 100).toFixed(2),
        ),
        maxProfitPoints: mt5Pos.profit > 0 ? mt5Pos.profit : 0,
        mt5Ticket: String(mt5Pos.ticket),
      };
    }
  }

  return null;
});

const isBoom = computed(() => {
  return currentEvaluation.value?.marketType === 'BOOM' ||
    evaluation.value?.marketType === 'BOOM' ||
    evaluation.value?.operationType === 'BUY' ||
    selectedSymbol.value.startsWith('BOOM');
});

const activeSymbolsList = computed(() => {
  return marketTab.value === 'BOOM' ? boomSymbols : crashSymbols;
});

function onMarketTabChange(newTab) {
  if (newTab === 'BOOM') {
    if (!selectedSymbol.value.startsWith('BOOM')) {
      selectedSymbol.value = 'BOOM1000';
    }
  } else {
    if (!selectedSymbol.value.startsWith('CRASH')) {
      selectedSymbol.value = 'CRASH1000';
    }
  }
  loadEvaluation();
}

function focusObCandle(epoch = null) {
  chartRef.value?.goToObCandle(epoch);
}

function getLotSizeForSymbol(sym) {
  const s = (sym || '').toUpperCase().replace(/\s+/g, '');
  if (
    s.includes('CRASH600') ||
    s.includes('C6') ||
    s.includes('BOOM600') ||
    s.includes('B6') ||
    s.includes('600')
  ) {
    return '0.50';
  }
  if (s.includes('CRASH900') || s.includes('C9')) {
    return '0.50';
  }
  return '1.00';
}

function formatNum(val) {
  if (!val && val !== 0) return '—';
  return Number(val).toFixed(2);
}

function getStatusBadgeColor(status) {
  switch (status) {
    case 'EN_ZONA_50': return 'emerald-7';
    case 'EN_BASE_CAJA': return 'amber-8';
    case 'EN_RETESTEO': return 'amber-9';
    case 'EN_MARGEN_SL': return 'orange-8';
    case 'SL_SUPERADO': return 'red-7';
    default: return 'grey-6';
  }
}

async function loadSummary() {
  try {
    const list = await crashIaStrategyService.getSummary();
    const map = {};
    for (const item of list) {
      map[item.symbol] = item;
    }
    summaryMap.value = map;
  } catch (err) {
    console.error('Error al cargar resumen Crash/Boom IA:', err);
  }
}

async function loadEvaluation() {
  loading.value = true;
  try {
    const data = await crashIaStrategyService.evaluate(selectedSymbol.value, selectedTimeframe.value);
    evaluation.value = data;
    if (data?.marketType) {
      marketTab.value = data.marketType;
    }
    if (data) {
      alertsStore.checkSingleEvaluation(data);
    }
    loadSummary();
  } catch (err) {
    console.error('Error al evaluar símbolo Crash/Boom IA:', err);
  } finally {
    loading.value = false;
  }
}

function switchSymbol(sym) {
  selectedSymbol.value = sym;
  marketTab.value = sym.startsWith('BOOM') ? 'BOOM' : 'CRASH';
  loadEvaluation();
}

watch(
  () => route.query.symbol,
  (newSym) => {
    if (newSym) {
      selectedSymbol.value = newSym.toUpperCase();
      marketTab.value = selectedSymbol.value.startsWith('BOOM') ? 'BOOM' : 'CRASH';
      loadEvaluation();
    }
  }
);

onMounted(() => {
  loadEvaluation();
  refreshTimer = setInterval(() => {
    loadEvaluation();
  }, 15_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.crash-ia-page {
  background: #f8fafc;
  min-height: 100vh;
}

.header-icon-box {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-icon-box--crash {
  background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
}

.header-icon-box--boom {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25);
}

.market-type-toggle {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.border-slate {
  border: 1px solid #e2e8f0;
}

.border-b-slate {
  border-bottom: 1px solid #f1f5f9;
}

.border-t-slate {
  border-top: 1px solid #f1f5f9;
}

.index-nav-btn {
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.index-nav-btn--inactive {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
}
.index-nav-btn--inactive .index-nav-title {
  color: #0f172a !important;
  font-weight: 800 !important;
}
.index-nav-btn--inactive:hover {
  background: #f8fafc !important;
  border-color: #94a3b8 !important;
}

.index-nav-btn--active-boom {
  background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
  border: 1px solid #047857 !important;
  box-shadow: 0 4px 12px rgba(5, 150, 105, 0.35) !important;
}
.index-nav-btn--active-boom .index-nav-title {
  color: #ffffff !important;
  font-weight: 900 !important;
  letter-spacing: 0.3px;
}

.index-nav-btn--active-crash {
  background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%) !important;
  border: 1px solid #4338ca !important;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35) !important;
}
.index-nav-btn--active-crash .index-nav-title {
  color: #ffffff !important;
  font-weight: 900 !important;
  letter-spacing: 0.3px;
}

.timeframe-toggle {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.alert-banner {
  border-radius: 12px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}

.alert-banner--sell {
  background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
  border: 1px solid #6366f1;
}

.alert-banner--buy {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  border: 1px solid #10b981;
}

.alert-banner--waiting {
  background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  border: 1px solid #f59e0b;
}

.alert-pulse-circle {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.level-row {
  padding: 6px 0;
  border-bottom: 1px solid #f8fafc;
}

.checklist-item {
  padding: 4px 0;
}

.ob-point-box {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.border-amber {
  border: 1px solid #fde68a;
}

.border-emerald {
  border: 1px solid #a7f3d0;
}

.border-b-slate-light {
  border-bottom: 1px solid #f8fafc;
}

.hover-bg-slate {
  transition: background-color 0.15s ease;
  border-radius: 4px;
  padding: 3px 6px;
}
.hover-bg-slate:hover {
  background-color: #f1f5f9;
}
</style>
