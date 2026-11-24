# Arquivos de associação de domínio (preparados, NÃO publicados)

Modelos para `https://inkwell.com.br/.well-known/`. Ficam fora de `site/` de propósito: nada aqui vai ao ar.
Publicar só com autorização, num PR próprio, depois de preencher:

- `apple-app-site-association`: trocar `TEAMID` pelo Team ID da conta Apple Developer do titular.
- `assetlinks.json`: trocar a impressão digital pela SHA-256 da chave de assinatura de **release** do Android
  (`keytool -list -v -keystore <release.keystore>`), ou pela chave da Play App Signing, se for usada.

Contexto e ordem dos passos: `docs/mobile-dominios.md`.
