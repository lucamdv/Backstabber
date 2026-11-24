# Emails transacionais da Backstabber

Fontes versionadas para Supabase Auth. A instalação dos HTMLs/assuntos no projeto compartilhado foi executada após autorização e conferida por comparação do editor após reload; consulte o [relatório de validação](validation-report.md). Credenciais SMTP não fazem parte do repositório. Instalar templates não comprova entrega em caixas externas.

| Template no Supabase | Assunto exato | Corpo HTML | Referência de texto simples |
| --- | --- | --- | --- |
| Confirm sign up | `Backstabber | Confirme sua identidade` | `supabase/templates/confirmation.html` | `supabase/templates/confirmation.txt` |
| Reset password | `Backstabber | Recupere seu acesso` | `supabase/templates/recovery.html` | `supabase/templates/recovery.txt` |

As prévias em `docs/auth/previews/` usam somente `000000`, identificado como exemplo, e `#preview`. Não devem ser instaladas como templates. O HTML de email é a fonte principal: as referências `.txt` são para revisão e para um eventual serviço de envio que aceite uma parte MIME separada. Não há configuração `.txt` inventada no `config.toml`; confira a parte `text/plain` realmente gerada pelo serviço no email recebido.

## Instalar por ambiente

1. Confirme o projeto Supabase correto antes de salvar qualquer configuração. Homologação e produção devem ter URLs explicitamente permitidas, com o caminho de retorno usado pelo aplicativo. Não use uma URL fixa de produção como fallback para a recuperação iniciada em homologação. Site URL é o padrão do provedor quando a aplicação não envia um retorno; a aplicação deve enviar o retorno do ambiente e validar sua origem. [Configuração oficial de URLs de retorno](https://supabase.com/docs/guides/auth/redirect-urls).
2. Na configuração de autenticação por email, habilite **Confirm email**. Em desenvolvimento local, use `auth.email.enable_confirmations = true`. Sem isso, o cadastro pode ser confirmado automaticamente e o template de confirmação não é enviado. [Templates oficiais do Supabase](https://supabase.com/docs/guides/auth/auth-email-templates).
3. Em **Authentication → Email Templates**, abra **Confirm sign up**, preencha o assunto da tabela e cole o conteúdo completo de `confirmation.html`. Repita em **Reset password** com `recovery.html` e seu assunto. Salve no ambiente selecionado. Alterar os arquivos locais não publica os templates no projeto hospedado.
4. Para a stack local, o `supabase/config.toml` referencia os corpos HTML e assuntos em `auth.email.template.confirmation` e `auth.email.template.recovery`. Confira a ajuda da versão instalada do CLI e reinicie a stack depois de ajustar a configuração. Capture os emails no Mailpit local; esse teste não envia a Gmail ou Outlook.
5. Configure e confira a política de senha também no provedor: mínimo de **8 caracteres**, com **maiúscula, minúscula, número e caractere especial**. O formulário deve apresentar a mesma política. O template não altera as regras de senha do servidor.

## Variáveis e destino seguro

- A confirmação mostra `{{ .Token }}` como texto selecionável. O código é emitido pelo provedor; configure **6 dígitos** no ambiente e valide com o tipo de confirmação esperado pelo aplicativo. Não gere, fixe ou valide esse código no template.
- O botão e o endereço alternativo da recuperação usam **exatamente** `{{ .ConfirmationURL }}`. Esse valor é fornecido pelo Supabase, inclui sua etapa oficial de verificação e preserva o retorno solicitado e permitido. Não substituir por `SiteURL`, `RedirectTo` ou um link próprio com `TokenHash`, não acrescentar parâmetros e não reescrever o fluxo PKCE.
- `{{ .SiteURL }}/images/isotipo.png` é usado **somente para a imagem pública da marca**, sem tokens ou dados de autenticação. Configure Site URL como uma origem HTTP(S) absoluta, sem barra final, que publique esse arquivo. Para email externo, o asset precisa estar disponível publicamente por HTTPS e responder sem login. Se o frontend do ambiente não servir esse asset ou Site URL for um deep link, substitua apenas o `src` da imagem por uma URL absoluta de asset público aprovada para aquele ambiente. Não invente domínio e não use `file:`, caminho relativo ou imagem em base64 nos emails instalados. Em projetos Auth compartilhados, um asset público de produção é aceitável; isso não autoriza enviar o retorno de autenticação para produção.
- A marca continua legível em texto quando imagens remotas são bloqueadas. O código, o botão e todas as instruções permanecem em texto HTML.
- As variáveis oficiais incluem `Token`, `TokenHash`, `ConfirmationURL`, `RedirectTo` e `SiteURL`; não existe uma variável oficial de expiração usada neste HTML. A confirmação exibe **60 minutos**, correspondentes ao `auth.email.otp_expiry = 3600` versionado na configuração local. **Antes de instalar o template hospedado, conferir/configurar também 3600 segundos nesse projeto**. Se a duração for diferente, alterar a cópia e o teste juntos, antes de publicar. O valor hospedado ainda precisa de conferência; não tratar este arquivo como prova de sua configuração. [Variáveis oficiais](https://supabase.com/docs/guides/auth/auth-email-templates).

## Recuperar acesso e cadastrar primeira senha

O mesmo template de recuperação atende quem esqueceu a senha e quem entrou inicialmente com Google e quer cadastrar uma senha para sua identidade existente. A mensagem não afirma que uma senha anterior existe. O aplicativo deve solicitar a recuperação pelo provedor e apresentar a mesma resposta pública para endereços existentes e inexistentes; o template não consulta nem expõe cadastro. A senha nova só pode ser salva após a recuperação oficial validar o acesso à identidade.

Não abra links reais de recuperação para produzir capturas de tela. Não registre OTP, link completo, `code`, `token`, `token_hash`, senha, verifier PKCE ou credenciais SMTP em relatórios, analytics, prints, fixtures ou logs. Valide host/caminho/tipo do retorno sem copiar valores de credenciais. Previews estáticas nunca comprovam autenticação.

## SMTP e domínio remetente

Configure o SMTP no servidor de Auth/painel do Supabase: host, porta, usuário, senha do provedor, endereço remetente aprovado e nome `Backstabber`. O proprietário deve fornecer esses valores pelo canal de segredos do ambiente. Não colocar credenciais em `VITE_*`, no JavaScript do navegador, HTML de email, commits ou documentação. Configure SPF, DKIM e DMARC conforme os registros fornecidos pelo serviço de envio; confira também a verificação do domínio e as cotas aplicáveis. Desabilite reescrita/rastreamento de links de autenticação no serviço de envio. [SMTP oficial e entregabilidade](https://supabase.com/docs/guides/auth/auth-smtp), [comportamentos de clientes de email](https://supabase.com/docs/guides/auth/auth-email-templates).

O SMTP padrão do Supabase tem restrições e serve a exploração/testes autorizados; não presumir envio para destinatários arbitrários ou entrega em produção. SMTP próprio, DNS e envio real precisam de validação separada.

## Validar antes de liberar

Use contas de teste controladas pelo responsável. Para cada ambiente, registre somente resultado, cliente e data; omita dados de autenticação.

| Validação | Evidência necessária | Situação inicial |
| --- | --- | --- |
| Prévia de confirmação e recuperação | Layout desktop e móvel, textos exatos, exemplo identificado e recuperação sem destino ativo | Arquivos locais disponíveis; verificar visualmente |
| Imagens bloqueadas | Código, marca, instruções e CTA compreensíveis sem carregar imagem | Validar no cliente |
| Mailpit local | Assunto, HTML e texto realmente recebidos; confirmação OTP e recuperação em fluxos separados | Pendente até executar a stack local |
| Destino por ambiente | Recuperação iniciada no ambiente retorna ao mesmo ambiente pelo fluxo oficial | Pendente de teste integrado |
| Código correto/incorreto/expirado | Aceitação apenas pelo provedor; reenvio e mensagens adequadas | Pendente de teste integrado |
| Recuperação usada/expirada e Google sem senha | Sessão de recuperação válida antes de definir senha; nova senha obedece à política | Pendente de teste integrado |
| Gmail desktop e móvel | Envio SMTP real, renderização, preheader, imagem, CTA, texto alternativo, caixa de entrada/spam | Pendente de envio real |
| Outlook web e desktop | Envio SMTP real, tabelas/botão, quebra de URL, imagem bloqueada e modo escuro | Pendente de envio real |
| Domínio remetente | SPF/DKIM/DMARC e autenticação dos cabeçalhos no email recebido | Pendente de SMTP/DNS |

O layout usa tabelas de apresentação, largura fluida até 600 px, estilos inline, fontes do sistema, cor de fundo também em `bgcolor` e um contêiner condicional para Outlook clássico. Não usa JavaScript, fontes externas, SVG ou imagens para informação essencial. Esses cuidados são de implementação, não uma certificação de compatibilidade: Gmail/Outlook podem alterar cores e bloquear imagens, e somente o recebimento nesses clientes encerra a validação.
