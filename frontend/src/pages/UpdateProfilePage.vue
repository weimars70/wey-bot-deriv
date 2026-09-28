<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-icon name="manage_accounts" color="primary" size="28px" />
      <h1 class="text-h6 q-my-none">Actualizar datos</h1>
    </div>
    <q-separator class="q-mb-lg" />

    <div style="width: 100%; max-width: 680px;">
      <user-data-form
        :user="authStore.user || {}"
        :loading="saving"
        :email-readonly="isAdmin"
        @submit="save"
      />
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import UserDataForm from 'components/UserDataForm.vue';
import { useAuthStore } from 'stores/auth.store';

const ADMIN_EMAIL = 'weimarsuber@gmail.com';
const authStore = useAuthStore();
const $q = useQuasar();
const saving = ref(false);
const isAdmin = computed(
  () => (authStore.user?.email || '').trim().toLowerCase() === ADMIN_EMAIL,
);

onMounted(() => authStore.fetchMe());

async function save(values) {
  saving.value = true;
  try {
    await authStore.updateProfile(values);
    $q.notify({ type: 'positive', message: 'Datos actualizados.' });
  } catch (error) {
    const message = error.response?.data?.message;
    $q.notify({
      type: 'negative',
      message: Array.isArray(message) ? message.join('. ') : message || 'No fue posible actualizar los datos.',
    });
  } finally {
    saving.value = false;
  }
}
</script>
