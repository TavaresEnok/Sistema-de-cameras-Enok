/**
 * PERGUNTAR À CÂMERA INTELBRAS o que ela sabe fazer — e catalogar a resposta.
 *
 * Contexto (17/08/2026): clientes de peso vão trazer câmeras analíticas
 * próprias, que falam a API HTTP/CGI da família Intelbras/Dahua. Duas análises
 * externas descreveram essa integração, ambas escritas LENDO DOCUMENTAÇÃO —
 * nenhuma perguntou a um equipamento.
 *
 * Bastaram cinco minutos contra uma câmera real da frota para aparecer a
 * divergência que justifica este módulo:
 *
 *   VIPC-1230-B-G2, firmware 2.860.00IB000.0.R
 *     /cgi-bin/magicBox.cgi?action=getDeviceType     → 200  type=VIPC-1230-B-G2
 *     /cgi-bin/magicBox.cgi?action=getSerialNo       → 200  sn=DER0009462716
 *     /cgi-bin/devVideoAnalyse.cgi?action=getCaps    → 400  Bad Request!
 *
 * O último está na documentação e a câmera recusa. Implementar a partir do PDF
 * escreveria código para uma rota que este firmware não atende — o mesmo erro
 * que o detector de PTZ cometia ao adivinhar caminhos ONVIF, e que custou dias.
 *
 * Este módulo é a LEITURA da resposta, separada da rede: dado o que a câmera
 * devolveu, isto é uma capacidade presente, ausente, ou não sabemos?
 */

export type ResultadoBruto = {
  /** Código HTTP. Ausente quando nem houve resposta (rede, timeout). */
  status?: number | null;
  corpo?: string | null;
  erro?: string | null;
};

export type Veredito =
  | 'suportado'
  | 'nao-suportado'
  | 'sem-permissao'
  | 'inalcancavel'
  | 'indeterminado';

export type Capacidade = {
  chave: string;
  veredito: Veredito;
  /** Valores lidos da resposta, quando ela é do formato `chave=valor`. */
  valores: Record<string, string>;
  /** O que mostrar ao operador. Nunca vazio. */
  explicacao: string;
};

/**
 * A família responde em linhas `chave=valor`, com chaves aninhadas por ponto
 * e colchetes (`table.General.LocalNo=1`). Devolve o que deu para ler; texto
 * fora do formato não vira entrada inventada.
 */
export function lerParesChaveValor(corpo: string | null | undefined): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const linha of String(corpo ?? '').split(/\r?\n/)) {
    const corte = linha.indexOf('=');
    if (corte <= 0) continue;
    const chave = linha.slice(0, corte).trim();
    const valor = linha.slice(corte + 1).trim();
    if (chave) saida[chave] = valor;
  }
  return saida;
}

/**
 * Classifica o que a câmera respondeu.
 *
 * A distinção que importa é entre "esta câmera NÃO tem o recurso" e "eu não
 * consegui perguntar". Confundir os dois é o defeito que este sistema já
 * cometeu com PTZ, marcando 27 câmeras como sem PTZ quando o cliente não sabia
 * falar WS-Security. Aqui:
 *
 *   400/404      → a câmera respondeu e recusou a rota: não suportado
 *   401/403      → ela existe, mas a credencial não alcança: sem permissão
 *   erro de rede → não sabemos nada
 *
 * E corpo com "Error"/"Bad Request" em HTTP 200 também é recusa: parte dos
 * firmwares devolve 200 com texto de erro, e tratar isso como sucesso
 * catalogaria capacidade que não existe.
 */
export function classificarResposta(chave: string, r: ResultadoBruto): Capacidade {
  const corpo = String(r.corpo ?? '');
  const valores = lerParesChaveValor(corpo);

  if (r.erro || r.status == null) {
    return {
      chave,
      veredito: 'inalcancavel',
      valores: {},
      explicacao: `Não consegui perguntar (${r.erro ?? 'sem resposta'}). Isto NÃO significa que a câmera não tenha o recurso.`,
    };
  }

  if (r.status === 401 || r.status === 403) {
    return {
      chave,
      veredito: 'sem-permissao',
      valores: {},
      explicacao: 'A câmera respondeu, mas recusou o usuário. Verifique a credencial ou o perfil de acesso.',
    };
  }

  if (r.status >= 400) {
    return {
      chave,
      veredito: 'nao-suportado',
      valores: {},
      explicacao: `A câmera recusou esta consulta (HTTP ${r.status}). Este modelo/firmware não a atende.`,
    };
  }

  // HTTP 200 com texto de erro é recusa disfarçada — comum nesta família.
  if (/^\s*Error\b/i.test(corpo) || /Bad Request|Invalid|not support/i.test(corpo)) {
    return {
      chave,
      veredito: 'nao-suportado',
      valores: {},
      explicacao: `A câmera respondeu 200 com texto de erro ("${corpo.trim().split(/\r?\n/)[0]?.slice(0, 60)}").`,
    };
  }

  if (Object.keys(valores).length === 0) {
    return {
      chave,
      veredito: 'indeterminado',
      valores: {},
      explicacao: 'Resposta aceita, mas em formato que não sei ler. Guardada crua para análise.',
    };
  }

  return {
    chave,
    veredito: 'suportado',
    valores,
    explicacao: `Respondeu com ${Object.keys(valores).length} campo(s).`,
  };
}

/**
 * Resumo do catálogo para a tela.
 *
 * Separa explicitamente o que a câmera NEGOU do que não foi possível perguntar
 * — um relatório que soma os dois faria o operador desistir de um recurso que
 * talvez exista.
 */
export function resumirCatalogo(capacidades: Capacidade[]) {
  const conta = (v: Veredito) => capacidades.filter((c) => c.veredito === v).length;
  return {
    total: capacidades.length,
    suportadas: conta('suportado'),
    naoSuportadas: conta('nao-suportado'),
    semPermissao: conta('sem-permissao'),
    inalcancaveis: conta('inalcancavel'),
    indeterminadas: conta('indeterminado'),
    /** Confiável apenas quando conseguimos falar com a câmera. */
    conclusivo: conta('inalcancavel') === 0,
  };
}
