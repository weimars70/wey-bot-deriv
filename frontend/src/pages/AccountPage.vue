<template>
  <q-page class="q-pa-md">
    <q-card v-if="isPhoneEditor" class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle1 q-mb-sm">Teléfono para alertas H1</div>
        <q-form class="row q-col-gutter-sm items-start" @submit="savePhone">
          <div class="col-12 col-sm-4">
            <q-select
              v-model="countryCallingCode"
              :options="countryCallingCodeOptions"
              label="Indicativo"
              outlined
              dense
              emit-value
              map-options
              :rules="[(value) => !!value || 'Requerido']"
            />
          </div>
          <div class="col-12 col-sm-5">
            <q-input
              v-model="phoneNumber"
              type="tel"
              inputmode="numeric"
              label="Número de teléfono"
              outlined
              dense
              :rules="[validatePhoneNumber]"
              @update:model-value="normalizePhoneNumber"
            />
          </div>
          <div class="col-12 col-sm-auto">
            <q-btn
              type="submit"
              color="primary"
              icon="save"
              label="Guardar"
              no-caps
              :loading="savingPhone"
            />
          </div>
        </q-form>
      </q-card-section>
    </q-card>

    <q-card class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle1 q-mb-sm">Información de cuenta</div>
        <div v-if="info.data.value">
          <div><b>Login ID:</b> {{ info.data.value.loginid }}</div>
          <div><b>Email:</b> {{ info.data.value.email }}</div>
          <div><b>Moneda:</b> {{ info.data.value.currency }}</div>
          <div><b>Cuenta virtual:</b> {{ info.data.value.is_virtual ? 'Sí' : 'No' }}</div>
        </div>
        <div v-else class="text-grey">
          Configura DERIV_API_TOKEN en el backend para ver esta información.
        </div>
      </q-card-section>
    </q-card>

    <q-card>
      <q-card-section>
        <div class="text-subtitle1 q-mb-sm">Historial de balance</div>
        <q-table
          :rows="history.data.value || []"
          :columns="columns"
          row-key="id"
          :loading="history.loading.value"
          dense
        />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { usePolling } from 'src/composables/usePolling';
import { derivService } from 'src/services/deriv.service';
import { useAuthStore } from 'stores/auth.store';

const PHONE_EDITOR_EMAIL = 'weimarsuber@gmail.com';
const authStore = useAuthStore();
const $q = useQuasar();

const countryCallingCode = ref('+57');
const phoneNumber = ref('');
const savingPhone = ref(false);
const isPhoneEditor = computed(
  () => (authStore.user?.email || '').trim().toLowerCase() === PHONE_EDITOR_EMAIL,
);

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

function hydratePhone(user) {
  countryCallingCode.value = user?.countryCallingCode || '+57';
  phoneNumber.value = user?.phoneNumber || '';
}

function normalizePhoneNumber(value) {
  phoneNumber.value = String(value || '').replace(/\D/g, '').slice(0, 14);
}

function validatePhoneNumber(value) {
  return /^\d{7,14}$/.test(value || '') || 'Ingresa entre 7 y 14 dígitos';
}

async function savePhone() {
  savingPhone.value = true;
  try {
    const user = await authStore.updatePhone({
      countryCallingCode: countryCallingCode.value,
      phoneNumber: phoneNumber.value,
    });
    hydratePhone(user);
    $q.notify({ type: 'positive', message: 'Teléfono actualizado.' });
  } catch (error) {
    const responseMessage = error.response?.data?.message;
    $q.notify({
      type: 'negative',
      message: Array.isArray(responseMessage)
        ? responseMessage.join('. ')
        : responseMessage || 'No fue posible actualizar el teléfono.',
    });
  } finally {
    savingPhone.value = false;
  }
}

onMounted(async () => {
  const user = await authStore.fetchMe();
  hydratePhone(user || authStore.user);
});

const info = usePolling(() => derivService.getAccountInfo(), 10000);
const history = usePolling(() => derivService.getAccountHistory(50), 5000);

const columns = [
  { name: 'balance', label: 'Balance', field: 'balance', align: 'left' },
  { name: 'currency', label: 'Moneda', field: 'currency', align: 'left' },
  {
    name: 'createdAt',
    label: 'Fecha',
    field: (row) => new Date(row.createdAt).toLocaleString(),
    align: 'left',
  },
];
</script>
