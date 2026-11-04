# Evidências — Visão geral do deck (Etapa B)

Geradas por `OV_EVIDENCE=1 npx playwright test tools/overview.spec.mjs` (Chromium, servidor local, catálogo e artes reais, Supabase falso).

- `vertical-1080x1350`, `horizontal-1920x1080`, `muitas-cartas-v-{1,2,3}` e `muitas-cartas-h-{1,2}` (deck com 60 impressões diferentes), `arte-faltando-vertical`: as imagens que o botão **Baixar** entrega. O site gera **PNG**; aqui estão em JPEG só para o repositório ficar leve. Os testes conferem o PNG baixado (assinatura, IHDR com 1080×1350 / 1920×1080) e leem o QR de volta com jsQR.
- `celular-{320,360,390,430}-tela-inicio` e `-tela-fim`: a tela do celular como ela é (captura da janela, com a barra do topo fixa e a barra de abas embaixo), no começo e no fim da seção.
- `celular-390-folha`: a folha "Compartilhar imagem do deck". `computador-1280`: a seção no computador. `perfil-390-deck-destacado`: o perfil aberto pelo QR, com o deck destacado.
- Capturas da página no tema claro do navegador de teste.

Sobre as barras sobre as cartas nas capturas anteriores: eram artefato da captura de um elemento mais alto que a tela (o Playwright junta a página e as barras fixas aparecem no meio). Na tela real a barra do topo fica no topo, a de abas embaixo, e o fim da seção fica acima da barra de abas (há teste para isso).

Não substitui o teste em iPhone e Android reais (a fazer pelo Luís).
