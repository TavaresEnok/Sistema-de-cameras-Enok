import { createHash, randomBytes } from 'node:crypto';

/**
 * WS-Security UsernameToken — a autenticação que a maioria das câmeras ONVIF
 * realmente usa, e que este sistema não falava.
 *
 * DESCOBERTO em 14/08/2026, numa Mercusys que o dono sabia ter PTZ. Outra
 * ferramenta movimentou a câmera pelo mesmo IP e porta; a nossa dizia "não tem
 * PTZ". Medido direto no equipamento:
 *
 *   POST /onvif/service  GetProfiles  →  HTTP 400 "Authority failure"
 *   WWW-Authenticate: (nenhum)
 *
 * A câmera NUNCA oferece Digest. E o cliente ONVIF daqui só sabia Digest —
 * `digestSoapRequest` desistia com "Auth não é Digest" e o resultado virava
 * `ptzCapable = false`. Como o ONVIF define UsernameToken como o mecanismo
 * padrão, é provável que parte das 27 câmeras hoje marcadas "sem PTZ" tenha
 * PTZ e nunca tenha sido perguntada direito.
 *
 * O cálculo é o do OASIS WSS 1.0, seção de UsernameToken Profile:
 *
 *     PasswordDigest = Base64( SHA1( nonce_bruto + created_utf8 + senha_utf8 ) )
 *
 * Três detalhes que fazem a câmera recusar quando errados, e que por isso têm
 * teste próprio:
 *
 *   1. o nonce entra no SHA-1 em BYTES CRUS, não no texto Base64 — trocar isso
 *      dá um digest bem-formado e sempre inválido;
 *   2. `Created` é UTC com Z e SEM milissegundos em muitos firmwares baratos;
 *   3. a ordem dos elementos é fixa (Username, Password, Nonce, Created) —
 *      câmera com parser rígido rejeita fora de ordem.
 */

export type TokenDeSeguranca = {
  usuario: string;
  senha: string;
  /** Injetáveis para o teste ser determinístico. */
  nonce?: Buffer;
  criadoEm?: Date;
};

const NS_WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
const NS_WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
const TIPO_DIGEST = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest';
const TIPO_BASE64 = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';

/** `Created` no formato que os firmwares aceitam: UTC, com Z, sem milissegundos. */
export function formatarCriadoEm(data: Date): string {
  return `${data.toISOString().split('.')[0]}Z`;
}

/** Base64( SHA1( nonce_BRUTO + created + senha ) ). */
export function calcularPasswordDigest(nonce: Buffer, criadoEm: string, senha: string): string {
  return createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(criadoEm, 'utf8'), Buffer.from(senha, 'utf8')]))
    .digest('base64');
}

function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** O bloco `<Security>` pronto para entrar no cabeçalho SOAP. */
export function montarCabecalhoWsSecurity(token: TokenDeSeguranca): string {
  const nonce = token.nonce ?? randomBytes(16);
  const criadoEm = formatarCriadoEm(token.criadoEm ?? new Date());
  const digest = calcularPasswordDigest(nonce, criadoEm, token.senha);
  return (
    `<wsse:Security xmlns:wsse="${NS_WSSE}" xmlns:wsu="${NS_WSU}">`
    + '<wsse:UsernameToken>'
    + `<wsse:Username>${escaparXml(token.usuario)}</wsse:Username>`
    + `<wsse:Password Type="${TIPO_DIGEST}">${digest}</wsse:Password>`
    + `<wsse:Nonce EncodingType="${TIPO_BASE64}">${nonce.toString('base64')}</wsse:Nonce>`
    + `<wsu:Created>${criadoEm}</wsu:Created>`
    + '</wsse:UsernameToken>'
    + '</wsse:Security>'
  );
}

/**
 * Insere o cabeçalho no envelope SOAP, respeitando o prefixo que o envelope já
 * usa (`s:`, `soap:`, `SOAP-ENV:`…).
 *
 * Envelope que JÁ tem `<Header>` recebe o bloco dentro dele; envelope sem
 * cabeçalho ganha um antes do corpo. Devolve o original quando não reconhece a
 * estrutura — mandar XML remendado errado é pior que mandar sem autenticação,
 * porque a câmera responde com falha de parse e o diagnóstico aponta para o
 * lugar errado.
 */
export function injetarWsSecurity(envelope: string, token: TokenDeSeguranca): string {
  const seguranca = montarCabecalhoWsSecurity(token);

  const cabecalhoExistente = /<([A-Za-z0-9_.-]+:)?Header(\s[^>]*)?>/i.exec(envelope);
  if (cabecalhoExistente) {
    const fim = cabecalhoExistente.index + cabecalhoExistente[0].length;
    return envelope.slice(0, fim) + seguranca + envelope.slice(fim);
  }

  const corpo = /<([A-Za-z0-9_.-]+:)?Body(\s[^>]*)?>/i.exec(envelope);
  if (!corpo) return envelope;
  const prefixo = corpo[1] ?? '';
  return (
    envelope.slice(0, corpo.index)
    + `<${prefixo}Header>${seguranca}</${prefixo}Header>`
    + envelope.slice(corpo.index)
  );
}

/**
 * Vale a pena tentar WS-Security depois desta resposta?
 *
 * Sim quando a câmera recusou por autorização SEM oferecer Digest — que é
 * exatamente o caso descoberto. Também no 401 sem cabeçalho de desafio.
 * Não quando ela ofereceu Digest (o caminho atual funciona) nem quando o
 * problema é outro.
 */
export function deveTentarWsSecurity(entrada: {
  statusCode?: number | null;
  wwwAuthenticate?: string | null;
  corpo?: string | null;
}): boolean {
  const status = Number(entrada.statusCode);
  const desafio = String(entrada.wwwAuthenticate ?? '').toLowerCase();
  if (desafio.includes('digest')) return false;
  if (status === 401) return true;
  if (status === 400) {
    // "Authority failure" é o texto que esta família de firmware devolve; há
    // variações ("not authorized", "sender not authorized"). Reagir só ao
    // status 400 seria demais — muita coisa vira 400.
    return /author|not authorized|access denied|senderNotAuthorized/i.test(String(entrada.corpo ?? ''));
  }
  return false;
}
