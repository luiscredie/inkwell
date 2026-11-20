# Coach — mão inicial e mulligan (conversor 2)

Rascunho para revisão do Conselho (20/11/2026). Este PR só muda o conversor e os testes. Não faz deploy, não altera
o banco nem a tela, e não recupera jogos antigos: cada uma dessas etapas precisa de autorização expressa.

## O que muda

Até o conversor 1, o `duels-sync` baixava os eventos do jogo, mas só guardava `players[].mulligan_count`. A mão
inicial e as cartas trocadas eram descartadas. O conversor 2 passa a guardar, **só para o dono do log**:

```json
"players": [{ "is_me": true, "mulligan_count": 1,
  "opening": {
    "status": "recorded",
    "hand":   [{ "card_id": "LOR11-86", "duels_id": "11-86" }, "… 7 cartas, na ordem do log"],
    "mulligan": { "count": 1,
                  "returned": [{ "card_id": "LOR3-90", "duels_id": "3-90" }],
                  "drawn":    [{ "card_id": "LOR4-84", "duels_id": "4-84" }] },
    "kept":   ["… as 6 que ficaram"]
  } }, { "is_me": false, "mulligan_count": 4 }],
"source_ref": { "converter": 2, "…": "…" }
```

| `status` | Quando | O que tem |
| --- | --- | --- |
| `recorded` | O log tem as 7 cartas do dono | `hand`, `kept` e `mulligan` |
| `recorded` com `mulligan: null` | Tem a mão, mas não tem o evento `MULLIGAN` | Mulligan **desconhecido**, nunca "manteve as 7" |
| `recorded` com `mulligan.count: 0` | Evento `MULLIGAN` com 0 cartas | Manteve as 7: `returned` e `drawn` vazios |
| `absent` | O log não tem a mão (`reason`: `conceded_before_start` ou `not_in_log`) | Nenhuma carta |
| `invalid` | Os eventos se contradizem | Só `issues`; nenhuma carta é guardada |

Checagens que levam a `invalid`:

- a mão não tem 7 cartas;
- uma carta devolvida não está na mão (contando cópias: duas Ursulas na mão permitem devolver até duas);
- o número de devolvidas é diferente do de compradas;
- a contagem do evento não bate com as cartas;
- há mais de um `MULLIGAN` do dono.

**O oponente.** O log do duels.ink é escrito do lado de um jogador. Para o oponente, a mão e as cartas trocadas vêm
vazias, e só a contagem é pública. O oponente fica sem `opening`, e esses campos nunca são preenchidos por inferência.

## A mesma carta em outra impressão

No log, uma promo ou reimpressão aparece com outro id (`9-C2-1`, `11-P3-29`, `3-D23-3`, `13-D23-12`). Na mão, essas
cartas são resolvidas pelo nome e caem na impressão principal (`LOR4-84`, `LOR11-89`, …). O id original fica em
`duels_id`, o que permite reprocessar quando o catálogo mudar. Se a carta não estiver no catálogo, `card_id` fica
`null` com `card_name`; nenhum id é inventado.

A lista do deck continua guardando a impressão que o jogador usa (por exemplo, `DLPC1-29-P3`), porque isso importa
para a coleção. Para comparar a mão com a lista, use `Catalog.baseOf(id)`: ele leva qualquer impressão à impressão
principal de mesmo nome. Exemplos: `DLPC1-29-P3` → `LOR11-89`, `LOR9-84` → `LOR4-84`, `D23C-3` → `LOR3-90`. No
catálogo, as impressões de uma carta têm o mesmo `name_en` e só a arte muda.

## Ações desfeitas e cópias repetidas

O conversor já tratava `FREE_UNDO`: remove a última ação principal do jogador **no turno atual** e tudo o que veio
depois dela (o desafio, o banimento, o dano), e devolve a lore. Agora isso está coberto por testes:

- vários desfazer seguidos;
- desfazer sem nada a desfazer, que não mexe em turno anterior;
- o desfazer do oponente, que nunca apaga ação do dono;
- a abertura, que o desfazer não altera.

Duas jogadas da mesma carta no mesmo turno são duas cópias e ficam como duas ações: o conversor não as junta nem
cria ação nova.

Nos 49 logs reais enviados pelo jogador (lidos fora do repositório; nenhum foi adicionado):

| Verificação | Resultado |
| --- | --- |
| Aberturas `recorded` / `absent` / `invalid` | 47 / 2 / 0 |
| Igual ao protótipo da análise (mão, devolvidas, contagem) | 47 de 47 |
| Cartas sem id do catálogo | 0 |
| `opening` do oponente | 0 |
| `FREE_UNDO` nos logs | 59 |
| Turnos com duas tintas do dono depois da conversão | 0 em 404 turnos |
| Turnos com a mesma carta jogada duas vezes | 14, todos cópias diferentes |

As duas tintas no mesmo turno que apareceram na primeira análise eram do protótipo, que ignorava `FREE_UNDO`. Não eram
do conversor.

**Custo pago.** Em 36 turnos, o custo impresso das cartas jogadas passa da tinta disponível. Isso não é erro: shift
custa menos, e há reduções de custo, como o UNDERDOG de White Rabbit, que sai por 1 no primeiro turno de quem não
começou. `inkPaid` existe em 132 de 1.077 jogadas. O conversor não reconstrói o custo pago das outras, e o Coach
continua dizendo "custo pago: não consta".

## Testes

`tools/duels-opening.test.mjs` (39 checagens, em CI junto com `duels-sync` e `duels-match`) usa só logs sintéticos.
Cobre:

- mulligan com cartas, com 0 cartas e sem evento;
- concessão antes do início, e o log convertido dessa concessão;
- o lado do oponente;
- os 6 casos `invalid` (e que nenhum guarda cartas);
- impressões alternativas e `baseOf`;
- carta fora do catálogo;
- desfazer (tinta, jogada com desafio, em sequência, sem nada a desfazer, do oponente);
- duas cópias no mesmo turno;
- reprocessamento (só a abertura muda, a segunda vez não muda nada, mesmo resultado de uma conversão nova).

Mutações que cada uma fazem testes falharem:

| Mutação | Testes que falham |
| --- | --- |
| Ler a falta do evento como "manteve as 7" | 1 |
| Aceitar carta devolvida que não está na mão | 3 |
| Guardar cartas num `invalid` | 1 |
| Dar `opening` ao oponente | 1 |
| Tirar o mapeamento de impressões | 2 |

## Como recuperar os jogos já guardados

O sync grava com `on_conflict … ignore-duplicates`. Por isso, um jogo que já está em `game_logs` não ganha `opening`
quando é sincronizado de novo. Os eventos brutos desses jogos foram descartados. Há dois caminhos, e os dois usam
`addOpening(log, row, events, cat)`:

1. **Pela API do duels.ink.** Um modo de reprocessamento no `duels-sync`, como o `refresh_decks` que já existe:
   - lê o histórico e escolhe os jogos guardados sem `source_ref.converter = 2`;
   - baixa `/g/{id}` (30 por minuto, 12 por execução, como o sync) e grava só `players[me].opening` e
     `source_ref.converter`.

   `addOpening` não mexe em turnos, resultado, deck nem resumo, e rodar de novo não muda nada. Um jogo que a API não
   devolver fica como está, sem `opening`, e a tela mostra "sem registro". **Falta confirmar** se o duels.ink ainda
   entrega `/g` de jogos antigos. Teste proposto: um único jogo antigo, com autorização. Esse modo não está neste PR.
2. **Pelos logs exportados pelo jogador** (`.logs.gz`), para jogos que a API não entregar mais. A mesma função, com o
   log que o próprio jogador enviou. Os arquivos não entram no repositório.

Para conferir depois do reprocessamento, uma consulta só de leitura:

```sql
select log->'players'->0->'opening'->>'status' as status, count(*)
from public.game_logs where source = 'duels_ink' group by 1;
```

Se algo der errado, reverter é simples: `opening` só foi acrescentado, então basta remover a chave e o
`source_ref.converter`.

## Como mostrar na tela (proposta; não implementada neste PR)

Fato registrado, sem julgamento:

- **Contexto:** "Você jogou primeiro (sem compra no T1)" ou "Você comprou primeiro".
- **Mão inicial:** as 7 cartas com custo e marca de tintável; as devolvidas esmaecidas, com a etiqueta "devolvida".
- **O que entrou:** "Comprou no lugar: Pegasus (1), Elinor (4, não tintável)".
- **A mão que ficou:** curva por custo (1/2/3/4/5+) e quantas tintáveis.
- `mulligan.count: 0`: "Manteve as 7 cartas".
- `mulligan: null`: "O log tem a mão, mas não a decisão de mulligan".
- `absent`: "Este jogo não tem registro de mão inicial", com o motivo quando houver (por exemplo, concessão antes do
  primeiro turno).
- `invalid`: igual a `absent` para o jogador; os `issues` ficam para revisão.
- **Oponente:** só "o oponente devolveu N cartas".
- **Prompt de IA:** quando houver `opening`, a mão e o mulligan entram como [fato]. Senão, fica "Mão e mulligan: não
  constam", como hoje.

**Fora desta etapa**, até revisão estratégica do Conselho: nota da decisão, "deveria manter" ou "deveria devolver",
comparações com a métrica de tinta e a sequência de turnos como análise.
