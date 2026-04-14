# 🐳 Docker Compose - ARQFI APS Data Extractor

## ¿Qué es Docker Compose?

Docker Compose te permite ejecutar **múltiples contenedores** (backend + frontend) con un solo comando. Cada contenedor es como una máquina virtual ligera que incluye todo lo necesario para ejecutar la app sin instalar Node.js localmente.

## 📋 Requisitos previos

1. **Docker Desktop** instalado en tu PC
   - Descarga desde: https://www.docker.com/products/docker-desktop
   - Incluye Docker + Docker Compose

2. **Verificar instalación**:
   ```bash
   docker --version
   docker-compose --version
   ```

## 🚀 Quickstart (3 pasos)

### Paso 1: Configurar variables de entorno

```bash
# Copiar plantilla
cp .env.docker .env

# Editar con tus credenciales APS
nano .env
# Agregar:
# APS_CLIENT_ID=tu_id_aqui
# APS_CLIENT_SECRET=tu_secret_aqui
```

### Paso 2: Construir imágenes Docker

```bash
docker-compose build
```

Primera vez toma ~2-3 minutos (descarga Node.js, instala dependencias).

### Paso 3: Iniciar la app

```bash
docker-compose up
```

Esperado:

```
revit-extractor-backend | 🚀 Server running on http://localhost:3000
revit-extractor-frontend | On Your Network: http://192.168.x.x:3001
```

## 🌐 Acceder a la app

- **Backend**: http://localhost:3000
- **Frontend**: http://localhost:3001
- **Health check**: http://localhost:3000/health

## 📝 Archivos Docker incluidos

```
revit-data-extractor/
├── docker-compose.yml          ← Orquestación de contenedores
├── .env.docker                 ← Plantilla de variables (copiar a .env)
├── backend/
│   ├── Dockerfile              ← Imagen para backend
│   └── .dockerignore           ← Qué no incluir en imagen
└── frontend/
    ├── Dockerfile              ← Imagen para frontend
    └── .dockerignore           ← Qué no incluir en imagen
```

## 🔧 Comandos útiles

### Iniciar en background (sin ver logs)

```bash
docker-compose up -d
```

### Ver logs en tiempo real

```bash
docker-compose logs -f
```

### Ver logs de un servicio específico

```bash
docker-compose logs -f backend
docker-compose logs -f frontend
```

### Detener todos los contenedores

```bash
docker-compose down
```

### Detener y eliminar volúmenes (limpieza completa)

```bash
docker-compose down -v
```

### Reconstruir imágenes (después de cambios en código)

```bash
docker-compose build --no-cache
docker-compose up
```

### Ejecutar comando en un contenedor

```bash
docker-compose exec backend npm install package-name
docker-compose exec frontend npm install package-name
```

### Ver estado de los contenedores

```bash
docker-compose ps
```

## 🔐 Variables de entorno en Docker

### .env vs .env.docker

- **`.env`** (PRIVADO - no subir a GitHub)
  - Tu archivo local con valores reales
  - Git lo ignora automáticamente (.gitignore)
  - Docker Compose lo usa: `docker-compose --env-file .env up`

- **`.env.docker`** (PÚBLICO - sube a GitHub)
  - Plantilla con estructura sin secretos
  - Referencia para otros desarrolladores

### Copiar y editar para desarrollo local

```bash
cp .env.docker .env
# Editar .env con tus credenciales APS
nano .env
```

## 🐛 Troubleshooting

### "Port 3000 already in use"

```bash
# Cambiar puerto en docker-compose.yml:
# ports:
#   - "3001:3000"  ← cambiar 3000 a 3001
docker-compose up
```

### "Cannot find module 'express'"

```bash
# Reconstruir sin cache
docker-compose build --no-cache
docker-compose up
```

### "Permission denied" en .env

```bash
chmod 644 .env
docker-compose up
```

### "Backend no responde en /health"

```bash
# Esperar 40 segundos (healthcheck timeout)
# Ver logs:
docker-compose logs backend
```

### "Frontend no carga"

```bash
# Verificar que backend está corriendo
docker-compose ps

# Ver logs
docker-compose logs frontend

# Reiniciar
docker-compose restart frontend
```

## 📊 Arquitectura Docker

```
┌─────────────────────────────────────────┐
│         Docker Compose Network          │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────────┐   │
│  │   Backend Container              │   │
│  │   • Node.js 18 Alpine            │   │
│  │   • Express Server               │   │
│  │   • APS APIs                     │   │
│  │   • Port: 3000                   │   │
│  │   • Health: /health              │   │
│  └──────────────────────────────────┘   │
│            ▲                             │
│            │ API calls                   │
│            ▼                             │
│  ┌──────────────────────────────────┐   │
│  │   Frontend Container             │   │
│  │   • Node.js 18 Alpine            │   │
│  │   • React App                    │   │
│  │   • UI Navigation                │   │
│  │   • Port: 3001                   │   │
│  └──────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
    ▲                                  ▲
    │                                  │
    └──────────────────┬───────────────┘
                       │
                   localhost
            3000 (backend)
            3001 (frontend)
```

## 🔄 Flujo de requests con Docker

1. Usuario abre: `http://localhost:3001` (Frontend container)
2. Frontend hace llamada: `GET http://localhost:3000/api/hubs` (Backend container)
3. Backend responde con datos de APS
4. Frontend renderiza en navegador

## 🚀 Desplegar Docker a producción

### Opción 1: Docker Hub + AWS ECS

```bash
# Login a Docker Hub
docker login

# Taggear imagen
docker tag revit-extractor-backend:latest tu_usuario/revit-backend:1.0

# Push
docker push tu_usuario/revit-backend:1.0

# En AWS ECS, crear tarea con esa imagen
```

### Opción 2: Google Cloud Run

```bash
# Configurar Google Cloud
gcloud auth login

# Build y push
gcloud builds submit --tag gcr.io/tu_proyecto/revit-extractor

# Deploy
gcloud run deploy revit-extractor \
  --image gcr.io/tu_proyecto/revit-extractor \
  --set-env-vars APS_CLIENT_ID=xxx,APS_CLIENT_SECRET=yyy
```

### Opción 3: Azure Container Instances

```bash
# Build
docker build -t revit-extractor:latest .

# Tag para Azure
docker tag revit-extractor:latest tu_registro.azurecr.io/revit:latest

# Push
docker push tu_registro.azurecr.io/revit:latest

# Deploy en Azure
```

## 📖 Documentación adicional

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Node.js Docker Image](https://hub.docker.com/_/node)
- [Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)

## ✅ Checklist Docker

- [ ] Docker Desktop instalado
- [ ] `docker --version` funciona
- [ ] `docker-compose --version` funciona
- [ ] `.env` creado con tus credenciales
- [ ] `docker-compose build` sin errores
- [ ] `docker-compose up` inicia sin errores
- [ ] Backend responde en http://localhost:3000/health
- [ ] Frontend carga en http://localhost:3001
- [ ] Puedes iniciar sesión con Autodesk

Si pasaste todo: ✅ **¡Docker está funcionando!**

---

## 🎯 Cuándo usar Docker vs npm

| Situación        | Usar   | Comando                                        |
| ---------------- | ------ | ---------------------------------------------- |
| Desarrollo local | npm    | `npm install && npm run dev`                   |
| Entorno aislado  | Docker | `docker-compose up`                            |
| Producción       | Docker | `docker-compose -f docker-compose.prod.yml up` |
| Testing          | Docker | `docker-compose -f docker-compose.test.yml up` |
| CI/CD            | Docker | Pipelines con imágenes Docker                  |

---

**¡Hecho con Docker! 🐳**
