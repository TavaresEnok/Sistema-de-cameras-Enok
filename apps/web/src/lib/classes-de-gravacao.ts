/**
 * O QUE INICIA UMA GRAVAÇÃO no modo "Pessoa ou veículo".
 *
 * Gêmea de `CLASSES_QUE_GRAVAM` em
 * apps/api/src/cameras/helpers/gatilho-de-gravacao.helper.ts. Mantenha as duas
 * iguais: uma classe que a tela oferece e o backend recusa vira uma câmera que
 * o operador configurou e que nunca grava — falha silenciosa, a pior num
 * sistema de segurança. O DTO valida contra a lista do backend, então uma
 * divergência aparece como erro ao salvar, não como gravação perdida.
 *
 * Só pessoa e veículos. O modelo reconhece dezenas de classes (pássaro, cadeira,
 * vaso de planta), mas nenhuma delas é motivo para gravar num VMS.
 */
export const CLASSES_DE_GRAVACAO = [
  { valor: 'person', rotulo: 'Pessoa' },
  { valor: 'car', rotulo: 'Carro' },
  { valor: 'motorcycle', rotulo: 'Moto' },
  { valor: 'bus', rotulo: 'Ônibus' },
  { valor: 'truck', rotulo: 'Caminhão' },
  { valor: 'bicycle', rotulo: 'Bicicleta' },
] as const;

/**
 * A frase que explica o estado atual da escolha.
 *
 * Nada marcado significa PESSOA E VEÍCULOS, jamais "não gravar nada" — é o que
 * o backend faz e é o que a tela precisa dizer. Se o operador ler o campo vazio
 * como "desligado", ele vai marcar tudo achando que está ligando algo, e depois
 * não vai entender por que carro voltou a gravar.
 */
export function resumoDeClasses(classes: readonly string[]): string {
  if (classes.length === 0) return 'Nada marcado = pessoa e veículos (padrão).';
  return classes.length === 1
    ? 'Só esta classe inicia a gravação.'
    : 'Só estas classes iniciam a gravação.';
}

/** Alterna uma classe, devolvendo uma lista nova (nunca muta a original). */
export function alternarClasse(classes: readonly string[], valor: string): string[] {
  return classes.includes(valor) ? classes.filter((c) => c !== valor) : [...classes, valor];
}
