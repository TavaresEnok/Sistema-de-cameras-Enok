/**
 * VALIDAR E SERIALIZAR o valor de uma configuração.
 *
 * Extraído do serviço em 24/08/2026, quando o Salvar das Configurações passou a
 * devolver 400 na instalação Córtex. A tela envia o objeto INTEIRO de
 * configurações; uma única chave recusada derruba o salvamento todo, e o
 * operador vê apenas "Falha ao salvar", sem saber qual campo.
 *
 * O defeito era `hiddenNavPaths` (quais itens do menu ficam escondidos), cujo
 * padrão É string vazia — "não esconder nada". A validação recusava vazio, então
 * o Salvar ficava quebrado em TODA instalação que não esconde item de menu,
 * inclusive a principal.
 *
 * A regra correta se deduz do próprio contrato do campo: **se o padrão é vazio,
 * vazio é um valor válido dele**. Campo com padrão preenchido continua exigindo
 * conteúdo — é o que impede apagar sem querer o nome da instalação.
 *
 * Puro de propósito: a política inteira é testável sem banco e sem HTTP.
 */

export type EspecificacaoDeConfiguracao = {
  type: 'number' | 'boolean' | 'color' | 'image' | 'string';
  default?: unknown;
  min?: number;
  max?: number;
};

export class ValorDeConfiguracaoInvalido extends Error {}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** ~400 KB em base64. Mantém o mesmo teto que o serviço já aplicava. */
export const MAX_CARACTERES_DE_IMAGEM = 550_000;

export function serializarValor(
  chave: string,
  valor: unknown,
  spec: EspecificacaoDeConfiguracao,
): string {
  if (spec.type === 'number') {
    const n = Number(valor);
    if (!Number.isFinite(n)) throw new ValorDeConfiguracaoInvalido(`Valor inválido para ${chave}.`);
    const limitado = Math.min(spec.max ?? n, Math.max(spec.min ?? n, Math.round(n)));
    return String(limitado);
  }

  if (spec.type === 'boolean') {
    return valor === true || valor === 'true' || valor === 1 || valor === '1' ? 'true' : 'false';
  }

  if (spec.type === 'color') {
    const s = String(valor ?? '').trim();
    // Vazio significa "voltar ao padrão do tema" — sempre válido.
    if (s && !HEX.test(s)) throw new ValorDeConfiguracaoInvalido(`Cor inválida para ${chave} (use #RRGGBB).`);
    return s.toLowerCase();
  }

  if (spec.type === 'image') {
    const s = String(valor ?? '').trim();
    // Vazio remove o logo personalizado — sempre válido.
    if (s) {
      if (!s.startsWith('data:image/')) throw new ValorDeConfiguracaoInvalido(`Imagem inválida para ${chave}.`);
      if (s.length > MAX_CARACTERES_DE_IMAGEM) {
        throw new ValorDeConfiguracaoInvalido(`Imagem muito grande para ${chave} (máx. ~400 KB).`);
      }
    }
    return s;
  }

  const s = String(valor ?? '').trim().slice(0, 200);
  const padraoVazio = String(spec.default ?? '') === '';
  if (!s && !padraoVazio) throw new ValorDeConfiguracaoInvalido(`Valor inválido para ${chave}.`);
  return s;
}
