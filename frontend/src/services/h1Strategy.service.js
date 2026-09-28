import { api } from 'boot/axios';

export const h1StrategyService = {
  /**
   * Obtiene el análisis de velas H1 de las últimas 24 horas y las alertas de cambio de hora
   * @param {number} tolerance Porcentaje de tolerancia para mecha visual (por defecto 2%)
   */
  getAnalysis(tolerance = 2) {
    return api.get(`/strategies/h1-no-wick?tolerance=${tolerance}`).then((r) => r.data);
  },

  /**
   * Endpoint público (desarrollo / sin JWT)
   */
  getAnalysisPublic(tolerance = 2) {
    return api.get(`/strategies/h1-no-wick/public?tolerance=${tolerance}`).then((r) => r.data);
  },

  /**
   * Obtiene estadísticas históricas por índice, semana y mes de velas sin mecha
   * @param {Object} params { month, week, symbol, tolerance }
   */
  getStatistics(params = {}) {
    return api.get('/strategies/h1-no-wick/statistics', { params }).then((r) => r.data);
  },

  /**
   * Versión pública para desarrollo de estadísticas
   */
  getStatisticsPublic(params = {}) {
    return api.get('/strategies/h1-no-wick/statistics/public', { params }).then((r) => r.data);
  },

  /**
   * Resumen real por índice H1 evaluando la vela de señal y la siguiente y segunda vela.
   * @param {Object} params { month, week, symbol, tolerance, months }
   */
  getRealSummary(params = {}) {
    return api.get('/strategies/h1-no-wick/real-summary/public', { params }).then((r) => r.data);
  },
};
