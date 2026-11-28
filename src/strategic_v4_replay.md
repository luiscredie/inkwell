# Coach Estratégico V4 · análise offline de replays

Execute no diretório do projeto. O módulo usa Python 3.10+ e a biblioteca padrão.

```bash
python3 -m unittest discover -s src -p 'test_strategic_v4_*.py' -v
python3 src/strategic_v4_replay.py /caminho/partida.replay.gz
python3 src/strategic_v4_replay.py /caminho/partida.logs.gz /caminho/observer/partida.json
```

| Entrada | Resultado |
| --- | --- |
| `duels-replay-v1` em JSON ou `.replay.gz`, também dentro de ZIP | Estado observado ao longo dos frames, desvantagem e retomadas de lore, disruption e compras de candidatos |
| `.logs.gz` com um array JSON de eventos `type` | Frequência de ações registradas, com perspectiva e estado indeterminados |
| Relatório JSON do Observer com `game_id` e listas de turnos | Frequência de ações por lado quando registrado e cobertura das observações por turno |

O JSON de saída distingue `games` de `observer_inputs`. As observações do Observer não habilitam análise por frame nem estimativa de outs. Erros retornam código diferente de zero. Os comandos leem os arquivos indicados e escrevem o resultado na saída padrão.

O reconstrutor confere a sequência, os cursores, as zonas visíveis registradas, a perspectiva e o encerramento. A forma observada de undo referencia o primeiro frame invalidado. A reconstituição exige que o frame de undo restaure turno, lore, zonas identificáveis e contagens de recursos da referência anterior. Eventos e checkpoints de lore dos frames invalidados são excluídos da análise. Comeback usa fechamentos de turno e distingue o resultado final.

Disruption usa o papel explícito de vítima ou a diferença de zona da carta entre snapshots adjacentes. Eventos sem evidência suficiente de vítima, ou com evidência conflitante, ficam em `unknown.*`. O campo genérico `player` não define a vítima. Causa e intenção ficam para revisão.

## Compra e resposta com Strength of a Raging Fire

O cálculo de compras usa a contagem do baralho e as zonas visíveis, sem consultar a ordem do baralho. Para uma carta candidata genérica, use `--at-seq`, um ou mais `--out-id` e `--draws`. Para uma resposta específica a **Strength of a Raging Fire**, use a impressão Duels `2-201` e um arquivo de contexto verificado para aquele frame.

```bash
python3 src/strategic_v4_replay.py partida.replay.gz --game-id ID_DA_PARTIDA \
  --at-seq 13 --out-id 2-201 --draws 2 --strength-context contexto.json
```

Exemplo sintético de `contexto.json`. Use `null` quando a evidência não estiver disponível. Uma lista vazia de cantores indica que a verificação encontrou zero cantores legais.

```json
{
  "target_instance_id": "id-da-instancia-alvo-no-frame",
  "play_legal": true,
  "target_legal": true,
  "paying_ink_legal": true,
  "eligible_singer_ids": [],
  "damage_reduction": 0,
  "target_effective_willpower": 3
}
```

- `play_legal` e `target_legal` refletem a checagem das restrições efetivas, incluindo Ward. `paying_ink_legal` vale para a rota de custo base de três tintas. A tinta disponível vem do estado de exertion do inkwell.
- `eligible_singer_ids` lista instâncias verificadas como aptas a cantar. O adaptador confere se estão prontas, secas, em jogo e com custo suficiente. `effective_singer_costs` pode informar o valor verificado quando Singer ou outro efeito muda o custo válido para canto.
- A carta causa dano pela quantidade de personagens próprios em jogo. Informe a redução de dano efetiva, como Resist, e o willpower efetivo do alvo. O dano registrado no alvo é descontado do willpower. [Galeria oficial da carta](https://cards.disneylorcana.com/en-US/?cardId=2186) · [Regras oficiais](https://disneylorcana.com/en/resources/)
- Com o `strategic_adaptation.py` V1.1 disponível ao lado do analisador, o adaptador chama `strength_playability(available_ink=..., eligible_singers=...)` e confere o retorno do motor. A execução isolada indica `reference_contract`; o módulo local, quando usado, aparece como `strategic_adaptation`.
- O relatório mantém a chance de comprar a carta e o intervalo condicionado à jogabilidade e ao dano letal da resposta no estado fixo. Mudanças de estado após compras, descontos fora da rota base, outras respostas e probabilidade de vitória ficam fora deste cálculo.

A integração com o módulo instalado e com os arquivos originais do Observer requer uma amostra no WSL.
