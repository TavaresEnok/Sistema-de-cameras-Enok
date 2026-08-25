/**
 * O TÚNEL ATÉ AS CÂMERAS DO CLIENTE, entregue pela Central.
 *
 * O túnel existe para ESTA instalação alcançar as câmeras do cliente quando o
 * servidor não está dentro da rede dele. Nada a ver com o contato entre
 * instalação e Central — esse é HTTPS comum e sempre foi.
 *
 * A INVARIANTE QUE NÃO PODE CAIR: o túnel carrega SÓ as faixas declaradas.
 * Nunca a rota padrão. Um perfil pedindo 0.0.0.0/0 jogaria todo o tráfego do
 * servidor para dentro da rede do cliente — o painel para de responder no
 * endereço público, o cliente perde acesso ao próprio sistema e nós perdemos
 * junto. A Central já recusa isso; aqui recusa DE NOVO, porque trava que existe
 * só de um lado é trava que um dia não existe.
 *
 * Puro: decide o que aplicar sem tocar em rede, arquivo ou processo.
 */

export type PerfilDeVpn = {
  tipo: string;
  nome: string;
  servidor: string;
  usuario?: string;
  faixas: string[];
  cameras: string[];
  senhaCifrada?: string | null;
  segredoCifrado?: string | null;
  revisao?: number;
};

export type DecisaoDeVpn = {
  acao: 'aplicar' | 'manter' | 'desmontar' | 'recusar';
  motivo:
    | 'sem-vpn'
    | 'ja-aplicado'
    | 'revisao-nova'
    | 'primeira-vez'
    | 'faixa-sequestra-a-internet'
    | 'faixa-invalida'
    | 'prova-de-vida-ausente'
    | 'tipo-desconhecido';
  detalhe?: string;
};

const TIPOS_SUPORTADOS = ['l2tp-ipsec', 'wireguard', 'openvpn'];
/** Rotas que sequestrariam a internet do proprio servidor. */
const PROIBIDAS = new Set(['0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1', '::/0']);

const CIDR = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/;

function faixaValida(f: string): boolean {
  const t = f.trim();
  if (!CIDR.test(t)) return false;
  const partes = t.split('/');
  if (Number(partes[1]) > 32) return false;
  return partes[0].split('.').every((o) => Number(o) <= 255);
}

/**
 * O que fazer com o perfil que chegou.
 *
 * `revisaoAplicada` e a ultima revisao que esta maquina ja montou. Reaplicar o
 * mesmo perfil derrubaria o tunel por alguns segundos a cada heartbeat — e o
 * heartbeat roda a cada minuto.
 */
export function decidirSobreVpn(
  perfil: PerfilDeVpn | null | undefined,
  revisaoAplicada: number | null,
): DecisaoDeVpn {
  if (!perfil || !perfil.tipo) {
    // Ja houve tunel e agora nao ha mais: desmontar. Nunca houve: nada a fazer.
    return revisaoAplicada ? { acao: 'desmontar', motivo: 'sem-vpn' } : { acao: 'manter', motivo: 'sem-vpn' };
  }

  if (!TIPOS_SUPORTADOS.includes(String(perfil.tipo).toLowerCase())) {
    return { acao: 'recusar', motivo: 'tipo-desconhecido', detalhe: String(perfil.tipo) };
  }

  const faixas = Array.isArray(perfil.faixas) ? perfil.faixas.map((f) => String(f).trim()).filter(Boolean) : [];
  if (!faixas.length) {
    return { acao: 'recusar', motivo: 'faixa-invalida', detalhe: 'nenhuma faixa declarada' };
  }
  for (const f of faixas) {
    if (PROIBIDAS.has(f)) {
      return { acao: 'recusar', motivo: 'faixa-sequestra-a-internet', detalhe: f };
    }
    if (!faixaValida(f)) {
      return { acao: 'recusar', motivo: 'faixa-invalida', detalhe: f };
    }
  }

  const cameras = Array.isArray(perfil.cameras) ? perfil.cameras.map((c) => String(c).trim()).filter(Boolean) : [];
  if (!cameras.length) {
    // Sem endereco de camera o vigia so saberia perguntar ao proprio tunel —
    // que responde sempre. Foi assim que o D-GUARDIAN ficou 8 horas sem gravar
    // com tudo "verde".
    return { acao: 'recusar', motivo: 'prova-de-vida-ausente' };
  }

  const revisao = Number(perfil.revisao) || 1;
  if (revisaoAplicada === null || revisaoAplicada === undefined) {
    return { acao: 'aplicar', motivo: 'primeira-vez' };
  }
  if (revisao > revisaoAplicada) {
    return { acao: 'aplicar', motivo: 'revisao-nova' };
  }
  return { acao: 'manter', motivo: 'ja-aplicado' };
}
