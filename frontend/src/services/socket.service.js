import { io } from 'socket.io-client';
import { useAuthStore } from 'stores/auth.store';

let socket = null;

export function getSocket() {
  if (socket) return socket;

  const authStore = useAuthStore();
  const isBrowser = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  // Si estamos en navegador local, SIEMPRE usar ruta relativa al proxy local de desarrollo
  const socketUrl = isBrowser ? '/realtime' : (
    (typeof window !== 'undefined' && (window.location.protocol === 'capacitor:' || window.location.protocol === 'file:'))
      ? 'http://2.58.80.90/realtime'
      : '/realtime'
  );

  const socketPath = '/bot/socket.io';

  socket = io(socketUrl, {
    path: socketPath,
    auth: { token: authStore.token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
