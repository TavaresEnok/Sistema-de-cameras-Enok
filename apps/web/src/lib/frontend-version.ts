const VERSION_URL = '/frontend-version.json';
const CHECK_INTERVAL_MS = 60_000;
const RELOAD_GUARD_PREFIX = 's2cam:frontend-reload:';

type FrontendVersionManifest = {
  buildId?: unknown;
};

async function fetchPublishedBuildId(): Promise<string | null> {
  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const manifest = await response.json() as FrontendVersionManifest;
    return typeof manifest.buildId === 'string' && manifest.buildId.trim()
      ? manifest.buildId.trim()
      : null;
  } catch {
    // Indisponibilidade momentânea da rede nunca deve interromper o vídeo.
    return null;
  }
}

export async function reloadWhenFrontendChanged(): Promise<boolean> {
  const publishedBuildId = await fetchPublishedBuildId();
  if (!publishedBuildId || publishedBuildId === __S2CAM_FRONTEND_BUILD_ID__) return false;

  const reloadGuardKey = `${RELOAD_GUARD_PREFIX}${publishedBuildId}`;
  try {
    // Evita ciclo de reload caso algum proxy intermediário entregue um
    // index.html antigo junto com um manifesto novo.
    if (window.sessionStorage.getItem(reloadGuardKey) === '1') return false;
    window.sessionStorage.setItem(reloadGuardKey, '1');
  } catch {
    // sessionStorage bloqueado não impede a atualização normal.
  }

  window.location.reload();
  return true;
}

/**
 * Mantém uma aba operacional alinhada ao frontend publicado no servidor.
 * Verifica ao voltar para a aba e, enquanto visível, uma vez por minuto.
 */
export function installFrontendVersionGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      await reloadWhenFrontendChanged();
    } finally {
      checking = false;
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void check();
  };
  const intervalId = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Confere também a versão carregada inicialmente, sem atrasar o render.
  void check();

  return () => {
    window.clearInterval(intervalId);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
