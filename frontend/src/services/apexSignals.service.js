import { api } from 'boot/axios';

/**
 * Cliente REST para las señales de ApexFusion Cartógrafo.
 * El backend hace el proxy y gestiona la sesión con ApexFusion.
 */
export const apexSignalsService = {
  /** Devuelve señales cacheadas del backend (actualizadas cada 20s automáticamente) */
  getSignals() {
    return api.get('/apex-signals').then((r) => r.data);
  },

  /** Fuerza un refresh inmediato de las señales */
  forceRefresh() {
    return api.post('/apex-signals/refresh').then((r) => r.data);
  },

  /** Obtiene la comparación lado a lado de señales locales calculadas vs Apex */
  getComparison() {
    return api.get('/apex-signals/compare').then((r) => r.data);
  },

  /** Inicia sesión o fuerza relevo de sesión con ApexFusion */
  login(relevo = true, cuenta = '41116831') {
    return api.post('/apex-signals/login', { relevo, cuenta }).then((r) => r.data);
  },

  /** Guarda manualmente un token de sesión */
  setSession(token) {
    return api.post('/apex-signals/session', { token }).then((r) => r.data);
  },
};
