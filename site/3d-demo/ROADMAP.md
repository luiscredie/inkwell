# Inkwell 3D Demo — Roadmap de evolução

> **Ambiente isolado:** toda a implementação vive em `site/3d-demo/`. Este projeto é demonstrativo, sem Supabase, autenticação, mudanças de schema ou alteração das telas produtivas do Inkwell. Link: https://luiscredie.github.io/inkwell/3d-demo/

## Princípios
1. **Arte real primeiro:** usar o logo do próprio Inkwell e cartas do catálogo publicado em `site/lorcana-card-images/images/`. Nunca mostrar uma carta fictícia sob o nome de uma carta real.
2. **Mágico, mas útil:** profundidade e movimento ajudam a compreender/valorizar a coleção; evitar efeitos que dificultem leitura.
3. **Mobile desenhado, não encolhido:** navegação inferior, toque e consumo de memória controlado.
4. **Demo sem efeitos colaterais:** botões operam sobre dados efêmeros da sessão; sem escrever dados pessoais no backend.
5. **Acessível e resiliente:** `prefers-reduced-motion`, navegação por teclado, fallback visível e mensagens honestas quando uma imagem estiver ausente.

## Roadmap executável

| Etapa | Entrega | Critério de aceite | Estado |
|---|---|---|---|
| P0.1 | Isolamento e documentação | Nenhum arquivo fora de `site/3d-demo/` modificado; roadmap e teste documentados | Concluído |
| P0.2 | Assets próprios do site | Logo local relativo e URLs locais oficiais das cartas, fallback sem carta conceitual errada | Implementado — validar em Pages |
| P0.3 | Primeira interação de destaque | Alternar Grade / Fichário, virar páginas e abrir detalhes de cartas | Implementado — validar em navegador |
| P1.1 | Fichário cinematográfico | Abertura da capa, páginas com transição, 24 cartas de exemplo e gesto horizontal no mobile | Implementado — falta teste visual publicado |
| P1.2 | Carta protagonista | Detalhe ampliado, frente/verso conceitual, foil demonstrativo, luz responsiva e atalhos acessíveis | Implementado — falta teste visual publicado |
| P1.3 | Feed com narrativa | Hero com entrada escalonada, reflexos móveis e cartões de publicações em sequência | Implementado — falta teste visual publicado |
| P2.1 | Deckbuilder 3D | Drag/drop acessível, agrupamento visual, curva calculada sobre deck de exemplo | Planejado |
| P2.2 | Faltando e trocas | Comparação visual de coleção desejada / duplicadas, fluxo simulado de proposta | Planejado |
| P2.3 | Amigos, mural e perfil | Componentes sociais consistentes, microinterações e estados vazios | Planejado |
| P3.1 | Mobile first polido | Layout mobile próprio, botões tocáveis, sem scroll horizontal inesperado | Planejado |
| P3.2 | Performance e inclusão | LCP e FPS aferidos, lazy loading, redução de movimento, auditoria por teclado | Planejado |
| P4 | Decisão de produto | Revisão com conselho, teste com usuários, estimativa para migração opcional | Planejado |

## Checklist de verificação
- [ ] A URL pública carrega e exibe conteúdo sem tela preta (desktop e mobile).
- [ ] O logo oficial em `../ui/assets/logo.svg` aparece.
- [ ] As 24 cartas de amostra apontam para `../lorcana-card-images/images/` com imagens correspondentes.
- [ ] Uma carta ausente mostra placeholder **sem arte de outra carta**.
- [ ] A navegação entre Feed, Coleção, Decks, Faltando, Amigos, Mural e Perfil funciona.
- [ ] Grade e Fichário alternam; a capa abre, a página vira e o gesto horizontal avança/volta.
- [ ] Clique e tecla Enter abrem os detalhes; Escape fecha; efeito foil e frente/verso respondem.
- [ ] `prefers-reduced-motion` desliga movimentos de decoração.
- [ ] Mobile 375 px: header, fichário e menu inferior utilizáveis.
- [ ] Comparar com telas conceituais em desktop, mobile, modo claro/escuro não exigido.

## Regras de release
- Manter o conteúdo e os componentes experimentais em `site/3d-demo/`.
- Não alterar `site/feed/`, `site/colecao/`, `site/decks/`, `site/ui/`, `site/data/`, Supabase nem políticas de acesso nesta iniciativa.
- Uma fase só é considerada *validada* após teste de navegador no build publicado, não apenas após commit ou sintaxe válida.
- Os números no protótipo são dados ilustrativos, não métricas de contas reais.

## Critério de WOW
A sessão da Coleção deve provocar descoberta: fichário com identidade própria, cartas oficiais legíveis, página virando, detalhe atraente e gesto intuitivo. O objetivo não é apenas mais brilho; é uma experiência visual singular que serve às tarefas do colecionador.

## Implementação P1 — 05/11/2026

**Incluído em** `index.html` e `experience.css`, exclusivamente na pasta da demo:
- Capa do fichário com ação de abertura; animação de abertura e fechamento.
- Galeria de 24 cartas de amostra referenciando nomes reais do acervo; duas páginas de 12 cartas por abertura.
- Virada com perspectiva, estados de controle (não avançar além do fim), gesto horizontal no celular e respeito ao movimento reduzido.
- Spotlight com tamanho ampliado, iluminação que acompanha o mouse, simulação de folha brilhante e verso gráfico claramente ilustrativo (não corresponde à carta física).
- Feed com entrada progressiva de conteúdo, reflexos e outras cartas oficiais em destaque.

### Riscos e verificação necessária
O teste de sintaxe JavaScript passou; **isso não equivale a validação de navegador**. O acesso HTTP externo a GitHub Pages não está disponível no ambiente de teste atual. É necessário verificar as 7 páginas, 24 imagens e animações em desktop/mobile após o deploy. O primeiro livro é uma demonstração com dados inventados de progresso, não o fichário de uma conta real. O efeito foil não representa o acabamento real da impressão.

### Teste manual de P1
1. Abra /3d-demo/ após GitHub Actions publicar o último commit; entre em Coleção.
2. Clique em **Abrir meu fichário**, confira a capa girando e 12 cartas corretas.
3. Clique em **Próxima** e confira a segunda página com 12 cartas diferentes; depois **Anterior**.
4. No celular, deslize horizontalmente sobre o livro; teste a navegação inferior.
5. Clique em qualquer carta, movimente o cursor, teste foil, verso, relação com outras cartas e Escape.
6. Entre em Feed, mude slides, verifique entradas dos cartões e os controles do carrossel.
7. Ative **reduzir movimento** no dispositivo e confirme que o conteúdo permanece operável.
