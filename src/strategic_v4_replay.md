# Coach Estratégico V4 · análise offline de replays

O módulo usa o replay bruto `duels-replay-v1` para reconstruir a perspectiva registrada. Aceita um `.replay.gz`, um JSON de replay ou um ZIP com jogos `.replay.gz`. O JSON de saída contém totais e referências a frames. Requer Python 3.10+ e usa a biblioteca padrão.

```bash
python3 -m unittest discover -s src -p 'test_strategic_v4_replay.py' -v
python3 src/strategic_v4_replay.py /caminho/para/partida.replay.gz
python3 src/strategic_v4_replay.py /caminho/para/partida.replay.gz \
  --at-seq 13 --out-id 13-97 --draws 2
```

Selecione uma partida de um ZIP com `--game-id`. Use `--out-id` uma vez por ID da lista registrada. Os números no exemplo reproduzem uma checagem matemática num replay específico e servem para demonstrar a interface. Um retorno diferente de zero indica pelo menos um erro de validação.

- Reconstrução aplica os patches e confere a ordem, os cursores do log e o resultado terminal. O formato Duels pode substituir propriedades omitidas em objetos exportados.
- Comeback registra o primeiro empate ou virada de cada episódio de desvantagem nos fechamentos de turno. O resultado da partida fica em outro campo. Uma concessão encerra a janela de observação.
- Disruption relata descartes da mão, banimentos, retornos à mão e cartas da mesa transformadas em tinta. A contagem é retrospectiva e exclui eventos marcados como desfeitos. O lado indica quem sofreu o evento. A causa da remoção e o mérito estratégico ainda exigem revisão.
- Outs calcula a probabilidade de pelo menos uma compra atingir os IDs fornecidos. Distingue cópias na mão de cópias ainda compráveis e calcula limites quando parte das cartas fora do baralho é desconhecida. Usa a contagem de cartas e as zonas visíveis no frame, com compras uniformes e sem reposição. Eventos que determinam a próxima compra, requisitos de timing e jogabilidade do out exigem avaliação separada. O valor mede chance de compra.

## Validação em ambiente isolado

8 replays brutos, 793 frames, 2.361 entradas de log, 15 frames de undo. Foram encontrados cinco retornos à liderança, dois empates e dois episódios ainda em desvantagem. O caso de duas compras no frame 13 tem 51 cartas no baralho, três a quatro cópias compráveis e probabilidade entre 11,53% e 15,22%.

A integração com `strategic_adaptation.py`, V2/V3, Observer e simulador depende da cópia do projeto instalada no WSL. O módulo pode ser testado isoladamente.
