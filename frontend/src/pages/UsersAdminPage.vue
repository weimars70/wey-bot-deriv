<template>
  <q-page class="q-pa-md">
    <div class="row items-center justify-between q-mb-md">
      <div class="row items-center q-gutter-sm">
        <q-icon name="group" color="primary" size="28px" />
        <h1 class="text-h6 q-my-none">Usuarios</h1>
      </div>
      <q-btn flat round icon="refresh" :loading="loading" @click="loadUsers">
        <q-tooltip>Actualizar lista</q-tooltip>
      </q-btn>
    </div>

    <q-table
      flat
      bordered
      row-key="id"
      :rows="users"
      :columns="columns"
      :loading="loading"
      :rows-per-page-options="[10, 25, 50]"
    >
      <template #body-cell-phone="props">
        <q-td :props="props">
          {{ formatPhone(props.row) }}
        </q-td>
      </template>
      <template #body-cell-notificationGroup="props">
        <q-td :props="props">
          <q-chip
            v-if="props.row.notificationGroup === 'H1_ONLY'"
            color="teal"
            text-color="white"
            dense
            icon="schedule"
          >
            Solo H1
          </q-chip>
          <q-chip
            v-else
            color="primary"
            text-color="white"
            dense
            icon="notifications_active"
          >
            Todas
          </q-chip>
        </q-td>
      </template>
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn flat round dense icon="edit" color="primary" @click="openEditor(props.row)">
            <q-tooltip>Editar usuario</q-tooltip>
          </q-btn>
        </q-td>
      </template>
    </q-table>

    <q-dialog v-model="showEditor">
      <q-card style="width: 640px; max-width: 94vw;">
        <q-card-section class="row items-center justify-between">
          <div class="text-subtitle1 text-weight-bold">Editar usuario</div>
          <q-btn flat round dense icon="close" v-close-popup />
        </q-card-section>
        <q-separator />
        <q-card-section>
          <user-data-form
            :user="selectedUser || {}"
            :loading="saving"
            :email-readonly="isProtectedAdmin"
            @submit="saveUser"
          />
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';
import UserDataForm from 'components/UserDataForm.vue';
import { useAuthStore } from 'stores/auth.store';

const ADMIN_EMAIL = 'weimarsuber@gmail.com';
const $q = useQuasar();
const authStore = useAuthStore();
const users = ref([]);
const loading = ref(false);
const saving = ref(false);
const showEditor = ref(false);
const selectedUser = ref(null);
const isProtectedAdmin = computed(
  () => (selectedUser.value?.email || '').trim().toLowerCase() === ADMIN_EMAIL,
);

const columns = [
  { name: 'name', label: 'Nombre', field: 'name', align: 'left', sortable: true },
  { name: 'email', label: 'Correo', field: 'email', align: 'left', sortable: true },
  { name: 'phone', label: 'Telefono', field: 'phoneNumber', align: 'left' },
  { name: 'notificationGroup', label: 'WhatsApp', field: 'notificationGroup', align: 'center', sortable: true },
  {
    name: 'createdAt',
    label: 'Registro',
    field: 'createdAt',
    align: 'left',
    sortable: true,
    format: (value) => value ? new Date(value).toLocaleString() : '-',
  },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
];

function formatPhone(user) {
  return user.countryCallingCode && user.phoneNumber
    ? `${user.countryCallingCode} ${user.phoneNumber}`
    : '-';
}

async function loadUsers() {
  loading.value = true;
  try {
    const { data } = await api.get('/users');
    users.value = Array.isArray(data) ? data : [];
  } catch (error) {
    $q.notify({ type: 'negative', message: error.response?.data?.message || 'No fue posible cargar los usuarios.' });
  } finally {
    loading.value = false;
  }
}

function openEditor(user) {
  selectedUser.value = { ...user };
  showEditor.value = true;
}

async function saveUser(values) {
  if (!selectedUser.value?.id) return;
  saving.value = true;
  try {
    const { data } = await api.put(`/users/${selectedUser.value.id}`, values);
    const index = users.value.findIndex((user) => user.id === data.id);
    if (index >= 0) users.value.splice(index, 1, data);
    if (data.id === authStore.user?.id) authStore.setUser(data);
    selectedUser.value = { ...data };
    showEditor.value = false;
    $q.notify({ type: 'positive', message: 'Usuario actualizado.' });
  } catch (error) {
    const message = error.response?.data?.message;
    $q.notify({
      type: 'negative',
      message: Array.isArray(message) ? message.join('. ') : message || 'No fue posible actualizar el usuario.',
    });
  } finally {
    saving.value = false;
  }
}

onMounted(loadUsers);
</script>
