import { api } from 'boot/axios';

export const smcSyntheticsService = {
  /**
   * Obtiene el escaneo en tiempo real de los 16 índices sintéticos (Step, Volatility, Jump)
   * @returns {Promise<Array>} Lista de resultados SMC con estado, score, precios y señales
   */
  async scan() {
    const res = await api.get('/smc-synthetics/scanner');
    return Array.isArray(res.data) ? res.data : [];
  },

  /**
   * Obtiene los datos del gráfico para un símbolo específico (velas M5/H1, zonas OB, FVG, Swings, SL, TP)
   * @param {string} symbol - p.ej. 'stpRNG', 'R_100', 'JD50'
   * @returns {Promise<Object|null>}
   */
  async getChart(symbol) {
    if (!symbol) return null;
    const res = await api.get('/smc-synthetics/chart', {
      params: { symbol },
    });
    return res.data;
  },
};

