# Coach Estratégico V4 · benchmark de decisões

Use replays completos e selecione frames para revisão. **O benchmark mede a evidência disponível sobre cada decisão.** A ordenação de alternativas permanece inconclusiva até haver execução contrafactual comparável.

```bash
python3 -m unittest discover -s src -p 'test_strategic_v4_*.py' -v
python3 src/strategic_v4_benchmark.py --cases selecao.json partida.replay.gz partidas.zip > benchmark.local.json
```

O JSON de seleção associa cada ID de jogo a pares `[frame_da_acao, foco]`. Os focos são `strength`, `comeback` e `disruption`. Para Strength, selecione o frame que resolve a escolha do alvo. Se há um lançamento verificável, a saída inclui também o estado antes do pagamento. IDs e snapshots ficam no relatório local. O comando aceita jogos sem decisões selecionadas para registrar o resultado e as pistas de arquétipo da amostra.

- `confirmed_at_choice` confirma a legalidade do alvo naquele prompt, depois do pagamento. `offered_hypothesis` identifica um alvo legal que ainda não foi executado.
- `observed_then_undone` identifica um alvo efetivamente escolhido e desfeito no mesmo prompt. O efeito imediato observado fica no relatório. Fora desse caso, use somente a sequência mantida como resultado da partida.
- Casos de lore e disruption registram a ação, o estado e a consequência observada. Alternativas fora de um prompt exigem ações legais enumeradas pelo motor ou revisão com evidência adicional. A saída deixa a lista de alternativas confirmadas vazia quando a legalidade não está demonstrada.
- `evaluate_strength` isola pagamento, canto, legalidade do alvo e dano no estado informado. Os testes passam a legalidade como evidência explícita. `strength_response` combina o resultado com o cálculo independente de compra. Nenhum deles estima chance de ganhar a partida.
- O subtipo Detective é evidência sobre cartas reveladas. O benchmark conserva a classificação do arquétipo como inconclusiva sem uma lista adversária ou evidência equivalente.

Seleções feitas após assistir ao replay servem para revisar casos, com viés de seleção. Os controles sintéticos não validam a instalação do motor no WSL nem substituem alternativas simuladas até o próximo estado de decisão.

## Impacto e resposta observada

Para o mesmo prompt após undo, o benchmark compara o snapshot anterior à primeira escolha com o estado restaurado e com o snapshot anterior à escolha mantida. Registra campos diferentes ou faltantes. A igualdade cobre a representação gravada, que inclui zonas visíveis, identidades, dano, tinta, informação de mão disponível, prompts, efeitos e contadores. Estados internos ou ocultos do motor ficam fora da verificação.

O impacto imediato registra saídas da mesa, banimentos corroborados pela passagem ao descarte, soma do lore dessas cartas no snapshot e os recursos próprios antes e depois. O lore removido da mesa é um indicador da ameaça imediata. Ele não é uma estimativa de lore efetivamente impedido, pois a carta pode retornar ou o turno pode se desenvolver de outra forma.

A continuação acompanha a linha mantida até o início do turno adversário, o início do turno próprio seguinte e o fim desse turno, ou até o fim da partida. Marca se a mesma instância banida retorna à mesa e lista eventos selecionados do replay. Os campos de confiança mantêm a observação, a continuação e a avaliação comparativa separadas. Uma escolha desfeita tem efeito imediato registrado, mas sua continuação fica desconhecida.
