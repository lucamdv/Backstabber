# Autenticação unificada — relatório de validação

Implementação: 23/11/2026. Atualização de evidências: 24/11/2026. **Cadastro/OTP, recuperação e vinculação email → Google confirmados em homologação após correção manual do SMTP.** Primeira senha de conta originalmente Google e refresh hospedado ainda não comprovados. O responsável corrigiu e confirmou a grafia do destinatário controlado. O endereço não é versionado neste relatório. A primeira tentativa manual exibiu uma máscara incompatível com o destinatário combinado; o formulário foi corrigido antes da segunda tentativa.

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
| Autenticação final Java (componentes, controller, transporte, rotas e política) | **34 aprovados** |
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
| Email confirmado → Google do mesmo email | **Real hospedado:** login Google no Preview Java retornou ao mesmo domínio e ao mesmo perfil. Uma única linha no Auth antes/depois e UUID comparado em memória: idêntico |
| Alternância Google/senha e ausência de perfil duplicado | **Real hospedado para a conta criada por email:** perfil de staging preservado no Google, após recuperação e no retorno ao Google. Login por nova senha confirmado pelo responsável e por evento Auth HTTP200 |
| Emails diferentes | Sem API de vinculação manual e sem comparação/merge por email na aplicação |
| Troca concorrente de conta durante alteração de senha | Testes do controller e transporte recusam alteração para bearer diferente |
| Voltar ao menu durante recuperação | Contexto em memória preservado com o cliente e vinculado ao UUID; teste de desmontagem/remontagem aprovado |

Não confundir preservar UUID no fluxo real de senha com comprovar os dois sentidos do Google. A documentação oficial explica que signup sobre uma conta OAuth existente pode retornar usuário ofuscado sem enviar confirmação; a interface utiliza uma instrução genérica e oferece definição/recuperação explícita, sem alegar descoberta de conta. [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)

## Auditoria hospedada e ajustes autorizados

Auditoria inicial: projeto Vercel existente `backstabber-homologacao`; overrides exclusivos de Preview/branch Java presentes: schema `bs_staging`, API `https://backstabber-java-staging.onrender.com/api/v1` e `DATABASE_URL` vazio. O deploy anterior era `c13adc5242ed0766c0830869e3bca91bf58e7932`. Render: serviço existente `backstabber-java-staging`, plano free, mesma branch, auto deploy desligado. Nenhum novo recurso foi criado. A publicação e a correção restrita de CORS posteriores estão descritas abaixo.

Auditoria inicial no Dashboard Supabase: Google e Email habilitados, confirmação obrigatória habilitada, usuários anônimos e linking manual desabilitados. OTP estava em **8 dígitos**, diferente do contrato solicitado. Validade observada: **3600 s**. A Site URL era `https://backstabber.vercel.app`; a allowlist incluía produção e previews AV2, mas não a URL estável da branch Java. Pela configuração exibida, um retorno não permitido cai em Site URL, explicando o redirecionamento indevido.

Após aprovação explícita do responsável, foi adicionada **somente** `https://backstabber-homologacao-git-feat-6522ba-luca-monteiros-projects.vercel.app/**`; o painel confirmou a adição de uma URL. Site URL e seis retornos existentes foram preservados. OTP foi alterado para **6 dígitos**, mantendo **3600 s**. O mínimo **8** e o preset **maiúscula/minúscula/número/símbolo**, previamente aceito pelo responsável, foram preenchidos/salvos. O preset e OTP foram conferidos ao reabrir o formulário; o painel mascara o campo de mínimo no canal textual de automação.

Os HTMLs e assuntos de confirmação e recuperação foram instalados. Após recarregar cada página, o conteúdo integral do editor foi comparado em memória à fonte versionada, normalizando apenas CRLF/LF: **ambos idênticos**. Não foram lidos nem alterados os segredos SMTP ou Google. Captura gráfica desse painel não foi obtida: a interface de screenshot do Chrome expirou; a conferência usou os controles visíveis e a cópia do editor, sem registrar credenciais.

## Publicação e verificação de homologação

Código da branch Java publicado: **`d02b0c5c13b3b79d9230da4b1c31b8e0b182e4c3`**. Preview Vercel `dpl_35f53hpYgTyMxNShxFpRHXYpxfAL` **READY**, com o alias estável preservado e apontando para esse deploy. Render recebeu o mesmo commit e ficou **live**. Main tem a implementação local em **`f31e12f78a4c8d9234496e67acbdf11da82b483b`**; seu remoto continua no release `f5c38d2`, sem push de produção. Commits posteriores deste relatório são apenas documentação.

Foi detectada ausência de CORS para o Preview Java no serviço Render. A única variável alterada foi `BACKSTABBER_ALLOWED_ORIGIN`, com a origem exata do alias estável, através de atualização por merge, preservando as demais variáveis. O deploy resultante `dep-dc2fdtcs728c73aeb6gg` ficou **live**, com o mesmo código `d02b0c5`. Verificação HTTP real: liveness200; readiness200; perfil anônimo401; preflight do Preview204 **com** `Access-Control-Allow-Origin` exato; preflight de origem inválida204 **sem** esse cabeçalho, mantendo o bloqueio pelo navegador.

O terminal real foi aberto no Chrome e o responsável realizou o cadastro, sem fornecer senha ou código ao agente. A segunda tentativa apresentou erro genérico na interface. A auditoria de logs do Auth consultou **somente contagens e classificações** do ClickHouse, sem selecionar mensagens, emails, códigos, URLs, tokens ou credenciais. Foram confirmados dois erros HTTP500 de envio, ambos contendo classificação SMTP535/credenciais rejeitadas, sem erro de TLS ou conexão. No painel, custom SMTP está habilitado, host `smtp.gmail.com`, porta465. Não foi lida, copiada nem alterada a senha SMTP.

**Histórico — entrega externa: FAIL nessa tentativa inicial.** O Gmail recusou a autenticação do remetente. O responsável posteriormente corrigiu e salvou o SMTP diretamente no painel, sem compartilhar o segredo. A repetição teve entrega real confirmada, conforme a seção seguinte. A senha de app requer verificação em duas etapas e pode ser revogada quando a senha da conta muda. Não a inserir em chat, fonte, bundle ou logs. [Documentação oficial Google](https://support.google.com/accounts/answer/185833?hl=pt-BR)

A fixture `auth-email-proof` e seus volumes sintéticos foram encerrados/removidos com o comando local específico, sem `--all`; nenhum container desse projeto permaneceu em execução. Não houve consulta direta ao PostgreSQL hospedado, migration remota ou criação de infraestrutura. O ensaio posterior criou somente o perfil de teste em `bs_staging` por meio da API Java; não alterou dados do jogo em `public.bs_*`.

## Reteste hospedado após correção do SMTP — 24/11/2026

| Verificação | Resultado e origem da evidência |
| --- | --- |
| Cadastro e OTP | **PASS.** Signup HTTP200 observado no navegador. Responsável confirmou recebimento do email e informou que o OTP liberou o perfil. Senha e código foram digitados exclusivamente por ele |
| API Java autenticada | **PASS.** GET `/api/v1/profile` HTTP200 observado após tentar novamente; perfil de teste salvo em staging. A primeira carga apresentou indisponibilidade, não reproduzida no retry; causa desconhecida |
| Sessão após F5 | **PASS.** Mesmo perfil visível após recarga; repetido também após login Google |
| Logout e recarga | **PASS.** Interface voltou ao login e permaneceu desconectada após recarga |
| Email → Google | **PASS.** Google verdadeiro da mesma conta, escopos básicos de identidade; retorno ao alias Java, código removido da URL e mesmo perfil. Uma linha de Auth e mesmo UUID antes/depois, comparados em memória sem registrar o valor |
| Recuperação hospedada | **PASS.** Solicitação HTTP200; responsável abriu o email, definiu a senha e confirmou a mensagem “Senha salva”. Link e senha não foram capturados |
| Login com nova senha | **PASS com evidências complementares.** Responsável confirmou o reaparecimento do mesmo perfil; consulta restrita de logs Auth agregados da conta controlada confirmou um login password HTTP200. A resposta dessa operação não foi capturada diretamente na aba do agente |
| Google após recuperação | **PASS.** Novo login Google executado e mesmo perfil de teste visível, sem nova conta de jogo |
| Refresh de sessão Google hospedada | **PENDENTE.** Tentativa de induzir um único 401 via interceptação do navegador não conseguiu injetar a resposta; não comprova refresh. Interceptação removida, navegação normal restaurada e perfil visível. Não foram alterados TTL global, credenciais ou conteúdo da sessão. Refresh real local permanece aprovado |
| Google primeiro → primeira senha | **PENDENTE.** A conta acima foi criada primeiro por email; sua recuperação não demonstra a primeira definição em uma conta exclusivamente Google |

O callback Google permaneceu no domínio de homologação. Não foram capturados tokens, códigos OAuth, cookies, corpos de sessão ou credenciais. Consultas de logs selecionaram apenas contagens/status/classificações; a inspeção de usuário no Dashboard foi limitada ao email autorizado. A captura [hosted-staging-profile.jpg](screenshots/hosted-staging-profile.jpg) mostra apenas o perfil sintético e a interface do jogo, sem endereço de email ou identificador Auth.

Os dados sociais preexistentes dessa conta de teste eram vazios. Preservar o perfil não constitui uma nova prova hospedada de histórico, amigos, partida em andamento ou convite; esses contratos têm cobertura automatizada e o ensaio completo hospedado não foi repetido. Também não se testou um login iniciado na produção, para evitar publicação ou alterações desse ambiente.

## Gate de validação externa

- **Concluído:** grafia do destinatário corrigido confirmada; endereço anterior excluído do teste.
- **Concluído:** retorno restrito Java e OTP6 aplicados após autorização, preservando Site URL e allowlist existente.
- **Configurado:** mínimo8/quatro categorias; confirmar a rejeição efetiva pelo provedor durante o ensaio controlado, sem bloquear login de senhas antigas.
- **Concluído:** dois templates e assuntos instalados, conteúdo persistido idêntico às fontes; validade observada de 3600 s.
- **Concluído:** responsável corrigiu o SMTP; confirmação e recuperação recebidas na caixa controlada, com OTP e nova senha funcionando. Compatibilidade visual em Outlook e autenticação de domínio do remetente ainda não auditadas.
- **Concluído:** Preview e Java de staging publicados e saudáveis; main permanece local e não deve ser enviada automaticamente.
- **Concluído:** email → Google com comparação de UUID e retorno ao mesmo perfil; nova senha e Google após recuperação. **Pendente:** Google → primeira senha em uma segunda conta controlada, refresh hospedado e preservação de relações/partida preexistentes em ensaio real.
- Conferir produção e Preview retornando a seus próprios domínios, inclusive convite; validar link inválido/expirado e entrega Gmail/Outlook.

**Veredito atual: PASS para implementação/provas locais, entrega SMTP e os fluxos hospedados confirmados acima; PENDENTE para aceite integral dos cenários restantes.** Alterações remotas: configurações Auth autorizadas, publicação do Preview/Java de staging, CORS desse serviço e conta/perfil sintético de teste. Não houve alteração do cliente Google, senha administrativa, produção do frontend/Node, migration hospedada ou cutover. O projeto Auth é compartilhado e recebeu somente as alterações de configuração e os ensaios explicitamente autorizados.
