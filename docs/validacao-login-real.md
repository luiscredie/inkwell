# Validação do login real (código por e-mail)

Os testes automáticos do repositório usam um Supabase **simulado**: eles provam a lógica da página, não o login real.
Este roteiro valida o caminho real. Ele **grava dados reais** no Supabase de produção (uma conta nova, um deck, um perfil),
então use um e-mail de teste e apague a conta no fim (Perfil → Seus dados → Excluir conta).

Antes de começar, anote em **Supabase → Authentication → Sign In / Providers → Email**:
- **Email OTP Length** (6 a 10). O site aceita de 6 a 10 dígitos e nunca corta o código.
- **Email OTP Expiration** (validade do código).

## A. Deck sem cadastro → conta → deck salvo (computador)
1. Janela anônima. Abra o site → **Testar um deck sem cadastro** → **Experimentar com um deck de exemplo**.
   Esperado: cartas, "legal"/"ainda não legal", estimativa de custo.
2. Recarregue a página. Esperado: a lista continua lá (fica 1 dia neste navegador).
3. **Criar conta e salvar** → digite o e-mail de teste → **Enviar código**.
4. No e-mail: confira que o número de dígitos é igual ao "Email OTP Length".
5. **Código errado**: digite um número a menos e aperte Entrar. Esperado: "Esse código não vale…", o que você digitou continua no campo.
6. **Colar o código inteiro**: copie o código do e-mail e cole no campo. Esperado: entra sozinho, sem cortar dígitos.
7. Esperado depois de entrar: a mesma página Decks, com o aviso "Você tem uma lista de antes de entrar" e a janela de
   salvar **já aberta**. Dê um nome e **Salvar**. Esperado: o deck aparece na lista; o aviso some.

## B. Código expirado e reenvio
1. Saia da conta. **Entrar** → e-mail → **Enviar código**. Espere passar a validade do código.
2. Digite o código vencido. Esperado: "Esse código não vale: está errado, expirou ou já foi usado".
3. Espere o contador de 60 s → **Mandar outro código**. Esperado: "Mandamos um código novo"; o campo fica vazio.
4. Use o código **novo**. Esperado: entra. (O código antigo não deve mais funcionar.)

## C. Link do e-mail aberto em outra aba
1. Saia. Janela anônima → **Criar meu perfil** → preencha nome, tintas e uma carta → **Criar conta e salvar** → e-mail.
2. No e-mail, **toque no link** ("Ou toque aqui para entrar") em vez de usar o código. Abre outra aba em /entrar/.
3. Na aba nova: aperte **Entrar no Inkwell**. Esperado: ela volta para "Criar meu perfil" e diz
   "Volte para a aba onde você começou para salvar suas alterações" (o rascunho do perfil fica só na aba original).
4. Volte à aba original. Esperado: ela recarrega sozinha, já com conta, e salva o perfil (perfil começa **privado**).

## C2. Deck com o link em outra aba
1. Repita A até o passo 3 e, no e-mail, use o **link** em vez do código.
2. Na aba nova: **Entrar no Inkwell**. Esperado: volta para Decks, com a lista e a janela de salvar já abertas
   (a lista fica no navegador por 1 dia, então as duas abas a enxergam).

## D. Celular (iPhone e Android)
1. No celular, faça o roteiro A.
2. Com o e-mail no **app Mail da Apple** (iOS 17+): ao tocar no campo do código, o iPhone deve sugerir o código acima do teclado.
   Tocar na sugestão deve entrar sozinho. No app do Gmail/Outlook não há sugestão: copie e cole (também entra sozinho).
3. Faça o roteiro C abrindo o link pelo app de e-mail. Se o link abrir dentro do app de e-mail (navegador interno),
   a sessão **não** chega ao Safari/Chrome: use o código. Anote o que aconteceu.
4. Confira que tocar nos campos não dá zoom na página.

## O que anotar
Para cada passo: aparelho, navegador, app de e-mail, tamanho do código, resultado esperado × real, captura de tela se falhar.
