import { io } from 'socket.io-client';
import { useAuthStore } from 'stores/auth.store';
import { Notify } from 'quasar';

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

  socket.on('session.terminated', (data) => {
    disconnectSocket();
    authStore.logout();
    Notify.create({
      type: 'warning',
      icon: 'phonelink_erase',
      message: data?.message || 'Tu sesión ha sido cerrada porque se inició sesión en otro dispositivo.',
      position: 'top',
      timeout: 7000,
    });
    if (typeof window !== 'undefined' && !window.location.href.includes('login')) {
      window.location.reload();
    }
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
