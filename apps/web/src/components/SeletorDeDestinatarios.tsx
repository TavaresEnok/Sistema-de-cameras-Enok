import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FolderKey, Search, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * PARA QUEM VAI — o seletor de destinatários de um mosaico ou de uma ronda.
 *
 * Duas listas e setas no meio, como o operador já viu em outros sistemas: à
 * esquerda quem existe, à direita quem vai receber.
 *
 * Pessoa e GRUPO na mesma caixa de seleção de propósito. Entregar ao grupo
 * "Portaria" é o caminho certo — quando entrar um porteiro novo, ele recebe
 * junto, sem ninguém lembrar de voltar aqui. Entregar pessoa a pessoa envelhece
 * no primeiro mês de rotatividade.
 */

export type PessoaSimples = { id: string; name: string; email?: string };
export type GrupoSimples = { id: string; name: string };
export type Destinatarios = { usuarios: string[]; grupos: string[] };

type Props = {
  usuarios: PessoaSimples[];
  grupos: GrupoSimples[];
  valor: Destinatarios;
  onChange: (valor: Destinatarios) => void;
  /** Identificador único na página — dois seletores na mesma tela sem isto
   *  fariam dois `<label htmlFor>` apontarem para o mesmo campo. */
  id: string;
};

export function SeletorDeDestinatarios({ usuarios, grupos, valor, onChange, id }: Props) {
  const [aba, setAba] = useState<'usuarios' | 'grupos'>('usuarios');
  const [buscaEsquerda, setBuscaEsquerda] = useState('');
  const [marcados, setMarcados] = useState<string[]>([]);

  const disponiveis = useMemo(() => {
    const termo = buscaEsquerda.trim().toLowerCase();
    const fonte =
      aba === 'usuarios'
        ? usuarios.filter((u) => !valor.usuarios.includes(u.id))
        : grupos.filter((g) => !valor.grupos.includes(g.id));
    if (!termo) return fonte;
    return fonte.filter((item) => {
      const email = (item as PessoaSimples).email ?? '';
      return `${item.name} ${email}`.toLowerCase().includes(termo);
    });
  }, [aba, buscaEsquerda, grupos, usuarios, valor]);

  const selecionados = useMemo(
    () => [
      ...valor.usuarios
        .map((uid) => usuarios.find((u) => u.id === uid))
        .filter((u): u is PessoaSimples => Boolean(u))
        .map((u) => ({ tipo: 'usuario' as const, id: u.id, nome: u.name, detalhe: u.email ?? '' })),
      ...valor.grupos
        .map((gid) => grupos.find((g) => g.id === gid))
        .filter((g): g is GrupoSimples => Boolean(g))
        .map((g) => ({ tipo: 'grupo' as const, id: g.id, nome: g.name, detalhe: 'Todos do grupo' })),
    ],
    [grupos, usuarios, valor],
  );

  const adicionar = () => {
    if (!marcados.length) return;
    onChange(
      aba === 'usuarios'
        ? { ...valor, usuarios: [...new Set([...valor.usuarios, ...marcados])] }
        : { ...valor, grupos: [...new Set([...valor.grupos, ...marcados])] },
    );
    setMarcados([]);
  };

  const remover = (tipo: 'usuario' | 'grupo', alvo: string) => {
    onChange(
      tipo === 'usuario'
        ? { ...valor, usuarios: valor.usuarios.filter((x) => x !== alvo) }
        : { ...valor, grupos: valor.grupos.filter((x) => x !== alvo) },
    );
  };

  const alternarMarca = (alvo: string) =>
    setMarcados((atual) => (atual.includes(alvo) ? atual.filter((x) => x !== alvo) : [...atual, alvo]));

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
      {/* ── Disponíveis ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col rounded-md border border-border">
        <div className="flex gap-1 border-b border-border p-1">
          {(['usuarios', 'grupos'] as const).map((qual) => (
            <button
              key={qual}
              type="button"
              onClick={() => { setAba(qual); setMarcados([]); }}
              className={cn(
                'flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors',
                aba === qual ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted',
              )}
              aria-pressed={aba === qual}
            >
              {qual === 'usuarios' ? 'Usuários' : 'Grupos'}
            </button>
          ))}
        </div>

        <div className="p-2">
          <label htmlFor={`${id}-busca`} className="sr-only">
            Procurar {aba === 'usuarios' ? 'usuário' : 'grupo'}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`${id}-busca`}
              value={buscaEsquerda}
              onChange={(e) => setBuscaEsquerda(e.target.value)}
              placeholder="Procurar"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        <ul className="max-h-56 min-h-[9rem] overflow-y-auto px-2 pb-2">
          {disponiveis.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              {buscaEsquerda.trim()
                ? 'Nada com esse nome.'
                : aba === 'usuarios'
                  ? 'Todos os usuários já receberam.'
                  : 'Todos os grupos já receberam.'}
            </li>
          )}
          {disponiveis.map((item) => {
            const marcado = marcados.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => alternarMarca(item.id)}
                  aria-pressed={marcado}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                    marcado ? 'bg-primary/15 text-primary' : 'hover:bg-muted',
                  )}
                >
                  {aba === 'usuarios' ? (
                    <User className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  ) : (
                    <FolderKey className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {item.name}
                    {(item as PessoaSimples).email && (
                      <span className="ml-1 opacity-60">{(item as PessoaSimples).email}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── Setas ───────────────────────────────────────────────────────── */}
      <div className="flex flex-row items-center justify-center gap-2 md:flex-col">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={adicionar}
          disabled={!marcados.length}
          aria-label="Adicionar aos destinatários"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={() => onChange({ usuarios: [], grupos: [] })}
          disabled={!selecionados.length}
          aria-label="Remover todos os destinatários"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Selecionados ────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium">Vai receber</span>
          <Badge variant="secondary" className="text-[10px]">
            {selecionados.length}
          </Badge>
        </div>
        <ul className="max-h-[17rem] min-h-[9rem] overflow-y-auto p-2">
          {selecionados.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              Ninguém ainda. Sem destinatário, o mosaico fica só com você.
            </li>
          )}
          {selecionados.map((s) => (
            <li
              key={`${s.tipo}-${s.id}`}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
            >
              {s.tipo === 'usuario' ? (
                <User className="h-3.5 w-3.5 shrink-0 opacity-70" />
              ) : (
                <FolderKey className="h-3.5 w-3.5 shrink-0 opacity-70" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {s.nome}
                <span className="ml-1 opacity-60">{s.detalhe}</span>
              </span>
              <button
                type="button"
                onClick={() => remover(s.tipo, s.id)}
                aria-label={`Tirar ${s.nome} dos destinatários`}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
