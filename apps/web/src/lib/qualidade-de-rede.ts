// ── "É O SISTEMA OU É A MINHA INTERNET?" ────────────────────────────────────
//
// Pedido antigo do dono, reforçado em 11/08/2026 depois de ele passar horas
// achando que o sistema tinha travado — e o culpado ser a rede do notebook
// dele: "se minha rede estiver ruim, deveria aparecer uma notificação, sua rede
// está instável! para não colocarem culpa no sistema assim como passei".
//
// A regra de ouro deste módulo é o CONTRÁRIO de uma desculpa automática:
// só apontamos a rede do usuário quando existe PROVA de que o servidor está
// respondendo bem. Um aviso "sua internet está ruim" exibido durante uma falha
// real do servidor seria pior que aviso nenhum — esconderia o defeito e faria o
// operador perder tempo brigando com o roteador. Foi exatamente o risco no dia
// em que a GPU sumiu e o sistema ficou 14 h fora: ali o certo é dizer que o
// problema é do servidor.
//
// COMO SE DISTINGUE, na prática:
//
//   O tráfego do sistema tem duas vias muito diferentes:
//     • CONTROLE  — requisições HTTPS pequenas (listar câmeras, abrir sessão
//                   WHEP). Poucos KB, sobrevivem em rede ruim.
//     • MÍDIA     — o vídeo em si. Megabits contínuos, sensível a perda,
//                   jitter e a UDP bloqueado.
//
//   Se o CONTROLE vai bem (a API responde rápido, o WHEP devolve 201) mas a
//   MÍDIA não chega, o servidor está demonstravelmente vivo e a falha está no
//   caminho do vídeo — quase sempre a última milha do usuário: banda,
//   perda de pacote, Wi-Fi ruim ou UDP bloqueado.
//
//   Se o próprio CONTROLE falha (a API não responde, o WHEP dá erro), NÃO dá
//   para culpar ninguém com honestidade: pode ser o servidor, pode ser a rede.
//   Nesse caso a mensagem é neutra.

export type NivelDeRede = 'ok' | 'instavel' | 'lenta' | 'offline' | 'servidor';

export type SinaisDeRede = {
  /** navigator.onLine. false = placa/Wi-Fi caiu; é local, sem ambiguidade. */
  online: boolean;
  /**
   * Ida-e-volta até a NOSSA API, em ms. null quando a última tentativa falhou.
   * É a régua do caminho de CONTROLE.
   */
  apiRttMs: number | null;
  /** Falhas consecutivas de contato com a API (0 = último contato deu certo). */
  apiFalhasSeguidas: number;
  /** Players de vídeo montados agora (0 = nenhuma tela ao vivo aberta). */
  streamsTotal: number;
  /**
   * Players cuja SINALIZAÇÃO deu certo (sessão aberta) mas que não recebem
   * imagem. É a assinatura de caminho de mídia ruim.
   */
  streamsSemMidia: number;
  /**
   * Players que falharam JÁ NA SINALIZAÇÃO (WHEP/HLS devolveu erro, ou nem
   * respondeu). Aponta para o servidor, não para a banda do usuário.
   */
  streamsSemSinalizacao: number;
};

export type DiagnosticoDeRede = {
  nivel: NivelDeRede;
  /** Texto curto para a faixa de aviso. */
  titulo: string;
  /** Uma frase dizendo o que fazer / de quem é o problema. */
  detalhe: string;
  /** true quando a causa provável é a conexão DO USUÁRIO. */
  culpaDaRedeLocal: boolean;
};

/** Acima disto a ida-e-volta já incomoda mesmo em requisição pequena. */
export const RTT_LENTO_MS = 1200;
/** Abaixo disto consideramos o caminho de controle comprovadamente saudável. */
export const RTT_SAUDAVEL_MS = 700;
/** Só acusamos a rede local quando a maioria das telas está sem imagem. */
export const FRACAO_MINIMA_SEM_MIDIA = 0.5;

/** O que um player relata ao diagnóstico. Ver EstadoDoPlayer no redeStore. */
export type EstadoDePlayer = 'ok' | 'sem-midia' | 'sem-sinalizacao';

/**
 * Classifica a falha de UM player nos dois modos que o diagnóstico distingue.
 *
 * A régua é o CÓDIGO HTTP: quando o servidor recusa o pedido de stream ele
 * responde 4xx/5xx, e isso é defeito do lado de lá. Qualquer outra falha
 * ("não entregou vídeo dentro do tempo limite", "vídeo preto") significa que a
 * sessão abriu e a imagem não veio — caminho de mídia.
 *
 * ⚠️ NÃO procure nomes de componente no texto. A mensagem agregada que o
 * operador vê é "Nenhum protocolo iniciou. Verifique WebRTC/WHEP, HLS, codec da
 * câmera e conectividade com o MediaMTX." — ela CITA o MediaMTX apenas como
 * conselho de onde olhar. A 1ª versão casava essa palavra e classificava o caso
 * mais comum de internet ruim como "defeito do servidor", justamente invertendo
 * o diagnóstico que o dono pediu.
 */
export function classificarFalhaDePlayer(
  erro: string | null | undefined,
  temImagem: boolean,
  carregando: boolean,
): EstadoDePlayer {
  if (erro) {
    const codigoHttp = /\b(4\d\d|5\d\d)\b/.test(erro);
    const recusaExplicita = /não autorizad|autentica|forbidden|unauthorized|path not found/i.test(erro);
    return codigoHttp || recusaExplicita ? 'sem-sinalizacao' : 'sem-midia';
  }
  // Sem erro declarado e sem quadro: só conta como falta de mídia depois que o
  // player parou de tentar. Enquanto está "carregando" é abertura normal.
  if (!temImagem && !carregando) return 'sem-midia';
  return 'ok';
}

export function avaliarQualidadeDeRede(s: SinaisDeRede): DiagnosticoDeRede {
  // 1) Sem rede nenhuma: não há o que interpretar.
  if (!s.online) {
    return {
      nivel: 'offline',
      titulo: 'Sem conexão com a internet',
      detalhe: 'Este dispositivo está sem rede. O servidor e as gravações não são afetados.',
      culpaDaRedeLocal: true,
    };
  }

  // 2) A API não responde. AQUI NÃO SE CULPA O USUÁRIO: pode ser o servidor.
  //    Mensagem neutra e honesta — quem investiga decide.
  //
  //    Só o CONTADOR de falhas manda. `apiRttMs == null` sozinho NÃO serve:
  //    ele também vale "ainda não medi" (a primeira sonda leva alguns
  //    milissegundos após a página abrir). A 1ª versão disparava por null e a
  //    faixa vermelha "Sem comunicação com o servidor" aparecia em TODA carga,
  //    com o sistema perfeito — o alarme falso que ensina a ignorar alarmes,
  //    o mesmo defeito do aviso `site-cameras:0.0.0.0` no Telegram.
  if (s.apiFalhasSeguidas >= 3) {
    return {
      nivel: 'servidor',
      titulo: 'Sem comunicação com o servidor',
      detalhe: 'Pode ser a sua conexão ou o servidor. As câmeras seguem gravando localmente.',
      culpaDaRedeLocal: false,
    };
  }

  // 3) A sinalização das câmeras está falhando na origem (o servidor recusa ou
  //    não responde ao pedido de stream). Isso é defeito do lado de lá — foi o
  //    caso do dia em que a placa de vídeo sumiu. Nunca chamar de "internet
  //    ruim": mandaria o operador procurar no lugar errado.
  if (s.streamsTotal > 0 && s.streamsSemSinalizacao > s.streamsSemMidia
      && s.streamsSemSinalizacao / s.streamsTotal >= FRACAO_MINIMA_SEM_MIDIA) {
    return {
      nivel: 'servidor',
      titulo: 'Falha ao iniciar as transmissões',
      detalhe: 'O servidor de vídeo não está entregando os streams. Não é a sua conexão.',
      culpaDaRedeLocal: false,
    };
  }

  // 4) O DIAGNÓSTICO CENTRAL: controle saudável + mídia não chega.
  //    A API respondeu rápido (logo o servidor está vivo e perto), as sessões
  //    de vídeo ABRIRAM, mas a imagem não vem. Só sobra o caminho do vídeo.
  // `apiRttMs == null` aqui significa "ainda não medido / medição falhou uma
  // vez". Sem essa régua não há prova de que o servidor está saudável, e sem
  // prova NÃO se acusa a rede do usuário — é a regra central deste módulo.
  const proporcaoSemMidia = s.streamsTotal > 0 ? s.streamsSemMidia / s.streamsTotal : 0;
  if (
    s.streamsTotal > 0
    && proporcaoSemMidia >= FRACAO_MINIMA_SEM_MIDIA
    && s.apiRttMs != null
    && s.apiRttMs <= RTT_SAUDAVEL_MS
  ) {
    return {
      nivel: 'instavel',
      titulo: 'Sua conexão está instável',
      detalhe:
        'O servidor responde normalmente, mas o vídeo não está chegando neste dispositivo. '
        + 'Verifique o Wi-Fi ou a internet daqui — as câmeras continuam gravando.',
      culpaDaRedeLocal: true,
    };
  }

  // 5) Tudo lento, inclusive requisição pequena: a conexão está ruim como um
  //    todo (ou o caminho até o servidor está congestionado).
  if (s.apiRttMs != null && s.apiRttMs >= RTT_LENTO_MS) {
    return {
      nivel: 'lenta',
      titulo: 'Conexão lenta',
      detalhe: `Respostas levando ${Math.round(s.apiRttMs)} ms. O vídeo pode travar ou demorar a abrir.`,
      culpaDaRedeLocal: true,
    };
  }

  return {
    nivel: 'ok',
    titulo: '',
    detalhe: '',
    culpaDaRedeLocal: false,
  };
}
