# Deriv Data App

Proyecto full-stack para conectarse a la API de **Deriv**, ingerir datos de mercado (ticks y velas) y de cuenta (balance), guardarlos en **PostgreSQL**, y visualizarlos desde un frontend **Vue 3 + Quasar** que consulta un **REST API propio en NestJS**.

## ⚠️ Nota importante sobre la API de Deriv

Deriv **no ofrece REST para datos de mercado** (ticks, velas, contratos): esa parte de su API es exclusivamente **WebSocket** (`wss://ws.derivws.com/websockets/v3`). Por eso la arquitectura es:

```
Deriv (WebSocket) ──▶ Backend NestJS (ingesta + Postgres) ──▶ REST propio ──▶ Frontend (polling)
```

El backend mantiene la única conexión WebSocket persistente con Deriv (con reconexión automática), guarda todo en Postgres, y expone endpoints REST normales. El frontend nunca habla directo con Deriv — solo hace polling periódico a tu backend, tal como pediste.

## Estructura

```
deriv-app/
├── docker-compose.yml     # Postgres + pgAdmin para desarrollo local
├── backend/                # NestJS
│   └── src/
│       ├── deriv/           # Cliente WebSocket a Deriv + endpoints utilitarios
│       ├── ticks/            # Entidad, servicio y controller de ticks
│       ├── candles/          # Entidad, servicio y controller de velas
│       └── account/          # Entidad, servicio y controller de balance/cuenta
└── frontend/                # Vue 3 + Quasar
    └── src/
        ├── pages/             # Dashboard, Ticks, Velas, Cuenta
        ├── services/          # Cliente REST hacia el backend
        └── composables/       # usePolling (fetch periódico)
```

## Puesta en marcha

### 1. Base de datos

```bash
docker compose up -d
```

Levanta Postgres en `localhost:5432` (usuario `deriv_user` / clave `deriv_pass` / db `deriv_db`) y pgAdmin en `localhost:5050`.

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
```

Edita `.env`:
- `DERIV_APP_ID`: crea el tuyo en https://api.deriv.com/dashboard (o usa `1089` para pruebas).
- `DERIV_API_TOKEN`: genera uno en https://app.deriv.com/account/api-token si quieres balance/cuenta (deja vacío para solo datos públicos de mercado).
- `DERIV_SYMBOLS`: símbolos a los que suscribirse al arrancar, ej. `R_100,frxEURUSD`.

```bash
npm run start:dev
```

El backend queda en `http://localhost:3000/api`. Al arrancar, se conecta a Deriv por WebSocket, se autoriza (si hay token) y empieza a guardar ticks/velas/balance en Postgres.

### Autenticación

Todos los endpoints de datos (`/ticks`, `/candles`, `/account/*`, `/deriv/*`) requieren estar logueado con **tu propio sistema de usuarios** (independiente de la cuenta de Deriv). Es JWT clásico con bcrypt:

- `POST /api/auth/register { "email", "password", "name"? }` → crea el usuario y devuelve `{ accessToken, user }`
- `POST /api/auth/login { "email", "password" }` → devuelve `{ accessToken, user }`
- `GET /api/auth/me` (con header `Authorization: Bearer <token>`) → datos del usuario logueado

Configura `JWT_SECRET` en `.env` (usa algo largo y aleatorio en producción, ej. `openssl rand -base64 48`).

Endpoints principales (todos requieren `Authorization: Bearer <token>` salvo `/auth/register` y `/auth/login`):
- `GET /api/ticks?symbol=R_100&limit=100`
- `GET /api/candles?symbol=R_100&granularity=60&limit=200`
- `GET /api/account/balance`
- `GET /api/account/info`
- `GET /api/account/history?limit=100`
- `GET /api/deriv/symbols`
- `POST /api/deriv/subscribe { "symbol": "frxEURUSD", "granularity": 60 }`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Se abre en `http://localhost:9000`. En desarrollo, Quasar hace proxy de `/api` hacia `http://localhost:3000`, así que no hay problemas de CORS.

Al entrar te pedirá login (`/login`) o registro (`/register`) primero — las páginas de datos (Dashboard, Ticks, Velas, Cuenta) están protegidas por un guard de ruta que revisa el JWT guardado en `localStorage`. El token se adjunta automáticamente a cada request y, si expira o es inválido, te devuelve al login.

## Datos en tiempo real (WebSocket, no polling)

Además del REST con polling, el backend expone un **gateway Socket.io** en el namespace `/realtime` que empuja los ticks (y velas en curso) apenas Deriv los envía — sin esperar al siguiente ciclo de polling.

- Se conecta con el mismo JWT de sesión: `io('/realtime', { auth: { token } })`.
- El cliente se suscribe por símbolo: `socket.emit('subscribe', { symbol: 'R_100' })`.
- Eventos que emite el servidor: `tick`, `candle` (por símbolo, solo a quien esté suscrito) y `balance` (a todos los clientes autenticados).
- En el frontend esto ya está integrado vía el composable `useRealtimeTicks` — el Dashboard y la página de Ticks lo usan para mostrar el precio en vivo con un indicador de conexión (🟢/🔴).

El resto de los datos (histórico, cuenta, velas ya cerradas) se sigue sirviendo por REST con polling, que es más simple para tablas y gráficos históricos.

## Próximos pasos sugeridos

- Agregar autenticación de usuarios de tu propia app (JWT) si varias personas van a usar el dashboard. ✅ Ya implementado.
- Migrar de `synchronize: true` a migraciones de TypeORM antes de ir a producción.
- Extender el WebSocket Gateway para push de velas cerradas y de contratos abiertos/cerrados, no solo ticks.
- Agregar endpoints para comprar/vender contratos si el objetivo evoluciona hacia un bot de trading (usa `buy`/`sell` sobre el mismo `DerivWebsocketService.send()`).
