# Valida�ao - 20/11/2026

Base: extensao local instalada 0.8.12; upload GitHub preservado sem mudan�as. Reposit�rio main em bfdc225d9737380b2346fc462fd807ec04381641. A extensao ainda nao estava versionada na main; esta entrega adiciona sua fonte em tools/ligalorcana_extension.

Passaram os sete arquivos de testes Node: test_commands, test_daily, test_recovery, test_v0810, test_v0811, test_v0812 e test_worker. Cobrem captura e identidade, m�dia acima do m�ximo, URLs LOR1/LOR2/LOR12/DLPC1, recupera�ao preservando cursor, CAPTCHA e agendamento (fuso Sao Paulo, duplica�ao, pausas, erros de backup e in�cio, simula�ao sem muta�oes).

Scripts PowerShell analisados pelo parser. Install-DailyTask.ps1 -DryRun executado no Windows PowerShell 5.1 com perfil Default existente e ID de extensao fict�cio, gerando e analisando o mesmo XML usado na instala�ao: di�rio �s 00h03, pr�xima ocorr�ncia futura, InteractiveToken, privil�gio limitado, IgnoreNew. Invoke-DailyTask.ps1 -DryRun tamb�m executado: argumentos do mesmo perfil e URL interna conferidos, sem abrir Chrome.

Nao houve registro de tarefa, reload da extensao instalada, navega�ao de coleta, requisi�ao � LigaLorcana, upload de pre�os, merge ou altera�ao do live. A abertura da URL interna no Chrome e a execu�ao real pelo Agendador exigem a instala�ao no perfil do usu�rio; nao foram testadas ponta a ponta nesta entrega. O sandbox nao disponibiliza CIM do Agendador para um teste real de registro.

Para repetir testes: execute `node test_daily.js` e os demais `test*.js` nesta pasta. Use os comandos -DryRun de INSTALL.md para testar instala�ao sem coletar.

Corre�ao 0.8.14: needs_review encerrado no dia anterior permite novo lote ap�s backup e arquivo de pend�ncias; mesmo dia aguarda. Testados erro de backup, arquivo de Sleepy pendente, simula�ao sem escrita e passagem de dia. Nenhum pre�o marcado como v�lido artificialmente.
