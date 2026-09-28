<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-gutter-md q-mb-md">
      <q-select
        v-model="symbol"
        :options="symbolOptions"
        dense
        outlined
        label="Símbolo"
        emit-value
        map-options
        style="max-width: 220px"
      />

      <q-select
        v-model="granularity"
        :options="granularityOptions"
        dense
        outlined
        label="Temporalidad"
        emit-value
        map-options
        style="max-width: 220px"
      />

      <q-btn label="Suscribir" color="primary" @click="subscribe" />
    </div>

    <q-card class="q-mb-md">
      <q-card-section>
        <CandlesChart :candles="candles.data.value || []" />
      </q-card-section>
    </q-card>

    <q-card>
      <q-card-section>
        <q-table
          :rows="candles.data.value || []"
          :columns="columns"
          row-key="epoch"
          :loading="candles.loading.value"
          dense
        />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import CandlesChart from 'src/components/CandlesChart.vue';
import { usePolling } from 'src/composables/usePolling';
import { derivService } from 'src/services/deriv.service';

const symbol = ref(null);
const granularity = ref(60);

const symbolOptions = ref([]);

const granularityOptions = [
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '10m', value: 600 },
  { label: '15m', value: 900 },
  { label: '1h', value: 3600 },
  { label: '4h', value: 14400 },
];

const candles = usePolling(
  () => (symbol.value ? derivService.getCandles(symbol.value, granularity.value, 500) : Promise.resolve([])),
  5000,
);

// Refresh inmediato cuando cambia símbolo o temporalidad
watch([symbol, granularity], () => {
  candles.refresh();
});

const columns = [
  { name: 'open', label: 'Apertura', field: 'open', align: 'left' },
  { name: 'high', label: 'Máximo', field: 'high', align: 'left' },
  { name: 'low', label: 'Mínimo', field: 'low', align: 'left' },
  { name: 'close', label: 'Cierre', field: 'close', align: 'left' },
  {
    name: 'epoch',
    label: 'Hora',
    field: (row) => new Date(row.epoch * 1000).toLocaleString(),
    align: 'left',
  },
];

function subscribe() {
  if (!symbol.value) return console.warn('No symbol selected');
  const exists = symbolOptions.value.find((s) => s.value === symbol.value);
  if (!exists) return console.warn('Símbolo inválido, consulta /api/deriv/symbols para la lista');
  derivService.subscribeSymbol(symbol.value, granularity.value).catch((e) => console.error(e));
}

onMounted(async () => {
  try {
    const list = await derivService.getSymbols();
    // The API may return items with either `symbol`/`display_name` or
    // `underlying_symbol`/`underlying_symbol_name`. Normalize both shapes.
    symbolOptions.value = (list || [])
      .map((s) => {
        const sym = s.symbol ?? s.underlying_symbol;
        const name = s.display_name ?? s.underlying_symbol_name ?? sym;
        return sym ? { label: name, value: sym } : null;
      })
      .filter(Boolean);

    if (!symbolOptions.value.length) {
      symbolOptions.value = [
        { label: 'Crash 300 Index', value: 'CRASH300N' },
        { label: 'Crash 500 Index', value: 'CRASH500' },
        { label: 'Crash 600 Index', value: 'CRASH600' },
        { label: 'Crash 900 Index', value: 'CRASH900' },
        { label: 'Crash 1000 Index', value: 'CRASH1000' },
        { label: 'Boom 300 Index', value: 'BOOM300N' },
        { label: 'Boom 500 Index', value: 'BOOM500' },
        { label: 'Boom 600 Index', value: 'BOOM600' },
        { label: 'Boom 900 Index', value: 'BOOM900' },
        { label: 'Boom 1000 Index', value: 'BOOM1000' },
        { label: 'Volatility 100 Index', value: 'R_100' },
        { label: 'Volatility 10 Index', value: 'R_10' },
      ];
    }

    // set default symbol preferring Crash symbols
    const crash = symbolOptions.value.find((s) => s.value.includes('CRASH'));
    symbol.value = crash ? crash.value : symbolOptions.value[0]?.value ?? null;

    // auto-subscribe if symbol valid
    if (symbol.value) subscribe();
  } catch (e) {
    console.error('No se pudo obtener lista de símbolos', e);
  }
});
</script>
