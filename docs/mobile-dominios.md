# Inkwell Mobile: domínios, links mágicos e passkeys (auditoria de 24/11)

Pedido do Conselho: auditar domínios associados, links mágicos e passkeys, distinguindo **WKAppBoundDomains** de **Associated Domains**. Preparar os arquivos de associação, **sem publicá-los**.

## 1. Os dois mecanismos do iOS não são a mesma coisa

| | WKAppBoundDomains | Associated Domains |
|---|---|---|
| Onde fica | `Info.plist` do app (já configurado: `inkwell.com.br`) | Entitlement `com.apple.developer.associated-domains` no app **e** o arquivo `/.well-known/apple-app-site-association` (AASA) no site |
| Para que serve | Limita a quais domínios o WKWebView navega e onde a ponte JavaScript pode agir. Habilita recursos restritos, como service workers no WKWebView. | Liga app e site: **Universal Links** (`applinks:`, um link do site abre o app) e **credenciais** (`webcredentials:`, senhas e **passkeys**). |
| Precisa de conta Apple? | Não | Sim: Team ID, App ID com a capacidade e perfil de provisionamento |
| Mexe no site? | Não | Sim: publicar o AASA (**exige autorização**) |
| Situação | Feito | Arquivo preparado, não publicado (seção 4) |

Ter `inkwell.com.br` em WKAppBoundDomains **não** habilita passkeys nem Universal Links. Para passkeys num WKWebView, a Apple exige que o identificador do relying party esteja nos Associated Domains do app, no serviço `webcredentials`. Sem isso, a requisição falha.

## 2. Android: o equivalente

| | Situação |
|---|---|
| App Links (`https://inkwell.com.br` abre o app) | Intent filter com `autoVerify` já está no manifesto. Só é verificado com `/.well-known/assetlinks.json` publicado com a impressão digital SHA-256 da chave de assinatura (arquivo preparado). |
| Passkeys no WebView | O WebView passou a suportar o Credential Manager a partir da biblioteca 1.12.0. O app precisa chamar `setWebAuthenticationSupport()` e associar app e site por Digital Asset Links (`assetlinks.json`). **Ainda não implementado:** é uma mudança nativa pequena, mas só pode ser validada com o `assetlinks.json` no ar. |

## 3. O que acontece hoje em cada alvo

| Fluxo | dev (site remoto) | release (cópia embarcada) |
|---|---|---|
| Origem da página | `https://inkwell.com.br` | `https://localhost` (Android) / `capacitor://localhost` (iOS) |
| **Login por código** (6 dígitos por e-mail) | Funciona: só `fetch` ao Supabase | Funciona: só `fetch`. **É o caminho seguro para o app.** |
| **Link mágico** | `redirect_to` = página atual em `inkwell.com.br`. O link do e-mail abre `inkwell.com.br/entrar/?h=…`: no navegador, ou no app com App Links / Universal Links. | `redirect_to` seria `https://localhost/…`, que não é um destino permitido no Supabase; o link do e-mail leva ao site. **Sem App Links, o login acontece no navegador, não no app.** Com App Links, o app precisa tratar o evento `appUrlOpen` e abrir a cópia local de `entrar/index.html?h=…` (não implementado). |
| **Passkeys** | Possíveis depois dos Associated Domains (iOS) e do Credential Manager mais `assetlinks.json` (Android), porque a origem é o próprio domínio do relying party. | **Não funcionam como estão:** a origem `localhost` não corresponde ao relying party `inkwell.com.br`. Exigiria passkeys nativas via plugin (ASAuthorization / Credential Manager) ligadas ao WebView. |
| Links para compartilhar (perfil, decks, convites) | `inkwell.com.br/...` corretos | Montados com `location.origin`: sairiam como `https://localhost/...` (17 ocorrências encontradas no pacote). Precisam usar a origem canônica `https://inkwell.com.br` dentro do app. |

## 4. Arquivos preparados (não publicados)

Ficam em `docs/mobile-well-known/`, fora de `site/`, para não irem ao ar por engano. Para publicar, copiar para `site/.well-known/` num PR próprio, **com autorização**.

- `apple-app-site-association`: `applinks` para `/entrar/*`, `/decks/*`, `/perfil/*` e `/comunidades/*`, mais `webcredentials`. Falta o **Team ID** da conta Apple do titular (`TEAMID` no arquivo).
- `assetlinks.json`: `delegate_permission/common.handle_all_urls` (App Links) e `common.get_login_creds` (passkeys e senhas). Falta a **impressão digital SHA-256** da chave de assinatura de release. A chave de debug do CI serve só para testes e não deve ir para produção.

Requisitos para publicar: servidos em HTTPS, sem redirecionamento, `application/json`, no caminho exato `/.well-known/…`. Conferir se o GitHub Pages serve a pasta `.well-known` (ela começa com ponto; pode exigir `.nojekyll` ou ajuste no gerador do artefato do Pages).

## 5. Ordem sugerida

1. **App com login por código apenas** no release (já funciona). O link mágico abre o navegador, e isso fica dito na tela de login do app.
2. Origem canônica nos links compartilhados quando rodar no app (mudança no site: detectar `Capacitor.isNativePlatform()`).
3. Publicar `assetlinks.json` e AASA (autorização), configurar o Associated Domains com a conta Apple e tratar `appUrlOpen` para o link mágico.
4. Passkeys no app: avaliar depois do passo 3, com teste em aparelho real.
