# Evidências — Visão geral do deck (Etapa B)

Geradas por `OV_EVIDENCE=1 npx playwright test tools/overview.spec.mjs` (Chromium, servidor local, catálogo e artes reais, Supabase falso).

- `vertical-1080x1350`, `horizontal-1920x1080`, `muitas-cartas-*`, `arte-faltando-vertical`: as imagens que o botão **Baixar** entrega. O site gera **PNG**; aqui estão em JPEG só para o repositório ficar leve. Os testes conferem o PNG baixado (assinatura, IHDR com 1080×1350 / 1920×1080) e leem o QR de volta com jsQR.
- `celular-*-previa`, `celular-390-folha`, `computador-1280`: a seção na página (tema claro do navegador de teste).

Não substitui o teste em iPhone e Android reais (a fazer pelo Luís).
