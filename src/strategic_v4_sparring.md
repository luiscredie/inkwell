# Inkwell Sparring — contrato de revisão humana V1

Este módulo **não é um simulador**. Ele recebe o estado de uma decisão e a mão do bot, fornecidos por um motor ou replay verificável, **após o jogador humano encerrar o próprio turno**. Registra a sequência de ações do bot, incluindo fazer tinta ou não fazer tinta, ações legais fornecidas pelo motor e hipóteses propostas pelo treinador. Não inventa cartas na mão, jogadas legais, probabilidades de vitória ou desfechos alternativos.

`prepare_sparring_review(turn, feedback)` devolve um registro JSON compatível com `inkwell-sparring-feedback-v1`. Aceita `game_changing`, `ok`, `bad`, `inconclusive`, justificativa e linha sugerida. A avaliação humana é **provisória**, e **não** altera política do bot, pesos ou treinamento. O campo `human_turn_locked=true` é obrigatório antes da revelação da mão do bot.

Uma classificação `bad` para `Circle of Life → Don Karnage` **não vira penalidade automática**. Antes de comparar com `Malicious, Mean, and Scary → Circle of Life → Prince Phillip`, o sistema deve verificar se Phillip estava no descarte, se Malicious estava na mão e se a sequência era legal quanto a canto/tinta, momento de uso, alvos e efeitos. Uma cópia ainda no baralho é uma possibilidade futura, não uma carta disponível no turno. Mesmo uma alternativa legal continua **não simulada** até o motor executar a linha e a resposta adversária.

A exceção proposta pelo treinador — adversário humano com 19 lore, ameaça letal imediata e Circle como **única defesa legal** — exige confirmação das três condições pelo motor. A presença de 19 lore, isoladamente, não a prova. Outras ameaças letais também podem surgir antes de 19 lore. Caso faltem informações, marque `unverified` e solicite evidências.

## Próxima integração no WSL/Work

- Construir o adaptador do simulador para `bot_hand`, `bot_actions`, `alternative_actions`, `context`, sem expor a mão antes do fechamento do turno humano.
- Confirmar quais alternativas são enumeradas pelo motor e quais são só hipóteses humanas. Não usar memória de uma partida futura como informação disponível em turnos anteriores.
- Usar o esquema para coletar avaliações humanas explicadas e o grau de evidência, nunca como rótulos de treinamento prontos.
- Revalidar contra os arquivos originais do Observer. O formato parcial de `.logs.gz` não fornece automaticamente a mão inteira do adversário.

Testes isolados: `python3 -m unittest discover -s src -p 'test_strategic_v4_*.py' -v`.

## Sessão local pelo terminal

O cliente Python usa um processo Node separado e o bundle do motor. A mão inicial do bot usada na revisão é a mão exata **quando o bot recebe a primeira solicitação do próprio turno**, depois do processamento inicial do motor, inclusive compra se houver. O cliente humano recebe o estado projetado pelo motor com a mão adversária reduzida a contagem. A informação que as regras da partida revelam durante uma resolução continua disponível nas solicitações legais dessa resolução.

Com o simulador já disponível, gere o bundle com `npm ci` e `npm run build` na raiz dele. Depois, na raiz do Inkwell, execute:

```sh
python3 src/strategic_v4_sparring_cli.py \
  --engine /caminho/simulador/dist/index.mjs \
  --human /caminho/seu-deck.deck --bot /caminho/deck-do-bot.deck \
  --feedback sparring-feedback.local.jsonl
```

Escolha números de ação oferecidos pelo motor. Para selecionar cartas, use índices da lista separados por vírgula. Para pagar, escolha entre os pagamentos enumerados. Outros prompts aceitam a resposta JSON do motor. Em partidas sem resultado, `--turns N` limita a sessão de diagnóstico. `--smoke` usa respostas automáticas limitadas para verificar a sessão curta.

Ao encerrar a ação **End Turn**, o motor precisa avançar para o turno do bot antes de a mão ser revelada. A revisão completa aparece antes do primeiro input próprio seguinte, ou no fim do jogo. O histórico registra todas as opções principais por etapa e os alvos/pagamentos selecionados nos prompts. O encerramento legal com tinta disponível é registrado como recusa se o bot não colocou carta naquele turno. Pagamentos e alvos mais complexos mantêm as restrições do prompt original. A presença de um alvo numa lista não certifica todas as combinações de seleção. A enumeração é local à posição de cada passo do bot.

A revisão aceita as quatro classificações e registra justificativa e alternativa no JSONL local. O arquivo contém informações da partida e deve permanecer fora do controle de versão. Ele não é entrada do simulador, da busca ou de treinamento.

## Cenário de defesa de 19 lore

```sh
node tools/strategic_v4_sparring_scenario.mjs /caminho/simulador/dist/index.mjs
```

O teste executa duas linhas a partir de uma posição sintética idêntica, até o fim do turno seguinte ou até vitória. No motor público testado, a linha Circle → Phillip deixa Simba ileso e pronto para o lore final. Na outra linha, Malicious marca Simba, Circle é cantada e Phillip bane Simba, evitando aquela vitória imediata. O teste não enumera todas as defesas. O catálogo público usado não oferece Don Karnage — Debonair Pirate, e a linha específica fica explicitamente indisponível para simulação nessa revisão. A ferramenta registra o resultado da terceira linha quando a impressão exata estiver disponível. O resultado sintético não estabelece a melhor linha da partida original.
