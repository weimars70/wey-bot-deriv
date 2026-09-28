import { api } from 'boot/axios';

export const watchedLevelsService = {
  list: (params = {}) => api.get('/watched-levels', { params }).then((r) => r.data),
  create: (payload) => api.post('/watched-levels', payload).then((r) => r.data),
  cancel: (id) => api.post(`/watched-levels/${id}/cancel`).then((r) => r.data),
};
