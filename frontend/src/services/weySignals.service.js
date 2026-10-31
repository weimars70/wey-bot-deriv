import { api } from 'boot/axios';

/**
 * Cliente REST para el motor local de senales Wey (calculo 100% local).
 */
export const weySignalsService = {
  /**
   * Obtiene las senales locales calculadas por el motor Wey,
   * ordenadas de mayor a menor numero de estrellas.
   * Usa endpoint /public para no requerir JWT en el dashboard.
   * @param {number} minStars Filtro opcional de estrellas minimas (por defecto 3)
   */
  getSignals(minStars = 3, onlyViable = true) {
    return api.get(`/wey-signals/public?minStars=${minStars}&onlyViable=${onlyViable}`).then((r) => r.data);
  },

  /**
   * Obtiene la comparacion lado a lado de senales Wey vs Apex.
   * @param {boolean} force Si true, ignora la cache y fuerza recalculo
   */
  getComparison(force = false) {
    return api.get(`/wey-signals/compare/public${force ? '?force=true' : ''}`).then((r) => r.data);
  },
};