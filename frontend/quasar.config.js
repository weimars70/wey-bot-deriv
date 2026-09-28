/* eslint-env node */
const { configure } = require('quasar/wrappers');

/**
 * Configura el proxy de desarrollo para manejar de forma elegante los errores
 * de conexión cuando el backend NestJS está reiniciando.
 *
 * Sin esto, Vite muestra "http proxy error: ECONNRESET" en consola y puede
 * dejar la petición colgada. Con el handler de error:
 *   - El error ECONNRESET se silencia en consola (es esperado durante reinicio)
 *   - El cliente recibe un 503 inmediato y puede reintentar
 */
function makeProxyTarget(extraOpts = {}) {
  const isWs = Boolean(extraOpts.ws);
  return {
    target: 'http://127.0.0.1:3038',
    changeOrigin: true,
    ...(isWs ? {} : { proxyTimeout: 15000, timeout: 15000 }),
    ...extraOpts,
    // Suprime ECONNRESET / ECONNREFUSED del log ruidoso de Vite y devuelve 503 limpio
    configure(proxy) {
      // Remueve el error handler por defecto de Vite para que no inunde la terminal
      proxy.removeAllListeners('error');

      if (typeof extraOpts.configure === 'function') {
        extraOpts.configure(proxy);
      }
      proxy.on('error', (err, _req, res) => {
        const code = err.code ?? '';
        // Estos errores son normales durante el reinicio del backend
        const isRestart =
          code === 'ECONNRESET' ||
          code === 'ECONNREFUSED' ||
          code === 'ENOTFOUND' ||
          code === 'ETIMEDOUT';

        if (!isRestart) {
          // Solo imprime errores inesperados
          console.error('[proxy]', err.message);
        }

        // Si la respuesta aún no fue enviada, devuelve 503 para que el
        // frontend (axios) pueda detectarlo y reintentar limpiamente
        if (res) {
          if (!res.headersSent && typeof res.writeHead === 'function') {
            res.writeHead(503, {
              'Content-Type': 'application/json',
              'Retry-After': '2',
            });
            res.end(
              JSON.stringify({
                statusCode: 503,
                message: 'Backend reiniciando, reintenta en unos segundos.',
              })
            );
          } else if (typeof res.destroy === 'function') {
            res.destroy();
          }
        }
      });
    },
  };
}

module.exports = configure(function () {
  return {
    boot: ['pinia', 'axios'],
    css: ['app.scss'],
    extras: ['roboto-font', 'material-icons'],

    build: {
      target: { browser: ['es2019'], node: 'node20' },
      vueRouterMode: 'hash',
      publicPath: '/bot/',
    },

    devServer: {
      port: 9000,
      open: false,
      proxy: {
        // Evita problemas de CORS en desarrollo: /api -> backend NestJS
        '/api': makeProxyTarget(),
        // Cuando el frontend corre bajo /bot/, axios envía requests a /bot/api
        '/bot/api': makeProxyTarget({
          rewrite: (path) => path.replace(/^\/bot\/api/, '/api'),
        }),
        // Socket.io del gateway de tiempo real
        '/socket.io': makeProxyTarget({ ws: true }),
        '/bot/socket.io': makeProxyTarget({
          ws: true,
          rewrite: (path) => path.replace(/^\/bot\/socket\.io/, '/socket.io'),
        }),
      },
    },

    framework: {
      config: {},
      plugins: ['Notify'],
    },

    pwa: {
      workboxMode: 'generateSW',
      injectPwaMetaTags: true,
      swFilename: 'sw.js',
      manifestFilename: 'manifest.json',
      useCredentialsForManifestTag: false,
      manifest: {
        id: '/bot/',
        name: 'WeyBot',
        short_name: 'WeyBot',
        description: 'Trading bot automatizado y radar macro H1 para índices sintéticos Deriv',
        display: 'standalone',
        start_url: '/bot/',
        scope: '/bot/',
        orientation: 'portrait',
        background_color: '#121212',
        theme_color: '#1976d2',
        icons: [
          {
            src: 'icons/icon-128x128.png',
            sizes: '128x128',
            type: 'image/png'
          },
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'icons/icon-256x256.png',
            sizes: '256x256',
            type: 'image/png'
          },
          {
            src: 'icons/icon-384x384.png',
            sizes: '384x384',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    },
  };
});
