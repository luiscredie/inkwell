# Inkwell Mobile: avaliação de riscos de propriedade intelectual para as lojas (24/11)

Pedido do Conselho: avaliação específica de riscos de PI antes de qualquer envio à App Store ou ao Google Play. Este documento reúne **fatos verificáveis e riscos técnicos de publicação**. Não é parecer jurídico: a análise jurídica fica com o titular e seus assessores.

## 1. O que o app usaria de terceiros

| Item | Origem | Onde aparece |
|---|---|---|
| Imagens das cartas (ilustrações, molduras, textos impressos) | Disney / Ravensburger | Coleção, Decks, Preços, scanner (miniaturas), comunidades |
| Nome "Disney Lorcana" e "Lorcana" | Marcas de terceiros | Textos do site, metadados da loja (se usados) |
| Nomes de personagens e de cartas | Disney | Catálogo, buscas |
| Símbolos de tinta e de coleção | Ravensburger | Filtros, pontos de cor |
| Regras do jogo (texto) | Ravensburger | Laboratório de mão, legalidade |
| "Inkwell" (nome do app) | Também é um termo do jogo (a zona de tinta) | Nome do app, ícone |

O site já declara no rodapé que é um projeto de fã, gratuito e sem vínculo com a Disney e a Ravensburger, e que as imagens e marcas pertencem a elas.

## 2. O que as lojas exigem

- **Apple, diretriz 5.2.1:** não usar material protegido de terceiros (marcas, obras com direitos autorais) sem permissão. O app deve ser enviado por quem possui ou licenciou a propriedade intelectual. Em recusas por 5.2.1, a Apple pede **prova documental** do direito de uso, anexada no App Store Connect. Há casos públicos de recusa citando especificamente material semelhante ao da Disney/Pixar sem autorização.
- **Google Play, política de PI:** proíbe apps que violem direitos autorais ou marcas. Pode exigir prova do direito de usar o conteúdo e recomenda contatar a equipe do Google Play **antes** do envio, com a autorização escrita. Declarar que o app "não é oficial" **não** basta.
- **Ambas:** um app que use o nome ou a identidade visual de outra marca de modo a parecer oficial cai também nas regras de **imitação** (impersonation).

## 3. Contexto do titular dos direitos

- **Pixelborn:** em maio de 2024, a Disney pediu que o Pixelborn, um site de fã muito popular para jogar Lorcana digitalmente, fosse retirado do ar, invocando seus direitos sobre as cartas. O criador cumpriu.
- **App oficial:** a Ravensburger mantém o app oficial "Disney Lorcana The Card Game Companion App", para gerenciar a coleção e com ferramentas de jogo. **É concorrente direto** das funções de coleção e scanner do Inkwell Mobile.
- **Sites de fã:** wikis e bancos de dados de fãs seguem no ar com avisos de não afiliação. Pelo menos um declara usar o material "sob a política do Community Code da Ravensburger", sem cobrar. **Não localizei** uma política pública de conteúdo de fã da Ravensburger que autorize expressamente apps em lojas; o Community Code público trata de conduta e, entre as violações, cita o uso não autorizado de nomes ou produtos da Ravensburger. Essa leitura precisa de confirmação jurídica.
- O site web e um app de loja têm riscos diferentes. A loja faz revisão ativa e pede documentos; no site, o risco aparece só se o titular reclamar.

## 4. Riscos por item

| Risco | Probabilidade de problema na loja | Comentário |
|---|---|---|
| Recusa na revisão por 5.2.1 / PI | **Alta** sem autorização documentada | É o motivo mais comum de recusa para apps de franquias. |
| Remoção depois de publicado (pedido do titular) | Média a alta | O precedente do Pixelborn mostra disposição de agir; o app oficial concorre com o Inkwell. |
| Uso de "Lorcana" ou "Disney" no nome ou no ícone do app | **Alta** | Evitar em qualquer caso: nome, ícone e capturas sem marcas de terceiros. |
| Conflito sobre o nome "Inkwell" | A verificar | É um termo do jogo; pesquisar registro de marca nas classes de software. |
| Diretriz 4.2 (app só embrulha um site) | Média | Não é PI, mas soma-se: o app precisa de valor nativo (scanner, uso offline, notificações). |

## 5. Opções a avaliar (decisão do titular)

1. **Pedir autorização à Ravensburger / Disney** para um app de fã gratuito, com escopo e condições por escrito. É o único caminho que atende diretamente às duas lojas.
2. **Distribuir o app fora das lojas enquanto isso:** APK direto no Android, e o site como PWA ("Adicionar à tela de início") no iOS. Não passa pela revisão das lojas, mas não elimina o risco de PI.
3. **App sem imagens oficiais nas capturas e nos metadados,** com imagens das cartas carregadas da rede só depois do login. **Não resolve** a questão de direitos; apenas reduz a exposição na revisão. Não recomendo depender disso.
4. **Adiar o envio** até haver autorização, mantendo o app como protótipo técnico (situação atual).

Recomendação técnica: tratar a **opção 1** como pré-requisito de qualquer envio às lojas e manter, enquanto isso, a opção 4 com builds de teste internos (emulador, simulador e APK de teste).

## Fontes consultadas (24/11/2026)
- Apple: App Review Guidelines, 5.2 Intellectual Property; fórum de desenvolvedores, casos de recusa por 5.2.1.
- Google Play: Policy Center, Intellectual Property.
- Ravensburger: Disney Lorcana Community Code; política de privacidade do app oficial.
- Dot Esports: pedido da Disney para retirar o Pixelborn.
- Mushu Report Wiki: aviso de não afiliação.
