'use strict';

// Entrega direta de push Android. A chave de serviço fica SOMENTE na Central;
// instalações nunca recebem a credencial Firebase e apenas encaminham pedidos
// autenticados com sua própria chave de licença.
const fs = require('node:fs');
const crypto = require('node:crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_RE = /^[A-Za-z0-9:_-]{20,4096}$/;
const MAX_TOKENS = 100;
const CONCURRENCY = 10;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function loadAccount(env = process.env) {
  const credentialFile = String(env.FIREBASE_SERVICE_ACCOUNT_FILE || '').trim();
  if (!credentialFile) throw Object.assign(new Error('Firebase não configurada na Central.'), { code: 'firebase_not_configured', status: 503 });
  let account;
  try { account = JSON.parse(fs.readFileSync(credentialFile, 'utf8')); } catch {
    throw Object.assign(new Error('Não foi possível ler a credencial Firebase da Central.'), { code: 'firebase_credentials_unavailable', status: 503 });
  }
  const projectId = String(env.FIREBASE_PROJECT_ID || account.project_id || '').trim();
  if (!projectId || !account.client_email || !account.private_key) {
    throw Object.assign(new Error('Credencial Firebase incompleta.'), { code: 'firebase_credentials_invalid', status: 503 });
  }
  return { projectId, clientEmail: account.client_email, privateKey: account.private_key };
}

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({ iss: account.clientEmail, scope: FCM_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.privateKey).toString('base64url');
  const response = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw Object.assign(new Error('Firebase recusou a credencial de push.'), { code: 'firebase_auth_failed', status: 502 });
  return body.access_token;
}

function safeData(input) {
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) continue;
    if (value == null) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text != null) result[key] = String(text).slice(0, 512);
  }
  return result;
}

function createMessage(token, message) {
  const title = String(message?.title || '').trim().slice(0, 120);
  const body = String(message?.body || '').trim().slice(0, 240);
  if (!title || !body) throw Object.assign(new Error('Push sem título ou mensagem.'), { code: 'invalid_push_message', status: 400 });
  const channelId = String(message?.channelId || 'alarms').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100) || 'alarms';
  return {
    token,
    notification: { title, body },
    data: safeData(message?.data),
    android: {
      priority: message?.priority === 'normal' ? 'NORMAL' : 'HIGH',
      notification: { channel_id: channelId, sound: 'default', notification_priority: 'PRIORITY_HIGH', visibility: 'PRIVATE' },
    },
  };
}

async function sendOne(projectId, accessTokenValue, token, message) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessTokenValue}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: createMessage(token, message) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok) return { token, accepted: true, invalid: false };
  const status = String(body?.error?.status || '');
  // UNREGISTERED é a confirmação inequívoca de token morto. INVALID_ARGUMENT
  // também pode apontar erro de payload, portanto nunca apaga token sozinho.
  if (status === 'UNREGISTERED' || status === 'NOT_FOUND') return { token, accepted: false, invalid: true };
  throw Object.assign(new Error(`FCM recusou a mensagem (${status || response.status}).`), { code: 'fcm_send_failed', status: 502, fcmStatus: status || String(response.status) });
}

async function sendToTokens(tokens, message, env = process.env) {
  const valid = Array.from(new Set((Array.isArray(tokens) ? tokens : []).filter((token) => TOKEN_RE.test(String(token))))).slice(0, MAX_TOKENS);
  if (!valid.length) return { accepted: 0, invalidTokens: [] };
  const account = loadAccount(env);
  const bearer = await accessToken(account);
  let cursor = 0;
  const results = await Promise.all(Array.from({ length: Math.min(CONCURRENCY, valid.length) }, async () => {
    const worker = [];
    while (cursor < valid.length) {
      const token = valid[cursor++];
      worker.push(await sendOne(account.projectId, bearer, token, message));
    }
    return worker;
  }));
  const all = results.flat();
  return { accepted: all.filter((item) => item.accepted).length, invalidTokens: all.filter((item) => item.invalid).map((item) => item.token) };
}

module.exports = { TOKEN_RE, MAX_TOKENS, createMessage, safeData, sendToTokens };
