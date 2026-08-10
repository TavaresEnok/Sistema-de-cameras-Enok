// ── SEGMENTOS .ts ÓRFÃOS ─────────────────────────────────────────────────────
//
// A gravação escreve segmentos `.ts` e os remuxa para `.mp4` (o `.mp4` é o que
// entra no banco). Depois do mux, o `.ts` é lixo. Quando o mux falha, ou o
// `.mp4` é rotacionado e o `.ts` fica para trás, sobra um `.ts` que:
//
//   · NÃO está no banco (nenhuma linha Recording aponta para ele);
//   · NÃO é varrido pela retenção — `listRecordingFilesOnDisk` só olha `.mp4`;
//   · NÃO é rotacionado — a rotação por câmera trabalha pelas linhas do banco.
//
// Resultado medido na matriz (10/08/2026): 8,1 GB de `.ts` de 2–3 dias atrás
// acumulados numa única câmera, invisíveis para todo o mecanismo de limpeza. A
// rotação por câmera funcionava, mas nunca via esses arquivos.
//
// A regra é simples e SEGURA por causa da natureza transitória do `.ts`: um
// segmento é remuxado em minutos. Qualquer `.ts` com muitas horas de vida já
// cumpriu (ou perdeu) seu papel e não é a gravação ativa. Usamos a idade do
// arquivo — não é preciso cruzar com o banco, e assim nunca se toca no segmento
// que está sendo escrito agora.

/** Idade padrão a partir da qual um `.ts` é considerado órfão obsoleto. */
export const IDADE_SEGMENTO_ORFAO_MS_PADRAO = 6 * 60 * 60 * 1000; // 6 horas

/**
 * Um arquivo `.ts` é órfão obsoleto (seguro de apagar)?
 *
 * @param nome       nome do arquivo (ex.: `2026-08-07_22-09-00.ts`)
 * @param mtimeMs    modificação do arquivo, em ms desde a época
 * @param agoraMs    agora, em ms
 * @param maxIdadeMs idade a partir da qual vira órfão (default 6h)
 */
export function segmentoOrfaoObsoleto(
  nome: string,
  mtimeMs: number,
  agoraMs: number,
  maxIdadeMs: number = IDADE_SEGMENTO_ORFAO_MS_PADRAO,
): boolean {
  if (!nome.toLowerCase().endsWith('.ts')) return false;
  // Datas inválidas nunca disparam remoção: sem prova de idade, não se apaga.
  if (!Number.isFinite(mtimeMs) || !Number.isFinite(agoraMs)) return false;
  const idade = agoraMs - mtimeMs;
  // Arquivo "do futuro" (relógio torto) também não é apagado — idade negativa
  // não prova nada.
  if (idade < 0) return false;
  return idade >= maxIdadeMs;
}
