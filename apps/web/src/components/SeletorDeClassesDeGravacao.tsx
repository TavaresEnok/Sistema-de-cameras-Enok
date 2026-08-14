import { CLASSES_DE_GRAVACAO, alternarClasse, resumoDeClasses } from '../lib/classes-de-gravacao';

/**
 * ESCOLHER O QUE INICIA A GRAVAÇÃO — "só pessoa, não carro".
 *
 * Existe como componente porque o modo de gravação é editado em TRÊS lugares
 * (detalhe da câmera, edição rápida da lista e assistente de nova câmera). A
 * primeira versão vivia só no detalhe, e o resultado foi previsível: quem
 * editava pela lista não via a opção e concluía que ela não existia. Uma opção
 * que aparece em uma tela de três não é uma opção do sistema.
 *
 * Só renderiza no modo `object`: nos outros modos seria uma pergunta sem efeito.
 */
export function SeletorDeClassesDeGravacao({
  classes,
  onChange,
  className,
  classesLiberadas,
}: {
  classes: string[];
  onChange: (classes: string[]) => void;
  className?: string;
  /** O que a CENTRAL liberou. Ausente = não informado, oferece o catálogo
   *  completo (comportamento histórico). Informado, oferece SÓ o liberado:
   *  marcar "Carro" numa instalação de pessoa seria escolher um evento que a
   *  IA nunca emite, e a câmera ficaria muda esperando (14/08/2026). */
  classesLiberadas?: string[];
}) {
  const catalogo = Array.isArray(classesLiberadas) && classesLiberadas.length
    ? CLASSES_DE_GRAVACAO.filter((c) => classesLiberadas.includes(c.valor))
    : CLASSES_DE_GRAVACAO;
  return (
    <div className={`rounded-lg border border-border bg-muted/30 px-3 py-2.5 ${className ?? ''}`}>
      <div className="text-[11px] font-medium text-foreground">O que inicia a gravação</div>
      <div className="mt-0.5 text-[10.5px] text-muted-foreground">{resumoDeClasses(classes)}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {catalogo.map(({ valor, rotulo }) => {
          const marcada = classes.includes(valor);
          return (
            <button
              key={valor}
              type="button"
              aria-pressed={marcada}
              onClick={() => onChange(alternarClasse(classes, valor))}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                marcada
                  ? 'border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--primary)_/_0.15)] text-[hsl(var(--primary))]'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {rotulo}
            </button>
          );
        })}
      </div>
    </div>
  );
}
