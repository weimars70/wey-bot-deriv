import { onMounted, onUnmounted, ref } from 'vue';

/**
 * Ejecuta `fetchFn` inmediatamente y luego cada `intervalMs`,
 * guardando el resultado en `data`. Limpia el intervalo al desmontar.
 */
export function usePolling(fetchFn, intervalMs = 3000) {
  const data = ref(null);
  const error = ref(null);
  const loading = ref(true);
  let timer = null;

  async function tick() {
    try {
      data.value = await fetchFn();
      error.value = null;
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    tick();
    timer = setInterval(tick, intervalMs);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { data, error, loading, refresh: tick };
}
