import { register } from 'register-service-worker'
import { Notify } from 'quasar'

// Eventos de ciclo de vida del Service Worker (PWA)
register(process.env.SERVICE_WORKER_FILE, {
  ready (/* registration */) {
    console.log('[PWA] Service worker activo y listo.')
  },

  registered (/* registration */) {
    console.log('[PWA] Service worker registrado con éxito.')
  },

  cached (/* registration */) {
    console.log('[PWA] Recursos cacheados para uso offline.')
  },

  updatefound (/* registration */) {
    console.log('[PWA] Nueva versión detectada, descargando actualización...')
  },

  updated (registration) {
    console.log('[PWA] ¡Nueva versión lista para instalar!')
    Notify.create({
      message: '🚀 ¡Nueva actualización disponible!',
      caption: 'Se han desplegado mejoras en el Bot. Toca "Actualizar" para cargar la última versión.',
      color: 'dark',
      textColor: 'white',
      icon: 'system_update',
      position: 'top',
      timeout: 0, // Permanece visible hasta que el usuario decida
      classes: 'pwa-update-banner',
      actions: [
        {
          label: 'Actualizar',
          color: 'primary',
          handler: () => {
            if (registration && registration.waiting) {
              registration.waiting.postMessage({ type: 'SKIP_WAITING' })
            }
            window.location.reload(true)
          }
        },
        {
          label: 'Más tarde',
          color: 'grey-5',
          handler: () => {}
        }
      ]
    })
  },

  offline () {
    console.log('[PWA] Sin conexión a internet. Ejecutando en modo offline.')
  },

  error (err) {
    console.error('[PWA] Error en el registro del service worker:', err)
  }
})
