/**
 * PERGUNTAR ao equipamento onde ficam os serviços, em vez de adivinhar.
 *
 * O cliente daqui tenta uma lista fixa de caminhos (`/onvif/device_service`,
 * `/onvif/ptz_service`, …) e de portas (8075, 8080, 8000, 8899, 80, 2020). Isso
 * acerta nas marcas que já vimos e erra em toda câmera que use outro endereço —
 * e o sintoma é sempre o mesmo, "esta câmera não tem PTZ".
 *
 * A norma ONVIF resolve isso: `GetCapabilities` (e `GetServices`, na versão
 * nova) devolve os XAddr, as URLs REAIS de cada serviço naquele equipamento.
 * É o que o Frigate faz com `update_xaddrs()` antes de qualquer comando, e o
 * que a biblioteca de referência faz por padrão.
 *
 * Escrito depois de o dono mostrar outra ferramenta movimentando uma câmera que
 * o DRAC dizia não ter PTZ (14/08/2026), e de perguntar — com razão — se o
 * sistema é compatível com ONVIF de verdade.
 *
 * `GetSystemDateAndTime` entra junto porque é o único comando ONVIF que a norma
 * define como SEM autenticação, e serve a duas coisas: prova que o endereço
 * fala ONVIF, e dá o relógio da câmera. O relógio importa porque o
 * PasswordDigest do WS-Security carrega um `Created`: câmera com horário
 * errado recusa a autenticação e o erro é idêntico ao de senha errada.
 */

export type ServicosOnvif = {
  device?: string;
  media?: string;
  ptz?: string;
  imaging?: string;
  events?: string;
};

/** Extrai o conteúdo do primeiro elemento com este nome local, ignorando prefixo. */
function elemento(xml: string, nome: string): string | null {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${nome}>`, 'i');
  return re.exec(xml)?.[1] ?? null;
}

function xaddrDe(bloco: string | null): string | undefined {
  if (!bloco) return undefined;
  const url = elemento(bloco, 'XAddr');
  const limpo = url?.trim();
  return limpo && /^https?:\/\//i.test(limpo) ? limpo : undefined;
}

/**
 * Lê os endereços de serviço de uma resposta de `GetCapabilities`.
 *
 * Devolve só o que veio: campo ausente fica `undefined`, e quem chama continua
 * com o palpite atual para aquele serviço. Nunca inventa URL — endereço errado
 * gera erro de rede que se parece com "câmera sem PTZ", que é exatamente a
 * confusão que este módulo existe para acabar.
 */
export function lerCapacidades(xml: string): ServicosOnvif {
  const capacidades = elemento(xml, 'Capabilities') ?? xml;
  return {
    device: xaddrDe(elemento(capacidades, 'Device')),
    media: xaddrDe(elemento(capacidades, 'Media')),
    ptz: xaddrDe(elemento(capacidades, 'PTZ')),
    imaging: xaddrDe(elemento(capacidades, 'Imaging')),
    events: xaddrDe(elemento(capacidades, 'Events')),
  };
}

/**
 * Lê `GetServices`, o formato da ONVIF 2.x — uma lista de `<Service>` com
 * `<Namespace>` e `<XAddr>`. O namespace é que diz qual serviço é.
 */
export function lerServicos(xml: string): ServicosOnvif {
  const saida: ServicosOnvif = {};
  const blocos = xml.match(/<(?:[A-Za-z0-9_.-]+:)?Service(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?Service>/gi) ?? [];
  for (const bloco of blocos) {
    const ns = (elemento(bloco, 'Namespace') ?? '').toLowerCase();
    const url = xaddrDe(bloco);
    if (!url) continue;
    if (ns.includes('/ptz/')) saida.ptz ??= url;
    else if (ns.includes('/media')) saida.media ??= url;
    else if (ns.includes('/device')) saida.device ??= url;
    else if (ns.includes('/imaging')) saida.imaging ??= url;
    else if (ns.includes('/events')) saida.events ??= url;
  }
  return saida;
}

/**
 * Reescreve o XAddr para o endereço por onde NÓS falamos com a câmera.
 *
 * Câmera atrás de roteador anuncia o próprio IP de LAN (192.168.x) no XAddr —
 * inútil de fora. O caminho vale; o host e a porta são os nossos. É o caso das
 * 4 câmeras do dono, todas atrás do mesmo IP com portas diferentes.
 */
export function reescreverParaHostAlcancavel(
  xaddr: string | undefined,
  host: string,
  porta: number,
): { host: string; porta: number; caminho: string } | null {
  if (!xaddr) return null;
  try {
    const u = new URL(xaddr);
    return { host, porta, caminho: `${u.pathname}${u.search}` || '/' };
  } catch {
    return null;
  }
}

/** Relógio da câmera, de `GetSystemDateAndTime`. Null quando não dá para ler. */
export function lerRelogioDaCamera(xml: string): Date | null {
  const utc = elemento(xml, 'UTCDateTime');
  if (!utc) return null;
  const data = elemento(utc, 'Date');
  const hora = elemento(utc, 'Time');
  if (!data || !hora) return null;
  const num = (bloco: string, nome: string) => {
    const v = elemento(bloco, nome);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const ano = num(data, 'Year');
  const mes = num(data, 'Month');
  const dia = num(data, 'Day');
  const h = num(hora, 'Hour');
  const m = num(hora, 'Minute');
  const s = num(hora, 'Second');
  if ([ano, mes, dia, h, m, s].some((v) => v === null)) return null;
  const ms = Date.UTC(ano!, mes! - 1, dia!, h!, m!, s!);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Diferença de relógio a aplicar no `Created` do WS-Security.
 *
 * Só corrige quando a diferença é grande o bastante para importar: relógio
 * ajustado por segundos entra em conflito com o `nonce` anti-repetição de
 * alguns firmwares, e a norma tolera alguns segundos. Diferença absurda
 * (anos) é lixo de leitura e não vira correção — carimbar 2011 num `Created`
 * faria TODA câmera recusar.
 */
export function calcularDesvioDeRelogio(
  relogioDaCamera: Date | null,
  agora: Date = new Date(),
): number {
  if (!relogioDaCamera) return 0;
  const desvio = relogioDaCamera.getTime() - agora.getTime();
  const abs = Math.abs(desvio);
  if (abs < 5_000) return 0;
  if (abs > 365 * 24 * 3600 * 1000) return 0;
  return desvio;
}
