// build-agent.mjs — agente de build white-label, roda NO HOST (onde estão o
// toolchain Android e o build-client.sh). A API (em container) NÃO consegue
// buildar; ela faz proxy autenticado para este agente.
//
// Endpoints (header x-build-token obrigatório, exceto /health):
//   GET  /health
//   GET  /clients                 → lista clientes + status do último build
//   POST /clients {slug,appName,apiUrl,packageId?,primaryColor?,logoBase64?}
//   DELETE /clients/:slug         → apaga config + APK (local e nginx) + jobs
//   POST /builds  {slug}          → enfileira build (serializado) → {jobId}
//   GET  /builds                  → histórico (sem log completo)
//   GET  /builds/:id              → job com log
//
// Variáveis: BUILD_AGENT_HOST (127.0.0.1), BUILD_AGENT_PORT (8780),
//   BUILD_AGENT_TOKEN (obrigatório), PUBLIC_APK_BASE_OVERRIDE (preferencial),
//   PUBLIC_APK_BASE (https://s2cam.com.br), MIN_FREE_GB (6).
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = path.resolve(__dirname, '..');
const CLIENTS_DIR = path.join(MOBILE_DIR, 'clients');
const BUILDS_DIR = path.join(MOBILE_DIR, 'builds');
const STATE_FILE = path.join(BUILDS_DIR, 'agent-state.json');
// Diretório do host servido pelo nginx em /apk (sobrevive a rebuilds do vms-web).
const APK_PUBLISH_DIR = process.env.APK_PUBLISH_DIR || path.resolve(MOBILE_DIR, '../../infra/apk');

const PORT = Number(process.env.BUILD_AGENT_PORT || 8780);
const HOST = process.env.BUILD_AGENT_HOST || '127.0.0.1';
const TOKEN = process.env.BUILD_AGENT_TOKEN || '';
const PUBLIC_APK_BASE = (
  process.env.PUBLIC_APK_BASE_OVERRIDE
  || process.env.PUBLIC_APK_BASE
  || 'https://s2cam.com.br'
).replace(/\/+$/, '');
const MIN_FREE_GB = process.env.MIN_FREE_GB || '6';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const PKG_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
// apiUrl e appName ficavam SEM validação enquanto slug/packageId eram estritos. Os dois
// descem para o build-client.sh, que roda no HOST com as keystores — e o apiUrl chegava a
// ser interpolado no fonte de um `node -e`. Validar aqui é a 2ª barreira (a 1ª é passar
// tudo por env/argv em vez de costurar em código).
const API_URL_RE = /^https?:\/\/[A-Za-z0-9._-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
const OPTIONAL_URL_RE = /^(?:https?:\/\/[A-Za-z0-9._-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~/?=&%+-]*)?)?$/;
// Nome de exibição: letras/números/espaço e pontuação simples. Sem aspas, sem barra
// (vira nome de arquivo no kit: `${APP_NAME}.aab`), sem '..'.
const APP_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,59}$/u;

fs.mkdirSync(BUILDS_DIR, { recursive: true });

let state = { jobs: [] };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* primeiro start */ }
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ── Fila serializada (1 build por vez) ─────────────────────────────────────
let running = false;
const queue = [];

function processQueue() {
  if (running || queue.length === 0) return;
  const job = queue.shift();
  running = true;
  job.status = 'building';
  job.startedAt = new Date().toISOString();
  saveState();

  const child = spawn('bash', [path.join(__dirname, 'build-client.sh'), job.slug], {
    cwd: MOBILE_DIR,
    env: { ...process.env, MIN_FREE_GB, EXPECTED_SOURCE_COMMIT: job.sourceCommit || '' },
  });
  let log = '';
  const append = (b) => { log = (log + b.toString()).slice(-8000); job.log = log; };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('close', (code) => {
    job.finishedAt = new Date().toISOString();
    if (code === 0) {
      job.status = 'done';
      const ver = /OK_VERSION=(.+)/.exec(log);
      const url = /OK_URL=(.+)/.exec(log);
      const aab = /OK_AAB_URL=(.+)/.exec(log);
      job.version = ver ? ver[1].trim() : null;
      job.url = url ? PUBLIC_APK_BASE + url[1].trim() : null;
      job.aabUrl = aab ? PUBLIC_APK_BASE + aab[1].trim() : null;
    } else {
      job.status = 'failed';
      job.error = `build saiu com código ${code}`;
    }
    saveState();
    running = false;
    processQueue();
  });
}

// ── Helpers de clientes ────────────────────────────────────────────────────
function listClients() {
  let slugs = [];
  try { slugs = fs.readdirSync(CLIENTS_DIR).filter((s) => s !== 'default'); } catch { /* vazio */ }
  return slugs.map((slug) => {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, slug, 'config.json'), 'utf8')); } catch { /* */ }
    const apk = path.join(APK_PUBLISH_DIR, `drac-${slug}.apk`);
    const aab = path.join(APK_PUBLISH_DIR, `drac-${slug}.aab`);
    const kit = path.join(APK_PUBLISH_DIR, `drac-${slug}-playstore-kit.zip`);
    const lastJob = [...state.jobs].reverse().find((j) => j.slug === slug);
    return {
      slug,
      appName: cfg.appName ?? slug,
      apiUrl: cfg.apiUrl ?? '',
      packageId: cfg.packageId ?? '',
      apkBaseUrl: cfg.apkBaseUrl ?? '',
      pushEnabled: cfg.pushEnabled === true,
      crashReportingEnabled: Boolean(cfg.crashDsn),
      primaryColor: cfg.primaryColor ?? null,
      hasLogo: fs.existsSync(path.join(CLIENTS_DIR, slug, 'logo.png')),
      apkExists: fs.existsSync(apk),
      apkUrl: fs.existsSync(apk) ? `${PUBLIC_APK_BASE}/apk/drac-${slug}.apk` : null,
      aabExists: fs.existsSync(aab),
      aabUrl: fs.existsSync(aab) ? `${PUBLIC_APK_BASE}/apk/drac-${slug}.aab` : null,
      kitExists: fs.existsSync(kit),
      kitUrl: fs.existsSync(kit) ? `${PUBLIC_APK_BASE}/apk/drac-${slug}-playstore-kit.zip` : null,
      lastBuild: lastJob ? { status: lastJob.status, version: lastJob.version ?? null, finishedAt: lastJob.finishedAt ?? null } : null,
    };
  });
}

// Roda ffmpeg lendo o arquivo pelo CONTEÚDO (não pela extensão) — o logo pode
// chegar em qualquer formato (JPEG/WebP/etc) do endpoint /settings/branding.
function ffmpegConvert(args) {
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return { ok: r.status === 0, stderr: r.stderr ? r.stderr.toString() : '' };
}

// Converte o logo do cliente em logo.png (tela de login) + splash.png (abertura
// limpa, sem cards) + icon.png/adaptive-icon.png (ícone do launcher Android — app.config.js já
// sabe usar esses arquivos se existirem, mas antes disso nada os gerava, então
// o app instalado ficava com o ícone genérico mesmo com o logo aplicado na
// tela de login).
//
// IMPORTANTE: gera tudo num diretório TEMPORÁRIO (staging) e devolve o caminho.
// Quem chama só move para o diretório do cliente depois que TUDO deu certo —
// assim um logo inválido NUNCA deixa um cliente pela metade no disco. Lança
// erro (em vez de cair silenciosamente pro padrão) se o arquivo enviado não
// for uma imagem decodificável — a Central mostra o problema na hora de gerar
// o app, não só depois de instalar o APK.
function stageClientBranding(logoBase64) {
  const data = String(logoBase64).replace(/^data:image\/[\w.+-]+;base64,/, '');
  const raw = Buffer.from(data, 'base64');
  if (raw.length < 16) throw new Error('logo do cliente vazio ou inválido');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'drac-brand-'));
  const srcPath = path.join(stage, 'src');
  fs.writeFileSync(srcPath, raw);
  try {
    const logo = ffmpegConvert(['-y', '-loglevel', 'error', '-i', srcPath, '-pix_fmt', 'rgba', path.join(stage, 'logo.png')]);
    if (!logo.ok) throw new Error(`logo do cliente não pôde ser decodificado (formato inválido): ${logo.stderr.trim().slice(0, 300)}`);
    const icon = ffmpegConvert(['-y', '-loglevel', 'error', '-i', srcPath,
      '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease,pad=1024:1024:(ow-iw)/2:(oh-ih)/2:color=0x071013',
      '-pix_fmt', 'rgba', path.join(stage, 'icon.png')]);
    if (!icon.ok) throw new Error(`falha ao gerar ícone do app a partir do logo: ${icon.stderr.trim().slice(0, 300)}`);
    // Ícone adaptativo Android: o sistema recorta ~33% das bordas, então o
    // conteúdo precisa ficar menor e centralizado (fundo transparente).
    const adaptive = ffmpegConvert(['-y', '-loglevel', 'error', '-i', srcPath,
      '-vf', 'scale=620:620:force_original_aspect_ratio=decrease,pad=1024:1024:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
      '-pix_fmt', 'rgba', path.join(stage, 'adaptive-icon.png')]);
    if (!adaptive.ok) throw new Error(`falha ao gerar ícone adaptativo do app: ${adaptive.stderr.trim().slice(0, 300)}`);
    const splash = ffmpegConvert(['-y', '-loglevel', 'error', '-i', srcPath,
      '-vf', 'scale=560:560:force_original_aspect_ratio=decrease,pad=1024:1024:(ow-iw)/2:(oh-ih)/2:color=white',
      '-pix_fmt', 'rgba', path.join(stage, 'splash.png')]);
    if (!splash.ok) throw new Error(`falha ao gerar tela de abertura do app: ${splash.stderr.trim().slice(0, 300)}`);
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
  fs.rmSync(srcPath, { force: true });
  return stage; // contém logo.png, icon.png, adaptive-icon.png
}

function writeClient(body) {
  const { slug, appName, apiUrl } = body;
  if (!SLUG_RE.test(slug || '')) throw new Error('slug inválido (a-z 0-9 -)');
  if (!appName || !apiUrl) throw new Error('appName e apiUrl são obrigatórios');
  if (!APP_NAME_RE.test(String(appName))) throw new Error('appName inválido (letras, números, espaço e . _ - ( ), até 60)');
  if (!API_URL_RE.test(String(apiUrl))) throw new Error('apiUrl inválida (use http(s)://host[:porta][/caminho])');
  const packageId = body.packageId || `com.ajustconsulting.drac${String(slug).replace(/-/g, '')}`;
  if (!PKG_RE.test(packageId)) throw new Error('packageId inválido');
  // Converte o branding ANTES de tocar no diretório do cliente: se o logo for
  // inválido, aborta aqui sem criar/alterar nada (evita cliente meia-boca).
  const stage = body.logoBase64 ? stageClientBranding(body.logoBase64) : null;
  try {
    const dir = path.join(CLIENTS_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    // PRESERVA o config existente (flags manuais como redesign/skipFirebase não
    // podem sumir numa regeração pela Central) e só sobrepõe o que veio no body.
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { /* novo cliente */ }
    const cfg = {
      ...existing,
      appName, slug: `drac-${slug}`, packageId, apiUrl,
      apkBaseUrl: String(body.apkBaseUrl || existing.apkBaseUrl || `${PUBLIC_APK_BASE}/apk`).replace(/\/+$/, ''),
      crashDsn: body.crashDsn === undefined ? (existing.crashDsn || '') : String(body.crashDsn || ''),
      // Sem arquivo Firebase por pacote, declarar false conscientemente. Se a
      // Central pedir true, app.config.js bloqueia o build sem credencial.
      pushEnabled: body.pushEnabled === undefined ? (existing.pushEnabled === true) : body.pushEnabled === true,
      primaryColor: body.primaryColor || existing.primaryColor || '#3b82f6',
      // O design NOVO (redesign) é o padrão de todo app gerado — o antigo só
      // permanece se o config do cliente disser explicitamente redesign:false.
      redesign: existing.redesign !== undefined ? existing.redesign : true,
    };
    if (!OPTIONAL_URL_RE.test(cfg.apkBaseUrl) || !OPTIONAL_URL_RE.test(cfg.crashDsn)) {
      throw new Error('apkBaseUrl/crashDsn inválida');
    }
    // Splash combina com o design: escuro no redesign, claro no antigo (a menos
    // que o cliente já tenha um valor próprio salvo).
    cfg.splashBackgroundColor = existing.splashBackgroundColor
      || (cfg.redesign ? '#0A0D13' : '#ffffff');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
    if (stage) {
      for (const name of ['logo.png', 'splash.png', 'icon.png', 'adaptive-icon.png']) {
        fs.copyFileSync(path.join(stage, name), path.join(dir, name));
      }
    }
    return cfg;
  } finally {
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
  }
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } }

// Apaga um app: config do cliente, APK local e o publicado no nginx, e os jobs.
// Mantém o keystore (~/toolchain/keystores/<slug>.jks) de propósito: se o mesmo
// cliente for regerado depois, o app instala por cima do antigo (mesma assinatura).
function deleteClient(slug) {
  if (!SLUG_RE.test(slug)) throw new Error('slug inválido');
  const dir = path.join(CLIENTS_DIR, slug);
  if (slug === 'default' || !fs.existsSync(dir)) throw new Error('cliente não existe');
  rmrf(dir);
  rmrf(path.join(BUILDS_DIR, `drac-${slug}.apk`));
  rmrf(path.join(BUILDS_DIR, `drac-${slug}.apk.idsig`));
  rmrf(path.join(APK_PUBLISH_DIR, `drac-${slug}.apk`)); // remove do diretório servido
  // Também remove o AAB e o kit (o delete antigo só limpava o APK → sobrava
  // AAB/kit órfãos servíveis). NÃO remove a keystore (updates precisam dela)
  // nem o contador `<slug>.versionCode` (a Play exige versionCode monotônico
  // mesmo após apagar+regerar).
  rmrf(path.join(BUILDS_DIR, `drac-${slug}.aab`));
  rmrf(path.join(APK_PUBLISH_DIR, `drac-${slug}.aab`));
  rmrf(path.join(BUILDS_DIR, `drac-${slug}-playstore-kit.zip`));
  rmrf(path.join(APK_PUBLISH_DIR, `drac-${slug}-playstore-kit.zip`));
  state.jobs = state.jobs.filter((j) => j.slug !== slug);
  saveState();
}

// ── HTTP ───────────────────────────────────────────────────────────────────
const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve) => {
  let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/health') return send(res, 200, { ok: true });
  if (!TOKEN || req.headers['x-build-token'] !== TOKEN) return send(res, 401, { error: 'unauthorized' });

  try {
    if (req.method === 'GET' && p === '/clients') return send(res, 200, { clients: listClients() });
    if (req.method === 'POST' && p === '/clients') {
      const body = await readBody(req);
      if (!body) return send(res, 400, { error: 'json inválido' });
      const cfg = writeClient(body);
      return send(res, 200, { ok: true, client: cfg });
    }
    if (req.method === 'POST' && p === '/builds') {
      const body = await readBody(req);
      if (!body || !SLUG_RE.test(body.slug || '')) return send(res, 400, { error: 'slug inválido' });
      if (!/^[0-9a-f]{40}$/i.test(String(body.sourceCommit || ''))) {
        return send(res, 409, { error: 'release não aprovada: sourceCommit completo é obrigatório' });
      }
      const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: MOBILE_DIR, encoding: 'utf8' });
      if (head.status !== 0 || head.stdout.trim().toLowerCase() !== String(body.sourceCommit).toLowerCase()) {
        return send(res, 409, { error: 'o build-agent não está no commit aprovado pela Central' });
      }
      if (!fs.existsSync(path.join(CLIENTS_DIR, body.slug, 'config.json'))) return send(res, 404, { error: 'cliente não existe' });
      const job = { id: `${Date.now()}-${body.slug}`, slug: body.slug, sourceCommit: String(body.sourceCommit).toLowerCase(), status: 'queued', queuedAt: new Date().toISOString(), log: '' };
      state.jobs.push(job);
      if (state.jobs.length > 100) state.jobs = state.jobs.slice(-100);
      saveState();
      queue.push(job);
      processQueue();
      return send(res, 202, { jobId: job.id, status: job.status });
    }
    if (req.method === 'DELETE' && p.startsWith('/clients/')) {
      const slug = decodeURIComponent(p.slice('/clients/'.length));
      deleteClient(slug);
      return send(res, 200, { ok: true, slug });
    }
    if (req.method === 'GET' && p === '/builds') {
      const jobs = [...state.jobs].reverse().map(({ log, ...j }) => j);
      return send(res, 200, { jobs });
    }
    if (req.method === 'GET' && p.startsWith('/builds/')) {
      const id = decodeURIComponent(p.slice('/builds/'.length));
      const job = state.jobs.find((j) => j.id === id);
      return job ? send(res, 200, { job }) : send(res, 404, { error: 'job não encontrado' });
    }
    return send(res, 404, { error: 'rota não encontrada' });
  } catch (e) {
    return send(res, 400, { error: e instanceof Error ? e.message : 'erro' });
  }
});

server.listen(PORT, HOST, () => console.log(`build-agent ouvindo em ${HOST}:${PORT}`));
