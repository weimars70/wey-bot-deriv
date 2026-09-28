<template>
  <q-page class="q-pa-md">
    <div class="text-h5 text-weight-bold q-mb-sm">Puntos vigilados</div>
    <div class="text-caption text-grey-7 q-mb-md">Registra un retroceso. El nivel queda pendiente hasta que el motor lo evalúe al tocarse.</div>
    <q-card flat bordered class="q-pa-md q-mb-md">
      <div class="row q-col-gutter-md items-end">
        <div class="col-12 col-sm-3"><q-select v-model="form.symbol" :options="symbols" label="Índice" outlined dense @update:model-value="setDefaults" /></div>
        <div class="col-12 col-sm-2"><q-select v-model="form.direction" :options="directions" emit-value map-options label="Dirección" outlined dense /></div>
        <div class="col-12 col-sm-2"><q-input v-model.number="form.entryPrice" type="number" label="Punto de entrada" outlined dense /></div>
        <div class="col-12 col-sm-2"><q-input v-model.number="form.lot" type="number" step="0.1" label="Lote sugerido" outlined dense /></div>
        <div class="col-12 col-sm-2"><q-input v-model="form.note" label="Nota" outlined dense /></div>
        <div class="col-12"><q-checkbox v-model="form.multipleReactions" label="Reacciones múltiples" dense /></div>
        <div class="col-12 row justify-end q-gutter-sm">
          <q-btn flat color="grey-7" label="Cancelar" no-caps :disable="saving" @click="clearForm" />
          <q-btn color="primary" icon="save" label="Guardar" no-caps :loading="saving" @click="save" />
        </div>
      </div>
    </q-card>
    <div class="row q-col-gutter-sm q-mb-sm items-end">
      <div class="col-12 col-sm-3"><q-select v-model="filters.symbol" :options="symbols" clearable label="Filtrar índice" outlined dense /></div>
      <div class="col-12 col-sm-2"><q-input v-model.number="filters.price" type="number" label="Precio exacto" outlined dense /></div>
      <div class="col-12 col-sm-2"><q-input v-model.number="filters.minPrice" type="number" label="Desde precio" outlined dense /></div>
      <div class="col-12 col-sm-2"><q-input v-model.number="filters.maxPrice" type="number" label="Hasta precio" outlined dense /></div>
      <div class="col-auto"><q-btn color="primary" icon="search" @click="load"><q-tooltip>Buscar</q-tooltip></q-btn></div>
      <div class="col-auto"><q-btn flat icon="restart_alt" @click="clearFilters"><q-tooltip>Limpiar filtros</q-tooltip></q-btn></div>
    </div>
    <q-table flat bordered :rows="levels" :columns="columns" row-key="id" :loading="loading" :pagination="{ rowsPerPage: 20 }">
      <template #body-cell-status="props"><q-td :props="props"><q-badge :color="props.value === 'PENDING' ? 'amber-8' : props.value === 'EVALUATING' ? 'cyan-8' : props.value === 'EXECUTED' ? 'positive' : 'grey-7'" :label="statusLabel(props.value)" /></q-td></template>
      <template #body-cell-actions="props"><q-td :props="props"><q-btn v-if="props.row.status === 'PENDING'" flat round dense color="negative" icon="close" @click="cancel(props.row.id)"><q-tooltip>Cancelar nivel</q-tooltip></q-btn></q-td></template>
    </q-table>
  </q-page>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Notify } from 'quasar';
import { watchedLevelsService } from 'src/services/watchedLevels.service';
const symbols = ['CRASH100','CRASH200','CRASH300','CRASH500','CRASH600','CRASH900','CRASH1000','BOOM100','BOOM200','BOOM300','BOOM500','BOOM600','BOOM900','BOOM1000'];
const directions = [{ label: 'VENTA', value: 'SELL' }, { label: 'COMPRA', value: 'BUY' }];
const form = reactive({ symbol: 'CRASH1000', direction: 'SELL', entryPrice: null, lot: 1, note: '', multipleReactions: false });
const filters = reactive({ symbol: null, price: null, minPrice: null, maxPrice: null });
const levels = ref([]); const loading = ref(false); const saving = ref(false);
const columns = [{ name:'symbol',label:'Índice',field:'symbol',align:'left' },{ name:'direction',label:'Dirección',field:'direction' },{ name:'entryPrice',label:'Punto',field:'entryPrice',format:v=>Number(v).toFixed(3) },{ name:'lot',label:'Lote',field:'lot' },{ name:'multipleReactions',label:'Reacciones',field:'multipleReactions',format:v=>v?'2+':'1' },{ name:'status',label:'Estado',field:'status' },{ name:'evaluationReason',label:'Evaluación',field:'evaluationReason' },{ name:'note',label:'Nota',field:'note' },{ name:'actions',label:'',field:'actions' }];
function setDefaults() { form.direction = form.symbol.includes('CRASH') ? 'SELL' : 'BUY'; form.lot = ['CRASH600','CRASH900','BOOM1000'].includes(form.symbol) ? .5 : 1; }
function statusLabel(status) { return status === 'EXECUTED' ? 'ORDEN ENVIADA' : status; }
async function load() { loading.value=true; try { levels.value=await watchedLevelsService.list(filters); } finally { loading.value=false; } }
function clearForm() { form.entryPrice = null; form.note = ''; form.multipleReactions = false; }
function clearFilters() { filters.symbol=null; filters.price=null; filters.minPrice=null; filters.maxPrice=null; load(); }
async function save() { saving.value=true; try { await watchedLevelsService.create(form); clearForm(); await load(); Notify.create({ type:'positive', message:'Punto vigilado registrado' }); } catch(e) { Notify.create({ type:'negative', message:e.response?.data?.message || 'No se pudo registrar el punto' }); } finally { saving.value=false; } }
async function cancel(id) { await watchedLevelsService.cancel(id); await load(); }
onMounted(load);
</script>
