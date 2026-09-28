import { api } from 'boot/axios';

/**
 * Cliente REST para el módulo de Backtesting y Simulación Histórica.
 */
export const backtestService = {
  /** Obtiene la lista de símbolos disponibles */
  getSymbols() {
    return api.get('/trading/backtest/symbols').then((r) => r.data);
  },

  /** Ejecuta la simulación de backtesting */
  runBacktest(params) {
    return api.post('/trading/backtest/run', params).then((r) => r.data);
  },
};
