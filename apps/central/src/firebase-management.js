'use strict';

// Cliente mínimo da Firebase Management API. A Central usa-o somente para
// cadastrar o package Android e buscar o google-services.json no momento do
// build. A chave privada nunca é enviada ao build-agent e nunca é salva no
// datastore/Git.
const fs = require('node:fs');
const crypto = require('node:crypto');

const FIREBASE_SCOPE = 'https://www.googleapis.com/auth/firebase';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://firebase.googleapis.com/v1beta1';
const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function configured(env = process.env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  const credentialFile = String(env.FIREBASE_SERVICE_ACCOUNT_FILE || '').trim();
  return Boolean(projectId && credentialFile);
}

function configurationError() {
  return Object.assign(new Error('A automação Firebase ainda não foi configurada na Central. Consulte o guia da VM Management.'), {
    code: 'firebase_not_configured',
    status: 409,
  });
}

function loadAccount(env = process.env) {
  if (!configured(env)) throw configurationError();
  let account;
  try {
    account = JSON.parse(fs.readFileSync(String(env.FIREBASE_SERVICE_ACCOUNT_FILE).trim(), 'utf8'));
  } catch {
    throw Object.assign(new Error('Não foi possível ler a credencial da Firebase na VM Management.'), {
      code: 'firebase_credentials_unavailable', status: 503,
    });
  }
  const projectId = String(env.FIREBASE_PROJECT_ID || account.project_id || '').trim();
  if (!projectId || !account.client_email || !account.private_key) {
    throw Object.assign(new Error('A credencial Firebase está incompleta ou não corresponde a uma conta de serviço.'), {
      code: 'firebase_credentials_invalid', status: 503,
    });
  }
  return { projectId, clientEmail: account.client_email, privateKey: account.private_key };
}

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: account.clientEmail,
    scope: FIREBASE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.privateKey).toString('base64url');
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw Object.assign(new Error('A Firebase recusou a credencial administrativa da Central.'), {
      code: 'firebase_auth_failed', status: 502,
    });
  }
  return body.access_token;
}

async function firebaseFetch(pathname, token, init = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error('A Firebase não aceitou a operação solicitada.'), {
      code: 'firebase_api_failed', status: 502, firebaseStatus: response.status,
    });
  }
  return body;
}

async function waitOperation(name, token) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const operation = await firebaseFetch(`/${name}`, token);
    if (operation.done) {
      if (operation.error) throw Object.assign(new Error('A Firebase não conseguiu criar o pacote Android.'), { code: 'firebase_create_failed', status: 502 });
      return operation.response;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Object.assign(new Error('A Firebase demorou além do esperado para preparar o pacote Android.'), { code: 'firebase_create_timeout', status: 504 });
}

async function findAndroidApp(projectId, packageId, token) {
  let pageToken = '';
  do {
    const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
    const body = await firebaseFetch(`/projects/${encodeURIComponent(projectId)}/androidApps${query}`, token);
    const found = (body.apps || []).find((app) => app.packageName === packageId);
    if (found) return found;
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return null;
}

async function ensureAndroidApp({ packageId, displayName, env = process.env }) {
  if (!PACKAGE_RE.test(String(packageId || ''))) {
    throw Object.assign(new Error('Pacote Android inválido para Firebase.'), { code: 'firebase_invalid_package', status: 400 });
  }
  const account = loadAccount(env);
  const token = await accessToken(account);
  let app = await findAndroidApp(account.projectId, packageId, token);
  let created = false;
  if (!app) {
    const operation = await firebaseFetch(`/projects/${encodeURIComponent(account.projectId)}/androidApps`, token, {
      method: 'POST', body: JSON.stringify({ packageName: packageId, displayName: String(displayName || packageId).slice(0, 100) }),
    });
    app = await waitOperation(operation.name, token);
    created = true;
  }
  if (!app?.name) throw Object.assign(new Error('A Firebase não devolveu a identificação do pacote Android.'), { code: 'firebase_invalid_response', status: 502 });
  const config = await firebaseFetch(`/${app.name}/config`, token);
  const configText = Buffer.from(String(config.configFileContents || ''), 'base64').toString('utf8');
  let parsed;
  try { parsed = JSON.parse(configText); } catch { /* below */ }
  const matchesPackage = (parsed?.client || []).some((client) => client?.client_info?.android_client_info?.package_name === packageId);
  if (!matchesPackage) throw Object.assign(new Error('A configuração recebida da Firebase não corresponde ao pacote solicitado.'), { code: 'firebase_config_mismatch', status: 502 });
  return { created, packageId, firebaseAppId: app.appId || null, configBase64: Buffer.from(configText).toString('base64') };
}

module.exports = { configured, ensureAndroidApp, PACKAGE_RE };
