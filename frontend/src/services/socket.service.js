import { io } from 'socket.io-client';
import { useAuthStore } from 'stores/auth.store';

let socket = null;

/**
 * Devuelve una única conexión (singleton) al namespace /realtime del
 * backend, autenticada con el JWT de sesión. Si el token cambia (login/
 * logout), hay que llamar a disconnectSocket() para forzar una reconexión
 * con las nuevas credenciales.
 */
export function getSocket() {
  if (socket) return socket;

  const authStore = useAuthStore();
  const isNativeMobile = typeof window !== 'undefined' && (
    window.Capacitor !== undefined ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'file:' ||
    (window.location.origin.includes('localhost') && !window.location.port)
  );
  const isSubpathBot = typeof window !== 'undefined' && window.location.pathname.startsWith('/bot');
  const socketUrl = isNativeMobile ? 'http://2.58.80.90/realtime' : '/realtime';
  const socketPath = (isNativeMobile || isSubpathBot) ? '/bot/socket.io' : '/socket.io';

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
