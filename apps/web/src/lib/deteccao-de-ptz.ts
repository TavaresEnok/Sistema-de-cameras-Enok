// Por que ESTA câmera não aparece na página de PTZ — e o que dá para fazer.
//
// Relatado em 14/08/2026 pelo dono, com duas câmeras NOC ONLINE e nunca
// sondadas:
//
//   "eu tenho uma camera com ptz mas nao aparece na pagina ptz e a pagina me
//    impede de colocar alguma camera manualmente deveria ter um campo para eu
//    escolher alguma camera para testar porque o sistema pode está errado"
//
// Três problemas na tela vazia, todos reais:
//
//   1. Ela dava UM motivo para todas — "estão fora do ar" — sem olhar câmera
//      por câmera. As dele estavam ONLINE, então a explicação estava errada
//      justamente para quem foi procurar explicação.
//   2. Não oferecia AÇÃO nenhuma. A rota de sondar sob demanda
//      (`POST /ptz/:id/probe`) e a marcação manual (`PATCH /cameras/:id` com
//      `ptzCapable`) existem desde sempre e não tinham botão.
//   3. Enchia de texto genérico ("câmeras fixas continuam normais") no lugar
//      onde o operador precisa resolver um problema.
//
// A regra: a tela diz a verdade sobre CADA câmera, e toda afirmação que ela faz
// vem acompanhada do que fazer a respeito.

export type CameraParaDeteccao = {
  id: string;
  name: string;
  isOnline?: boolean;
  enabled?: boolean;
  /** `ptzCapable` do backend. null = nunca sondada. */
  ptzDetectado?: boolean | null;
};

export type SituacaoDeDeteccao = {
  chave: 'nunca-sondada-online' | 'nunca-sondada-offline' | 'desativada' | 'sondada-sem-ptz';
  /** Frase curta que explica ESTA câmera. */
  motivo: string;
  /** Vale a pena oferecer "Testar agora"? */
  podeTestar: boolean;
};

/**
 * Por que esta câmera não está na lista de PTZ.
 *
 * A ordem importa: desativada vence tudo (não adianta sondar), depois o estado
 * de sonda, e só então online/offline — que muda o que se pode fazer AGORA.
 */
export function situacaoDeDeteccao(camera: CameraParaDeteccao): SituacaoDeDeteccao {
  if (camera.enabled === false) {
    return {
      chave: 'desativada',
      motivo: 'Câmera desativada — reative para poder testar.',
      podeTestar: false,
    };
  }
  if (camera.ptzDetectado === null || camera.ptzDetectado === undefined) {
    if (camera.isOnline === false) {
      return {
        chave: 'nunca-sondada-offline',
        motivo: 'Ainda não foi verificada, e está fora do ar. O teste precisa da câmera respondendo.',
        podeTestar: false,
      };
    }
    return {
      chave: 'nunca-sondada-online',
      motivo: 'Ainda não foi verificada. Está no ar — dá para testar agora.',
      podeTestar: true,
    };
  }
  return {
    chave: 'sondada-sem-ptz',
    motivo: 'Foi verificada e respondeu que não aceita comandos de movimento.',
    podeTestar: true,
  };
}

/**
 * As câmeras que vale oferecer para teste, na ordem em que ajudam.
 *
 * Quem está no ar e nunca foi verificada vem primeiro: é o caso com maior
 * chance de o sistema estar simplesmente sem informação, que é exatamente a
 * situação que fez o dono desconfiar da tela.
 */
export function candidatasParaTeste(cameras: CameraParaDeteccao[]): CameraParaDeteccao[] {
  const peso: Record<SituacaoDeDeteccao['chave'], number> = {
    'nunca-sondada-online': 0,
    'sondada-sem-ptz': 1,
    'nunca-sondada-offline': 2,
    desativada: 3,
  };
  return cameras
    .filter((c) => c.ptzDetectado !== true)
    .slice()
    .sort((a, b) => {
      const da = peso[situacaoDeDeteccao(a).chave];
      const db = peso[situacaoDeDeteccao(b).chave];
      return da - db || a.name.localeCompare(b.name, 'pt-BR');
    });
}

/**
 * O que dizer depois de um teste, traduzindo o motivo cru do backend.
 *
 * `sondou: false` NÃO é fracasso: pode ser "você já definiu à mão" ou "a câmera
 * está desativada". Tratar tudo como erro faria o operador tentar de novo em
 * situações que nenhuma quantidade de cliques resolve.
 */
export function explicarResultadoDoTeste(resultado: {
  sondou?: boolean;
  motivo?: string | null;
  ptzCapable?: boolean | null;
}): { titulo: string; detalhe: string; sucesso: boolean } {
  if (resultado?.sondou && resultado.ptzCapable === true) {
    return {
      titulo: 'PTZ encontrado',
      detalhe: 'A câmera respondeu aos comandos de movimento e já aparece na lista.',
      sucesso: true,
    };
  }
  if (resultado?.sondou) {
    return {
      titulo: 'A câmera respondeu que não tem PTZ',
      detalhe: 'Se você sabe que ela tem, confira usuário, senha e porta ONVIF no cadastro — '
        + 'ou marque manualmente aqui embaixo.',
      sucesso: false,
    };
  }
  const motivos: Record<string, { titulo: string; detalhe: string }> = {
    'definido-manualmente': {
      titulo: 'Esta câmera está definida à mão',
      detalhe: 'A sua decisão vence a verificação automática. Para voltar ao automático, '
        + 'limpe a marcação no cadastro da câmera.',
    },
    'camera-desativada': {
      titulo: 'Câmera desativada',
      detalhe: 'Reative a câmera para poder testar.',
    },
    'falha-na-sonda': {
      titulo: 'Não deu para falar com a câmera',
      detalhe: 'Falha de rede ou credencial ONVIF. Isto NÃO significa que ela não tem PTZ — '
        + 'confira o cadastro e tente de novo.',
    },
    'camera-inexistente': {
      titulo: 'Câmera não encontrada',
      detalhe: 'Ela pode ter sido removida enquanto esta tela estava aberta.',
    },
    'sondada-recentemente': {
      titulo: 'Já verificada há pouco',
      detalhe: 'O resultado anterior continua valendo.',
    },
  };
  const conhecido = resultado?.motivo ? motivos[resultado.motivo] : undefined;
  if (conhecido) return { ...conhecido, sucesso: false };
  return {
    titulo: 'Não foi possível verificar',
    detalhe: resultado?.motivo
      ? `O servidor informou "${resultado.motivo}", que esta tela ainda não sabe explicar.`
      : 'Tente novamente em alguns instantes.',
    sucesso: false,
  };
}
