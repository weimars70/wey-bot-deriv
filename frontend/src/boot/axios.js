import { boot } from 'quasar/wrappers';
import axios from 'axios';

// Detección de entorno: Navegador web vs Capacitor APK nativo
const isNativeMobile = typeof window !== 'undefined' && (
  window.Capacitor !== undefined ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'file:' ||
  (window.location.origin.includes('localhost') && !window.location.port)
);
const isSubpathBot = typeof window !== 'undefined' && window.location.pathname.startsWith('/bot');
const baseURL = isNativeMobile
  ? 'http://2.58.80.90/bot/api'
  : (isSubpathBot ? '/bot/api' : '/api');

const api = axios.create({ baseURL });

const TOKEN_KEY = 'deriv_app_token';

// Adjunta el JWT (si existe) a cada request saliente
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Reintenta una petición axios tras un delay.
 * Usado cuando el backend devuelve 503 (reiniciando).
 */
function retryAfter(config, delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs)).then(() => api(config));
}

export default boot(({ app, router }) => {
  app.config.globalProperties.$axios = axios;
  app.config.globalProperties.$api = api;

  // Interceptor de respuesta:
  //   401 → forzar login
  //   503 → backend reiniciando, reintenta hasta 3 veces con 2s de espera
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status  = error.response?.status;
      const config  = error.config;

      // 401: token inválido o expirado → redirigir a login
      if (status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        if (router.currentRoute.value.name !== 'login') {
          router.push({ name: 'login' });
        }
        return Promise.reject(error);
      }

      // 503 o caída de red / reiniciando → reintentar hasta 2 veces
      const isRetryable =
        status === 503 ||
        error.code === 'ECONNRESET' ||
        error.code === 'ERR_NETWORK' ||
        error.message === 'Network Error';

      if (isRetryable && config && !config._skipRetry) {
        config._retryCount = (config._retryCount ?? 0) + 1;
        if (config._retryCount <= 2) {
          console.info(`[axios] Backend no disponible (intento ${config._retryCount}/2), reintentando en 1.5s...`);
          return retryAfter(config, 1500);
        }
      }

      return Promise.reject(error);
    },
  );
});

export { api };
