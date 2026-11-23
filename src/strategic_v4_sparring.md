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
