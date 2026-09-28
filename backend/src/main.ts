import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { existsSync } from 'fs';
import * as express from 'express';
import { AppModule } from './app.module';

process.on('unhandledRejection', (reason: any) => {
  if (reason?.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error('❌ Puerto en uso detectado en unhandledRejection, cerrando proceso...');
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.error('⚠️ [unhandledRejection] Error prevenido para evitar caída del servidor:', reason?.message || reason);
});

process.on('uncaughtException', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error('❌ Puerto en uso detectado en uncaughtException, cerrando proceso...');
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.error('⚠️ [uncaughtException] Excepción prevenida para evitar caída del servidor:', err?.message || err);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();

  app.enableCors({
    origin: true, // en producción, restringir al dominio del frontend si aplica
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Prefijo global para la API REST
  app.setGlobalPrefix('api');

  // Middleware para redirigir/reescribir /bot/api/* a /api/* y /bot/socket.io a /socket.io
  app.use((req: any, _res: any, next: any) => {
    if (req.url && (req.url === '/bot/api' || req.url.startsWith('/bot/api/'))) {
      req.url = req.url.replace(/^\/bot/, '');
    } else if (req.url && req.url.startsWith('/bot/socket.io')) {
      req.url = req.url.replace(/^\/bot/, '');
    }
    next();
  });

  // Servir frontend SPA/PWA construido solo en /bot y nunca sobre rutas API.
  const possibleSpaPaths = [
    join(process.cwd(), 'frontend', 'dist', 'pwa'),
    join(process.cwd(), '..', 'frontend', 'dist', 'pwa'),
    join(__dirname, '..', '..', 'frontend', 'dist', 'pwa'),
    join(process.cwd(), 'frontend', 'dist', 'spa'),
    join(process.cwd(), '..', 'frontend', 'dist', 'spa'),
    join(__dirname, '..', '..', 'frontend', 'dist', 'spa'),
    join(process.cwd(), 'public'),
  ];

  let spaFound = false;
  for (const spaPath of possibleSpaPaths) {
    try {
      if (existsSync(spaPath)) {
        app.use('/bot', express.static(spaPath, {
          index: false,
          redirect: false,
          fallthrough: true,
        }));

        const sendFavicon = (_req: any, res: any) => {
          const favPath = join(spaPath, 'favicon.ico');
          const iconPath = join(spaPath, 'icons', 'icon-192x192.png');
          if (existsSync(favPath)) {
            res.setHeader('Content-Type', 'image/x-icon');
            return res.sendFile(favPath);
          }
          if (existsSync(iconPath)) {
            res.setHeader('Content-Type', 'image/png');
            return res.sendFile(iconPath);
          }
          return res.status(404).end();
        };

        app.getHttpAdapter().get('/favicon.ico', sendFavicon);
        app.getHttpAdapter().get('/bot/favicon.ico', sendFavicon);

        const sendSpaIndex = (_req: any, res: any) => {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          res.sendFile(join(spaPath, 'index.html'));
        };

        app.getHttpAdapter().get('/bot', sendSpaIndex);
        app.getHttpAdapter().get('/bot/', sendSpaIndex);

        app.getHttpAdapter().get('/bot/*', (req: any, res: any) => {
          const rawPath = String(req.path || '/');
          const safePath = rawPath.replace(/^\/bot\/?/, '');

          if (!safePath || safePath === '/' || safePath === 'index.html') {
            return sendSpaIndex(req, res);
          }

          if (safePath === 'favicon.ico') {
            return sendFavicon(req, res);
          }

          // Si es una ruta de API que no se encontró
          if (safePath.startsWith('api')) {
            return res.status(404).json({ statusCode: 404, message: 'Not found' });
          }

          const target = join(spaPath, safePath);
          if (existsSync(target)) {
            if (safePath.endsWith('manifest.json')) {
              res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            }
            return res.sendFile(target);
          }

          return sendSpaIndex(req, res);
        });

        app.getHttpAdapter().get('/', (_req: any, res: any) => {
          res.redirect('/bot/');
        });

        // eslint-disable-next-line no-console
        console.log(`📦 Frontend Quasar SPA servido desde: ${spaPath} bajo /bot`);
        spaFound = true;
        break;
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(`⚠️ No se pudo acceder a spaPath ${spaPath}:`, err.message);
    }
  }

  if (!spaFound) {
    // eslint-disable-next-line no-console
    console.warn('⚠️ No se encontró la carpeta de la SPA Quasar en las rutas habituales.');
  }

  try {
    const httpServer = app.getHttpServer();
    const originalListeners = httpServer.listeners('upgrade').slice(0);
    httpServer.removeAllListeners('upgrade');
    httpServer.on('upgrade', (req: any, socket: any, head: any) => {
      if (req.url && req.url.startsWith('/bot/socket.io')) {
        req.url = req.url.replace(/^\/bot/, '');
      }
      for (const listener of originalListeners) {
        listener.call(httpServer, req, socket, head);
      }
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn('⚠️ No se pudo configurar listener de upgrade:', err?.message);
  }

  const port = Number(process.env.PORT) || 3038;
  let retries = 5;
  while (retries > 0) {
    try {
      await app.listen(port, '0.0.0.0');
      // eslint-disable-next-line no-console
      console.log(`🚀 Backend Deriv escuchando en http://localhost:${port}/api`);
      break;
    } catch (err: any) {
      if (err.code === 'EADDRINUSE' && retries > 1) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ Puerto ${port} ocupado, reintentando en 1.5s... (${retries - 1} intentos restantes)`);
        retries--;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } else {
        // eslint-disable-next-line no-console
        console.error(`❌ Error al iniciar servidor en puerto ${port}:`, err);
        process.exit(1);
      }
    }
  }
}
bootstrap();

