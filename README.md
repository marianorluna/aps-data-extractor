# 📐 ARQFI APS Data Extractor

> Aplicación web profesional para extraer datos, propiedades y metadatos de modelos RVT y NWC usando **Autodesk Platform Services (APS)**

![Node.js](https://img.shields.io/badge/Node.js-16+-green)
![React](https://img.shields.io/badge/React-18+-blue)
![License](https://img.shields.io/badge/License-MIT-brightgreen)

## 🎯 Características

- ✅ **Autenticación OAuth 2.0** con Autodesk
- ✅ **Navegación jerárquica** de Hubs → Proyectos → Archivos
- ✅ **Extracción de datos** de modelos RVT y NWC
- ✅ **Metadatos del modelo** y propiedades de elementos
- ✅ **Interfaz web intuitiva** y responsiva
- ✅ **Backend seguro** con gestión de tokens
- ✅ **Fácil despliegue** en Heroku, AWS, Azure, etc.

---

## 📁 Estructura del proyecto

```
revit-data-extractor/
├── backend/
│   ├── server.js              # Servidor Express principal
│   ├── package.json           # Dependencias backend
│   ├── env.example            # Variables de entorno (plantilla)
│   └── .env                   # 🔐 PRIVADO - no subir a GitHub
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Componente principal
│   │   ├── App.css            # Estilos
│   │   └── index.js
│   ├── public/
│   │   └── index.html
│   ├── package.json           # Dependencias frontend
│   ├── .env.example           # Variables de entorno (plantilla)
│   └── .env                   # 🔐 PRIVADO - no subir a GitHub
│
├── .gitignore                 # ✅ Evita subir .env
├── README.md                  # Este archivo
├── SETUP.md                   # Guía de instalación
└── docker-compose.yml         # Para desarrollo con Docker (opcional)
```

---

## 🚀 Quick Start (5 minutos)

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu_usuario/revit-data-extractor.git
cd revit-data-extractor
```

### 2. Backend Setup

```bash
cd backend

# Copiar plantilla de variables
cp env.example .env

# Editar .env con tus credenciales APS
nano .env

# Instalar dependencias
npm install

# Iniciar servidor
npm run dev
# Servidor en http://localhost:3000
```

### 3. Frontend Setup (nueva terminal)

```bash
cd frontend

# Copiar plantilla
cp .env.example .env

# Instalar dependencias
npm install

# Iniciar interfaz (puerto 3001 definido en package.json)
npm start
# App en http://localhost:3001 — API en http://localhost:3000 (REACT_APP_* en .env)
```

### 4. Autenticarse

1. Abre http://localhost:3001
2. Haz clic en **"Iniciar sesión con Autodesk"**
3. Autoriza el acceso a tus proyectos
4. ¡Navega y extrae datos!

---

## 🔑 Obtener credenciales APS

### Paso 1: Registrar tu app

1. Ve a **[aps.autodesk.com](https://aps.autodesk.com)**
2. Inicia sesión con tu cuenta Autodesk (o crea una)
3. Ve a **"My Apps"** → **"Create New App"**
4. Rellena:
   - **App Name**: "ARQFI APS Data Extractor"
   - **Description**: "Extrae datos de modelos RVT y NWC"

### Paso 2: Copiar credenciales

Después de crear la app, verás:

- **Client ID** ← Cópialo
- **Client Secret** ← Cópialo (se muestra una sola vez)

### Paso 3: Agregar callback URL

En la configuración de tu app, añade:

```
http://localhost:3000/callback
```

---

## 🔐 Gestión de secrets

### Variables sensibles (.env)

**Nunca** compartas `.env` públicamente. El archivo `.gitignore` evita que se suba a GitHub automáticamente.

**Archivos `.env.example`** sí se suben para mostrar estructura:

```env
# backend/env.example — convención local: API :3000, CRA :3001
APS_CLIENT_ID=your_client_id_here
APS_CLIENT_SECRET=your_client_secret_here
CALLBACK_URL=http://localhost:3000/callback
PORT=3000
FRONTEND_URL=http://localhost:3001
```

### En producción

Para desplegar a producción, configura variables de entorno en:

- **Heroku**: Panel → Settings → Config Vars
- **AWS/Azure**: App Configuration → Application Settings
- **GitHub Actions**: Repo → Settings → Secrets and variables

```bash
# Ejemplo Heroku
heroku config:set APS_CLIENT_ID=your_value
heroku config:set APS_CLIENT_SECRET=your_value
```

---

## 📚 API Endpoints

### Autenticación

```
GET  /auth/login           Inicia sesión OAuth
GET  /callback             Callback de Autodesk
GET  /logout               Cierra sesión
```

### Usuario

```
GET  /api/user-profile     Perfil del usuario autenticado
GET  /api/status           Estado de autenticación
```

### Data Management

```
GET  /api/hubs                              Listar hubs
GET  /api/hubs/:hubId/projects              Proyectos de un hub
GET  /api/projects/:projectId/contents      Archivos/carpetas de un proyecto
```

### Model Derivative

```
POST /api/translate                         Solicitar traducción del modelo
GET  /api/metadata/:urnBase64              Metadatos del modelo
GET  /api/properties/:urnBase64/:guid      Propiedades de un elemento
```

---

## 🐳 Con Docker (opcional)

```bash
docker-compose up -d
```

Requiere `docker-compose.yml` configurado.

---

## 🔧 Troubleshooting

| Problema                    | Solución                                                                         |
| --------------------------- | -------------------------------------------------------------------------------- |
| "ENOENT: no such file .env" | `cp backend/env.example backend/.env` y `cp frontend/.env.example frontend/.env` |
| "Client ID invalid"         | Verifica que copiaste correctamente de aps.autodesk.com                          |
| "Callback URL mismatch"     | Asegúrate que coincide en `.env` y en aps.autodesk.com                           |
| CORS error                  | Verifica que frontend hace peticiones a `http://localhost:3000/api`              |
| Token expirado              | Los tokens expiran en ~1 hora, implementar refresh                               |

Ver [SETUP.md](./SETUP.md) para más detalles.

---

## 📦 Stack técnico

| Aspecto             | Tecnología              |
| ------------------- | ----------------------- |
| **Backend**         | Node.js 16+ / Express 4 |
| **Frontend**        | React 18 / Axios        |
| **Autenticación**   | OAuth 2.0 / APS         |
| **APIs**            | REST / Axios            |
| **Estilos**         | CSS3 / Flexbox / Grid   |
| **Gestor paquetes** | npm                     |

---

## 🚢 Despliegue

### Heroku

```bash
heroku create revit-data-extractor
heroku config:set APS_CLIENT_ID=your_id APS_CLIENT_SECRET=your_secret
git push heroku main
```

### AWS Elastic Beanstalk

```bash
eb create revit-data-extractor
eb setenv APS_CLIENT_ID=your_id APS_CLIENT_SECRET=your_secret
eb deploy
```

### Azure App Service

```bash
az webapp create --resource-group myGroup --plan myPlan --name revit-data-extractor
az webapp config appsettings set --name revit-data-extractor ... --settings APS_CLIENT_ID=your_id
```

---

## 🤝 Contribuir

1. Fork el repo
2. Crea una rama (`git checkout -b feature/nueva-feature`)
3. Commit cambios (`git commit -m 'Add feature'`)
4. Push a la rama (`git push origin feature/nueva-feature`)
5. Abre un Pull Request

---

## 📝 Licencia

MIT - Libre para uso personal y comercial

---

## 🔗 Recursos

- [Documentación APS](https://aps.autodesk.com/docs/)
- [Data Management API](https://aps.autodesk.com/en/docs/data/v2/)
- [Model Derivative API](https://aps.autodesk.com/en/docs/model-derivative/v2/)
- [OAuth 2.0](https://aps.autodesk.com/en/docs/authentication/v2/)

---

## 📞 Soporte

Para issues o preguntas:

1. Abre un [GitHub Issue](https://github.com/tu_usuario/revit-data-extractor/issues)
2. Revisa [SETUP.md](./SETUP.md) para troubleshooting
3. Contacta a tu equipo de soporte APS

---

**Hecho con ❤️ para la comunidad de Autodesk**
