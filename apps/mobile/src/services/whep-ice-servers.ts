export type WhepIceServer = {
  urls: string;
  username?: string;
  credential?: string;
};

const ICE_SERVER_SCHEME = /^(?:stun|stuns|turn|turns):/i;

function splitLinkValues(header: string) {
  const values: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let angleDepth = 0;
  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === '<') angleDepth += 1;
    else if (!quoted && char === '>' && angleDepth > 0) angleDepth -= 1;
    else if (!quoted && angleDepth === 0 && char === ',') {
      values.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(header.slice(start).trim());
  return values.filter(Boolean);
}

function unquote(value: string) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/\\([\\"])/g, '$1')
    : trimmed;
}

/** Parser estreito do Link WHEP: só aceita esquemas próprios de ICE. */
export function parseWhepIceServers(linkHeader?: string | null): WhepIceServer[] {
  if (!linkHeader) return [];
  const result: WhepIceServer[] = [];
  for (const value of splitLinkValues(linkHeader)) {
    const target = /^\s*<([^>]+)>/.exec(value)?.[1]?.trim();
    if (!target || !ICE_SERVER_SCHEME.test(target)) continue;
    const params = new Map<string, string>();
    const tail = value.slice(value.indexOf('>') + 1);
    const parameter = /;\s*([^=;\s]+)(?:\s*=\s*("(?:\\.|[^"])*"|[^;]*))?/g;
    let match: RegExpExecArray | null;
    while ((match = parameter.exec(tail)) !== null) {
      params.set(match[1].toLowerCase(), unquote(match[2] ?? ''));
    }
    if (!(params.get('rel') ?? '').toLowerCase().split(/\s+/).includes('ice-server')) continue;
    const server: WhepIceServer = { urls: target };
    if (params.get('username')) server.username = params.get('username');
    if (params.get('credential')) server.credential = params.get('credential');
    result.push(server);
  }
  return result.filter((server, index, all) => all.findIndex((candidate) => (
    candidate.urls === server.urls
    && candidate.username === server.username
    && candidate.credential === server.credential
  )) === index);
}

export async function discoverWhepIceServers(
  whepUrl: string,
  authorization: string | null,
): Promise<WhepIceServer[]> {
  try {
    const response = await fetch(whepUrl, {
      method: 'OPTIONS',
      redirect: 'error',
      headers: authorization ? { Authorization: authorization } : undefined,
    });
    if (!response.ok) return [];
    return parseWhepIceServers(response.headers.get('link'));
  } catch {
    // Instalações antigas com ICE público direto continuam funcionando.
    return [];
  }
}
