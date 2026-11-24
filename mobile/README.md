# Inkwell Mobile (experimental)

Apps Android e iOS feitos com **Capacitor 8**, que abrem o site do Inkwell (`https://inkwell.com.br`) dentro de um app nativo. O site continua sendo o produto principal e nada aqui altera a versão publicada.

Status: **base experimental em PR draft.** Os apps **não foram compilados nem rodados em aparelho**; veja "O que depende de quê".

## Como usar

```bash
cd mobile
npm ci
npm run check          # verificações estáticas (sem SDK): 25 itens
npx cap sync           # copia www/ e configura os projetos nativos
npm run android        # abre no Android Studio (precisa do Android SDK)
npm run ios            # abre no Xcode (precisa de macOS)
```

`playwright.webview.config.mjs` + `webview-smoke.spec.mjs` testam as telas que o app mostra em emulação de celular (Chromium/Android e WebKit/iPhone). Isso testa o conteúdo web, não o app nativo.

## Estrutura

| Arquivo | O que é |
|---|---|
| `capacitor.config.json` | `appId br.com.inkwell.app`. Abre `https://inkwell.com.br/feed/`. Só o Inkwell e o Supabase navegam dentro do app; os outros links vão para o navegador. Sem conexão, mostra `www/offline.html`. |
| `www/` | Página "Sem conexão" (com "Tentar de novo") e uma página de entrada que só redireciona. |
| `android/` | Projeto Gradle gerado pela CLI, com: permissão de câmera (Escanear, sem exigir câmera para instalar); `allowBackup=false` e regras que mantêm a sessão fora de backups; links `https://inkwell.com.br` abrindo o app; ícones e splash do Inkwell. |
| `ios/` | Projeto Xcode gerado pela CLI (Swift Package Manager, sem CocoaPods), com texto de uso da câmera, `inkwell.com.br` como domínio vinculado (WKAppBoundDomains), ícone e splash. |
| `check.mjs` | Verificações estáticas, rodadas no CI pelo workflow `mobile.yml`. |

## B1: diagnóstico técnico

### Arquitetura atual e encaixe no Capacitor
- O site é estático, com várias páginas geradas em `site/`. Fala com o Supabase só por `fetch` (`src/site/cloud.js`) e guarda a sessão em `localStorage`. Não há framework nem build de JS. É o melhor caso para o Capacitor: **nada precisa ser reescrito.**
- Há duas formas de entregar o conteúdo:

| Opção | Vantagens | Riscos | Uso |
|---|---|---|---|
| **Remoto** (`server.url` = site publicado) | 100% do código compartilhado; atualização imediata; mesmo domínio para link mágico e passkeys; app pequeno. | Sem offline. A Apple pode ver como "site embrulhado" (diretriz 4.2). | **Base experimental (agora).** |
| **Embutido** (o site copiado no app) | Abre offline; mais "nativo". | O site tem 1,1 GB (988 MB são imagens): seria preciso embutir só o código e carregar imagens e dados da rede. A origem `capacitor://localhost` quebra passkeys e o link mágico. Versões do app ficam presas à loja. | Avaliar depois, junto com o offline. |

### Adaptações por função

| Função | Situação no app | O que falta |
|---|---|---|
| Inicialização e navegação | Abre `/feed/`. As barras superior e inferior já tratam a área segura. Teste de fumaça: 10/10. | Botão "voltar" do Android (plugin `@capacitor/app`, já instalado) ligado ao histórico. Splash definitivo. |
| Câmera e Escanear (atual e 2.0) | `getUserMedia` funciona no WKWebView (iOS 14.3+) com o texto de uso e num domínio vinculado. No Android, o Capacitor pede a permissão em tempo de uso. | Validar em aparelho: foco contínuo, lanterna e a resolução pedida (3840×2160). O OCR baixa o Tesseract de um CDN, o que conta para privacidade e para o uso offline. |
| Login por código (e-mail) | Funciona como no site (só `fetch`). | Nada. |
| Link mágico | O link abre `inkwell.com.br/entrar`. Com o intent filter, o Android oferece o app. | Publicar `/.well-known/assetlinks.json` (Android) e `apple-app-site-association` (iOS), mais o entitlement "Associated Domains". **Isso muda o site publicado e exige autorização.** |
| Passkeys | O relying party é `inkwell.com.br`, o mesmo domínio carregado pelo app. | iOS: entitlement `webcredentials:inkwell.com.br` e o arquivo AASA. Android: o WebView precisa da API de autenticação web (androidx.webkit) e do `assetlinks.json`. **A validar em aparelho.** Até lá, o login por código cobre tudo. |
| Compartilhar | O site usa `navigator.share` com alternativa. | Usar `@capacitor/share` no app (o WebView do Android não tem `navigator.share`; o compartilhamento de imagens de deck usa `files`). |
| Baixar arquivos (lista de faltantes, `.ics` de eventos, "Baixar meus dados") | São feitos com `blob` + `<a download>`, que não funciona no WebView do Android. | No app: Filesystem + Share. É uma pequena mudança no site, detectando `Capacitor.isNativePlatform()`. |
| Notificações | O site usa Web Push (`/push/sw.js`), que não funciona no WKWebView. | `@capacitor/push-notifications` com APNs/FCM e o envio pelo servidor. **Mexe em banco e segredos: exige aprovação.** |
| Armazenamento | `localStorage` persiste nos dois sistemas. O backup da sessão está desligado no Android. | Avaliar `@capacitor/preferences` para a sessão se o iOS limpar dados do WebView. |
| Offline e sincronização | Nenhum hoje. A página "Sem conexão" evita tela branca. | Fase 2: cache do catálogo e do índice do scanner (~34 MB em `data/`) e uma fila local das alterações de coleção (o site já agrupa alterações em `pending`/`flush`), com regras de conflito. Requer projeto próprio. |

### Lojas, privacidade e riscos

| Tema | Situação |
|---|---|
| Exclusão de conta dentro do app (Apple 5.1.1(v), Google Play) | **Atende:** Perfil → "Excluir minha conta". |
| Política de privacidade | `/privacidade/` existe. É preciso preencher o "Privacy Nutrition Label" (Apple) e o "Data safety" (Google): e-mail, coleção, jogos, câmera (processada no aparelho). |
| Sign in with Apple (4.8) | **Não exigido:** não há login social (só e-mail e passkeys). |
| Funcionalidade mínima (Apple 4.2) | **Risco médio:** app que só embrulha o site pode ser recusado. Mitigação: scanner 2.0, push nativo, compartilhamento nativo e offline antes do envio. |
| Marca e artes de Disney Lorcana (Apple 5.2, política de PI do Google Play) | **Risco alto.** O app exibe artes oficiais das cartas e usa o nome "Lorcana" (o site já declara que é projeto de fã, sem vínculo). As lojas costumam exigir autorização documentada do titular para conteúdo de terceiros. Precisa de análise jurídica e, se for o caso, de contato com a Ravensburger antes de qualquer envio. O nome "Inkwell" também merece verificação de marca. |
| Contas e taxas | Apple Developer Program e Google Play Console, ambos em nome do titular. |

## O que depende de quê

| Etapa | Feito aqui | Depende de |
|---|---|---|
| Gerar projetos Android e iOS | ✅ CLI do Capacitor 8.6.2 | — |
| Verificações estáticas | ✅ `npm run check`, 25/25 | — |
| Telas do app em emulação (Chromium e WebKit) | ✅ 10/10 | — |
| Compilar o APK ou AAB | ❌ | Android SDK. O download (`dl.google.com`, `maven.google.com`) é bloqueado neste ambiente. Rodar `./gradlew assembleDebug` no Android Studio. |
| Rodar no Android real | ❌ | APK compilado e um aparelho. |
| Compilar e rodar no iOS | ❌ | macOS + Xcode 16 ou mais recente + conta Apple (assinatura). Abrir `ios/App/App.xcodeproj`. |
| Links e passkeys no app | ❌ | Arquivos `.well-known` no site publicado (autorização), entitlements e chaves de assinatura. |
| Push nativo | ❌ | FCM/APNs, secrets e mudanças no servidor (aprovação). |

Nenhum teste nativo foi executado.
