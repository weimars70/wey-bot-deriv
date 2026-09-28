<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-gutter-md q-mb-md">
      <q-select
        v-model="symbol"
        :options="symbolOptions"
        use-input
        fill-input
        hide-selected
        dense
        outlined
        label="Símbolo (ej: CRASH600, BOOM900, R_100)"
        emit-value
        map-options
        style="min-width: 280px"
        @filter="filterSymbols"
      />
      <q-btn color="primary" label="Suscribir" @click="subscribe" />
      <q-chip :color="live.connected.value ? 'positive' : 'negative'" text-color="white" icon="fiber_manual_record">
        {{ live.connected.value ? 'En vivo' : 'Desconectado' }}
      </q-chip>
      <div class="text-h5">{{ liveQuote }}</div>
    </div>

    <q-card class="q-mb-md">
      <q-card-section>
        <Line v-if="chartData" :data="chartData" :options="chartOptions" style="height: 320px" />
      </q-card-section>
    </q-card>

    <q-card>
      <q-card-section>
        <div class="text-caption text-grey q-mb-sm">Feed en vivo (WebSocket) — los más recientes primero</div>
        <q-table
          :rows="live.ticks.value"
          :columns="columns"
          row-key="id"
          dense
        />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from 'chart.js';
import { useRealtimeTicks } from 'src/composables/useRealtimeTicks';
import { derivService } from 'src/services/deriv.service';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

const ALL_DEFAULT_SYMBOLS = [
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

const symbol = ref('CRASH600');
const allSymbols = ref(ALL_DEFAULT_SYMBOLS);
const symbolOptions = ref(ALL_DEFAULT_SYMBOLS);

function filterSymbols(val, update) {
  update(() => {
    if (!val) {
      symbolOptions.value = allSymbols.value;
      return;
    }
    const needle = val.toLowerCase();
    symbolOptions.value = allSymbols.value.filter(
      (v) => v.label.toLowerCase().includes(needle) || v.value.toLowerCase().includes(needle),
    );
  });
}

onMounted(async () => {
  try {
    const list = await derivService.getSymbols();
    if (list?.length) {
      allSymbols.value = list.map((s) => ({
        label: s.display_name ?? s.symbol,
        value: s.symbol,
      }));
      symbolOptions.value = allSymbols.value;
    }
  } catch (e) {}
});
const live = useRealtimeTicks(symbol, 100);

const liveQuote = computed(() => live.ticks.value[0]?.quote ?? '—');

const columns = [
  { name: 'quote', label: 'Precio', field: 'quote', align: 'left' },
  {
    name: 'epoch',
    label: 'Hora',
    field: (row) => new Date(row.epoch * 1000).toLocaleTimeString(),
    align: 'left',
  },
];

const chartData = computed(() => {
  const rows = [...live.ticks.value].reverse();
  if (!rows.length) return null;
  return {
    labels: rows.map((r) => new Date(r.epoch * 1000).toLocaleTimeString()),
    datasets: [
      {
        label: symbol.value,
        data: rows.map((r) => r.quote),
        borderColor: '#1976d2',
        tension: 0.2,
        pointRadius: 0,
      },
    ],
  };
});

const chartOptions = { responsive: true, maintainAspectRatio: false, animation: false };

function subscribe() {
  // Registra el símbolo en el backend (que a su vez se suscribe a Deriv);
  // el composable useRealtimeTicks ya se re-suscribe solo al cambiar `symbol`.
  derivService.subscribeSymbol(symbol.value);
}
</script>
