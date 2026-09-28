import { api } from 'boot/axios';

export const crashIaStrategyService = {
  /**
   * Obtiene la evaluación detallada de un símbolo Crash (zonas, filtros y velas).
   * @param {string} symbol - ej: CRASH1000
   * @param {number} timeframe - en minutos: 1, 5, 15, 60
   */
  evaluate(symbol = 'CRASH1000', timeframe = 5) {
    return api
      .get('/strategies/crash-ia/evaluate', {
        params: { symbol, timeframe },
      })
      .then((r) => r.data);
  },

  /**
   * Obtiene el resumen de todos los índices Crash.
   */
  getSummary() {
    return api.get('/strategies/crash-ia/summary').then((r) => r.data);
  },

  getDoubleWick(symbol = 'BOOM500') {
    return api
      .get('/strategies/crash-ia/double-wick', {
        params: { symbol },
      })
      .then((r) => r.data);
  },

  getDoubleWickSummary() {
    return api.get('/strategies/crash-ia/double-wick-summary').then((r) => r.data);
  },

  getDoubleWickH1Summary() {
    return api.get('/strategies/crash-ia/double-wick-h1-summary').then((r) => r.data);
  },

  /**
   * Obtiene el historial de ocurrencias del patrón de dos velas y si vino spike después.
   * @param {string} symbol - ej: BOOM500
   * @param {number} days   - días a escanear hacia atrás (default 7)
   */
  getDoubleWickHistory(symbol = 'BOOM500', days = 7) {
    return api
      .get('/strategies/crash-ia/double-wick-history', {
        params: { symbol, days },
      })
      .then((r) => r.data);
  },
};
