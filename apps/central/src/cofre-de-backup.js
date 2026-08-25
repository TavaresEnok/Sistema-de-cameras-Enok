'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * COFRE DE BACKUP: as cópias das instalações, guardadas FORA delas.
 *
 * O buraco que isto fecha (25/08/2026): as instalações fazem backup diário do
 * banco, e guardam em `/opt/drac/infra/backups` — o MESMO disco dos dados. Isso
 * protege contra apagar uma tabela por engano e NÃO protege contra o disco
 * falhar, que é justamente o que acontece em servidor rodando 24 horas. Nenhuma
 * das instalações mandava cópia para lugar nenhum.
 *
 * O que o backup contém: câmeras, usuários, permissões, eventos, configuração e
 * os REGISTROS das gravações. Não contém o vídeo — vídeo é volumoso e tem outro
 * caminho (nuvem, por política de retenção). Com este backup você reconstrói o
 * SISTEMA numa máquina nova; as imagens antigas dependem da política de nuvem.
 *
 * DUAS DECISÕES QUE PARECEM DETALHE:
 *
 *   · RETENÇÃO POR CONTAGEM, não por idade. "Apagar o que tem mais de 30 dias"
 *     apaga TUDO de uma instalação que ficou um mês sem se comunicar — que é
 *     exatamente quando o backup mais importa.
 *   · O ARQUIVO NUNCA É SOBRESCRITO. Cada envio é um arquivo novo com a data no
 *     nome. Sobrescrever significa que um backup corrompido apaga o bom.
 */

const MAX_BYTES = 64 * 1024 * 1024; // 64 MiB: o dump real tem 1–3 MB.

function pastaDa(raiz, installationId) {
  // Ponto FORA da lista permitida de propósito: identificador de instalação é
  // um slug (letras, números, hífen) e não precisa de ponto. Permitindo ponto,
  // "../../etc" virava ".._.._etc" — não escapa da pasta, mas é frouxo demais
  // para um caminho montado a partir de entrada de rede.
  const seguro = String(installationId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  if (!seguro || /^_+$/.test(seguro)) throw new Error('identificador de instalação inválido');
  return path.join(path.resolve(raiz), seguro);
}

/** Guarda um backup. Devolve o registro do que ficou salvo. */
async function guardar(raiz, installationId, conteudo, { agora = new Date(), manter = 7 } = {}) {
  if (!Buffer.isBuffer(conteudo) || !conteudo.length) {
    throw new Error('backup vazio');
  }
  if (conteudo.length > MAX_BYTES) {
    throw new Error(`backup excede ${Math.round(MAX_BYTES / 1024 / 1024)} MiB`);
  }
  const dir = pastaDa(raiz, installationId);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

  const carimbo = agora.toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const nome = `${carimbo}.dump`;
  const destino = path.join(dir, nome);
  await fs.promises.writeFile(destino, conteudo, { mode: 0o600 });

  const registro = {
    nome,
    bytes: conteudo.length,
    sha256: crypto.createHash('sha256').update(conteudo).digest('hex'),
    recebidoEm: agora.toISOString(),
  };
  await podar(raiz, installationId, manter);
  return registro;
}

/** Lista do mais novo para o mais velho. */
async function listar(raiz, installationId) {
  const dir = pastaDa(raiz, installationId);
  let nomes = [];
  try {
    nomes = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const itens = [];
  for (const nome of nomes) {
    if (!nome.endsWith('.dump')) continue;
    try {
      const info = await fs.promises.stat(path.join(dir, nome));
      itens.push({ nome, bytes: info.size, recebidoEm: info.mtime.toISOString() });
    } catch {
      // Arquivo sumiu entre o readdir e o stat: ignora, não derruba a lista.
    }
  }
  return itens.sort((a, b) => (a.nome < b.nome ? 1 : -1));
}

/**
 * Mantém apenas os N mais recentes.
 *
 * Por CONTAGEM e não por idade: instalação que ficou um mês sem se comunicar
 * perderia todos os backups justamente quando eles mais importam.
 */
async function podar(raiz, installationId, manter = 7) {
  const quantos = Math.max(1, Number(manter) || 1);
  const itens = await listar(raiz, installationId);
  const sobrando = itens.slice(quantos);
  const dir = pastaDa(raiz, installationId);
  for (const item of sobrando) {
    await fs.promises.unlink(path.join(dir, item.nome)).catch(() => undefined);
  }
  return sobrando.map((i) => i.nome);
}

/** Caminho de um backup para leitura. Recusa nome que tente sair da pasta. */
function caminhoDe(raiz, installationId, nome) {
  const limpo = path.basename(String(nome || ''));
  if (!limpo.endsWith('.dump')) throw new Error('nome de backup inválido');
  return path.join(pastaDa(raiz, installationId), limpo);
}

module.exports = { guardar, listar, podar, caminhoDe, MAX_BYTES };
