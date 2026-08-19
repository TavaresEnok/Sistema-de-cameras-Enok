const DEFAULT_TIMEOUT_MS = 15_000;

// Handler global de "sessão expirada". O App registra sua função de logout aqui;
// qualquer requisição AUTENTICADA que receba 401 dispara o logout gracioso, em
// vez de deixar o app preso mostrando telas vazias com um token morto.
let unauthorizedHandler: ((requestToken?: string) => void) | null = null;
let tokenRefreshHandler: ((expiredToken: string) => Promise<string | null>) | null = null;
let tokenRefreshInFlight: Promise<string | null> | null = null;
export function setUnauthorizedHandler(handler: ((requestToken?: string) => void) | null) {
  unauthorizedHandler = handler;
}

export function setTokenRefreshHandler(handler: ((expiredToken: string) => Promise<string | null>) | null) {
  tokenRefreshHandler = handler;
  if (!handler) tokenRefreshInFlight = null;
}

export async function request<T>(apiUrl: string, path: string, token?: string, init?: RequestInit): Promise<T> {
  return requestInternal<T>(apiUrl, path, token, init, true);
}

async function requestInternal<T>(apiUrl: string, path: string, token: string | undefined, init: RequestInit | undefined, allowRefresh: boolean): Promise<T> {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    let data: any = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { data = { message: text.slice(0, 300) }; }
    }
    if (!response.ok) {
      if (response.status === 401 && token && allowRefresh && tokenRefreshHandler) {
        tokenRefreshInFlight ??= tokenRefreshHandler(token).finally(() => {
          tokenRefreshInFlight = null;
        });
        const refreshedToken = await tokenRefreshInFlight;
        if (refreshedToken) {
          return requestInternal<T>(apiUrl, path, refreshedToken, init, false);
        }
      }
      // Só desconecta depois que a renovação automática falhou. Login sem token
      // continua sem disparar o handler.
      if (response.status === 401 && token) {
        unauthorizedHandler?.(token);
      }
      // Anexa o status HTTP ao erro para que quem chama possa tratar 401 (sessão
      // expirada) de forma robusta, sem depender do texto da mensagem.
      const error = new Error(data?.message ?? `HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Tempo esgotado. Verifique a conexão.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

export function normalizeServerUrl(value: string | null | undefined, apiUrl: string) {
  if (!value) return null;
  try {
    const api = new URL(apiUrl);
    const target = new URL(value, api);
    if (!['http:', 'https:'].includes(target.protocol)) return null;
    if (target.username || target.password) return null;
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(target.hostname.toLowerCase())) {
      // URLs internas emitidas pelo backend devem acompanhar host, porta e TLS
      // públicos da API; preservar "http" aqui quebrava o app HTTPS em release.
      target.protocol = api.protocol;
      target.hostname = api.hostname;
      target.port = api.port;
    }
    return target.toString();
  } catch {
    return null;
  }
}
