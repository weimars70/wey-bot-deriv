import { api } from 'boot/axios';

export const SUPPORTED_SYMBOLS = [
  'CRASH300N', 'CRASH500', 'CRASH600', 'CRASH900', 'CRASH1000',
  'BOOM300N', 'BOOM500', 'BOOM600', 'BOOM900', 'BOOM1000',
];

export const SYMBOL_LABELS = {
  CRASH300N: 'Crash 300 Index',
  CRASH500: 'Crash 500 Index',
  CRASH600: 'Crash 600 Index',
  CRASH900: 'Crash 900 Index',
  CRASH1000: 'Crash 1000 Index',
  BOOM300N: 'Boom 300 Index',
  BOOM500: 'Boom 500 Index',
  BOOM600: 'Boom 600 Index',
  BOOM900: 'Boom 900 Index',
  BOOM1000: 'Boom 1000 Index',
};

export default {
  getLiveEvaluation(granularity = 300, symbol = 'CRASH600') {
    return api
      .get('/strategies/crash-spike/live', { params: { granularity, symbol } })
      .then((res) => res.data);
  },
  executeTrade(lot, symbol = 'CRASH600') {
    return api
      .post('/strategies/crash-spike/execute', { lot, symbol })
      .then((res) => res.data);
  },
  runBacktest(days = 30, minScore = 65, symbol = 'CRASH600') {
    return api
      .post('/strategies/crash-spike/backtest', { days, minScore, symbol })
      .then((res) => res.data);
  },
  getAutoTradingStatus() {
    return api.get('/strategies/crash-spike/auto-trading').then((res) => res.data);
  },
  setAutoTradingStatus(active) {
    return api.post('/strategies/crash-spike/auto-trading', { active }).then((res) => res.data);
  },
};
