# Fluxo de versão: matriz → Central → frota

## O problema

Até 10/08/2026, a versão que uma instalação recebia era a variável de ambiente
`DRAC_CENTRAL_INSTALLER_COMMIT`, cozida no container da Central. Isso significa:

- atualizar a frota exigia editar `.env` e **recriar** o container (reiniciar não
  basta, o env é cozido) — ou seja, linha de comando e memória de quem faz;
- **nada ligava essa versão a ter sido testada.** Era uma afirmação;
- nenhuma instalação sabia que estava atrasada, e a Central não sabia dizer quem
  estava em qual versão.

## Os quatro papéis

| Quem | Papel |
|------|-------|
| **Git** | A verdade sobre o que existe. Versão é sempre um commit de 40 caracteres — nunca um branch, que se move, nem um commit curto, que fica ambíguo. |
| **Matriz** | A instalação principal. É onde se constrói, se testa e se aprova. Roda com dados reais. |
| **Central** | Guarda qual versão está **aprovada** e enxerga em que versão cada instalação está. |
| **Instalações** | Perguntam à Central qual é a versão aprovada e se atualizam. Nunca recebem conexão de fora. |

## Promover (na matriz)

```bash
bash scripts/promover-release.sh --notas "o que mudou"
```

Ele recusa e explica se a árvore tiver alteração não commitada ou se o commit
não estiver publicado — instalação nenhuma consegue buscar o que não foi
enviado ao GitHub. Depois roda **dois testes diferentes**:

1. **Instalação limpa numa máquina virgem** → prova que *instala* do zero;
2. **Bateria contra a própria matriz** → prova que *roda* com dados reais.

Nenhum substitui o outro: uma instalação pode subir perfeita e a aplicação não
funcionar, e o contrário também. Só com os dois verdes ele promove na Central.

A Central **recusa** promoção sem essa evidência. Não há como pular por pressa —
foi exatamente a ausência disso que fez a primeira instalação de cliente virar
uma sequência de consertos na frente do cliente.

Para testar sem promover: `--so-testar`.

## Atualizar (no cliente)

```bash
bash scripts/atualizar-instalacao.sh --conferir   # só diz em que versão está
bash scripts/atualizar-instalacao.sh              # aplica
```

A conexão é sempre **da instalação para a Central** — nada de porta aberta no
cliente, que na maioria dos casos está atrás de NAT.

A sequência tem rede de segurança:

1. backup do banco **antes** de qualquer mudança (se o backup falhar, aborta —
   atualizar sem rede de segurança não vale o risco);
2. checkout do commit aprovado, rebuild, migrações;
3. **bateria de verificação**;
4. se a bateria reprovar, **volta sozinho** para a versão anterior e confere que
   ela está sadia.

> **Voltar não é máquina do tempo.** O código volta; as migrações de banco já
> aplicadas **não** são desfeitas — o Prisma não desfaz migração. Na prática as
> migrações são aditivas e o código antigo convive com elas, mas se algo
> depender disso, o backup do passo 1 é o caminho. Use `--sem-volta` para
> manter a versão nova no ar mesmo reprovada e decidir à mão.

## Limite conhecido: a evidência é declarada, não verificada

A Central confere que a evidência **existe e está completa**, não que ela é
verdadeira. Quem tem o token administrativo consegue afirmar "o gate passou" com
um `curl` e promover sem ter testado nada.

Isso é uma escolha consciente por ora — a disciplina mora no
`promover-release.sh`, que é o caminho normal e roda os testes de verdade —, mas
**não confunda com garantia**. Enquanto for assim, promover à mão é burlar o
processo, não usá-lo.

O fechamento correto seria a evidência vir assinada por quem realmente rodou o
gate (o CI), com a Central verificando a assinatura. Está anotado como próximo
passo; até lá, o combinado é: **promove-se pelo script**.

## Rollback de emergência

A Central aceita voltar para um commit **que já esteve aprovado** sem exigir
gate de novo (ele já passou um dia), marcando a entrada como `rollback`.
Novidade continua exigindo gate mesmo nesse modo — senão "rollback" viraria a
porta dos fundos para publicar sem testar.

## O que a Central mostra

`GET /api/admin/releases` devolve a versão atual, o histórico e o resumo da
frota: quantas instalações estão atualizadas, quantas atrasadas e quantas
**desconhecidas**.

`desconhecida` é diferente de `atrasada` de propósito: uma instalação que nunca
reportou versão (ou está fora do ar) não pode ser contada como atualizada nem
empurrada às cegas — o operador precisa ver que não se sabe.
