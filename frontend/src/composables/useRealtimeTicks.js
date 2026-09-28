import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getSocket } from 'src/services/socket.service';

/**
 * Se suscribe (vía Socket.io) a los ticks en vivo de `symbolRef` y mantiene
 * un array reactivo con los más recientes primero. Cambia de suscripción
 * automáticamente si `symbolRef` cambia, y limpia todo al desmontar.
 *
 * A diferencia de usePolling, acá no se hace ningún fetch: los datos llegan
 * empujados por el backend en el instante en que Deriv los emite.
 */
export function useRealtimeTicks(symbolRef, maxItems = 200) {
  const ticks = ref([]);
  const connected = ref(false);
  let socket = null;

  function onTick(tick) {
    if (tick.symbol !== symbolRef.value) return;
    ticks.value = [
      { ...tick, id: `live-${tick.symbol}-${tick.epoch}` },
      ...ticks.value,
    ].slice(0, maxItems);
  }

  function subscribeCurrent() {
    socket.emit('subscribe', { symbol: symbolRef.value });
  }

  onMounted(() => {
    socket = getSocket();

    socket.on('connect', () => {
      connected.value = true;
      subscribeCurrent();
    });
    socket.on('disconnect', () => {
      connected.value = false;
    });
    socket.on('tick', onTick);

    if (socket.connected) {
      connected.value = true;
      subscribeCurrent();
    }
  });

  watch(symbolRef, (newSymbol, oldSymbol) => {
    if (oldSymbol) socket.emit('unsubscribe', { symbol: oldSymbol });
    ticks.value = [];
    socket.emit('subscribe', { symbol: newSymbol });
  });

  onBeforeUnmount(() => {
    if (!socket) return;
    socket.emit('unsubscribe', { symbol: symbolRef.value });
    socket.off('tick', onTick);
  });

  return { ticks, connected };
}
