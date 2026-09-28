import { api } from 'boot/axios';

export const tradingService = {
  getActiveTrades() {
    return api.get('/trading/active').then((r) => r.data);
  },

  getConfig() {
    return api.get('/trading/config').then((r) => r.data);
  },

  getHistory(limit = 50) {
    return api.get(`/trading/history?limit=${limit}`).then((r) => r.data);
  },

  toggleConfig(strategy, enabled) {
    return api.post('/trading/toggle', { strategy, enabled }).then((r) => r.data);
  },

  closeTrade(id) {
    return api.post(`/trading/close/${id}`).then((r) => r.data);
  },

  resetCounts(symbol) {
    return api.post('/trading/reset-counts', { symbol }).then((r) => r.data);
  },

  getMt5Status() {
    return api.get('/trading/mt5-status').then((r) => r.data);
  },

  getDailyReport(dateOrParams, endDate) {
    let params = {};
    if (typeof dateOrParams === 'object' && dateOrParams !== null) {
      params = dateOrParams;
    } else if (endDate) {
      params = { startDate: dateOrParams, endDate };
    } else if (dateOrParams) {
      params = { date: dateOrParams };
    }
    return api.get('/trading/daily-report', { params }).then((r) => r.data);
  },

  getAdaptiveStatus() {
    return api.get('/trading/adaptive-status').then((r) => r.data);
  },

  toggleAdaptive(enabled) {
    return api.post('/trading/toggle-adaptive', { enabled }).then((r) => r.data);
  },

  executeTrade(payload) {
    return api.post('/trading/execute', payload).then((r) => r.data);
  },
};
