# ARQFI APS Revit Data Extractor

Aplicación web para explorar Autodesk Docs/ACC y OSS, traducir modelos RVT/NWC con APS Model Derivative y consultar propiedades/metadata con una UX orientada a extracción técnica.

## Estado actual de la app

- OAuth 3-legged para Autodesk Docs/ACC (`/auth/login`, `/callback`).
- Flujo OSS directo (crear/listar/eliminar bucket, subir objeto, extraer por URN OSS).
- Modo demo público opcional sin login (`/api/demo/extract`) con límites y CAPTCHA.
- Extracción inteligente: manifest listo, traducción en curso, o encolado de job (`svf2` con fallback a `svf`).
- Panel de propiedades y analítica en frontend (categorías, tipos, métricas agregadas).
- Docker para entorno local y para despliegue tipo producción con `nginx`.

## Arquitectura

```text
frontend (React, puerto 3001 dev)
   |
   |  REST + cookie de sesión
   v
backend (Express, puerto 3000)
   |
   +--> APS Authentication (3-legged + 2-legged)
   +--> APS Data Management (hubs/proyectos/contenidos)
   +--> APS OSS (buckets/objetos/signed S3 upload)
   +--> APS Model Derivative (manifest, job, metadata, properties, tree)
```

## Estructura del proyecto

```text
aps-revit-data-extractor/
├── backend/
│   ├── server.js
│   ├── demoProtection.js
│   ├── data/demo-usage.json
│   ├── env.example
│   └── package.json
├── frontend/
│   ├── src/App.jsx
│   ├── src/App.css
│   ├── public/oauth-redirect.html
│   ├── public/oauth-popup-close.html
│   ├── env.example
│   └── package.json
├── docker-compose.yml
├── docker-compose.prod.yml
├── nginx.conf
└── README.md
```

## Requisitos

- Node.js 18+ recomendado
- npm 9+ recomendado
- Cuenta APS con app registrada
- Docker Desktop (opcional)

## Configuración de APS

1. Crea una app en [APS](https://aps.autodesk.com/).
2. Copia `Client ID` y `Client Secret`.
3. Configura callback:
   - `http://localhost:3000/callback` (local)

## Variables de entorno

### Backend (`backend/.env`)

Crear desde plantilla:

```bash
cp backend/env.example backend/.env
```

Variables clave:

- `APS_CLIENT_ID`, `APS_CLIENT_SECRET`
- `CALLBACK_URL` (default local: `http://localhost:3000/callback`)
- `FRONTEND_URL` (default local: `http://localhost:3001`)
- `SESSION_SECRET`
- `DEMO_URN_BASE64` (opcional, habilita modo demo)
- `DEMO_CAPTCHA_*` (opcional, endurecimiento demo)

### Frontend (`frontend/.env`)

Crear desde plantilla:

```bash
cp frontend/env.example frontend/.env
```

Variables clave:

- `REACT_APP_BACKEND_ORIGIN=http://localhost:3000`
- `REACT_APP_API_URL=http://localhost:3000/api`
- `REACT_APP_DEMO_CAPTCHA_SITE_KEY=` (si aplica)

## Ejecución local (sin Docker)

Terminal 1:

```bash
cd backend
npm install
npm run dev
```

Terminal 2:

```bash
cd frontend
npm install
npm start
```

URLs:

- Frontend: `http://localhost:3001`
- Backend: `http://localhost:3000`
- Health: `http://localhost:3000/health`

## Ejecución con Docker

### Desarrollo

```bash
docker compose up --build
```

### Perfil producción local

```bash
docker compose -f docker-compose.prod.yml up --build
```

Notas:

- `docker-compose.prod.yml` levanta `backend`, `frontend` y `nginx`.
- Revisa `nginx.conf` y certificados en `./ssl` si habilitas TLS local.

## Flujos funcionales soportados

### 1) Autodesk Docs/ACC (autenticado)

1. Login OAuth.
2. Navega `Hubs -> Projects -> Contents`.
3. Selecciona item RVT/NWC.
4. Ejecuta extracción (`/api/docs/extract`).

### 2) OSS de la aplicación (autenticado)

1. Crea o elige bucket.
2. Sube archivo RVT/NWC (`/api/oss/buckets/:bucketKey/upload`).
3. Ejecuta extracción (`/api/oss/extract`).

### 3) Demo pública (sin login, opcional)

1. Configura `DEMO_URN_BASE64`.
2. Activa opcionalmente CAPTCHA/rate limit.
3. Consumir extracción demo (`/api/demo/extract`).

## API principal

### Autenticación y estado

- `GET /auth/login`
- `GET /callback`
- `GET /logout`
- `GET /api/status`
- `GET /api/user-profile`

### Data Management (Docs/ACC)

- `GET /api/hubs`
- `GET /api/hubs/:hubId/projects`
- `GET /api/hubs/:hubId/projects/:projectId/contents`
- `POST /api/docs/extract`

### OSS

- `POST /api/oss/buckets`
- `GET /api/oss/buckets`
- `DELETE /api/oss/buckets/:bucketKey`
- `GET /api/oss/buckets/:bucketKey/objects`
- `DELETE /api/oss/buckets/:bucketKey/objects?objectKey=...`
- `POST /api/oss/buckets/:bucketKey/upload`
- `POST /api/oss/extract`

### Model Derivative

- `POST /api/translate`
- `GET /api/metadata/:urnBase64`
- `GET /api/properties/:urnBase64/:guid`
- `GET /api/tree/:urnBase64/:guid`

### Demo

- `POST /api/demo/extract`

## Calidad y verificación

Comandos útiles:

```bash
# backend
cd backend
node --check server.js
node --check demoProtection.js

# frontend
cd frontend
npm run build
```

## Troubleshooting rápido

- `Not authenticated`: sesión expirada o cookie bloqueada por navegador.
- `Callback mismatch`: `CALLBACK_URL` no coincide con APS app config.
- `no_properties` en Model Derivative: vista sin property DB, probar reproceso forzado.
- Error CORS: revisar `FRONTEND_URL` (backend) y `REACT_APP_API_URL` (frontend).
- Demo no visible: falta `DEMO_URN_BASE64` o `DEMO_PUBLIC_ENABLED=false`.

## Seguridad

- Nunca subir `backend/.env` ni `frontend/.env`.
- Mantener `SESSION_SECRET` fuerte en producción.
- Usar límites de rate/captcha para demo pública.

## Licencia

MIT.
