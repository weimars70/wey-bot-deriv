import { api } from 'boot/axios';

/**
 * Cliente REST hacia el backend NestJS (que a su vez mantiene la conexión
 * WebSocket con Deriv). El frontend nunca habla directo con Deriv.
 */
export const derivService = {
  getTicks(symbol, limit = 100) {
    return api.get('/ticks', { params: { symbol, limit } }).then((r) => r.data);
  },

  getCandles(symbol, granularity = 60, limit = 200) {
    return api
      .get('/candles', { params: { symbol, granularity, limit } })
      .then((r) => r.data);
  },

  getAccountInfo() {
    return api.get('/account/info').then((r) => r.data);
  },

  getAccountBalance() {
    return api.get('/account/balance').then((r) => r.data);
  },

  getAccountHistory(limit = 100) {
    return api.get('/account/history', { params: { limit } }).then((r) => r.data);
  },

  getSymbols() {
    return api.get('/deriv/symbols').then((r) => r.data);
  },

  subscribeSymbol(symbol, granularity = 60) {
    return api.post('/deriv/subscribe', { symbol, granularity }).then((r) => r.data);
  },

  getSignal(symbol, granularity = 60) {
    return api
      .get('/signals', { params: { symbol, granularity } })
      .then((r) => r.data);
  },

  getAllSignals() {
    return api.get('/signals/all').then((r) => r.data);
  },

  subscribeTargets() {
    return api.post('/signals/subscribe-targets').then((r) => r.data);
  },
};
