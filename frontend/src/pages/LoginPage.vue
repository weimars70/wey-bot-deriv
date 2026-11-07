<template>
  <q-page class="flex flex-center">
    <q-card style="width: 100%; max-width: 380px">
      <q-card-section>
        <div class="text-h6">Iniciar sesión</div>
        <div class="text-caption text-grey">Deriv Data Dashboard</div>
      </q-card-section>

      <q-card-section>
        <q-form class="q-gutter-md" @submit.prevent="onSubmit(false)">
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
                label="Cerrar sesión en otro dispositivo y entrar"
                :loading="loading"
                @click="onConfirmForceLogin"
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

    <!-- Modal de confirmación cuando ya existe sesión en otro dispositivo -->
    <q-dialog v-model="showSessionDialog" persistent>
      <q-card style="width: 100%; max-width: 420px" class="q-pa-sm">
        <q-card-section class="row items-center q-pb-none">
          <q-avatar icon="phonelink_lock" color="amber-1" text-color="warning" size="44px" class="q-mr-sm" />
          <div>
            <div class="text-subtitle1 text-weight-bold">Sesión activa detectada</div>
            <div class="text-caption text-grey">Dispositivo en uso</div>
          </div>
        </q-card-section>

        <q-card-section class="q-pt-md">
          <p class="text-body2 text-grey-9 q-mb-sm">
            Ya hay una sesión iniciada con esta cuenta en otro dispositivo.
          </p>
          <p class="text-caption text-grey-7 q-mb-none">
            ¿Deseas entrar y cerrar la sesión en el otro dispositivo, o cancelar para mantenerla?
          </p>
        </q-card-section>

        <q-card-actions align="right" class="q-pt-none q-pb-sm q-gutter-sm">
          <q-btn
            flat
            label="Cancelar"
            color="grey-7"
            :disable="loading"
            @click="onCancelSessionDialog"
          />
          <q-btn
            unelevated
            label="Entrar"
            icon="login"
            color="primary"
            :loading="loading"
            @click="onConfirmForceLogin"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
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
const showSessionDialog = ref(false);

const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

async function onSubmit(forceLogout = false) {
  const isForce = forceLogout === true;
  loading.value = true;
  errorMsg.value = '';
  if (!isForce) {
    canForceLogout.value = false;
  }

  try {
    const res = await authStore.login({
      email: email.value,
      password: password.value,
      forceLogoutOthers: isForce,
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
      showSessionDialog.value = true;
      errorMsg.value = errData?.message || 'Ya hay una sesión iniciada en otro dispositivo.';
    } else {
      errorMsg.value =
        errData?.message || 'No se pudo iniciar sesión. Verifica tus datos.';
    }
  } finally {
    loading.value = false;
  }
}

function onCancelSessionDialog() {
  showSessionDialog.value = false;
  loading.value = false;
}

async function onConfirmForceLogin() {
  showSessionDialog.value = false;
  await onSubmit(true);
}
</script>
