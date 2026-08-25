'use strict';

const { validarFaixasDoTunel } = require('./faixas-de-rede');

/**
 * PERFIL DE VPN de uma instalação, guardado e servido pela Central.
 *
 * O problema que resolve: hoje a VPN do D-GUARDIAN vive INTEIRA na máquina, em
 * arquivos editados à mão. Reinstalar a VM apagaria correções que custaram
 * horas de cliente fora do ar, e não existe forma de ver pelo painel se o túnel
 * de um cliente está de pé.
 *
 * O túnel serve para a instalação alcançar as CÂMERAS do cliente quando o
 * servidor não está dentro da rede dele. Não tem relação com o contato entre
 * instalação e Central — esse é HTTPS comum e sempre foi.
 *
 * TRÊS INVARIANTES, cada uma paga com incidente real:
 *
 *   · NUNCA rota padrão. O túnel carrega SÓ as faixas declaradas. Um perfil que
 *     pedisse 0.0.0.0/0 jogaria todo o tráfego do servidor para dentro da rede
 *     do cliente: o painel para de responder no endereço público, o cliente
 *     perde acesso ao próprio sistema e nós perdemos junto.
 *   · A prova de vida é CÂMERA, nunca o túnel. Em 13/08/2026 o D-GUARDIAN
 *     ficou 8 HORAS sem gravar com tudo "verde", porque o vigia perguntava para
 *     a ponta do próprio túnel — que responde sempre.
 *   · Segredo não volta nunca. Senha e chave saem cifradas para a instalação e
 *     JAMAIS na leitura do painel; quem lê o perfil vê apenas se há segredo
 *     guardado.
 */

const TIPOS = ['l2tp-ipsec', 'wireguard', 'openvpn'];

/** Rotas que, se aceitas, sequestrariam a internet do próprio servidor. */
const FAIXAS_PROIBIDAS = ['0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1'];

function texto(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

/**
 * Valida o que veio do painel.
 *
 * `outros` são os perfis de OUTRAS instalações no mesmo servidor — usados só
 * quando um servidor atende mais de um cliente, para barrar faixa repetida
 * (ver faixas-de-rede.js: é o que faria o servidor mostrar a câmera do cliente
 * errado, sem erro e sem aviso).
 */
function validarPerfilDeVpn(entrada, outros = []) {
  const tipo = texto(entrada.tipo).toLowerCase();
  if (!tipo) return { ok: false, motivo: 'tipo-ausente' };
  if (!TIPOS.includes(tipo)) return { ok: false, motivo: 'tipo-desconhecido', detalhe: TIPOS.join(', ') };

  const servidor = texto(entrada.servidor, 120);
  if (!servidor) return { ok: false, motivo: 'servidor-ausente' };

  const faixasCruas = texto(entrada.faixas, 400);
  for (const proibida of FAIXAS_PROIBIDAS) {
    if (faixasCruas.split(',').map((f) => f.trim()).includes(proibida)) {
      return { ok: false, motivo: 'faixa-sequestra-a-internet', detalhe: proibida };
    }
  }

  const faixas = validarFaixasDoTunel({
    nome: texto(entrada.nome) || 'tunel',
    faixas: faixasCruas,
    outros,
  });
  if (!faixas.ok) return { ok: false, motivo: faixas.motivo, detalhe: faixas.detalhe };

  // A prova de vida: pelo menos um endereço de câmera DENTRO das faixas.
  const provas = texto(entrada.cameras, 300).split(',').map((c) => c.trim()).filter(Boolean);
  if (!provas.length) return { ok: false, motivo: 'prova-de-vida-ausente' };

  return {
    ok: true,
    perfil: {
      tipo,
      nome: texto(entrada.nome) || 'tunel',
      servidor,
      usuario: texto(entrada.usuario, 120),
      faixas: faixas.faixas,
      cameras: provas,
      // Chaves de segredo ficam de fora: quem grava decide como cifrar.
    },
  };
}

/**
 * O que a instalação recebe no heartbeat.
 *
 * Os segredos vão cifrados; o painel nunca os relê. `null` quando não há VPN
 * configurada — instalação sem túnel não deve receber configuração vazia e
 * concluir que precisa desmontar algo.
 */
function perfilParaHeartbeat(guardado) {
  if (!guardado || !guardado.tipo) return null;
  return {
    tipo: guardado.tipo,
    nome: guardado.nome || 'tunel',
    servidor: guardado.servidor,
    usuario: guardado.usuario || '',
    faixas: Array.isArray(guardado.faixas) ? guardado.faixas : [],
    cameras: Array.isArray(guardado.cameras) ? guardado.cameras : [],
    segredoCifrado: guardado.segredoCifrado || null,
    senhaCifrada: guardado.senhaCifrada || null,
    revisao: Number(guardado.revisao) || 1,
  };
}

/** O que o PAINEL mostra. Nunca inclui segredo, nem cifrado. */
function perfilParaPainel(guardado) {
  if (!guardado || !guardado.tipo) return null;
  return {
    tipo: guardado.tipo,
    nome: guardado.nome || 'tunel',
    servidor: guardado.servidor,
    usuario: guardado.usuario || '',
    faixas: Array.isArray(guardado.faixas) ? guardado.faixas : [],
    cameras: Array.isArray(guardado.cameras) ? guardado.cameras : [],
    temSenha: Boolean(guardado.senhaCifrada),
    temSegredo: Boolean(guardado.segredoCifrado),
    revisao: Number(guardado.revisao) || 1,
  };
}

module.exports = { TIPOS, FAIXAS_PROIBIDAS, validarPerfilDeVpn, perfilParaHeartbeat, perfilParaPainel };
