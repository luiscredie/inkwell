# Sparring V4 · defesa contra vitória no próximo turno

Piloto offline para revisar decisões no Coach. O módulo `tools/strategic_v4_sparring_defense.mjs` recebe o motor e uma posição da fase principal em jogo com dois jogadores. As cópias para simulação preservam cartas públicas e a mão do jogador que decide. A mão adversária, o baralho, a tinta e cartas viradas sob personagens usam marcadores sem habilidades. Os resultados dizem respeito ao cenário com essa informação pública.

O ponto de comparação é encerrar o turno na posição fornecida. O motor inicia a resposta e verifica quests e os efeitos de encerramento. Se encontrar vitória por lore nessa linha, testa um desafio ou quest legal do defensor seguido de encerramento. Uma vitória imediata do defensor tem prioridade sobre um desafio que evita a linha de vitória. O retorno inclui o estado da comparação, o lore alcançado nas linhas visitadas, as ações candidatas e o consumo do orçamento.

## Casos usados para avaliação

- Reproduziu-se o checkpoint final da partida do iPhone com o mesmo motor e histórico. O motor confirmou vitória por lore em 15 turnos de jogo, com as duas avaliações provisórias preservadas.
- No turno 5 do bot, manter Lilo no descarte deixou 4 personagens no descarte e até 5 tintas após tintar. O motor ainda não ofereceu Chernabog.
- No turno 6 do bot, manter Lilo no descarte deixou 5 personagens no descarte e 5 tintas. O motor ofereceu e executou Chernabog por 5. No turno 7, o mesmo desvio também o colocou em jogo por 5, sobrando 1 tinta. Chernabog entrou secando nos dois casos. No turno 7, uma segunda simulação continuou até o fim. O bot baixou Chernabog e encerrou, e os dois Pegasus ainda fizeram quest para vencer por 20–7. A ramificação do turno 6 terminou na entrada de Chernabog. O efeito dessa preparação antecipada e a tentativa de desafiar Elinor continuam em aberto.
- As posições sintéticas verificam um desafio que impede uma vitória pública, uma mesa sem defesa de uma jogada no escopo, uma mesa com lore insuficiente, limite de busca, gatilho de Lilo sem resolução, sigilo da mão adversária, Evasive e vitória imediata do próprio defensor.

```sh
INKWELL_SPAR_ENGINE=/caminho/simulador/dist/index.mjs \
  node --test tools/strategic_v4_sparring_defense.test.mjs
```

## Limites do piloto

O simulador externo precisa expor `getCard`, `continueTurn` e `startTurn`. O bundle e os checkpoints privados ficam fora do GitHub. A checagem é local e requer esse bundle.

A reconstrução da fase principal não restaura limites de uso dependentes das ações anteriores do mesmo turno. Desafios e quests com decisões pendentes, como a volta de Lilo, o fim do orçamento e alternativas públicas fora do horizonte podem deixar o resultado inconclusivo. `no_lethal_found` informa o que foi verificado no horizonte público. Retomar a partida original continua a usar a ponte e o perfil do bot existentes. O piloto ainda não escolhe ações no Sparring do iPhone.
