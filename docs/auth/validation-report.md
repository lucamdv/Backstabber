# Autenticação unificada — relatório de validação

Data: 23/11/2026. **Implementação local concluída; aceite hospedado condicionado aos testes externos abaixo.** Nenhum envio real foi realizado para o endereço anteriormente informado. O responsável informou que configurou SMTP, corrigiu e confirmou a grafia do destinatário controlado. O endereço não é versionado neste relatório.

## Implementação por branch

| Branch | Backend preservado | Alteração |
| --- | --- | --- |
| `main` | Node, schema público e tópicos existentes | Terminal de seis vistas, cadastro/OTP, senha, Google, recuperação, retorno PKCE e proteção de logs; validação de email confirmado no Node |
| `feature/av3-sprint-03-spring-boot` | Java autoritativo, `bs_staging`, canais `hml:*` e build guard | Mesmo frontend e proteção Node comum; confirmação confiável também no Spring |

O checkout main parte do release remoto `f5c38d2bd0a898f3df8ef3a7f784b33d40f537d1`. Na branch Java, o commit local legítimo de documentação `85e7bc1` foi preservado e os commits remotos `17ac18a` e `c13adc5` foram incorporados pela sincronização da **mesma branch**, commit `ea01400`. Não houve integração entre main e Java nem publicação de produção.

Não há tabela paralela de senhas, associação manual por email, alteração do motor, migration nova, alteração de RLS ou cópia de dados. UUID vem do Supabase. Os backends consultam `/auth/v1/user` por requisição e recusam confirmação ausente/inválida, identidade anônima e metadata falsa. A nova composição de senha só se aplica ao cadastro/atualização, preservando senhas antigas no login.

## Testes automatizados

| Execução | Resultado e limites |
| --- | --- |
| Web/Node da branch Java, suíte completa | **187 aprovados; 8 opcionais de PostgreSQL nativo omitidos** |
| Web/Node da main, suíte completa com `--maxWorkers=1` | **171 aprovados; 8 opcionais de PostgreSQL nativo omitidos** |
| Ajustes finais do controller/transporte/Hub Java | **22 aprovados** |
| Browser visual `auth-terminal.spec.ts` | **8 aprovados**, Chrome, seis vistas em 360×800, 390×844, 1366×768 e 1920×1080; APIs e controller simulados explicitamente |
| Regressão visual de identidade 390×844 | **1 aprovado**; outros cenários visuais do jogo não foram repetidos nesta alteração |
| Java completo, PostgreSQL descartável + paridade Node habilitados | **119 executados: 118 aprovados e 1 timeout ao iniciar processo filho**; nenhuma omissão nessa execução |
| Java focado após sincronizar commits de configuração | **29 aprovados**, zero falhas/omissões: `MatchPersistenceTest`, `DatabaseConfigurationTest`, `SupabaseAuthenticatorTest`, `FoundationHttpTest` |
| Builds Vite das duas branches | Aprovados; aviso existente de chunk acima de 500 kB, sem ocultar o aviso |

Histórico preservado: a primeira execução Java sem os flags de fixture tentou usar uma URL local inexistente e falhou na preparação do contexto. Com `BACKSTABBER_TESTCONTAINERS=true` e `BACKSTABBER_NODE_PARITY=true`, o banco foi exercitado; o único cenário que falhou aguardou 30 s pelo início de um processo filho. A repetição focada passou nos 13 testes de persistência, incluindo os sete checkpoints de reinício. Não foi alterado o timeout do teste para mascarar falha. A execução web concorrente da main também teve um timeout de 5 s na presença da arena; ele não ocorreu na execução final com um worker. Um fixture de broadcast foi corrigido para aguardar a inscrição, em vez de enviar para um callback ainda ausente.

## Prova real Supabase local / Mailpit

CLI **3.1.0**, projeto descartável `auth-email-proof`; API `127.0.0.1:55441`, PostgreSQL `55442`, Mailpit `55444`. Google desabilitado, sem migrations/seed do jogo, sem SMTP externo. Configuração efetiva inspecionada em memória: confirmação obrigatória, OTP de seis dígitos/3600 s e política mínima 8/quatro categorias. A fixture usa intervalo de envio de 1 s e cotas próprias, exclusivamente para os testes locais; o produto mantém cooldown/intervalo de 60 s.

`test-auth-email-local.ps1`: **25 verificações reais aprovadas**. Incluem rejeição de senha curta/incompleta; signup sem sessão; login não confirmado recusado; HTML personalizado recebido; OTP incorreto/correto/reutilizado; login e `getUser` com o UUID original; link oficial de recuperação → HTTP303 → código PKCE; troca HTTP200 e evento `PASSWORD_RECOVERY`; replay do código recusado; `updateUser` HTTP200 mantendo UUID; senha antiga recusada/nova aceita; refresh preservando UUID; logout204; refresh revogado recusado; recuperação genérica para conta inexistente sem email.

`test-auth-email-browser.ps1`: **17 verificações reais aprovadas** com `AuthTerminal`, `auth.ts`, navegador Chrome e SDK sem substituição. Confirma signup/OTP, bloqueio antes da confirmação, restauração após F5, login por senha, link real de Mailpit, preservação de `online=salas&auth=recovery`, retorno PKCE, formulário autorizado, atualização200, saída da sessão e login com nova senha no mesmo UUID. **Somente as APIs do jogo foram simuladas nesse browser**; esse resultado não comprova uma nova integração HTTP Java/Node com o Supabase real. Essa fronteira é exercitada separadamente pelos testes de backend com Auth simulado.

O primeiro startup do PostgreSQL da fixture expirou; o segundo terminou saudável. A primeira tentativa do browser não concluiu a abertura do cadastro; uma nova execução com etapas sanitizadas passou integralmente, sem mudar a lógica do produto. Não aguardamos os 60 minutos de validade para comprovar expiração temporal. Não capturamos sessões, senhas, códigos, URLs de recuperação, cookies ou conteúdo de caixas pessoais. Capturas versionadas usam apenas exemplos fictícios.

## Identidade: evidência e pendências

| Cenário | Evidência atual |
| --- | --- |
| Email → confirmação → recuperação → senha nova | **Real local:** UUID original preservado em todos os passos |
| Google → primeira senha | Mecanismo oficial implementado (`resetPasswordForEmail`, `PASSWORD_RECOVERY`, `updateUser`); **teste com Google verdadeiro pendente** |
| Email confirmado → Google do mesmo email | Delegado à vinculação automática oficial do Supabase; **teste com Google verdadeiro pendente** |
| Alternância Google/senha e ausência de perfil duplicado | Backends aceitam o mesmo UUID confirmado independentemente do método nos testes; **prova hospedada com dados de staging pendente** |
| Emails diferentes | Sem API de vinculação manual e sem comparação/merge por email na aplicação |
| Troca concorrente de conta durante alteração de senha | Testes do controller e transporte recusam alteração para bearer diferente |
| Voltar ao menu durante recuperação | Contexto em memória preservado com o cliente e vinculado ao UUID; teste de desmontagem/remontagem aprovado |

Não confundir preservar UUID no fluxo real de senha com comprovar os dois sentidos do Google. A documentação oficial explica que signup sobre uma conta OAuth existente pode retornar usuário ofuscado sem enviar confirmação; a interface utiliza uma instrução genérica e oferece definição/recuperação explícita, sem alegar descoberta de conta. [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)

## Auditoria hospedada e ajustes autorizados

Vercel: projeto existente `backstabber-homologacao`; overrides exclusivos de Preview/branch Java presentes: schema `bs_staging`, API `https://backstabber-java-staging.onrender.com/api/v1` e `DATABASE_URL` vazio. Deploy anterior `c13adc5242ed0766c0830869e3bca91bf58e7932` estava READY na consulta. Isso não representa deploy desta implementação. Render: serviço existente `backstabber-java-staging`, plano free, mesma branch, auto deploy desligado. Nenhum recurso foi criado/alterado nesta tarefa.

Auditoria inicial no Dashboard Supabase: Google e Email habilitados, confirmação obrigatória habilitada, usuários anônimos e linking manual desabilitados. OTP estava em **8 dígitos**, diferente do contrato solicitado. Validade observada: **3600 s**. A Site URL era `https://backstabber.vercel.app`; a allowlist incluía produção e previews AV2, mas não a URL estável da branch Java. Pela configuração exibida, um retorno não permitido cai em Site URL, explicando o redirecionamento indevido.

Após aprovação explícita do responsável, foi adicionada **somente** `https://backstabber-homologacao-git-feat-6522ba-luca-monteiros-projects.vercel.app/**`; o painel confirmou a adição de uma URL. Site URL e seis retornos existentes foram preservados. OTP foi alterado para **6 dígitos**, mantendo **3600 s**. O mínimo **8** e o preset **maiúscula/minúscula/número/símbolo**, previamente aceito pelo responsável, foram preenchidos/salvos. O preset e OTP foram conferidos ao reabrir o formulário; o painel mascara o campo de mínimo no canal textual de automação.

Os HTMLs e assuntos de confirmação e recuperação foram instalados. Após recarregar cada página, o conteúdo integral do editor foi comparado em memória à fonte versionada, normalizando apenas CRLF/LF: **ambos idênticos**. Não foram lidos nem alterados os segredos SMTP ou Google. Captura gráfica desse painel não foi obtida: a interface de screenshot do Chrome expirou; a conferência usou os controles visíveis e a cópia do editor, sem registrar credenciais.

## Gate de publicação e validação externa

- **Concluído:** grafia do destinatário corrigido confirmada; endereço anterior excluído do teste.
- **Concluído:** retorno restrito Java e OTP6 aplicados após autorização, preservando Site URL e allowlist existente.
- **Configurado:** mínimo8/quatro categorias; confirmar a rejeição efetiva pelo provedor durante o ensaio controlado, sem bloquear login de senhas antigas.
- **Concluído:** dois templates e assuntos instalados, conteúdo persistido idêntico às fontes; validade observada de 3600 s.
- Verificar SMTP configurado pelo responsável, domínio remetente, SPF/DKIM/DMARC, rastreamento de links desativado e entrega real controlada.
- Publicar somente o Preview autorizado e atualizar o Java de staging de forma explícita, se necessário; main não deve ser enviada automaticamente.
- Executar Google → primeira senha e email → Google com contas controladas, comparar UUID sem divulgar seu valor, conferir perfil/amigos/salas de staging e repetir troca de método.
- Conferir produção e Preview retornando a seus próprios domínios, inclusive convite; validar link inválido/expirado e entrega Gmail/Outlook.

**Veredito atual: PASS para implementação e provas locais descritas; PENDENTE para aceite integral hospedado.** SMTP informado como configurado não é evidência de entrega. As únicas alterações remotas até esta etapa foram as configurações Auth autorizadas acima; não houve SQL remoto, reset de senha administrativa, alteração do cliente Google ou cutover.
