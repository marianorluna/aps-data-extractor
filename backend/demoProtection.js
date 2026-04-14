const fs = require('fs');
const path = require('path');
const axios = require('axios');

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function toBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function monthKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function createUsageStore(filePath) {
  let cache = { month: monthKey(), counters: {} };
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.month && parsed.counters) {
        cache = parsed;
      }
    }
  } catch (err) {
    console.warn('⚠️ demo usage store read failed:', err.message);
  }

  function ensureMonth() {
    const current = monthKey();
    if (cache.month !== current) {
      cache = { month: current, counters: {} };
      persist();
    }
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
      console.warn('⚠️ demo usage store write failed:', err.message);
    }
  }

  return {
    month() {
      ensureMonth();
      return cache.month;
    },
    getCounter(key) {
      ensureMonth();
      return Number(cache.counters[key] || 0);
    },
    addCounters(delta) {
      ensureMonth();
      for (const [key, value] of Object.entries(delta || {})) {
        const add = toInt(value, 0);
        if (add <= 0) continue;
        cache.counters[key] = Number(cache.counters[key] || 0) + add;
      }
      persist();
    },
    snapshot() {
      ensureMonth();
      return {
        month: cache.month,
        counters: { ...cache.counters },
      };
    },
  };
}

function createInMemoryRateLimiter() {
  const buckets = new Map();
  return function checkRateLimit({ key, windowMs, limit }) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSec: Math.ceil(windowMs / 1000) };
    }
    if (bucket.count >= limit) {
      const retryAfterMs = Math.max(1000, bucket.resetAt - now);
      return { allowed: false, remaining: 0, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
    }
    bucket.count += 1;
    return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  };
}

function extractClientIp(req) {
  const raw = req.headers['x-forwarded-for'];
  if (typeof raw === 'string' && raw.length > 0) {
    return raw.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function readCaptchaToken(req) {
  const bodyToken = req.body?.captchaToken;
  const headerToken = req.headers['x-captcha-token'];
  if (typeof bodyToken === 'string' && bodyToken.trim()) return bodyToken.trim();
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();
  return '';
}

function normalizeUsageDelta(delta) {
  return {
    mdBasic: toInt(delta?.mdBasic, 0),
    dmBasic: toInt(delta?.dmBasic, 0),
    mdSimpleJobs: toInt(delta?.mdSimpleJobs, 0),
    mdComplexJobs: toInt(delta?.mdComplexJobs, 0),
  };
}

function createDemoProtection(options) {
  const cfg = {
    demoUrnBase64: String(options.demoUrnBase64 || '').trim(),
    demoPublicEnabled: toBool(process.env.DEMO_PUBLIC_ENABLED, true),
    usageWarningThreshold: Number(process.env.DEMO_USAGE_WARNING_THRESHOLD || 0.8),
    extractWindowMs: toInt(process.env.DEMO_EXTRACT_RATE_WINDOW_MS, 10 * 60 * 1000),
    extractMaxPerIp: toInt(process.env.DEMO_EXTRACT_RATE_MAX_PER_IP, 3),
    readWindowMs: toInt(process.env.DEMO_READ_RATE_WINDOW_MS, 60 * 1000),
    readMaxPerIp: toInt(process.env.DEMO_READ_RATE_MAX_PER_IP, 20),
    mdBasicCap: toInt(process.env.DEMO_MD_BASIC_MONTHLY_CAP, 180000),
    dmBasicCap: toInt(process.env.DEMO_DM_BASIC_MONTHLY_CAP, 180000),
    mdSimpleJobsCap: toInt(process.env.DEMO_MD_SIMPLE_JOBS_MONTHLY_CAP, 4),
    mdComplexJobsCap: toInt(process.env.DEMO_MD_COMPLEX_JOBS_MONTHLY_CAP, 4),
    captchaEnabled: toBool(process.env.DEMO_CAPTCHA_ENABLED, true),
    captchaProvider: String(process.env.DEMO_CAPTCHA_PROVIDER || 'turnstile').trim().toLowerCase(),
    captchaSiteKey: String(process.env.DEMO_CAPTCHA_SITE_KEY || '').trim(),
    captchaSecret: String(process.env.DEMO_CAPTCHA_SECRET || '').trim(),
    captchaPassTtlMs: toInt(process.env.DEMO_CAPTCHA_PASS_TTL_MS, 30 * 60 * 1000),
    usageStorePath: process.env.DEMO_USAGE_STORE_PATH
      ? path.resolve(process.env.DEMO_USAGE_STORE_PATH)
      : path.resolve(process.cwd(), 'data', 'demo-usage.json'),
  };
  const captchaConfigured =
    cfg.captchaEnabled &&
    cfg.captchaProvider === 'turnstile' &&
    Boolean(cfg.captchaSiteKey) &&
    Boolean(cfg.captchaSecret);

  const usageStore = createUsageStore(cfg.usageStorePath);
  const checkRateLimit = createInMemoryRateLimiter();

  function currentUsage() {
    const snap = usageStore.snapshot();
    return {
      month: snap.month,
      mdBasic: Number(snap.counters.mdBasic || 0),
      dmBasic: Number(snap.counters.dmBasic || 0),
      mdSimpleJobs: Number(snap.counters.mdSimpleJobs || 0),
      mdComplexJobs: Number(snap.counters.mdComplexJobs || 0),
    };
  }

  function overBudget(delta) {
    const u = currentUsage();
    const next = {
      mdBasic: u.mdBasic + toInt(delta?.mdBasic, 0),
      dmBasic: u.dmBasic + toInt(delta?.dmBasic, 0),
      mdSimpleJobs: u.mdSimpleJobs + toInt(delta?.mdSimpleJobs, 0),
      mdComplexJobs: u.mdComplexJobs + toInt(delta?.mdComplexJobs, 0),
    };

    const limits = [
      ['mdBasic', cfg.mdBasicCap, 'Model Derivative basic interactions'],
      ['dmBasic', cfg.dmBasicCap, 'Data Management basic interactions'],
      ['mdSimpleJobs', cfg.mdSimpleJobsCap, 'Model Derivative simple jobs'],
      ['mdComplexJobs', cfg.mdComplexJobsCap, 'Model Derivative complex jobs'],
    ];
    for (const [field, cap, label] of limits) {
      if (cap <= 0) continue;
      if (next[field] > cap) {
        return { blocked: true, field, label, cap, current: u[field], next: next[field], month: u.month };
      }
    }
    return { blocked: false, month: u.month };
  }

  function logUsageWarningIfNeeded() {
    const u = currentUsage();
    const limitPairs = [
      ['mdBasic', cfg.mdBasicCap],
      ['dmBasic', cfg.dmBasicCap],
      ['mdSimpleJobs', cfg.mdSimpleJobsCap],
      ['mdComplexJobs', cfg.mdComplexJobsCap],
    ];
    for (const [field, cap] of limitPairs) {
      if (cap <= 0) continue;
      const ratio = u[field] / cap;
      if (ratio >= cfg.usageWarningThreshold) {
        console.warn(`⚠️ demo usage ${field}: ${u[field]}/${cap} (${Math.round(ratio * 100)}%)`);
      }
    }
  }

  function isDemoUrn(urnBase64) {
    return !!cfg.demoUrnBase64 && urnBase64 === cfg.demoUrnBase64;
  }

  function isAnonymous(req) {
    return !req.session?.accessToken;
  }

  function isAnonymousDemoDataRequest(req, urnBase64) {
    return isAnonymous(req) && isDemoUrn(urnBase64);
  }

  async function verifyCaptcha(req) {
    if (!cfg.captchaEnabled) return { ok: true };
    if (cfg.captchaProvider !== 'turnstile') {
      return { ok: false, error: 'captcha_provider_not_supported' };
    }
    if (!cfg.captchaSecret) {
      return { ok: false, error: 'captcha_secret_missing' };
    }
    const token = readCaptchaToken(req);
    if (!token) return { ok: false, error: 'captcha_token_missing' };
    const form = new URLSearchParams({
      secret: cfg.captchaSecret,
      response: token,
      remoteip: extractClientIp(req),
    });
    try {
      const response = await axios.post(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        form,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 6000 }
      );
      if (response.data?.success === true) return { ok: true };
      return { ok: false, error: 'captcha_verification_failed', details: response.data };
    } catch (err) {
      return { ok: false, error: 'captcha_unreachable', details: err.response?.data || err.message };
    }
  }

  function requireDemoPublicEnabled(req, res, next) {
    if (!cfg.demoPublicEnabled) {
      return res.status(503).json({
        error: 'Demo pública deshabilitada',
        details: 'El administrador desactivó temporalmente la demo.',
      });
    }
    return next();
  }

  function makeRateLimitMiddleware(scope) {
    const isExtract = scope === 'extract';
    const windowMs = isExtract ? cfg.extractWindowMs : cfg.readWindowMs;
    const max = isExtract ? cfg.extractMaxPerIp : cfg.readMaxPerIp;
    return (req, res, next) => {
      if (!cfg.demoPublicEnabled || max <= 0 || windowMs <= 0) return next();
      const ip = extractClientIp(req);
      const key = `${scope}:${ip}`;
      const result = checkRateLimit({ key, windowMs, limit: max });
      res.setHeader('X-Demo-RateLimit-Limit', String(max));
      res.setHeader('X-Demo-RateLimit-Remaining', String(result.remaining));
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
        return res.status(429).json({
          error: 'Demasiadas solicitudes para la demo',
          details: `Superaste el límite de ${max} solicitudes en ${Math.round(windowMs / 1000)} segundos.`,
        });
      }
      return next();
    };
  }

  async function requireCaptchaForDemo(req, res, next) {
    if (!captchaConfigured) return next();
    if (!isAnonymous(req)) return next();
    if (!req.session) return next();
    const now = Date.now();
    const verifiedAt = Number(req.session.demoCaptchaVerifiedAt || 0);
    if (verifiedAt > 0 && now - verifiedAt < cfg.captchaPassTtlMs) {
      return next();
    }
    const outcome = await verifyCaptcha(req);
    if (!outcome.ok) {
      return res.status(400).json({
        error: 'CAPTCHA requerido para usar la demo',
        code: 'captcha_required',
        details: outcome.error,
      });
    }
    req.session.demoCaptchaVerifiedAt = now;
    return next();
  }

  function guardBudget(estimateDelta) {
    return (req, res, next) => {
      const delta = typeof estimateDelta === 'function' ? estimateDelta(req) : estimateDelta;
      const check = overBudget(normalizeUsageDelta(delta));
      if (check.blocked) {
        return res.status(503).json({
          error: 'Demo temporalmente limitada',
          details: `Se alcanzó el tope mensual demo para ${check.label} (${check.current}/${check.cap}).`,
          month: check.month,
        });
      }
      return next();
    };
  }

  function addUsage(delta) {
    const normalized = normalizeUsageDelta(delta);
    usageStore.addCounters(normalized);
    logUsageWarningIfNeeded();
  }

  function statusForClient() {
    return {
      enabled: cfg.demoPublicEnabled,
      captcha: {
        enabled: captchaConfigured,
        provider: cfg.captchaProvider,
        siteKey: cfg.captchaSiteKey || undefined,
      },
      usage: {
        month: usageStore.month(),
        caps: {
          mdBasic: cfg.mdBasicCap,
          dmBasic: cfg.dmBasicCap,
          mdSimpleJobs: cfg.mdSimpleJobsCap,
          mdComplexJobs: cfg.mdComplexJobsCap,
        },
      },
    };
  }

  return {
    isDemoUrn,
    isAnonymousDemoDataRequest,
    requireDemoPublicEnabled,
    rateLimitExtract: makeRateLimitMiddleware('extract'),
    rateLimitRead: makeRateLimitMiddleware('read'),
    requireCaptchaForDemo,
    guardBudget,
    addUsage,
    statusForClient,
  };
}

module.exports = {
  createDemoProtection,
};
