'use strict';

/**
 * MATRÍCULA de uma instalação nova na Central.
 *
 * O buraco que isto fecha (24/08/2026): o `cliente.env` promete "licença vazia
 * = gerada na instalação", mas a Central recusa qualquer instalação que ela
 * mesma não tenha criado. Os dois lados foram desenhados com ideias diferentes,
 * então instalação feita direto pelo script NUNCA se registrava — o instalador
 * tomava 403, imprimia um aviso e seguia como se tivesse dado certo. A Córtex
 * passou o dia inteiro assim.
 *
 * Com a regra de licença que vence sozinha, isso deixou de ser detalhe: uma
 * instalação órfã seria SUSPENSA em 15 dias.
 *
 * A matrícula usa uma senha combinada (o "token de matrícula"), guardada na
 * Central e copiada para o arquivo de respostas do instalador. Sem ela ninguém
 * se matricula — o que preserva a proteção original: antes de existir esse
 * cuidado, qualquer um na internet registrava instalações e injetava dados no
 * painel do dono.
 *
 * Três regras que a operação exige, cada uma com teste:
 *
 *   · SEM token configurado na Central, a matrícula fica DESLIGADA. Não é
 *     "aceita todo mundo": é recusar, porque token vazio casaria com qualquer
 *     coisa e reabriria exatamente o buraco que se fechou.
 *   · Reinstalar a MESMA instalação é permitido enquanto ela nunca deu sinal
 *     de vida — é o caso de refazer uma instalação que deu errado.
 *   · Instalação ATIVA (que já mandou heartbeat) não pode ser tomada por quem
 *     chega com outra chave. Senão o token de matrícula viraria um jeito de
 *     sequestrar o cliente de alguém.
 */

/**
 * @param {object} e
 * @param {string} e.tokenApresentado   token que o instalador enviou
 * @param {string} e.tokenConfigurado   token guardado na Central (vazio = desligado)
 * @param {object|null} e.existente     instalação já gravada, se houver
 * @param {string} e.chaveApresentada   licença que o instalador propõe (pode ser vazia)
 * @param {(a:string,b:string)=>boolean} e.comparar  comparação à prova de cronometragem
 */
function decidirMatricula(e) {
  const configurado = String(e.tokenConfigurado || '').trim();
  const apresentado = String(e.tokenApresentado || '').trim();

  if (!configurado) {
    return { permitido: false, motivo: 'matricula-desligada', http: 403 };
  }
  if (!apresentado || !e.comparar(configurado, apresentado)) {
    return { permitido: false, motivo: 'token-invalido', http: 403 };
  }

  const existente = e.existente || null;
  if (!existente) {
    return { permitido: true, motivo: 'criar', http: 201 };
  }

  // Já existe. Se nunca deu sinal de vida, é reinstalação legítima.
  if (!existente.lastHeartbeatAt) {
    return { permitido: true, motivo: 'reinstalar', http: 200 };
  }

  // Está viva: só quem prova a chave atual continua dono dela.
  const chaveAtual = String(existente.licenseKey || '');
  const chave = String(e.chaveApresentada || '');
  if (chaveAtual && chave && e.comparar(chaveAtual, chave)) {
    return { permitido: true, motivo: 'ja-matriculada', http: 200 };
  }
  return { permitido: false, motivo: 'instalacao-ativa', http: 409 };
}

module.exports = { decidirMatricula };
