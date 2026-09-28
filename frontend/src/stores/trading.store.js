import { defineStore } from 'pinia';
import { Notify } from 'quasar';
import { tradingService } from 'src/services/trading.service';
import { useAlertsStore } from 'src/stores/alerts.store';

export const useTradingStore = defineStore('trading', {
  state: () => ({
    activeTrades: [],
    tradeHistory: [],
    executedTradesLog: [],
    knownTradeIds: new Set(),
    hasInitialLoad: false,
    config: {
      h1AutoEnabled: true,
      crashBoomAutoEnabled: true,
      m5PlusAutoEnabled: false,
      m5XAutoEnabled: true,
      maxOpenTrades: 6,
      maxTradesPerSymbol: 2,
      tradesCountPerSymbol: {},
    },
    mt5Status: {
      connected: false,
      positionsCount: 0,
      positions: [],
      lastSyncAt: 0,
    },
    pollingTimer: null,
    isPolling: false,
  }),

  getters: {
    tradeCount: (state) => state.activeTrades.length,

    getTradeForSymbol: (state) => (symbol) => {
      if (!symbol) return null;
      return state.activeTrades.find((t) => t.symbol === symbol && t.status === 'OPEN') || null;
    },

    h1Trades: (state) =>
      state.activeTrades.filter((t) => t.strategy === 'H1_NO_WICK' && t.status === 'OPEN'),

    crashBoomTrades: (state) =>
      state.activeTrades.filter((t) => t.strategy === 'CRASH_BOOM_IA' && t.status === 'OPEN'),

    getTradesCountForSymbol: (state) => (symbol) => {
      if (!symbol) return 0;
      return state.config.tradesCountPerSymbol?.[symbol] || 0;
    },
  },

  actions: {
    async fetchActiveTrades() {
      try {
        const list = await tradingService.getActiveTrades();
        if (Array.isArray(list)) {
          this.activeTrades = list;

          const alertsStore = useAlertsStore();

          if (!this.hasInitialLoad) {
            // Registrar los IDs iniciales para no disparar toasts repetidos al recargar
            for (const t of list) {
              this.knownTradeIds.add(t.id);
            }
            this.hasInitialLoad = true;
          } else {
            // Detectar trades NUEVOS recién ejecutados por el bot
            for (const t of list) {
              if (!this.knownTradeIds.has(t.id)) {
                this.knownTradeIds.add(t.id);
                this.executedTradesLog.unshift({
                  ...t,
                  detectedAt: new Date().toLocaleTimeString(),
                });

                // 1. Notificar en Campanita + Alerta Sonora + Voz en Alto Volumen
                alertsStore.notifyTradeExecuted(t);

                // 2. Banner Flotante Emergente (Quasar Toast)
                const isBuy = t.direction === 'BUY';
                Notify.create({
                  type: 'positive',
                  position: 'top-right',
                  timeout: 10000,
                  progress: true,
                  icon: 'rocket_launch',
                  color: isBuy ? 'emerald-8' : 'indigo-8',
                  message: `🚀 ¡TRADE EJECUTADO EN ${t.mercado || t.symbol}!`,
                  caption: `${isBuy ? '🟢 COMPRA (BUY)' : '🔴 VENTA (SELL)'} @ ${t.entryPrice} | SL: ${t.stopLossPrice || 'Protegido'} | TP: ${t.takeProfitPrice || 'Estructural'}`,
                  actions: [
                    {
                      label: 'VER EN GRÁFICO',
                      color: 'white',
                      noDismiss: false,
                      handler: () => {
                        const path = t.strategy === 'H1_NO_WICK'
                          ? '/h1-strategy'
                          : t.strategy === 'M5_PLUS'
                            ? '/m5plus-strategy'
                            : t.strategy === 'M5_X'
                              ? '/m5x-strategy'
                              : '/crash-ia';
                        window.location.hash = `#${path}?symbol=${t.symbol}`;
                      },
                    },
                  ],
                });
              }
            }
          }
        }
      } catch (e) {
        // Silencioso
      }
    },

    async fetchConfig() {
      try {
        const conf = await tradingService.getConfig();
        if (conf) {
          this.config = {
            ...this.config,
            ...conf,
          };
        }
      } catch (e) {}
    },

    async toggleStrategy(strategy) {
      try {
        const conf = await tradingService.toggleConfig(strategy);
        if (conf) {
          this.config = {
            ...this.config,
            ...conf,
          };
        }
      } catch (e) {
        console.error('Error toggling bot strategy:', e);
      }
    },

    async resetSymbolCount(symbol) {
      try {
        const conf = await tradingService.resetCounts(symbol);
        if (conf) {
          this.config = {
            ...this.config,
            ...conf,
          };
        }
      } catch (e) {
        console.error('Error resetting symbol count:', e);
      }
    },

    async closeTrade(id) {
      try {
        await tradingService.closeTrade(id);
        await this.fetchActiveTrades();
      } catch (e) {
        console.error('Error closing trade:', e);
      }
    },

    async executeTrade(payload) {
      try {
        const res = await tradingService.executeTrade(payload);
        await this.fetchActiveTrades();
        return res;
      } catch (e) {
        console.error('Error executing trade:', e);
        throw e;
      }
    },

    async fetchMt5Status() {
      try {
        const data = await tradingService.getMt5Status();
        if (data) {
          this.mt5Status = data;
        }
      } catch (e) {}
    },

    startPolling() {
      if (this.isPolling) return;
      this.isPolling = true;
      this.fetchActiveTrades();
      this.fetchConfig();
      this.fetchMt5Status();
      this.pollingTimer = setInterval(() => {
        this.fetchActiveTrades();
        this.fetchConfig();
        this.fetchMt5Status();
      }, 3000);
    },

    stopPolling() {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }
      this.isPolling = false;
    },
  },
});
