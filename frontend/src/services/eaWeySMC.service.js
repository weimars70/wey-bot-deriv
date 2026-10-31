import { api } from 'boot/axios';

export const eaWeySMCService = {
  scan() {
    return api.get('/ea-wey-smc/scanner').then((r) => r.data);
  },
  getChart(symbol) {
    return api.get(`/ea-wey-smc/chart?symbol=${symbol}`).then((r) => r.data);
  },
};
