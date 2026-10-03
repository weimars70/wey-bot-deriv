import { api } from 'boot/axios';

export const signalCenterService = {
  list(limit = 60) {
    return api.get('/signal-center/alerts', { params: { limit } }).then((response) => response.data);
  },
};
