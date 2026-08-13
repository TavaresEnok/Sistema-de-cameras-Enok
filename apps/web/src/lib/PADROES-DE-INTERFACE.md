# Padrões de interface — DRAC VMS

Regras extraídas da auditoria de front-end (07/08/2026). Não são preferências
de estilo: cada uma corrigiu um defeito que chegou a produção. Aplicar em toda
tela que for tocada — a convergência é incremental, não um mutirão.

## 1. Botões

Três sistemas conviviam (classes `.btn`, kit `<Button>` e `<button>` cru com
Tailwind inline), gerando cinco alturas para o mesmo controle e estados de
foco/desabilitado divergentes na mesma barra.

- **Barras de operação e toolbars:** `.btn` + `.btn-primary` / `.btn-secondary`
  / `.btn-ghost`, com `.btn-sm` quando couber.
- **Dentro de diálogos e painéis laterais:** `<Button>` do kit.
- **Nunca:** `<button>` com classes de aparência inline.

## 2. Casco de página

O `AppLayout` renderiza o filho dentro de `overflow-hidden`. **A página fornece
a própria rolagem.** Quatro telas não faziam isso e deixavam o botão "Salvar"
fora do alcance em notebook de 768px.

```
<div className="h-full overflow-y-auto"> … </div>
```

Em painel lateral (`Sheet`) com rodapé de ação: `flex flex-col p-0`, corpo
`min-h-0 flex-1 overflow-y-auto`, rodapé `shrink-0`.

## 3. Erro nunca é vazio

`catch { setItems([]) }` faz a tela afirmar "não há nada" quando na verdade não
conseguiu perguntar. Num VMS isso é caro: o operador lê "Nenhum alarme" às 2h
da manhã e conclui que a noite está tranquila.

- Guarde um estado de erro separado do estado vazio.
- O texto diz que é falha de comunicação **e** que o dado não foi perdido.
- Sempre com "Tentar novamente".
- Em atualização periódica: carimbo "atualizado às HH:mm:ss" e faixa quando o
  ciclo de fundo falha — lista estagnada em silêncio é indistinguível de calma.

## 4. Atrito proporcional ao risco

- Ação destrutiva **nomeia o alvo** e **quantifica** ("12.443 gravações, 4,2 TB").
- Alcance real explícito quando difere do que a tela mostra (filtro aplicado
  não limita o `DELETE`).
- Confirmação por **digitação** quando não há volta.
- Botão de confirmar em `--destructive`; o seguro é o primário.
- Nunca `window.confirm` / `alert` / `prompt` — fora do tema, sem foco preso.

## 5. Nada de conteúdo simulado

Tela oferecida ao operador **não simula**: nem quadro que pareça vídeo, nem
régua que pareça cobertura, nem relógio que pareça contar, nem barra de
progresso fixa. Isso leva alguém a concluir que reviu uma cena que nunca foi
exibida. Sem o dado real, mostre o caminho para ele (link para a Reprodução no
instante certo) ou diga que não há.

Protegido por `tests/presentation-surface.test.mts`.

## 6. Hora

- Exibição **sempre local** (`format()` do date-fns ou `toLocaleString('pt-BR')`).
- `toISOString()` só para parâmetro de API ou campo `type="date"` — é UTC e
  aparece 3h adiantado no Brasil.
- Relógio na tela precisa de `setInterval`: avaliado no render, ele congela na
  hora em que a página abriu.

Protegido por `tests/acessibilidade-estrutural.test.mts`.

## 7. Formatação

Use `lib/formato.ts`: `formatarBytes`, `formatarDataHora`, `formatarData`,
`formatarNumero`. Havia dois formatadores de bytes divergentes (um forçava GB
sempre — 30 MB virava "0.03 GB") e duas convenções de data, nenhuma com locale
pt-BR declarado.

## 8. Acessibilidade mínima

- Todo botão só-ícone tem `aria-label` (não basta `title`).
- Todo campo tem `<label>` com `htmlFor`/`id`, ou o controle aninhado no label.
- Alvo de clique ≥ 24px.
- Texto com informação: mínimo 11px; contraste ≥ 4,5:1 (vale para os **dois**
  temas — vários defeitos passavam no escuro e reprovavam no claro).
- Lista clicável precisa de `role`/`tabIndex`/`onKeyDown`, ou de um link real.
- Token de cor inexistente computa para `transparent` e some da tela: use só os
  definidos em `index.css` (protegido por teste).

## 9. Vocabulário

alarme (não alerta) · aberto/reconhecido/resolvido · quadro (não slot) ·
grupo (não andar) · gravações (não vídeos) · função (não perfil).

## 10. Vocabulário da IA

A auditoria da camada de IA (13/08/2026) encontrou **sete nomes para quatro
conceitos**: Inteligência, Perímetro, Zonas, Detecção de objeto, Pessoa ou
veículo, Monitorar, Ignorar. O usuário não tinha como saber que "Perímetro",
"Zonas" e "Monitorar/Ignorar" eram a mesma família.

Passam a existir **três termos**, e só três:

| termo | significa | substitui |
| --- | --- | --- |
| **Detecções** | o que a IA achou (a fila com foto, rótulo e hora) | "Revisão" |
| **Onde olhar** | linha e áreas desenhadas sobre a cena | "Perímetro", "Zonas", "Monitorar/Ignorar" |
| **O que procurar** | classes de objeto (pessoa, carro, moto…) | "Escopo de objeto", "Detecção de objeto" |

Dentro de **Onde olhar**, os três desenhos mantêm nome próprio porque fazem
coisas diferentes: **linha** (limite que não se atravessa), **área monitorada**
(só aqui conta) e **área ignorada** (aqui nunca conta).

## 11. Estado da IA nunca é nome de campo

Chave de sistema (`camera_ai_disabled`, `filtered_by_ai_env`) e nome de variável
de ambiente **não** aparecem na interface. A tradução vive em
`lib/estado-da-ia.ts`, é pura e tem teste próprio — a decisão de estado erra em
silêncio, e uma câmera parada anunciada como saudável é pior que nenhuma
informação.

Três regras para essas frases:

1. dizer o que **está** acontecendo, não o nome do campo;
2. quando houver o que fazer, dizer o que fazer **e onde**;
3. quando **não** houver (trava do servidor, por exemplo), dizer isso — nunca
   sugerir um botão que não existe.

Motivo desconhecido nunca vira card em branco: mostrar o motivo cru é melhor do
que fingir que sabe.
