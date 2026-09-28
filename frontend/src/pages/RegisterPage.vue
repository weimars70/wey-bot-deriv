<template>
  <q-page class="flex flex-center">
    <q-card style="width: 100%; max-width: 380px">
      <q-card-section>
        <div class="text-h6">Crear cuenta</div>
        <div class="text-caption text-grey">Deriv Data Dashboard</div>
      </q-card-section>

      <q-card-section>
        <q-form class="q-gutter-md" @submit.prevent="onSubmit">
          <q-input v-model="name" label="Nombre (opcional)" outlined dense />
          <q-input
            v-model="email"
            type="email"
            label="Email"
            outlined
            dense
            :rules="[(v) => !!v || 'Requerido']"
          />
          <div class="row q-col-gutter-sm">
            <div class="col-5">
              <q-select
                v-model="countryCallingCode"
                :options="countryCallingCodeOptions"
                label="Indicativo"
                outlined
                dense
                emit-value
                map-options
                :rules="[(v) => !!v || 'Requerido']"
              />
            </div>
            <div class="col-7">
              <q-input
                v-model="phoneNumber"
                type="tel"
                inputmode="numeric"
                label="Teléfono"
                outlined
                dense
                :rules="[validatePhoneNumber]"
                @update:model-value="normalizePhoneNumber"
              />
            </div>
          </div>
          <q-input
            v-model="password"
            type="password"
            label="Contraseña"
            outlined
            dense
            hint="Mínimo 8 caracteres"
            :rules="[(v) => (v && v.length >= 8) || 'Mínimo 8 caracteres']"
          />

          <div v-if="errorMsg" class="text-negative text-caption">{{ errorMsg }}</div>

          <q-btn type="submit" color="primary" label="Registrarme" class="full-width" :loading="loading" />
        </q-form>
      </q-card-section>

      <q-card-section class="text-center">
        ¿Ya tienes cuenta?
        <router-link to="/login">Inicia sesión</router-link>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from 'stores/auth.store';

const name = ref('');
const email = ref('');
const countryCallingCode = ref('+57');
const phoneNumber = ref('');
const password = ref('');
const loading = ref(false);
const errorMsg = ref('');

const authStore = useAuthStore();
const router = useRouter();

const countryCallingCodeOptions = [
  { label: 'Colombia +57', value: '+57' },
  { label: 'Venezuela +58', value: '+58' },
  { label: 'Ecuador +593', value: '+593' },
  { label: 'Perú +51', value: '+51' },
  { label: 'Panamá +507', value: '+507' },
  { label: 'México +52', value: '+52' },
  { label: 'Argentina +54', value: '+54' },
  { label: 'Brasil +55', value: '+55' },
  { label: 'Chile +56', value: '+56' },
  { label: 'Bolivia +591', value: '+591' },
  { label: 'Paraguay +595', value: '+595' },
  { label: 'Uruguay +598', value: '+598' },
  { label: 'Costa Rica +506', value: '+506' },
  { label: 'Guatemala +502', value: '+502' },
  { label: 'El Salvador +503', value: '+503' },
  { label: 'Honduras +504', value: '+504' },
  { label: 'Nicaragua +505', value: '+505' },
  { label: 'EE. UU. / Canadá / R. Dominicana +1', value: '+1' },
  { label: 'España +34', value: '+34' },
];

function normalizePhoneNumber(value) {
  phoneNumber.value = String(value || '').replace(/\D/g, '').slice(0, 14);
}

function validatePhoneNumber(value) {
  return /^\d{7,14}$/.test(value || '') || 'Ingresa entre 7 y 14 dígitos';
}

async function onSubmit() {
  loading.value = true;
  errorMsg.value = '';
  try {
    await authStore.register({
      email: email.value,
      password: password.value,
      name: name.value,
      countryCallingCode: countryCallingCode.value,
      phoneNumber: phoneNumber.value,
    });
    router.push({ name: 'dashboard' });
  } catch (e) {
    errorMsg.value =
      e.response?.data?.message || 'No se pudo crear la cuenta. Intenta de nuevo.';
  } finally {
    loading.value = false;
  }
}
</script>
