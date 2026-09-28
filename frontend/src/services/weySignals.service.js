import { api } from 'boot/axios';

/**
 * Cliente REST para el motor local de señales Wey (cálculo 100% local).
 */
export const weySignalsService = {
  /**
   * Obtiene las señales locales calculadas por el motor Wey,
   * ordenadas de mayor a menor número de estrellas.
   * @param {number} minStars Filtro opcional de estrellas mínimas (por defecto 3)
   */
  getSignals(minStars = 3, onlyViable = true) {
    return api.get(`/wey-signals?minStars=${minStars}&onlyViable=${onlyViable}`).then((r) => r.data);
  },

  /**
   * Obtiene la comparación lado a lado de señales Wey vs Apex.
   * @param {boolean} force Si true, ignora la caché y fuerza recálculo
   */
  getComparison(force = false) {
    return api.get(`/wey-signals/compare${force ? '?force=true' : ''}`).then((r) => r.data);
  },
};
