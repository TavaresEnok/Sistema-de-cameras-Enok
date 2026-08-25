'use strict';

const crypto = require('crypto');

/**
 * CIFRAR SEGREDO DE CONFIGURAÇÃO guardado pela Central.
 *
 * Senha de VPN e chave pré-compartilhada não podem ficar em texto no arquivo de
 * dados: quem tiver acesso de leitura ao arquivo entra na rede do cliente. E
 * não podem VOLTAR na leitura do painel — o operador precisa saber que existe
 * um segredo guardado, nunca qual é.
 *
 * AES-256-GCM, mesmo esquema já usado no arquivo de reativação. GCM e não CBC
 * porque ele detecta adulteração: segredo alterado no disco falha ao abrir em
 * vez de devolver lixo que viraria configuração inválida na máquina do cliente.
 *
 * A chave vem de `DRAC_CENTRAL_SECRET_KEY`. SEM ela a cifra recusa trabalhar,
 * em vez de guardar em texto — falhar fechado é o que impede uma instalação
 * sem a variável configurada gravar senha de cliente em claro sem ninguém ver.
 */

const FORMATO = 'v1';

function chaveDe(segredoBruto) {
  const s = String(segredoBruto || '').trim();
  if (s.length < 16) {
    throw new Error('DRAC_CENTRAL_SECRET_KEY ausente ou curta demais (mínimo 16 caracteres).');
  }
  return crypto.createHash('sha256').update(s, 'utf8').digest();
}

function cifrar(texto, segredoBruto) {
  const valor = String(texto ?? '');
  if (!valor) return null;
  const chave = chaveDe(segredoBruto);
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cifra.update(valor, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return [FORMATO, iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join('.');
}

function decifrar(envelope, segredoBruto) {
  const partes = String(envelope || '').split('.');
  if (partes.length !== 4 || partes[0] !== FORMATO) {
    throw new Error('Segredo cifrado em formato desconhecido.');
  }
  const chave = chaveDe(segredoBruto);
  const decifra = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(partes[1], 'base64'));
  decifra.setAuthTag(Buffer.from(partes[2], 'base64'));
  return Buffer.concat([decifra.update(Buffer.from(partes[3], 'base64')), decifra.final()]).toString('utf8');
}

/** Existe segredo guardado? É a única coisa que o painel pode saber. */
function temSegredo(envelope) {
  return typeof envelope === 'string' && envelope.split('.').length === 4;
}

module.exports = { cifrar, decifrar, temSegredo, FORMATO };
