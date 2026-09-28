<template>
  <q-form class="row q-col-gutter-md" @submit="submit">
    <div class="col-12 col-sm-6">
      <q-input v-model="form.name" label="Nombre" outlined dense maxlength="120" />
    </div>
    <div class="col-12 col-sm-6">
      <q-input
        v-model="form.email"
        type="email"
        label="Correo"
        outlined
        dense
        :readonly="emailReadonly"
        :rules="[validateEmail]"
      />
    </div>
    <div class="col-12 col-sm-5">
      <q-select
        v-model="form.countryCallingCode"
        :options="countryCallingCodeOptions"
        label="Indicativo"
        outlined
        dense
        emit-value
        map-options
        :rules="[(value) => !!value || 'Requerido']"
      />
    </div>
    <div class="col-12 col-sm-7">
      <q-input
        v-model="form.phoneNumber"
        type="tel"
        inputmode="numeric"
        label="Numero de telefono"
        outlined
        dense
        :rules="[validatePhone]"
        @update:model-value="normalizePhone"
      />
    </div>
    <div class="col-12">
      <q-select
        v-model="form.notificationGroup"
        :options="notificationGroupOptions"
        label="Grupo de notificaciones WhatsApp"
        outlined
        dense
        emit-value
        map-options
        hint="Define qué alertas recibe el usuario a su WhatsApp"
      >
        <template #prepend>
          <q-icon name="notifications_active" color="primary" />
        </template>
      </q-select>
    </div>
    <div class="col-12 row justify-end">
      <q-btn
        type="submit"
        color="primary"
        icon="save"
        label="Guardar"
        no-caps
        :loading="loading"
      />
    </div>
  </q-form>
</template>

<script setup>
import { reactive, watch } from 'vue';
import { countryCallingCodeOptions } from 'src/constants/countryCallingCodes';

const props = defineProps({
  user: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  emailReadonly: { type: Boolean, default: false },
});

const emit = defineEmits(['submit']);

const notificationGroupOptions = [
  { label: 'Todas las notificaciones (H1, Puntos vigilados, etc.)', value: 'ALL' },
  { label: 'Solo estrategia H1', value: 'H1_ONLY' },
];

const form = reactive({
  name: '',
  email: '',
  countryCallingCode: '+57',
  phoneNumber: '',
  notificationGroup: 'ALL',
});

watch(
  () => props.user,
  (user) => {
    form.name = user?.name || '';
    form.email = user?.email || '';
    form.countryCallingCode = user?.countryCallingCode || '+57';
    form.phoneNumber = user?.phoneNumber || '';
    form.notificationGroup = user?.notificationGroup || 'ALL';
  },
  { immediate: true },
);

function normalizePhone(value) {
  form.phoneNumber = String(value || '').replace(/\D/g, '').slice(0, 14);
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '') || 'Correo invalido';
}

function validatePhone(value) {
  return /^\d{7,14}$/.test(value || '') || 'Ingresa entre 7 y 14 digitos';
}

function submit() {
  emit('submit', {
    name: form.name,
    email: form.email.trim().toLowerCase(),
    countryCallingCode: form.countryCallingCode,
    phoneNumber: form.phoneNumber,
    notificationGroup: form.notificationGroup || 'ALL',
  });
}
</script>
