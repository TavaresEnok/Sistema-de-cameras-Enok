'use strict';

/**
 * REMOVER uma instalação da Central.
 *
 * "não deve ter instalação sem central" (dono, 24/08/2026)
 *
 * Até aqui só dava para remover instalação que NUNCA tinha dado sinal de vida
 * ("Cancelar instalação"). Cliente que saiu ficava para sempre no painel,
 * poluindo a frota — a `dguardian` é o caso: a máquina foi formatada e virou
 * outro cliente, e o registro velho continuou lá.
 *
 * Agora dá para remover instalação ATIVA, e é a licença que faz o resto: sem
 * registro na Central ela para de renovar, restringe em 10 dias e suspende em
 * 15. Não é preciso apagar nada na máquina do cliente para que ela pare.
 *
 * A trava é digitar o código da instalação. Não é burocracia: remover é o
 * único botão do painel que TIRA A LICENÇA de um cliente pagante, e um clique
 * errado na lista de frota derrubaria o sistema de segurança de alguém duas
 * semanas depois — longe o bastante para ninguém ligar uma coisa à outra.
 */

function decidirRemocao({ existente, confirmacao }) {
  if (!existente) {
    return { permitido: false, motivo: 'nao-encontrada', http: 404 };
  }

  // Instalação que nunca deu sinal de vida é só um provisionamento pendente:
  // cancelar isso não tira licença de ninguém e não pede confirmação digitada.
  if (!existente.lastHeartbeatAt) {
    return { permitido: true, motivo: 'cancelar-pendente', http: 200 };
  }

  const digitado = String(confirmacao || '').trim();
  if (!digitado || digitado !== String(existente.id || '')) {
    return { permitido: false, motivo: 'confirmacao-invalida', http: 428 };
  }
  return { permitido: true, motivo: 'remover-ativa', http: 200 };
}

module.exports = { decidirRemocao };
