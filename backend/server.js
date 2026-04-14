require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const session = require('express-session');
const multer = require('multer');
const { createDemoProtection } = require('./demoProtection');

const app = express();

// Convención desarrollo local: API/backend :3000, CRA :3001 (PORT + FRONTEND_URL / package.json).
const CLIENT_ID = process.env.APS_CLIENT_ID;
const CLIENT_SECRET = process.env.APS_CLIENT_SECRET;
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:3000/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const FRONTEND_URLS = String(process.env.FRONTEND_URLS || FRONTEND_URL)
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const FRONTEND_ORIGINS = new Set(FRONTEND_URLS);
const BASE_URL = 'https://developer.api.autodesk.com';

/** URN base64 (objeto OSS público de la app, ya traducido) para modo demo sin sesión. Opcional. */
const DEMO_URN_BASE64 = String(process.env.DEMO_URN_BASE64 || '').trim();
const DEMO_MODEL_LABEL = String(process.env.DEMO_MODEL_LABEL || 'Modelo de ejemplo').trim();
const demoProtection = createDemoProtection({ demoUrnBase64: DEMO_URN_BASE64 });

/** Cabeceras comunes para APIs APS (JSON:API / JSON). */
const apsHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/json',
});

/** Scopes 2-legged para OSS + Model Derivative (subida y job). */
const TWO_LEGGED_SCOPES = [
  'bucket:create',
  'bucket:read',
  'bucket:delete',
  'data:read',
  'data:write',
].join(' ');

let twoLeggedCache = { token: null, expiresAtMs: 0 };

async function getTwoLeggedToken() {
  const skewMs = 60_000;
  if (twoLeggedCache.token && Date.now() < twoLeggedCache.expiresAtMs - skewMs) {
    return twoLeggedCache.token;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: TWO_LEGGED_SCOPES,
  });
  const res = await axios.post(`${BASE_URL}/authentication/v2/token`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const expiresIn = res.data.expires_in || 3500;
  twoLeggedCache = {
    token: res.data.access_token,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };
  return twoLeggedCache.token;
}

function safeDecodeUrnFromBase64(urnBase64) {
  if (!urnBase64 || typeof urnBase64 !== 'string') return '';
  let b64 = urnBase64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (b64.length % 4)) % 4;
  if (pad) b64 += '='.repeat(pad);
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function isOssObjectUrn(urn) {
  return typeof urn === 'string' && urn.includes('adsk.objects:os.object');
}

/** Almacenamiento WIP de ACC/Docs: el objeto es `os.object` pero el acceso a MD va con token del usuario. */
function isWipManagedOssUrn(urn) {
  if (!isOssObjectUrn(urn) || typeof urn !== 'string') return false;
  const lower = urn.toLowerCase();
  return lower.includes('wip.dm.') || lower.includes('wip.em.');
}

function isDemoOssUrnConfigured() {
  if (!DEMO_URN_BASE64) return false;
  const urn = safeDecodeUrnFromBase64(DEMO_URN_BASE64);
  return isOssObjectUrn(urn) && !isWipManagedOssUrn(urn);
}

/**
 * Token para Model Derivative: sesión OAuth, o 2-legged solo si el URN coincide con el demo OSS configurado.
 * @returns {Promise<string|null>}
 */
async function resolveModelDerivativeToken(req, urnBase64) {
  if (!urnBase64 || typeof urnBase64 !== 'string') return null;
  if (DEMO_URN_BASE64 && urnBase64 === DEMO_URN_BASE64) {
    const urn = safeDecodeUrnFromBase64(urnBase64);
    if (isOssObjectUrn(urn) && !isWipManagedOssUrn(urn)) {
      return getTwoLeggedToken();
    }
  }
  if (!req.session?.accessToken) return null;
  return tokenForDerivativeApi(urnBase64, req.session.accessToken);
}

async function tokenForDerivativeApi(urnBase64, sessionToken) {
  const urn = safeDecodeUrnFromBase64(urnBase64);
  if (isOssObjectUrn(urn) && !isWipManagedOssUrn(urn)) {
    return getTwoLeggedToken();
  }
  return sessionToken;
}

function normalizeBucketKey(input) {
  let s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  if (s.length < 3) {
    s = `rvt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return s.slice(0, 128);
}

function sanitizeObjectKey(originalName) {
  return String(originalName || 'model.rvt')
    .replace(/[/\\]/g, '_')
    .trim() || 'model.rvt';
}

function publicOssObjectUrn(bucketKey, objectKey) {
  return `urn:adsk.objects:os.object:${bucketKey}/${objectKey}`;
}

/** Partes de 5 MiB (exigido por APS para multipart); la última parte puede ser menor. */
const OSS_S3_CHUNK_BYTES = 5 * 1024 * 1024;
const OSS_S3_MAX_SIGNED_URLS_PER_BATCH = 25;

/**
 * Sube un buffer a OSS vía URLs firmadas S3 (reemplazo del PUT legacy deprecado).
 * @see https://github.com/autodesk-platform-services/aps-directToS3
 */
async function uploadBufferViaSignedS3(token, bucketKey, objectKey, buffer) {
  const authHeaders = apsHeaders(token);
  const totalParts = Math.max(1, Math.ceil(buffer.length / OSS_S3_CHUNK_BYTES));
  let partsUploaded = 0;
  /** @type {string[]} */
  let uploadUrls = [];
  let uploadKey;

  while (partsUploaded < totalParts) {
    const start = partsUploaded * OSS_S3_CHUNK_BYTES;
    const end = Math.min(start + OSS_S3_CHUNK_BYTES, buffer.length);
    const chunk = buffer.subarray(start, end);

    while (true) {
      if (uploadUrls.length === 0) {
        const batchCount = Math.min(totalParts - partsUploaded, OSS_S3_MAX_SIGNED_URLS_PER_BATCH);
        const firstPart = partsUploaded + 1;
        const q = new URLSearchParams({
          parts: String(batchCount),
          firstPart: String(firstPart),
        });
        if (uploadKey) q.set('uploadKey', uploadKey);

        const signedRes = await axios.get(
          `${BASE_URL}/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3upload?${q.toString()}`,
          { headers: authHeaders }
        );
        const data = signedRes.data;
        uploadUrls = Array.isArray(data.urls) ? [...data.urls] : [];
        uploadKey = data.uploadKey;
        if (!uploadKey || uploadUrls.length === 0) {
          const err = new Error('signeds3upload: sin urls ni uploadKey en la respuesta');
          err.responseBody = data;
          throw err;
        }
      }

      const s3Url = uploadUrls.shift();
      if (!s3Url) {
        const err = new Error('signeds3upload: URL vacía');
        throw err;
      }

      try {
        await axios.put(s3Url, chunk, {
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
        break;
      } catch (putErr) {
        const st = putErr.response?.status;
        if (st === 403) {
          uploadUrls = [];
        } else {
          throw putErr;
        }
      }
    }
    partsUploaded += 1;
  }

  const completeRes = await axios.post(
    `${BASE_URL}/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3upload`,
    { uploadKey },
    {
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        'x-ads-meta-Content-Type': 'application/octet-stream',
      },
    }
  );
  return completeRes.data;
}

function urnToDerivativeBase64(urn) {
  return Buffer.from(urn, 'utf8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Recorre el manifest MD y separa geometría/vistas, miniaturas y otros recursos (por guid). */
function categorizeManifestDerivatives(manifestData) {
  const derivatives =
    manifestData?.data?.derivatives || manifestData?.derivatives || [];
  const geometryViews = [];
  const thumbnails = [];
  const otherResources = [];
  const seenGeom = new Set();
  const seenThumb = new Set();
  const seenOther = new Set();

  function excluded(node) {
    const r = String(node.role || '').toLowerCase();
    if (r.includes('propertydatabase')) return true;
    return false;
  }

  function isThumbnailNode(node) {
    const r = String(node.role || '').toLowerCase();
    const n = String(node.name || '').toLowerCase();
    if (r.includes('thumbnail')) return true;
    if (n === 'original-thumbnail' || n.endsWith('-thumbnail')) return true;
    return false;
  }

  function isPrimaryViewable(node) {
    if (!node.guid || excluded(node) || isThumbnailNode(node)) return false;
    const role = String(node.role || '').toLowerCase();
    const type = String(node.type || '').toLowerCase();
    if (role === '3d' || role === '2d' || role === 'graphics') return true;
    if (type === 'geometry' || type === 'view') return true;
    if (type === 'resource' && String(node.mime || '').includes('svf')) return true;
    return false;
  }

  function walk(node, parentLabel) {
    if (!node || typeof node !== 'object') return;
    const label = node.name || parentLabel || '';
    if (node.guid && !excluded(node)) {
      if (isThumbnailNode(node)) {
        if (!seenThumb.has(node.guid)) {
          seenThumb.add(node.guid);
          thumbnails.push({
            name: node.name || '(miniatura)',
            role: node.role || 'thumbnail',
            guid: node.guid,
          });
        }
      } else if (isPrimaryViewable(node)) {
        if (!seenGeom.has(node.guid)) {
          seenGeom.add(node.guid);
          geometryViews.push({
            name: node.name || label || '(sin nombre)',
            role: node.role || node.type,
            guid: node.guid,
          });
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c, label);
    }
  }

  for (const deriv of derivatives) {
    walk(deriv, deriv.name || deriv.outputType || '');
  }

  function walkOther(node) {
    if (!node || typeof node !== 'object') return;
    if (
      node.guid &&
      !excluded(node) &&
      !seenGeom.has(node.guid) &&
      !seenThumb.has(node.guid) &&
      !seenOther.has(node.guid)
    ) {
      seenOther.add(node.guid);
      otherResources.push({
        name: node.name || '(recurso)',
        role: node.role || node.type || '—',
        guid: node.guid,
      });
    }
    if (Array.isArray(node.children)) node.children.forEach(walkOther);
  }
  for (const deriv of derivatives) walkOther(deriv);

  return { geometryViews, thumbnails, otherResources };
}

/**
 * Flujo Model Derivative: manifest → listo / en curso / encolar job.
 * Usa token 2-legged para URN `os.object` público y 3-legged para WIP/Docs.
 * @param {string} urnBase64
 * @param {string} sessionAccessToken
 * @returns {Promise<object>} Payload JSON para el cliente (sin designUrn).
 */
async function runDerivativeExtractFlow(urnBase64, sessionAccessToken, options = {}) {
  const forceReprocess = options.forceReprocess === true;
  const mdToken = await tokenForDerivativeApi(urnBase64, sessionAccessToken);
  const mdHeaders = { Authorization: `Bearer ${mdToken}` };

  let manifestData = null;
  try {
    const manifestRes = await axios.get(
      `${BASE_URL}/modelderivative/v2/designdata/${urnBase64}/manifest`,
      { headers: mdHeaders }
    );
    manifestData = manifestRes.data;
  } catch (mfErr) {
    if (mfErr.response?.status !== 404) {
      console.error('❌ extract manifest:', mfErr.response?.data || mfErr.message);
      const st = mfErr.response?.status || 500;
      const err = new Error('manifest_failed');
      err.httpStatus = st >= 400 && st < 600 ? st : 500;
      err.responseBody = {
        error: 'Error al leer el manifest',
        details: mfErr.response?.data || mfErr.message,
      };
      throw err;
    }
  }

  if (manifestData && !forceReprocess) {
    const derivsEarly =
      manifestData?.data?.derivatives || manifestData?.derivatives || [];
    const anyDerivativeReady = derivsEarly.some(
      (d) =>
        d.status === 'success' ||
        d.progress === 'complete' ||
        d.progress === '100%'
    );
    const progressStatus =
      manifestData?.data?.status ||
      manifestData?.status ||
      (anyDerivativeReady ? 'success' : undefined);

    if (progressStatus === 'inprogress' || progressStatus === 'pending') {
      const pct =
        manifestData?.data?.progress || manifestData?.progress || 'desconocido';
      return {
        status: 'translating',
        urnBase64,
        message: `La traducción está en curso (${pct}). Espera unos segundos y vuelve a pulsar «Extraer».`,
      };
    }

    if (progressStatus === 'success' || progressStatus === 'complete') {
      const { geometryViews, thumbnails, otherResources } =
        categorizeManifestDerivatives(manifestData);

      let metadataPayload = null;
      let metadataHasPropertyDb = false;
      try {
        const metaRes = await axios.get(
          `${BASE_URL}/modelderivative/v2/designdata/${urnBase64}/metadata`,
          { headers: mdHeaders }
        );
        metadataPayload = metaRes.data;
        const metaList =
          metaRes.data?.data?.metadata || metaRes.data?.metadata || [];
        if (Array.isArray(metaList) && metaList.length > 0) {
          metadataHasPropertyDb = true;
          for (const m of metaList) {
            if (!geometryViews.find((v) => v.guid === m.guid)) {
              geometryViews.push({ name: m.name, role: m.role, guid: m.guid });
            }
          }
        }
      } catch (metaErr) {
        console.warn(
          '⚠️ extract metadata (no-fatal):',
          metaErr.response?.data?.diagnostic || metaErr.message
        );
      }

      return {
        status: 'ready',
        urnBase64,
        metadata: metadataPayload,
        views: geometryViews,
        thumbnails,
        otherResources,
        metadataHasPropertyDb,
        canRetryWithForce: !metadataHasPropertyDb,
        recoveryHint: !metadataHasPropertyDb
          ? 'No hay base de propiedades publicada. Reintenta con reproceso forzado.'
          : null,
        manifestStatus: progressStatus,
        manifestProgress: manifestData?.data?.progress || manifestData?.progress || null,
      };
    }

    const err = new Error('translation_state');
    err.httpStatus = 422;
    err.responseBody = {
      error: `La traducción terminó con estado "${progressStatus}"`,
      details: manifestData,
    };
    throw err;
  }

  const jobInput = { urn: urnBase64 };
  const jobHeaders = {
    Authorization: `Bearer ${mdToken}`,
    'Content-Type': 'application/json',
    'x-ads-force': 'true',
  };

  const postJob = (format) =>
    axios.post(
      `${BASE_URL}/modelderivative/v2/designdata/job`,
      {
        input: jobInput,
        output: { formats: [{ type: format, views: ['2d', '3d'] }] },
      },
      { headers: jobHeaders }
    );

  let jobFormat = null;
  let lastJobErr = null;
  for (const fmt of ['svf2', 'svf']) {
    try {
      const jobRes = await postJob(fmt);
      console.log(`✅ extract job ${fmt}:`, jobRes.data?.result || jobRes.status);
      jobFormat = fmt;
      break;
    } catch (jobErr) {
      const body = jobErr.response?.data;
      const hasDiagnostic = typeof body?.diagnostic === 'string';
      console.warn(`⚠️ extract job ${fmt}:`, body || jobErr.message);
      lastJobErr = jobErr;
      if (!hasDiagnostic) break;
    }
  }

  if (!jobFormat) {
    const body = lastJobErr?.response?.data;
    const err = new Error('job_failed');
    err.httpStatus = 500;
    err.responseBody = {
      error: 'No se pudo encolar la traducción (ni SVF2 ni SVF)',
      details: body || lastJobErr?.message,
    };
    throw err;
  }

  return {
    status: 'translation_started',
    format: jobFormat,
    urnBase64,
    forced: forceReprocess,
    canRetryWithForce: false,
    message:
      jobFormat === 'svf2'
        ? forceReprocess
          ? 'Se encoló un reproceso forzado SVF2. Espera 1-5 minutos y vuelve a pulsar «Extraer».'
          : 'Se ha encolado la traducción SVF2. Espera 1-5 minutos y vuelve a pulsar «Extraer».'
        : forceReprocess
          ? 'SVF2 no fue compatible; se encoló un reproceso forzado en SVF. Espera 1-5 minutos y vuelve a pulsar «Extraer».'
          : 'SVF2 no es compatible con este archivo; se ha encolado la traducción SVF. Espera 1-5 minutos y vuelve a pulsar «Extraer».',
  };
}

function requireUserSession(req, res, next) {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function estimateDemoExtractBudget(req) {
  const forceReprocess = req.body?.forceReprocess === true;
  return {
    mdBasic: 2,
    dmBasic: 0,
    mdSimpleJobs: forceReprocess ? 0 : 1,
    mdComplexJobs: forceReprocess ? 1 : 0,
  };
}

function demoReadRateLimitIfNeeded(req, res, next) {
  const urnBase64 = req.params?.urnBase64;
  if (!demoProtection.isAnonymousDemoDataRequest(req, urnBase64)) return next();
  return demoProtection.rateLimitRead(req, res, next);
}

function demoReadBudgetGuardIfNeeded(req, res, next) {
  const urnBase64 = req.params?.urnBase64;
  if (!demoProtection.isAnonymousDemoDataRequest(req, urnBase64)) return next();
  return demoProtection.guardBudget({ mdBasic: 1 })(req, res, next);
}

const ossUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/\.(rvt|nwc)$/i.test(file.originalname)) {
      cb(new Error('Solo archivos .rvt o .nwc'));
      return;
    }
    cb(null, true);
  },
});

// Validar que tenemos credenciales
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ ERROR: APS_CLIENT_ID y APS_CLIENT_SECRET no están configurados en .env');
  process.exit(1);
}

// Chrome DevTools pide este archivo; un 404 de Express añade CSP default-src 'none' y llena la consola de avisos.
app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
  res.type('application/json').send('{}');
});

// Raíz: evitar 404 con CSP estricta (p. ej. tras OAuth) y llevar al CRA.
app.get('/', (_req, res) => {
  res.redirect(FRONTEND_URL);
});

// Middleware: el CRA (:3001) llama a la API (:3000) con cookies de sesión (OAuth).
app.set('trust proxy', 1);
app.use(
  cors({
    origin: (origin, callback) => {
      // Permite llamadas server-to-server/healthchecks sin header Origin.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (FRONTEND_ORIGINS.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS bloqueado para origen: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(session({
  proxy: process.env.NODE_ENV === 'production',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

// ============ AUTENTICACIÓN OAUTH ============

/**
 * Paso 1: Redirigir al usuario a Autodesk para autorización
 */
app.get('/auth/login', (req, res) => {
  /** Si el login se abre en ventana emergente, el callback redirige a una página que avisa al opener. */
  req.session.oauthInPopup = req.query.popup === '1';
  // data:read + account:read: Data Management (hubs/proyectos). Sin account:read APS responde AUTH-010 en /project/v1/hubs.
  /** data:write: encolar Model Derivative si el .rvt de Docs aún no tiene derivados */
  const oauthScopes = ['data:read', 'data:write', 'account:read'].join(' ');
  const authUrl = `${BASE_URL}/authentication/v2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&scope=${encodeURIComponent(oauthScopes)}`;
  res.redirect(authUrl);
});

/**
 * Paso 2: Callback - Autodesk redirige aquí con un código
 */
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No authorization code received');

  try {
    // Intercambiar código por access token
    const tokenResponse = await axios.post(`${BASE_URL}/authentication/v2/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: CALLBACK_URL
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // Guardar tokens en sesión
    req.session.accessToken = tokenResponse.data.access_token;
    req.session.refreshToken = tokenResponse.data.refresh_token;
    req.session.expiresIn = tokenResponse.data.expires_in;

    const popupFlow = req.session.oauthInPopup === true;
    delete req.session.oauthInPopup;
    const frontendBase = String(FRONTEND_URL || '').replace(/\/+$/, '');
    if (popupFlow) {
      return res.redirect(`${frontendBase}/oauth-popup-close.html`);
    }
    return res.redirect(FRONTEND_URL);
  } catch (error) {
    console.error('❌ Error en callback:', error.response?.data || error.message);
    res.status(500).send('Authentication failed');
  }
});

/**
 * Obtener perfil del usuario autenticado
 */
app.get('/api/user-profile', async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const userProfile = await axios.get(`${BASE_URL}/userprofile/v1/users/@me`, {
      headers: { Authorization: `Bearer ${req.session.accessToken}` }
    });

    res.json(userProfile.data);
  } catch (error) {
    console.error('❌ Error fetching profile:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ============ DATA MANAGEMENT API ============

/**
 * Listar hubs del usuario (cuentas Autodesk)
 */
app.get('/api/hubs', async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const hubs = await axios.get(`${BASE_URL}/project/v1/hubs`, {
      headers: apsHeaders(req.session.accessToken),
    });

    res.json(hubs.data);
  } catch (error) {
    console.error('❌ Error fetching hubs:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch hubs' });
  }
});

/**
 * Listar proyectos dentro de un hub
 */
app.get('/api/hubs/:hubId/projects', async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { hubId } = req.params;
    const projects = await axios.get(
      `${BASE_URL}/project/v1/hubs/${encodeURIComponent(hubId)}/projects`,
      { headers: apsHeaders(req.session.accessToken) }
    );

    res.json(projects.data);
  } catch (error) {
    console.error('❌ Error fetching projects:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/**
 * Listar carpetas (y luego archivos) en un proyecto.
 * Raíz: topFolders (Project API). Subcarpeta: Data API folder contents.
 */
app.get('/api/hubs/:hubId/projects/:projectId/contents', async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { hubId, projectId } = req.params;
    const folderId = req.query.folderId;
    const token = req.session.accessToken;
    const headers = apsHeaders(token);

    let contents;
    if (!folderId) {
      const top = await axios.get(
        `${BASE_URL}/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`,
        { headers }
      );
      contents = top.data;
    } else {
      const folder = await axios.get(
        `${BASE_URL}/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`,
        { headers }
      );
      contents = folder.data;
    }

    res.json(contents);
  } catch (error) {
    console.error('❌ Error fetching contents:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch contents' });
  }
});

/**
 * Resolver URN de almacenamiento del ítem (tip) y consultar Model Derivative.
 * Usa siempre el token 3-legged del usuario (ACC/Docs no debe usar 2-legged en MD).
 */
app.post('/api/docs/extract', async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { projectId, itemId, forceReprocess } = req.body || {};
  if (!projectId || !itemId) {
    return res.status(400).json({ error: 'projectId e itemId son obligatorios' });
  }

  const token = req.session.accessToken;
  const headers = apsHeaders(token);

  try {
    const tipUrl = `${BASE_URL}/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/tip`;
    const tipRes = await axios.get(tipUrl, {
      headers,
      params: { include: 'storage' },
    });

    const versionNode = tipRes.data?.data;
    const storageData = versionNode?.relationships?.storage?.data;
    let storageUrn = storageData?.id;
    if (!storageUrn && Array.isArray(tipRes.data?.included)) {
      const match = tipRes.data.included.find(
        (inc) => inc.type === 'objects' && (!storageData?.id || inc.id === storageData.id)
      );
      storageUrn = match?.id;
    }

    /** MD acepta el id de la versión (wip/fs.file) o el URN de storage; el primero evita 404 en muchos hubs ACC/Fusion. */
    const versionUrn =
      versionNode?.type === 'versions' && typeof versionNode.id === 'string'
        ? versionNode.id
        : null;
    const designUrn = versionUrn || storageUrn;

    if (!designUrn || typeof designUrn !== 'string') {
      return res.status(422).json({
        error: 'Sin identificador de diseño',
        details:
          'No se pudo obtener la versión punta ni el storage del ítem. Revisa permisos y el ítem seleccionado.',
      });
    }

    const urnBase64 = urnToDerivativeBase64(designUrn);

    try {
      const payload = await runDerivativeExtractFlow(urnBase64, req.session.accessToken, {
        forceReprocess: forceReprocess === true,
      });
      return res.json({
        ...payload,
        designUrn,
        storageUrn: storageUrn || undefined,
        storageUrnBase64: storageUrn ? urnToDerivativeBase64(storageUrn) : undefined,
      });
    } catch (flowErr) {
      if (flowErr.httpStatus && flowErr.responseBody) {
        return res.status(flowErr.httpStatus).json(flowErr.responseBody);
      }
      throw flowErr;
    }
  } catch (error) {
    console.error('❌ extract:', error.response?.data || error.message);
    const st = error.response?.status;
    if (st === 404) {
      return res.status(404).json({
        error: 'Ítem o proyecto no encontrado',
        details: error.response?.data || error.message,
      });
    }
    res.status(500).json({
      error: 'Fallo al extraer',
      details: error.response?.data || error.message,
    });
  }
});

/**
 * Modo demo: manifest/vistas del URN DEMO (OSS) sin sesión. Requiere DEMO_URN_BASE64 válido en entorno.
 */
app.post(
  '/api/demo/extract',
  demoProtection.requireDemoPublicEnabled,
  demoProtection.rateLimitExtract,
  demoProtection.requireCaptchaForDemo,
  demoProtection.guardBudget((req) => estimateDemoExtractBudget(req)),
  async (req, res) => {
  if (!isDemoOssUrnConfigured()) {
    return res.status(503).json({
      error: 'Demo no configurada',
      details:
        'Define DEMO_URN_BASE64 (URN base64 de un objeto OSS de esta app, con derivados listos). Opcional: DEMO_MODEL_LABEL.',
    });
  }
  const forceReprocess = req.body?.forceReprocess === true;
  try {
    const sessionTok = req.session?.accessToken || '';
    const payload = await runDerivativeExtractFlow(DEMO_URN_BASE64, sessionTok, {
      forceReprocess,
    });
    const usageDelta = {
      mdBasic: 2,
      dmBasic: 0,
      mdSimpleJobs: payload.status === 'translation_started' && !forceReprocess ? 1 : 0,
      mdComplexJobs: payload.status === 'translation_started' && forceReprocess ? 1 : 0,
    };
    demoProtection.addUsage(usageDelta);
    const designUrn = safeDecodeUrnFromBase64(DEMO_URN_BASE64);
    return res.json({
      ...payload,
      designUrn,
      source: 'demo',
      demoLabel: DEMO_MODEL_LABEL,
    });
  } catch (flowErr) {
    if (flowErr.httpStatus && flowErr.responseBody) {
      return res.status(flowErr.httpStatus).json(flowErr.responseBody);
    }
    console.error('❌ demo/extract:', flowErr.response?.data || flowErr.message);
    res.status(500).json({
      error: 'Fallo al cargar la demo',
      details: flowErr.response?.data || flowErr.message,
    });
  }
}
);

// ============ OSS (Object Storage Service) — 2-legged, sesión de usuario obligatoria ============

/**
 * Crear bucket transitorio (~24 h). bucketKey opcional (se normaliza).
 */
app.post('/api/oss/buckets', requireUserSession, async (req, res) => {
  const bucketKey = normalizeBucketKey(req.body?.bucketKey);
  try {
    const token = await getTwoLeggedToken();
    await axios.post(
      `${BASE_URL}/oss/v2/buckets`,
      { bucketKey, policyKey: 'transient' },
      { headers: { ...apsHeaders(token), 'Content-Type': 'application/json' } }
    );
    res.status(201).json({ bucketKey, policyKey: 'transient' });
  } catch (error) {
    if (error.response?.status === 409) {
      return res.status(200).json({ bucketKey, alreadyExists: true });
    }
    console.error('❌ Error creating OSS bucket:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to create bucket',
      details: error.response?.data || error.message,
    });
  }
});

/**
 * Eliminar bucket OSS y todos sus objetos (irreversible).
 */
app.delete('/api/oss/buckets/:bucketKey', requireUserSession, async (req, res) => {
  const bucketKey = normalizeBucketKey(req.params.bucketKey);
  try {
    const token = await getTwoLeggedToken();
    await axios.delete(
      `${BASE_URL}/oss/v2/buckets/${encodeURIComponent(bucketKey)}`,
      { headers: apsHeaders(token) }
    );
    res.status(204).end();
  } catch (error) {
    console.error('❌ OSS delete bucket:', error.response?.data || error.message);
    const st = error.response?.status;
    if (st === 404) {
      return res.status(404).json({
        error: 'Bucket no encontrado',
        details: error.response?.data || error.message,
      });
    }
    res.status(500).json({
      error: 'Failed to delete bucket',
      details: error.response?.data || error.message,
    });
  }
});

/**
 * Listar buckets OSS de la aplicación (token 2-legged).
 */
app.get('/api/oss/buckets', requireUserSession, async (req, res) => {
  try {
    const token = await getTwoLeggedToken();
    const params = {};
    if (req.query.region) params.region = String(req.query.region);
    const lim = Number(req.query.limit);
    if (Number.isFinite(lim) && lim > 0) params.limit = Math.min(lim, 100);
    if (req.query.startAt) params.startAt = String(req.query.startAt);
    const r = await axios.get(`${BASE_URL}/oss/v2/buckets`, {
      headers: apsHeaders(token),
      params,
    });
    res.json(r.data);
  } catch (error) {
    console.error('❌ OSS list buckets:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to list buckets',
      details: error.response?.data || error.message,
    });
  }
});

/**
 * Listar objetos de un bucket (incluye urn / urnBase64 por ítem).
 */
app.get('/api/oss/buckets/:bucketKey/objects', requireUserSession, async (req, res) => {
  const bucketKey = normalizeBucketKey(req.params.bucketKey);
  try {
    const token = await getTwoLeggedToken();
    const params = {};
    const lim = Number(req.query.limit);
    if (Number.isFinite(lim) && lim > 0) params.limit = Math.min(lim, 100);
    if (req.query.beginsWith) params.beginsWith = String(req.query.beginsWith);
    if (req.query.startAt) params.startAt = String(req.query.startAt);
    const r = await axios.get(
      `${BASE_URL}/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects`,
      { headers: apsHeaders(token), params }
    );
    const data = r.data;
    const itemsRaw = Array.isArray(data.items) ? data.items : [];
    const items = itemsRaw.map((it) => {
      const key = it.objectKey || it.name || '';
      const urn = publicOssObjectUrn(bucketKey, key);
      return {
        bucketKey: it.bucketKey || bucketKey,
        objectKey: key,
        size: it.size,
        urn,
        urnBase64: urnToDerivativeBase64(urn),
      };
    });
    res.json({
      items,
      next: typeof data.next === 'string' ? data.next : null,
    });
  } catch (error) {
    console.error('❌ OSS list objects:', error.response?.data || error.message);
    const st = error.response?.status;
    if (st === 404) {
      return res.status(404).json({
        error: 'Bucket no encontrado',
        details: error.response?.data || error.message,
      });
    }
    res.status(500).json({
      error: 'Failed to list objects',
      details: error.response?.data || error.message,
    });
  }
});

/**
 * Eliminar un objeto de un bucket OSS (irreversible).
 * Query param requerido: objectKey
 */
app.delete('/api/oss/buckets/:bucketKey/objects', requireUserSession, async (req, res) => {
  const bucketKey = normalizeBucketKey(req.params.bucketKey);
  const objectKeyRaw = req.query?.objectKey;
  const objectKey = typeof objectKeyRaw === 'string' ? objectKeyRaw.trim() : '';
  if (!objectKey) {
    return res.status(400).json({ error: 'Falta objectKey en query string' });
  }
  try {
    const token = await getTwoLeggedToken();
    await axios.delete(
      `${BASE_URL}/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}`,
      { headers: apsHeaders(token) }
    );
    res.status(204).end();
  } catch (error) {
    console.error('❌ OSS delete object:', error.response?.data || error.message);
    const st = error.response?.status;
    if (st === 404) {
      return res.status(404).json({
        error: 'Objeto o bucket no encontrado',
        details: error.response?.data || error.message,
      });
    }
    res.status(500).json({
      error: 'Failed to delete object',
      details: error.response?.data || error.message,
    });
  }
});

/**
 * Subir un .rvt al bucket (crea el bucket si no existe).
 * multipart field name: file
 */
app.post(
  '/api/oss/buckets/:bucketKey/upload',
  requireUserSession,
  ossUpload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Falta el archivo (campo file)' });
    }
    const bucketKey = normalizeBucketKey(req.params.bucketKey);
    const objectKey = sanitizeObjectKey(req.file.originalname);

    const respondSuccess = (createdBucket) => {
      const urn = publicOssObjectUrn(bucketKey, objectKey);
      const urnBase64 = urnToDerivativeBase64(urn);
      const payload = {
        bucketKey,
        objectKey,
        urn,
        urnBase64,
        size: req.file.size,
      };
      if (createdBucket) payload.createdBucket = true;
      res.json(payload);
    };

    const runUpload = async () => {
      const token = await getTwoLeggedToken();
      await uploadBufferViaSignedS3(token, bucketKey, objectKey, req.file.buffer);
    };

    try {
      await runUpload();
      respondSuccess(false);
    } catch (error) {
      if (error.response?.status === 404) {
        try {
          const token = await getTwoLeggedToken();
          await axios.post(
            `${BASE_URL}/oss/v2/buckets`,
            { bucketKey, policyKey: 'transient' },
            { headers: { ...apsHeaders(token), 'Content-Type': 'application/json' } }
          );
        } catch (createErr) {
          if (createErr.response?.status !== 409) {
            console.error('❌ OSS create after 404:', createErr.response?.data || createErr.message);
            return res.status(500).json({ error: 'Bucket no encontrado y no se pudo crear' });
          }
        }
        try {
          await runUpload();
          return respondSuccess(true);
        } catch (retryErr) {
          console.error('❌ OSS upload retry:', retryErr.response?.data || retryErr.message);
          return res.status(500).json({
            error: 'Upload failed',
            details: retryErr.response?.data || retryErr.message,
          });
        }
      }
      console.error('❌ Error uploading to OSS:', error.response?.data || error.message);
      res.status(500).json({
        error: 'Upload failed',
        details: error.response?.data || error.message,
      });
    }
  }
);

/**
 * Consultar manifest / encolar traducción / vistas para un objeto OSS directo (urnBase64 del .rvt subido).
 */
app.post('/api/oss/extract', requireUserSession, async (req, res) => {
  const { urnBase64, forceReprocess } = req.body || {};
  if (!urnBase64 || typeof urnBase64 !== 'string') {
    return res.status(400).json({ error: 'urnBase64 es obligatorio' });
  }
  const urn = safeDecodeUrnFromBase64(urnBase64);
  if (!isOssObjectUrn(urn) || isWipManagedOssUrn(urn)) {
    return res.status(400).json({
      error: 'URN no válido para extracción OSS directa',
      details: 'Se espera urn:adsk.objects:os.object:bucket/objeto (almacenamiento público de la app, no WIP/ACC).',
    });
  }
  try {
    const payload = await runDerivativeExtractFlow(urnBase64, req.session.accessToken, {
      forceReprocess: forceReprocess === true,
    });
    return res.json({
      ...payload,
      designUrn: urn,
      source: 'oss',
    });
  } catch (flowErr) {
    if (flowErr.httpStatus && flowErr.responseBody) {
      return res.status(flowErr.httpStatus).json(flowErr.responseBody);
    }
    console.error('❌ oss/extract:', flowErr.response?.data || flowErr.message);
    res.status(500).json({
      error: 'Fallo al extraer desde OSS',
      details: flowErr.response?.data || flowErr.message,
    });
  }
});

// ============ MODEL DERIVATIVE API ============

/**
 * Solicitar traducción de un archivo (generar derivados)
 */
app.post('/api/translate', async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { urnBase64 } = req.body;
    if (!urnBase64) {
      return res.status(400).json({ error: 'urnBase64 requerido' });
    }

    const token = await tokenForDerivativeApi(urnBase64, req.session.accessToken);

    const response = await axios.post(
      `${BASE_URL}/modelderivative/v2/designdata/job`,
      {
        input: { urn: urnBase64 },
        output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('❌ Error in translation:', error.response?.data || error.message);
    res.status(500).json({ error: 'Translation failed' });
  }
});

/**
 * Obtener metadatos del modelo
 */
app.get('/api/metadata/:urnBase64', demoReadRateLimitIfNeeded, demoReadBudgetGuardIfNeeded, async (req, res) => {
  try {
    const { urnBase64 } = req.params;
    const countDemoUsage = demoProtection.isAnonymousDemoDataRequest(req, urnBase64);
    const token = await resolveModelDerivativeToken(req, urnBase64);
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const metadata = await axios.get(
      `${BASE_URL}/modelderivative/v2/designdata/${encodeURIComponent(urnBase64)}/metadata`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (countDemoUsage) demoProtection.addUsage({ mdBasic: 1 });
    res.json(metadata.data);
  } catch (error) {
    const { urnBase64 } = req.params;
    const countDemoUsage = demoProtection.isAnonymousDemoDataRequest(req, urnBase64);
    const st = error.response?.status;
    const body = error.response?.data || { message: error.message };
    console.error('❌ Error fetching metadata:', body);
    const outStatus = typeof st === 'number' && st >= 400 && st < 600 ? st : 500;
    if (countDemoUsage && outStatus !== 401) demoProtection.addUsage({ mdBasic: 1 });
    res.status(outStatus).json({ error: 'Failed to fetch metadata', details: body });
  }
});

/**
 * Obtener propiedades de objetos del modelo.
 * Usa siempre el URN de diseño (version fs.file) con token 3-legged.
 * El storageUrn WIP nunca es válido para este endpoint en APS.
 */
app.get('/api/properties/:urnBase64/:guid', demoReadRateLimitIfNeeded, demoReadBudgetGuardIfNeeded, async (req, res) => {
  const { urnBase64, guid } = req.params;
  const countDemoUsage = demoProtection.isAnonymousDemoDataRequest(req, urnBase64);

  try {
    const token = await resolveModelDerivativeToken(req, urnBase64);
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const mdUrl = `${BASE_URL}/modelderivative/v2/designdata/${encodeURIComponent(urnBase64)}/metadata/${encodeURIComponent(guid)}/properties`;
    const properties = await axios.get(mdUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (countDemoUsage) demoProtection.addUsage({ mdBasic: 1 });
    return res.json(properties.data);
  } catch (err) {
    const st = err.response?.status;
    const body = err.response?.data || { message: err.message };
    if (st === 404) {
      // 404 es esperado para GUIDs sin base de propiedades (graphics, thumbnails, etc.)
      return res.status(404).json({ error: 'no_properties', details: body });
    }
    console.error('❌ Error fetching properties:', body);
    const outStatus = typeof st === 'number' && st >= 400 && st < 600 ? st : 500;
    if (countDemoUsage && outStatus !== 401) demoProtection.addUsage({ mdBasic: 1 });
    res.status(outStatus).json({ error: 'Failed to fetch properties', details: body });
  }
});

/**
 * Árbol de objetos (jerarquía Modelo → Categoría → Familia → Tipo → Instancia).
 * Endpoint: GET /metadata/{guid}  (sin /properties).
 */
app.get('/api/tree/:urnBase64/:guid', demoReadRateLimitIfNeeded, demoReadBudgetGuardIfNeeded, async (req, res) => {
  const { urnBase64, guid } = req.params;
  const countDemoUsage = demoProtection.isAnonymousDemoDataRequest(req, urnBase64);
  try {
    const token = await resolveModelDerivativeToken(req, urnBase64);
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const mdUrl = `${BASE_URL}/modelderivative/v2/designdata/${encodeURIComponent(urnBase64)}/metadata/${encodeURIComponent(guid)}`;
    const tree = await axios.get(mdUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (countDemoUsage) demoProtection.addUsage({ mdBasic: 1 });
    return res.json(tree.data);
  } catch (err) {
    const st = err.response?.status;
    const body = err.response?.data || { message: err.message };
    console.error('❌ Error fetching object tree:', body);
    const outStatus = typeof st === 'number' && st >= 400 && st < 600 ? st : 500;
    if (countDemoUsage && outStatus !== 401) demoProtection.addUsage({ mdBasic: 1 });
    res.status(outStatus).json({ error: 'Failed to fetch object tree', details: body });
  }
});

// ============ RUTAS DE SERVICIO ============

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Error destroying session:', err);
    res.redirect(FRONTEND_URL);
  });
});

app.get('/api/status', (req, res) => {
  const demoCfg = demoProtection.statusForClient();
  const demoAvailable = isDemoOssUrnConfigured() && demoCfg.enabled;
  res.json({
    authenticated: !!req.session.accessToken,
    demoAvailable,
    demoLabel: demoAvailable ? DEMO_MODEL_LABEL : undefined,
    demoCaptcha: demoCfg.captcha,
    demoUsage: demoCfg.usage,
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running ✅' });
});

// ============ ERROR HANDLING ============

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'El archivo supera el límite (100 MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message === 'Solo archivos .rvt o .nwc') {
    return res.status(400).json({ error: err.message });
  }
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ INICIAR SERVIDOR ============

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  🚀 ARQFI APS Data Extractor - Backend     ║
║  Running on port ${PORT}                    ║
║  📝 Login: http://localhost:${PORT}/auth/login  ║
║  ✅ Health: http://localhost:${PORT}/health    ║
╚════════════════════════════════════════╝
  `);
});
