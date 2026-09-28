import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { disconnectSocket } from 'src/services/socket.service';

const TOKEN_KEY = 'deriv_app_token';
const USER_KEY = 'deriv_app_user';

let heartbeatInterval = null;

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || null,
    user: (() => {
      try {
        const cached = localStorage.getItem(USER_KEY);
        return cached ? JSON.parse(cached) : null;
      } catch {
        return null;
      }
    })(),
  }),

  getters: {
    isAuthenticated: (state) => !!state.token,
    strategyPreferences: (state) => ({
      h1NoWick: state.user?.strategyPreferences?.h1NoWick ?? true,
      doubleWick: state.user?.strategyPreferences?.doubleWick ?? false,
      crashBoomIa: state.user?.strategyPreferences?.crashBoomIa ?? false,
      spikePatterns: state.user?.strategyPreferences?.spikePatterns ?? false,
      weySignals: state.user?.strategyPreferences?.weySignals ?? false,
      m5Plus: state.user?.strategyPreferences?.m5Plus ?? false,
      m5X: state.user?.strategyPreferences?.m5X ?? true,
    }),
  },

  actions: {
    startHeartbeat() {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(async () => {
        if (!this.token) return;
        try {
          await api.post('/auth/heartbeat');
        } catch (err) {
          // Si el backend responde 401 (ej: invalidado porque se abrió en otro dispositivo), cerrar sesión
          if (err.response?.status === 401) {
            this.logout();
            window.location.reload();
          }
        }
      }, 45000); // Latido cada 45 segundos
    },

    stopHeartbeat() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    },

    setSession(accessToken, user) {
      this.token = accessToken;
      localStorage.setItem(TOKEN_KEY, accessToken);
      this.setUser(user);
      // Pasar el JWT al servicio nativo de background (Android)
      try {
        if (window.AndroidBridge && typeof window.AndroidBridge.saveToken === 'function') {
          window.AndroidBridge.saveToken(accessToken);
        }
      } catch (e) {}
      this.startHeartbeat();
    },

    setUser(user) {
      this.user = user;
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_KEY);
      }
    },

    async register({ email, password, name, countryCallingCode, phoneNumber }) {
      const { data } = await api.post('/auth/register', {
        email,
        password,
        name,
        countryCallingCode,
        phoneNumber,
      });
      this.setSession(data.accessToken, data.user);
      return data;
    },

    async login({ email, password, forceLogoutOthers }) {
      const { data } = await api.post('/auth/login', { email, password, forceLogoutOthers });
      this.setSession(data.accessToken, data.user);
      return data;
    },

    async fetchMe() {
      if (!this.token) return null;
      try {
        const { data } = await api.get('/auth/me');
        this.user = data;
        if (data) localStorage.setItem(USER_KEY, JSON.stringify(data));
        this.startHeartbeat();
        return data;
      } catch (err) {
        if (err.response?.status === 401) {
          this.logout();
        }
        return null;
      }
    },

    async updatePhone({ countryCallingCode, phoneNumber }) {
      const { data } = await api.put('/auth/phone', {
        countryCallingCode,
        phoneNumber,
      });
      this.user = data;
      localStorage.setItem(USER_KEY, JSON.stringify(data));
      return data;
    },

    async updateProfile(profile) {
      const { data } = await api.put('/users/me', profile);
      this.setUser(data);
      return data;
    },

    async saveStrategyPreferences(preferences) {
      // 1. Actualización optimista inmediata en memoria y localStorage (cero espera en UI)
      if (this.user) {
        this.user.strategyPreferences = {
          ...(this.user.strategyPreferences || {}),
          ...preferences,
        };
        localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      }

      // 2. Persistencia en base de datos
      try {
        const { data } = await api.put('/auth/preferences', preferences, {
          timeout: 6000,
          _skipRetry: true, // Si hay algún retraso, no congelar la UI
        });
        if (this.user && data?.strategyPreferences) {
          this.user.strategyPreferences = data.strategyPreferences;
          localStorage.setItem(USER_KEY, JSON.stringify(this.user));
        }
        return data;
      } catch (err) {
        console.warn('Sincronización remota diferida (guardado en caché local):', err?.message || err);
        // Retornamos éxito con bandera local para garantizar fluidez inmediata en la interfaz
        return { success: true, localOnly: true, strategyPreferences: preferences };
      }
    },

    async logout() {
      this.stopHeartbeat();
      if (this.token) {
        try {
          await api.post('/auth/logout');
        } catch {}
      }
      this.token = null;
      this.user = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      disconnectSocket();
    },
  },
});
