/**
 * A CÂMERA ESTÁ VIVA? — hierarquia de provas.
 *
 * Relatado em 14/08/2026, com print da tela: "Camera mercusys fica caindo
 * direto no sistema mas no app dela e em outro sistema roda normal, deve ter
 * alguma incompatibilidade!!!"
 *
 * Havia mesmo. Medido no equipamento do cliente, com o MediaMTX já puxando:
 *
 *   ffprobe rtsp://…@168.194.15.82:8554/…  →  "Operation not permitted"
 *   (três tentativas seguidas, todas recusadas)
 *
 * Essa câmera aceita UMA sessão RTSP por vez. No app dela e no outro sistema
 * há um consumidor só, e por isso funcionam. Aqui, o vigia de saúde abria uma
 * SEGUNDA sessão a cada minuto só para testar, levava "não permitido", e
 * concluía que a câmera tinha caído — enquanto o vídeo continuava chegando
 * pela primeira sessão. Daí o sintoma exato do print: imagem na tela e
 * "Offline" no rótulo.
 *
 * A regra antiga exigia três coisas ao mesmo tempo para dizer ONLINE: porta
 * RTSP aberta, porta ONVIF aberta e autenticação RTSP aceita. Nenhuma delas é
 * a pergunta certa. A pergunta certa é: ESTÃO CHEGANDO QUADROS?
 *
 * Quadros chegando é prova mais forte que qualquer sonda — a sonda testa se a
 * câmera aceita MAIS UMA conexão, que é outra coisa. E é uma prova que não
 * custa nada à câmera: quem responde é o nosso servidor de mídia, que já tem
 * a sessão aberta.
 *
 * Isto não vale só para esta marca. Vale para toda câmera com limite baixo de
 * sessões — e as baratas, que é o que mais se instala, costumam ter.
 */

export type CameraStatusSimples = 'ONLINE' | 'OFFLINE';

export type ProvasDeVida = {
  /** O servidor de mídia está recebendo quadros desta câmera AGORA. */
  transmitindoAgora?: boolean | null;
  /** A porta RTSP configurada respondeu ao TCP. */
  rtspAlcancavel?: boolean;
  /** Alguma porta ONVIF respondeu ao TCP. */
  onvifAlcancavel?: boolean;
  /** A câmera aceitou a credencial na sonda RTSP. */
  autenticacaoRtspOk?: boolean;
  /** Há usuário cadastrado? Sem credencial não há o que autenticar. */
  temCredencial?: boolean;
};

export type VeredictoDeVida = {
  status: CameraStatusSimples;
  /** Chave estável para log e teste. */
  motivo:
    | 'transmitindo'
    | 'sondas-ok'
    | 'sem-rtsp'
    | 'sem-onvif'
    | 'credencial-recusada';
  /** Frase para quem opera, sem jargão. */
  explicacao: string;
};

/**
 * Decide o estado a partir das provas disponíveis.
 *
 * A ordem importa e é a razão de este módulo existir: transmissão em curso
 * vence qualquer sonda. Uma câmera que está entregando vídeo está online, e
 * dizer o contrário é o defeito que esta função corrige.
 */
export function decidirEstadoDaCamera(provas: ProvasDeVida): VeredictoDeVida {
  if (provas.transmitindoAgora === true) {
    return {
      status: 'ONLINE',
      motivo: 'transmitindo',
      explicacao: 'A câmera está enviando vídeo agora.',
    };
  }

  if (provas.rtspAlcancavel !== true) {
    return {
      status: 'OFFLINE',
      motivo: 'sem-rtsp',
      explicacao: 'A câmera não respondeu na porta de vídeo.',
    };
  }

  // Credencial recusada é diferente de câmera fora do ar: o equipamento está
  // lá e respondeu. Separado para o operador saber que o conserto é a senha.
  if (provas.temCredencial === true && provas.autenticacaoRtspOk !== true) {
    return {
      status: 'OFFLINE',
      motivo: 'credencial-recusada',
      explicacao: 'A câmera respondeu, mas recusou o usuário e a senha cadastrados.',
    };
  }

  if (provas.onvifAlcancavel !== true) {
    return {
      status: 'OFFLINE',
      motivo: 'sem-onvif',
      explicacao: 'A câmera respondeu no vídeo, mas não na porta de controle (ONVIF).',
    };
  }

  return {
    status: 'ONLINE',
    motivo: 'sondas-ok',
    explicacao: 'A câmera respondeu a todas as verificações.',
  };
}

/**
 * Vale a pena abrir uma sonda RTSP nesta câmera agora?
 *
 * Não, quando ela já está transmitindo: a sonda seria uma segunda sessão, e é
 * exatamente essa segunda sessão que a câmera de sessão única recusa. Pior que
 * inútil — é a causa do falso "offline".
 */
export function devoSondarRtsp(transmitindoAgora: boolean | null | undefined): boolean {
  return transmitindoAgora !== true;
}
