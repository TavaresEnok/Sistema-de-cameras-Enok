/** Normaliza o servidor digitado e migra somente os domínios oficiais legados. */
export function normalizeApiUrl(value: string, fallback = ''): string {
  const raw = value.trim() || fallback.trim();
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try { parsed = new URL(candidate); }
  catch { throw new Error('Endereço do servidor inválido. Use, por exemplo, https://servidor.com/api.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('O servidor precisa usar um endereço HTTP ou HTTPS válido.');
  }
  if (parsed.username || parsed.password) throw new Error('Não inclua usuário ou senha no endereço do servidor.');
  parsed.hash = '';
  parsed.search = '';
  const legacyHost = parsed.hostname.toLowerCase();
  if (legacyHost === 'ajustcam.ajustconsulting.com.br') {
    parsed.protocol = 'https:';
    parsed.hostname = 'principal.s2cam.com.br';
    parsed.port = '';
  } else {
    const tenant = legacyHost.match(/^([a-z0-9-]+)\.cam\.ajustconsulting\.com\.br$/)?.[1];
    if (tenant) {
      parsed.protocol = 'https:';
      parsed.hostname = `${tenant}.s2cam.com.br`;
      parsed.port = '';
    }
  }
  return parsed.toString().replace(/\/+$/, '');
}
