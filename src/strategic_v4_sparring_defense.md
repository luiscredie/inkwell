# Sparring V4 · defesa contra vitória no próximo turno

A política de defesa é o padrão das novas partidas do chat e do terminal. O mesmo analisador serve para revisar posições offline. O módulo `tools/strategic_v4_sparring_defense.mjs` recebe o motor e uma posição da fase principal em jogo com dois jogadores. As cópias para simulação preservam cartas públicas e a mão do jogador que decide. A mão adversária, o baralho, a tinta e cartas viradas sob personagens usam marcadores sem habilidades. Os resultados dizem respeito ao cenário com essa informação pública.

O ponto de comparação é encerrar o turno na posição fornecida. O motor inicia a resposta e verifica quests e efeitos de encerramento. Se encontrar vitória por lore, testa sequências de desafio, quest, tinta, jogar e cantar. O analisador avulso usa duas ações por padrão. A política do Sparring usa três e testa primeiro uma sequência de até 12 quests para vencer. O motor valida pagamentos simples em tinta e resolve escolhas de alvo único, efeitos opcionais e a resposta adversária ao Dark Dance. Uma vitória imediata do defensor tem prioridade. O resultado inclui as ações e decisões executadas, a resposta pública encontrada, o lore alcançado e o consumo do orçamento.

## Casos usados para avaliação

- Reproduziu-se o checkpoint final da partida do iPhone com o mesmo motor e histórico. O motor confirmou vitória por lore em 15 turnos de jogo, com as duas avaliações provisórias preservadas.
- No turno 5 do bot, manter Lilo no descarte deixou 4 personagens no descarte e até 5 tintas após tintar. O motor ainda não ofereceu Chernabog.
- No turno 6 do bot, manter Lilo no descarte deixou 5 personagens no descarte e 5 tintas. O motor ofereceu e executou Chernabog por 5. No turno 7, o mesmo desvio também o colocou em jogo por 5, sobrando 1 tinta. Chernabog entrou secando nos dois casos. No turno 7, uma segunda simulação continuou até o fim. O bot baixou Chernabog e encerrou, e os dois Pegasus ainda fizeram quest para vencer por 20–7. A ramificação do turno 6 terminou na entrada de Chernabog. O efeito dessa preparação antecipada e a tentativa de desafiar Elinor continuam em aberto.
- As posições sintéticas verificam um desafio que impede uma vitória pública, uma mesa sem defesa de uma jogada no escopo, uma mesa com lore insuficiente, limite de busca, gatilho público opcional de Lilo, sigilo da mão adversária, Evasive e vitória imediata do próprio defensor.

```sh
INKWELL_SPAR_ENGINE=/caminho/simulador/dist/index.mjs \
  node --test tools/strategic_v4_sparring_defense.test.mjs
```

## Regressões com as partidas do Duels

- **20–0, primeiro jogo.** Após a defesa do bot ainda sobram Elinor e o novo Max. O motor confirma a vitória por quest quando Max deixa de estar secando.
- **21–5.** O segundo Chart Topper está em jogo e seca ao começar o turno. Somado a Meilin e Vanessa, ele preserva o letal. A cópia banida fica no descarte.
- **20–0, último jogo.** O motor confirma letal na reconstrução do turno 18, começando tanto com Ariel desafiando o Bodyguard quanto com Chernabog. A reconstrução usa a mesa relevante para desafio e lore. Guitar e Boost ficam fora do modelo, assim como compras com identidade desconhecida.
- Uma posição sintética confirma que, quando a defesa existe, Chernabog pode remover o Bodyguard e liberar o desafio seguinte. Outra confirma que o adversário pode usar a reposição de Dark Dance para manter o letal. Um caso separado reproduz o ponto decisivo da Elinor no fim do turno.

## Limites do piloto

O simulador externo precisa expor `getCard`, `continueTurn` e `startTurn`. O bundle e os checkpoints privados ficam fora do GitHub. A checagem é local e requer esse bundle.

A reconstrução da fase principal não restaura limites de uso dependentes de ações anteriores do mesmo turno. A resposta adversária explora quests, desafios, ativações e fim do turno. Boost, compras futuras identificadas, vários custos e escolhas de múltiplos alvos ficam fora da busca. Embaralhamentos usam uma ordenação legal com a próxima compra opaca. A busca resolve a volta opcional da Lilo adversária quando o motor oferece a escolha e o pagamento. A política ainda delega a volta da própria Lilo à política original. `no_lethal_found` informa o que foi verificado no horizonte público. O limite de tempo é cooperativo entre transições do motor.

## Política usada na partida

O chat e o terminal aceitam `--policy baseline` como controle. No chat a opção pertence ao comando `start`. Partidas novas usam `defense`. Checkpoints anteriores carregam a política e o bundle originais. A política nova fixa também os hashes dos três módulos de defesa e registra, no checkpoint privado, a conclusão e o plano de cada busca. Ao retomar, confere o hash da visão e do pedido e reutiliza o plano. Isso preserva inclusive as decisões tomadas quando acabou o tempo.

O motor projeta a visão do jogador antes de chamar o controlador. A busca usa a mão própria, a mesa, o descarte público e as contagens das zonas ocultas. A projeção conservadora também oculta identidades de compras futuras possivelmente conhecidas. Cada passo do plano exige a mesma posição projetada e uma opção compatível no pedido atual. O pagamento usa os identificadores oferecidos naquele pedido. Uma escolha adversária encerra o prefixo que o bot pode executar. Na próxima ação principal ele reavalia. A busca recebe até 768 transições, três ações de defesa, 48 passos por ramo em cada turno e 1.200 ms por consulta. Uma operação síncrona do motor pode ultrapassar o prazo antes da próxima verificação. As cartas de custo alternativo com descrições ambíguas ficam a cargo da política original.

A escolha defensiva exige uma vitória adversária executada ao passar e uma resposta que sobreviva no horizonte público modelado. Entre defesas que sobrevivem, a política prefere gastar menos cartas, depois mais lore próprio e menos ações. Se uma linha necessária exceder o orçamento ou depender de opções fora da busca, a política mantém o diagnóstico inconclusivo e devolve o controle ao bot original. O motor ainda valida a decisão real. A revisão humana continua provisória.

## Comparação no motor

Posições artificiais de dois turnos com a versão pública `5765234bb94efd8fb86c6cb5140fde0bb9fd2708`. Para cada posição, cada política recebeu a mesma seed, estado inicial, catálogo e configuração do bot. O oponente do ensaio prioriza quests legais e encerra o turno. Nos prompts usa o controlador original. A busca interna também examina respostas públicas alternativas. Os três casos inspirados no Duels usam reconstruções parciais. O benchmark mantém as zonas e compras sintéticas explícitas. Na reconstrução de Chart Topper o defensor já esgotou as ações relevantes. No T18 Guitar, Boost e cartas sob Ariel ficam fora da posição pareada.

Cada uma das 17 posições foi repetida com as seeds 17, 309 e 20261123. A tabela usa a última seed. O número de nós soma as buscas do candidato no turno. Os milissegundos medem a execução dos dois turnos do ensaio, separadamente para original e candidato, em uma execução do Work. Todos os casos incluem passar como referência. A linha vencedora pode encerrar a busca antes de examinar o restante do menu.

| Posição | Outras opções examinadas ou controle | Política original | Candidato e resultado até a resposta | Nós | ms original / candidato |
|---|---|---|---|---:|---:|
| Simba a 19 | Quest, tinta de música, canto de cada música, pagar Malicious | Quest com Mufasa, tinta Circle, paga Malicious. Perde a 20 | Paga 3 por Malicious, canta Circle com Mufasa, recupera Phillip. Simba é banido e o adversário fica a 19 | 90 | 5 / 16 |
| Mesma mesa com Lilo adversária no descarte e 2 tintas | Mesmas aberturas, com aceitar ou recusar a volta na resposta | Mesma perda a 20 | Mesma defesa, sobrevive a 19 | 120 | 4 / 17 |
| Duas tintas e Ursula na mão | Tinta de cada carta oferecida, jogar Ursula, cantar as músicas, quest | Quest, tinta Circle, joga Ursula. Perde | Tinta Ursula, paga Malicious, canta Circle para Phillip. Sobrevive a 19 | 230 | 2 / 49 |
| Simba e Magic Golden Flower | Combo, quest e tintas, resposta da ativação com custo de banir o próprio item | Quest, tinta Circle, paga Malicious. Perde | Resolve o combo e sobrevive a 19. Uma execução dirigida independente confirmou o resultado da mesma linha | 98 | 4 / 17 |
| Pegasus Evasive a 19 | Pagar Strength, cantar, tintar, quest. Desafio indisponível | Tinta Strength, quest. Perde | Quest com Elinor, paga 3 por Strength e bane Pegasus. Sobrevive a 19 | 44 | 3 / 14 |
| Chernabog contra Bodyguard e Lady | Quest de Elinor, desafiar o Bodyguard, jogar Chernabog | Chernabog remove Woolter & Jesse, Elinor desafia Lady | Mesma defesa executada. Ambos sobrevivem a 19 | 93 | 40 / 58 |
| Elinor com vitória de um quest | Quest vence imediatamente | Joga Chernabog antes do quest | Quest, vence a 20 com Chernabog na mão | 3 | 3 / 2 |
| Vitória em dois quests | Sequência de quests | Chernabog, dois quests | Dois quests, vence | 4 | 4 / 2 |
| Vitória em três quests | Sequência de quests | Chernabog, três quests | Três quests, vence | 5 | 3 / 4 |
| Hercules e Lilo | Desafio, cantar Strength, tintar, quest | Desafia Lilo e tinta Strength | Desafia e mantém Strength. Em outro ramo, cantar gastou a carta com a mesma mesa própria, tinta e lore finais | 31 | 2 / 4 |
| Lady e Chernabog na mão | Desafio de Elinor, jogar Chernabog, quest | Joga Chernabog e faz quest | Desafia, preserva Chernabog e as cinco tintas, ganha um lore a menos. Superioridade de longo prazo em aberto | 57 | 2 / 8 |
| Pegasus sem resposta | Quest ou passar | Quest e passa. Perde | Mesma sequência, perde a 20. Nenhuma defesa encontrada no escopo | 8 | 1 / 2 |
| Kuzco com Ward | Tinta, pagar/cantar Strength, quest | Tinta Strength, quest. Perde | Mesma sequência. A oferta da música não torna Kuzco um alvo elegível. Adversário chega a 22 | 40 | 2 / 6 |
| Lady sem ameaça letal | Ponto de comparação ao passar | Chernabog e quest | Mesma sequência. Sem intervenção defensiva | 10 | 3 / 4 |
| Final Elinor e Max | Passar. O novo Max seca no próximo turno | Passa | Passa. Ambos perdem a 20 | 3 | 1 / 1 |
| Segundo Chart Topper | Passar. A cópia no descarte e a da mesa têm identidades distintas | Passa | Passa. Meilin, Vanessa e o Max restante chegam a 21 | 4 | 2 / 2 |
| Mesa parcial do T18 com Bodyguard | Chernabog, quest de Ariel ou desafiar Woolter & Jesse | Chernabog em Vixey, quest com Ariel | Mesma linha. O adversário vence a 20. Desafiar primeiro também deixou letal no piloto | 288 | 9 / 138 |

Há ainda controles separados de orçamento. Com apenas um nó por consulta, ou prazo efetivamente zero, o bot registra inconclusivo e executa a linha original que perde a 20. No teste de sigilo, substituímos a mão e o topo adversários mantendo suas contagens. As decisões, os menus, os ramos examinados e os veredictos foram idênticos. As seeds repetidas ajudam a detectar dependência de desempate, mas não aumentam a diversidade das posições estratégicas.

O teste registra a posição e a seed, os menus projetados, os ramos pesquisados com pagamentos e alvos, e os passos aceitos pelo motor para cada política. Para ver o detalhe, execute com o bundle público compilado:

```sh
INKWELL_BENCH_TRACE=1 INKWELL_SPAR_ENGINE=/caminho/dist/index.mjs \
  node --test tools/strategic_v4_sparring_policy.test.mjs
```

Na reprodução privada do checkpoint do iPhone, as duas políticas receberam a mesma primeira solicitação do turno 14. Ambas aceitaram voltar Lilo, pagaram o custo e encerraram. Os dois Pegasus terminaram a partida em 20–7. O checkpoint antigo também retomou até o fim, com as duas anotações provisórias. Essa partida usa Chernabog – Evildoer. O caso de Dark Dance usa Chernabog – Unnatural Force.

## Proposta para a Etapa 3

Começar pela decisão opcional de Lilo no turno anterior ao letal. A partir do mesmo checkpoint, executar a volta, a recusa com Chernabog e a recusa sem baixá-lo. Para cada ramo, registrar lore disponível agora, tinta restante, descarte necessário, mesa após a resposta e ações legais no próximo turno próprio. Testar também quest versus desenvolvimento e tinta versus preservação em posições onde essas decisões mudem a combinação disponível.

Em uma segunda posição, comparar Circle para Don Karnage com guardar Circle para Malicious e Phillip no descarte. Registrar a impressão exata disponível no catálogo antes de executar. A versão pública fixada aqui não contém Don Karnage – Debonair Pirate. Repetir com e sem letal adversário e verificar se a política abandona a preparação a tempo. Aprovar a ampliação quando a nova política melhorar esses casos nos mesmos estados e preservar os resultados defensivos acima. A evidência atual sustenta um piloto de dois turnos. Treinamento e estimativa de taxa de vitória exigem validação posterior em posições independentes.

## Variações automáticas de um final com Pegasus

O teste gera doze posições sintéticas combinando 18 ou 19 de lore adversário, um ou dois Pegasus e três recursos próprios: Robin Hood – Capable Fighter, Steel Chromicon ou Ratigan's Marvelous Trap. Cada posição roda nas mesmas três seeds da bateria. O adversário do ensaio faz quests legais até vencer ou passar. Para imprimir as escolhas e linhas executadas, use `INKWELL_ACTIVATION_TRACE=1` no comando de testes do motor.

A política examina ativações impressas oferecidas pelo motor. Confere jogador, instância, índice da habilidade e modalidade de custo antes da execução. Para pagar virando ou banindo a própria carta, exige a opção de pagamento correspondente no pedido real. A busca mantém os limites anteriores.

| Resultado até o fim da resposta | Política do commit 142a454 | Candidata |
|---|---:|---:|
| Derrotas imediatas em 36 pares | 21 | 6 |
| Pares que sobreviveram à resposta | 15 | 30 |

Quinze perdas evitadas se distribuem por cinco posições distintas. A 19 contra um Pegasus, Robin Hood deixa de fazer quest e vira para causar 1 dano. Contra dois Pegasus a 19, banir apenas um ainda deixa vitória por quest. A armadilha pode se banir para reduzir o lore adversário em 2 e sobreviver aos dois quests. Nas posições sem ameaça, a candidata repetiu a sequência original. No Work, a primeira consulta explorou de 4 a 28 transições. O teste usa o motor com entrada sintética e não estima vitória na partida completa. A bateria instalada no WSL continua fixada à sua versão até atualização explícita.

## Memória de derrotas do laboratório

A bateria pode gravar as perdas do candidato com a posição sintética completa anterior à decisão, seed, horizonte, política adversária, hashes dos módulos e do motor, placar e ações aceitas. A reprodução usa o mesmo bot e o adversário do ensaio. Exige que ambos os turnos reproduzam a sequência e o resultado salvos antes de abrir alternativas. A posição completa pertence ao executor offline; cada controlador continua recebendo a visão projetada pelo motor.

Para capturar perdas, defina `INKWELL_LOSS_DIR` ao executar a suíte acima. Para reabrir uma posição em outro processo com o mesmo bundle:

```sh
INKWELL_SPAR_ENGINE=/caminho/engine.mjs node tools/strategic_v4_sparring_lab.mjs /caminho/perdas/<hash>.json
```

O revisor varia ações, escolhas opcionais e alvos únicos oferecidos ao defensor nos seis primeiros pedidos do turno. As demais decisões seguem a política instalada. Cada alternativa vincula o prefixo à solicitação projetada e é executada no motor sem novas tentativas em caso de ação inválida. São até doze ramificações, com limite cooperativo de oito segundos por posição. O executor diário aplica ainda dezoito segundos por subprocesso e noventa por lote.

A V4 do instalador salva os checkpoints em `perdas/` no histórico da execução, o índice em `revisoes.json` e as linhas simuladas em `reports/strategic-v4/memoria-perdas/<hash>.json`. Uma execução posterior reaproveita a revisão do mesmo checkpoint. Mudanças na posição, resultado, seed, motor ou módulos produzem outro identificador.

Na validação do Work, houve 21 perdas do candidato nos 87 pares e mais uma posição diagnóstica com Angel – Experiment 624. As 22 reproduções coincidiram. A busca executou 82 alternativas. No diagnóstico, ativar Good Aim, descartar Lady e atingir Pegasus manteve o adversário a 19 após sua resposta. As demais revisões ficaram inconclusivas. O horizonte cobre a resposta de um oponente que prioriza quest. Esses resultados são hipóteses para revisar a política; o relatório não a modifica.

## Descartar uma carta para impedir o letal

A política do Sparring agora simula o custo de escolher uma carta da própria mão para descarte. O motor fornece as instâncias elegíveis. O controlador confere o pagamento completo no menu atual, assim como o alvo, e inclui a perda da carta ao comparar defesas. O piloto cobre um descarte simples em uma única parte de custo. Se várias cartas resolvem a ameaça com o mesmo placar e gasto, o desempate ainda depende da ordem de busca.

No Work, com o mesmo motor, dez posições sintéticas e as seeds 17, 309 e 20261123, a política anterior do commit 89c0fc5 perdeu 18 das 30 respostas. A nova perdeu 9. As nove mudanças vêm de três posições: Good Aim eliminou Pegasus, Max Goof com 2 de vida ou, com dois alvos e 18 de lore adversário, Lilo que faria quest por 2. Em todas as três, o bot também fez quest com Angel. Em controles com um desafio ou Robin Hood disponíveis, Lady ficou na mão. A vitória própria imediata teve prioridade. Ward, dano insuficiente e um segundo Pegasus ainda deixaram letal. As escolhas permaneceram idênticas no controle de identidades ocultas adversárias.

O caso de Angel integra a bateria pareada. Para continuar testando a memória de derrotas com uma falha real do candidato, o diagnóstico separado usa Merida's Bow e seu custo combinado de tinta e banimento do item. O revisor offline encontra essa alternativa. A política de partida ainda não a executa nessa posição.

## Escolha de descarte e conversão no próximo turno

A política reabre uma defesa com descarte único quando o defensor termina com pelo menos 15 de lore. Testa outro pagamento oferecido e exige equivalência da posição ao passar, trocando apenas as duas instâncias entre a mão e o descarte. A troca exige uma vitória executada no motor na projeção em que passar é a única ação pública do adversário. O piloto usa até quatro quests e uma carta que já era conhecida na mão própria, com pagamentos ou gatilhos forçados. Compras futuras continuam opacas. A busca adicional usa até 96 transições do orçamento original de 768, com o mesmo prazo. Se o orçamento termina, a defesa já validada tem prioridade.

O histórico de decisão registra a linha projetada em `afterPublicPass`. No próximo turno o bot volta a decidir a partir do estado real. Uma resposta da mão oculta pode mudar esse estado. O piloto ainda não estima a frequência dessa resposta.

A comparação adicional cobre dez configurações sintéticas em três seeds e termina no fim do próximo turno próprio. Duas mesas foram repetidas com a ordem da mão invertida. Com Gathering Knowledge and Wisdom ou com Alistair Krei diante de Weight Set, o candidato conservou a carta, pagou o custo real e chegou a 20 após a defesa. A V5 terminou essas linhas a 18 e 19, respectivamente. Os controles cobrem tinta insuficiente, condição de Alistair ausente, total de lore insuficiente, opção pública adversária além de passar, vitória própria imediata e letal adversário remanescente. A bateria grava a comparação de três turnos separadamente do benchmark de derrota imediata.

## Conversão diante de respostas públicas

Para trocar a carta descartada, o Sparring procura uma continuação vencedora para cada sequência de respostas oferecida pelo motor na projeção pública. Depois de pagar Good Aim, por exemplo, pode valer a pena guardar Gathering Knowledge and Wisdom se tanto passar quanto ativar um item adversário ainda permitirem chegar a 20. O diário registra as respostas e suas continuações em `publicReplies`. A decisão do próximo turno usa o estado real que resultar.

A busca examina quest, desafio, ativação e encerramento. Reconhece custos de exaurir ou banir a própria fonte, escolha de um alvo em jogo e quantidades limitadas. Se aparece outro tipo de ação, uma decisão fora do escopo ou um ramo sem vitória demonstrada, a troca proposta fica sem comprovação. Os limites são oito passos por resposta, oito opções por menu e doze respostas completas. A análise adicional pode consumir até 192 operações dentro dos mesmos 768 nós e 1.200 ms da decisão. A política preserva a defesa anterior se esgotar o orçamento. A projeção conhece as cartas da própria mão e oculta a mão adversária e as compras futuras.

Na bateria nova, três posições sintéticas foram avaliadas contra duas políticas adversárias, cada uma em três seeds. Uma política prioriza quest e passa; a outra prioriza ativar o item. Com Magic Golden Flower, Angel sem dano ou com um dano, a V6 terminou a 18 e a V7 chegou a 20 nas doze comparações. No caso de Angel ferida, o motor ofereceu curar zero ou um. Ambas as continuações e o passe foram verificados. Contra Ratigan’s Marvelous Trap, a V7 manteve a escolha da V6. Em um contrafactual separado, pagar com Lady e preservar Gathering levou a 20 após o passe e a 18 após a ativação. O horizonte termina no próximo turno próprio. A amostra mede a decisão de descarte nessas mesas e não estima taxa de vitória em partidas completas.

## Corrida de lore com vitória condicional

Quando a política anterior termina sem comprovar uma vitória contra todas as respostas públicas, o bot pode comparar novamente os descartes. Ele exige uma vitória em pelo menos uma resposta, aumento estrito do menor lore alcançado e preservação das vitórias e do lore em cada resposta correspondente. Os dois descartes precisam produzir a mesma mesa ao fim do turno defensivo e os mesmos caminhos de resposta pública. A medição considera até quatro quests e uma carta conhecida. Em cada continuação nova sem vitória, o motor também precisa concluir o turno próprio e executar o passe como única ação pública no turno adversário seguinte. Se há outra ação nesse ponto, a comparação fica inconclusiva. A comparação adicional gasta até 128 operações dentro do limite global de 768 nós e 1.200 ms. O diário registra as linhas comparadas em `conditionalProgress`, separadas das vitórias demonstradas contra todas as respostas públicas.

Na mesa sintética com Angel, Pegasus e Ratigan’s Marvelous Trap, a V8 pagou Good Aim descartando Lady. Depois de um passe, venceu a 20 com Gathering. Após a ativação da Trap, terminou a 18 com Angel em jogo. A V7 chegou respectivamente a 18 e 16 e manteve Lady na mesa ao lado de Angel. Na comparação com ativação estendida até sete turnos individuais a partir da posição, ambas venceram no sétimo. Com Gathering na mão adversária e duas tintas disponíveis, o oponente ganhou a 21 logo na primeira resposta contra ambas. A política escolheu a mesma defesa quando essa identidade oculta mudou.

A bateria do Work usou quatro configurações, três seeds e dois comportamentos de resposta por configuração. Houve 6 vitórias da V7 e 9 da V8 até o próximo turno próprio, com lore superior em 6 dos 24 pares. Os controles com tinta insuficiente, lore inicial insuficiente e conversão já assegurada com Magic Golden Flower conservaram a sequência anterior. O custo observado da escolha de Gathering foi abrir mão do corpo de Lady. A medição deixa em aberto o valor desse corpo em partidas mais longas ou contra outro adversário.

## Desenvolver a mesa depois da defesa

Se uma defesa já resolveu a ameaça com um descarte e ainda sobra tinta, a política testa jogar uma carta antes de passar. Compara a sequência anterior e os descartes oferecidos pelo motor, mantendo as outras ações defensivas. A projeção executa até três turnos próprios posteriores. Em cada um, tenta até quatro quests e uma jogada da mão conhecida. Um menu com várias jogadas próprias elegíveis, uma escolha fora do escopo ou uma ação adversária além de passar deixa a comparação inconclusiva. A política só troca a linha quando executa uma vitória mais cedo que a linha anterior dentro do horizonte. Vitórias e conversões já verificadas pela política anterior têm prioridade. O diário registra em `boardRace` as sequências examinadas. O orçamento adicional é de até 176 operações dentro dos 768 nós e 1.200 ms totais.

Com Angel e duas tintas diante de Pegasus, a 13 de lore, Good Aim removeu Pegasus. A V8 passou e baixou Lady no turno seguinte. A V9 baixou Lady no próprio turno da defesa. Ao fim de sete turnos individuais, a V8 chegou a 19 e a V9 venceu com 20. Outra execução, com o mesmo estado e seed, gastou Gathering imediatamente e terminou a 19. A 17 de lore, ambas as políticas ganharam com Gathering no próprio turno. Com Gathering na mão oculta adversária e tinta para pagá-la, o bot tomou a mesma decisão e perdeu para 21 na resposta.

Nove posições de corrida, nas seeds 17, 309 e 20261123, produziram 9 vitórias da V8 e 18 da V9 nos horizontes definidos por posição (um a sete turnos individuais). Em uma grade separada de 24 posições, com Pinocchio, Minnie e Simba, uma ou duas tintas e lore inicial de 11 a 14, as vitórias até sete turnos passaram de 7 para 9. Todas as vitórias anteriores dessa grade ocorreram no mesmo turno ou antes com a candidata. As posições são sintéticas; não medem taxa de vitória do deck.

## Usar uma defesa encontrada na revisão de derrotas

A política agora vincula o custo combinado de pagar tinta e banir a própria fonte ao pagamento oferecido no menu real. Verifica o valor pago, a identidade da fonte e o alvo. Nas oito posições com itens em três seeds, a V8 perdeu na resposta em 24 pares e a V9 em 12. Merida’s Bow e Rafiki’s Bakora Staff removeram Pegasus; o arco também removeu Max já ferido. Os controles cobrem Ward, dois Pegasus, Max sem dano e falta de tinta. A reprodução da perda histórica usa o perfil V8. A memória diária da V9 recebe apenas derrotas atuais da bateria. O avanço da revisão para a política foi implementado e testado explicitamente.
