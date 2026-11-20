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
    "kept":   ["… as 6 cartas da mão original que ficaram"],
    "final":  ["… kept + drawn: as 7 com que o jogo começou"]
  } }, { "is_me": false, "mulligan_count": 4 }],
"source_ref": { "converter": 2, "…": "…" }
```

Três listas, para não confundir o que foi distribuído com o que ficou:

| Campo | O que é | Quando o mulligan é desconhecido |
| --- | --- | --- |
| `hand` | As 7 cartas distribuídas, antes de qualquer troca | Presente |
| `kept` | Só as cartas da mão original que ficaram (`hand` menos `returned`) | `null` |
| `final` | A mão com que o jogo começou: `kept` e depois `drawn` | `null` |

Uma cópia comprada de uma carta já mantida aparece uma vez em `kept` e duas em `final`.

| `status` | Quando | O que tem |
| --- | --- | --- |
| `recorded` | O log tem as 7 cartas do dono | `hand`, `mulligan`, `kept` e `final` |
| `recorded` com `mulligan: null` | Tem a mão, mas o mulligan não pode ser conhecido (motivo em `mulligan_unknown`, abaixo) | Mulligan **desconhecido**, nunca "manteve as 7"; `kept` e `final` também `null` |
| `recorded` com `mulligan.count: 0` | Evento `MULLIGAN` com `mulliganCount: 0` explícito | Manteve as 7: `returned` e `drawn` vazios |

Informação insuficiente não é mulligan zero. "Manteve as 7" só vale quando o evento diz `mulliganCount: 0`. Nos demais
casos sem cartas, o mulligan fica desconhecido:

| `mulligan_unknown` | O evento | Por que não é zero |
| --- | --- | --- |
| `no_event` | Não há `MULLIGAN` do dono | Nada foi registrado |
| `event_without_data` | `MULLIGAN` sem contagem e sem cartas (inclusive listas vazias sem contagem) | Uma lista ausente ou vazia não afirma nada |
| `event_without_cards` | Contagem acima de 0, sem as cartas | Sabe-se quantas, não quais; a contagem continua em `mulligan_count` |

Nos 49 logs reais, o evento do dono sempre traz contagem e cartas, ou só `mulliganCount: 0` (o "manteve as 7"). Os 45
eventos com contagem e sem cartas são do oponente, que não é processado.
| `absent` | O log não tem a mão (`reason`: `conceded_before_start` ou `not_in_log`) | Nenhuma carta |
| `invalid` | Os eventos se contradizem | Só `issues`; nenhuma carta é guardada |

Checagens que levam a `invalid`:

- a mão não tem 7 cartas;
- uma carta devolvida não está na mão (contando cópias: duas Ursulas na mão permitem devolver até duas);
- o número de devolvidas é diferente do de compradas;
- a contagem do evento não bate com as cartas;
- há mais de um `MULLIGAN` do dono;
- há duas `INITIAL_HAND` do dono com cartas diferentes (a mesma mão repetida, em qualquer ordem, conta uma vez; uma
  `INITIAL_HAND` vazia não conta);
- a mão aparece depois do `MULLIGAN` ou depois do primeiro turno;
- o `MULLIGAN` do dono aparece depois do primeiro turno (mesmo dizendo 0). Nos logs reais, isso nunca acontece.

Nos 49 logs reais, cada jogador tem exatamente uma `INITIAL_HAND`, sempre antes do `MULLIGAN` e do primeiro turno.
Essas regras só pegam logs fora desse padrão.

**Carta devolvida com outro id.** A carta devolvida é procurada na mão primeiro pelo mesmo id do duels.ink e, se não
houver, pela mesma carta em outra impressão (`baseOf`). Assim, uma Pegasus promo (`9-C2-1`) na mão devolvida como
`4-84` não vira evento inválido, e é ela que sai da mão. Com as duas impressões na mão, sai a do id exato. Impressões
não criam cópias: com uma Pegasus na mão, devolver duas continua inválido.

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

`tools/duels-opening.test.mjs` (72 checagens, em CI junto com `duels-sync` e `duels-match`) usa só logs sintéticos.
Cobre:

- mulligan com cartas, com 0 cartas explícito e sem evento;
- `MULLIGAN` sem contagem e sem cartas, com listas vazias, com contagem e sem cartas: desconhecido, nunca zero;
- `MULLIGAN` depois do primeiro turno: inválido;
- `hand`, `kept` e `final` separados, inclusive com uma cópia comprada de uma carta mantida;
- concessão antes do início, e o log convertido dessa concessão;
- o lado do oponente, inclusive uma `INITIAL_HAND` do oponente com cartas (ignorada);
- os casos `invalid` (e que nenhum guarda cartas), inclusive mão repetida com cartas diferentes e mão fora de ordem;
- carta devolvida com o id de outra impressão (promo devolvida como regular, as duas impressões na mão, impressões
  que não criam cópias);
- impressões alternativas e `baseOf`, e carta fora do catálogo;
- desfazer (tinta, jogada com desafio, em sequência, sem nada a desfazer, do oponente);
- duas cópias no mesmo turno;
- reprocessamento (só a abertura muda, a segunda vez não muda nada, mesmo resultado de uma conversão nova);
- compatibilidade: `format_version` continua `"1.0"`, e sem os dois campos novos o log tem exatamente as chaves do
  conversor 1.

Mutações (cada uma quebra o código de propósito; todas fazem testes falharem):

| Mutação | Testes que falham |
| --- | --- |
| Ler a falta do evento como "manteve as 7" | 4 |
| Ler um `MULLIGAN` sem contagem e sem cartas como "manteve as 7" | 4 |
| Ler contagem acima de 0 sem cartas como resolvida | 1 |
| Ler listas vazias sem contagem como zero explícito | 1 |
| Aceitar `MULLIGAN` depois do primeiro turno | 2 |
| Mostrar a mão distribuída como `kept`/`final` quando o mulligan é desconhecido | 2 |
| Aceitar carta devolvida que não está na mão | 5 |
| Não procurar a carta devolvida em outra impressão | 2 |
| Não preferir a impressão exata | 1 |
| Guardar cartas num `invalid` | 1 |
| Aceitar duas mãos diferentes | 1 |
| Aceitar mão depois do mulligan | 1 |
| Aceitar mão depois do primeiro turno | 1 |
| `final` sem as compradas | 2 |
| `kept` misturado com as compradas | 6 |
| Dar `opening` ao oponente | 1 |
| Tirar o mapeamento de impressões (`baseOf`) | 2 |

Comparação com o código de `main`, nos 49 logs reais (fora do repositório): os logs saem idênticos em tudo, menos
`players[me].opening` e `source_ref.converter`.

## Outro conversor (Python) e compatibilidade

Os comentários de `convert.ts` e `index.ts` diziam que eles seguiam `tools/duels/duels_import.py` e que um
`parity.mjs` conferia os dois. Verificado em 20/11:

- nenhum dos dois arquivos existe neste repositório, nem no histórico dele (que começa na importação do #137, em
  03/11), nem em `luiscredie/lorcana` ou `luiscredie/lorcanasupp`;
- nenhum workflow ou função roda Python sobre logs do duels.ink;
- no banco, os jogos `duels_ink` vão de 26/06 a 20/11. Os 550 gravados em 20/10, antes deste repositório, têm as
  mesmas chaves que o `convert.ts` grava;
- o Coach do site não converte eventos do duels.ink: só aceita logs já no formato 1.0, do Lore Counter e do Training
  Logger.

O que não deu para verificar: se o `duels_import.py` ainda existe e é usado fora dos repositórios (por exemplo, no
computador do Luis). Os comentários agora dizem a verdade: o `convert.ts` é o conversor em uso, e não há checagem de
paridade.

Compatibilidade: o conversor 2 só **acrescenta** campos (`players[me].opening` e `source_ref.converter`) e mantém
`format_version: "1.0"`. Um leitor do formato 1.0 que ignora chaves desconhecidas lê o log como antes, e a ausência de
`opening` quer dizer "sem registro". Se um conversor Python voltar a gravar logs, há duas opções: (a) ele grava sem
`opening`, e o reprocessamento acrescenta depois; ou (b) ele copia as regras de `openingOf`, e o teste de paridade
passa a existir de verdade, com os mesmos logs sintéticos deste PR.

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
- **Mão distribuída** (`hand`): as 7 cartas com custo e marca de tintável; as devolvidas esmaecidas, com a etiqueta
  "devolvida". As que ficaram (`kept`) aparecem normais.
- **O que entrou** (`drawn`): "Comprou no lugar: Pegasus (1), Elinor (4, não tintável)", numa linha separada, para não
  parecer que estavam na mão original.
- **Mão com que o jogo começou** (`final`): curva por custo (1/2/3/4/5+) e quantas tintáveis, com a marca "comprada"
  nas cartas que vieram no mulligan.
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
