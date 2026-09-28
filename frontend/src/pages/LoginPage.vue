<template>
  <q-page class="flex flex-center">
    <q-card style="width: 100%; max-width: 380px">
      <q-card-section>
        <div class="text-h6">Iniciar sesión</div>
        <div class="text-caption text-grey">Deriv Data Dashboard</div>
      </q-card-section>

      <q-card-section>
        <q-form class="q-gutter-md" @submit.prevent="onSubmit">
          <q-input
            v-model="email"
            type="email"
            label="Email"
            outlined
            dense
            :rules="[(v) => !!v || 'Requerido']"
          />
          <q-input
            v-model="password"
            type="password"
            label="Contraseña"
            outlined
            dense
            :rules="[(v) => !!v || 'Requerido']"
          />

          <div v-if="errorMsg" class="q-pa-sm bg-red-1 text-negative rounded-borders text-caption">
            <div class="row items-center no-wrap q-gutter-xs">
              <q-icon name="warning" size="18px" />
              <div>{{ errorMsg }}</div>
            </div>
            <div v-if="canForceLogout" class="q-mt-sm">
              <q-btn
                dense
                flat
                size="sm"
                color="negative"
                icon="phonelink_erase"
                label="Cerrar sesión anterior y entrar aquí"
                :loading="loading"
                @click="onForceLogin"
              />
            </div>
          </div>

          <q-btn type="submit" color="primary" label="Entrar" class="full-width" :loading="loading" />
        </q-form>
      </q-card-section>

      <q-card-section class="text-center">
        ¿No tienes cuenta?
        <router-link to="/register">Regístrate</router-link>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from 'stores/auth.store';

const email = ref('');
const password = ref('');
const loading = ref(false);
const errorMsg = ref('');
const canForceLogout = ref(false);

const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

async function onSubmit(forceLogout = false) {
  loading.value = true;
  errorMsg.value = '';
  canForceLogout.value = false;
  try {
    const res = await authStore.login({
      email: email.value,
      password: password.value,
      forceLogoutOthers: forceLogout,
    });

    const prefs = res?.user?.strategyPreferences || authStore.strategyPreferences;
    const activeKeys = ['h1NoWick', 'doubleWick', 'crashBoomIa', 'spikePatterns', 'weySignals', 'm5Plus', 'm5X'].filter(
      (k) => prefs && prefs[k]
    );

    if (activeKeys.length === 1 && !route.query.redirect) {
      const map = {
        h1NoWick: '/h1-strategy',
        doubleWick: '/double-wick-strategy',
        crashBoomIa: '/crash-ia',
        spikePatterns: '/spike-strategy',
        m5Plus: '/m5plus-strategy',
        m5X: '/m5x-strategy',
      };
      const target = map[activeKeys[0]] || '/h1-strategy';
      router.push(target);
    } else {
      router.push(route.query.redirect || { name: 'dashboard' });
    }
  } catch (e) {
    const errData = e.response?.data;
    if (e.response?.status === 409 || errData?.error === 'ACTIVE_SESSION_EXISTS') {
      canForceLogout.value = true;
    }
    errorMsg.value =
      errData?.message || 'No se pudo iniciar sesión. Verifica tus datos.';
  } finally {
    loading.value = false;
  }
}

function onForceLogin() {
  onSubmit(true);
}
</script>
