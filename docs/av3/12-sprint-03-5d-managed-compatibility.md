# Sprint 03.5D · Compatibilidade com Supabase gerenciado

## Escopo e plano de execução

Base: `7920a460b3c73fedd8390a9fad803536c28b7aac`, branch `feature/av3-sprint-03-spring-boot`.

A auditoria remota de leitura foi fornecida pelo usuário como entrada desta sprint. Esta execução não consulta nem altera o projeto hospedado. O trabalho está restrito ao repositório e a ambientes locais descartáveis.

1. Reproduzir os limites de delegação em um fixture PostgreSQL não-superusuário e observar a falha da proposta anterior.
2. Remover a FK para Auth e os grants/revokes inviáveis, preservando todas as FKs internas de staging.
3. Manter a ponte de publicação do owner sem login usando send invoker e EXECUTE já concedido a PUBLIC; comprovar a recusa de publicação pelo runtime.
4. Ensaiar separadamente a capacidade de criar políticas, a instalação, a operação das APIs e o rollback.
5. Reexecutar regressões, registrar limitações, revisar o GO/NO-GO e publicar somente na branch Java.

## Entrada da auditoria, sem nova execução remota

O usuário confirmou PostgreSQL 17.11; executor postgres com CREATEROLE e CREATE no banco, sem SUPERUSER; zero colisões; oito tabelas públicas com RLS; messages com RLS e as duas políticas legadas; INSERT em messages e USAGE em realtime delegáveis. USAGE em auth, REFERENCES em auth.users(id) e EXECUTE em realtime.send não são delegáveis. send é SECURITY INVOKER e já permite EXECUTE a PUBLIC. A sessão auditada utilizou TLS 1.3.

O resultado de delegação de INSERT não comprova, isoladamente, a capacidade de CREATE/DROP POLICY em messages. Essa capacidade é verificada separadamente nos ensaios locais e permanece sujeita à evidência específica do projeto hospedado antes de uma aplicação autorizada.

## Incompatibilidades e correções

| Dependência anterior | Incompatibilidade observada | Proposta revisada |
| --- | --- | --- |
| FK de bs_profiles para auth.users | Não é possível delegar USAGE/REFERENCES ao owner sem login | UUID validado pelo Java como PK, sem FK externa nem grant em Auth |
| GRANT EXECUTE em realtime.send ao owner | EXECUTE utilizável, porém sem GRANT OPTION | Usar o EXECUTE já concedido a PUBLIC, exigindo send SECURITY INVOKER |
| REVOKEs desses privilégios no rollback | Privilégios nunca deveriam ser concedidos pela revisão | Removidos. O rollback preserva ACLs de Auth e o PUBLIC EXECUTE preexistente |
| Permissão de usar/delegar INSERT confundida com DDL de política | Uma operação não comprova a outra | Teste negativo de owner, prova local de Supautils e consulta SELECT Q26 específica |
| Rollback por administrador diferente | REVOKE depende de quem concedeu o privilégio | Exigir o mesmo executor efetivo da migration, sem depender de SUPERUSER |

O preflight da migration exige RLS já ativa, send invoker com EXECUTE para PUBLIC e delegação efetiva de USAGE em realtime/INSERT em messages. A criação real das políticas valida separadamente sua autorização. Falhas abortam a transação com os papéis e objetos novos, preservando os objetos anteriores. Não há fallback administrativo.

Esta migration proposta não foi aplicada no projeto hospedado; por isso o mesmo arquivo ainda em revisão foi corrigido. A migration canônica de produção não foi alterada. Uma cópia local que já recebeu a proposta antiga deve ser descartada ou usar o rollback correspondente ao seu commit antigo antes de reaplicar a revisão. Não executar cegamente o rollback novo sobre uma instalação antiga com grants adicionais de Auth/send.

## Identidade sem FK externa

Cada requisição protegida é autenticada por `SupabaseAuthenticator` por GET em `/auth/v1/user`. O UUID da resposta validada vira o principal de `ApiSecurity`. `ProfileController` passa esse principal para `ProfileReader.update`, que o vincula por parâmetro SQL. Campos userId no corpo ou na query não escolhem o perfil atualizado.

Não existe cache de identidade no Java. Um 401/403 retornado pelo Auth recusa a requisição; uma indisponibilidade do Auth impede a escrita. Os testes novos verificam um bearer aceito em uma requisição e recusado pelo upstream na seguinte. Isso não é um teste de revogação real de sessões Google. O Java não consulta auth.sessions nem administra sessões compartilhadas.

As 13 FKs internas permanecem, incluindo associações a perfis, salas, partidas e comandos. Somente a aresta para auth.users foi removida. Os perfis de produção continuam na estrutura canônica, com sua FK original e sem alterações de dados pela migration de staging.

O papel JDBC continua sendo uma credencial de serviço restrita ao schema, com DML em todo staging. Ele não representa individualmente cada jogador no PostgreSQL. Quem possui essa credencial pode inserir UUIDs em staging; a proteção contra a manipulação por clientes HTTP é a autenticação e a autorização do Java. Nenhum novo escritor deve contornar essa fronteira.

### Exclusão no Auth, órfãos e retenção

Excluir uma conta Auth não exclui automaticamente seu perfil de staging. Username, amizades, memberships, convites e associações de comandos podem permanecer; buscas também podem exibir o perfil retido. As sessões/canais já autorizados pelo serviço gerenciado não são revogados pela remoção da FK. Há ainda uma janela para requisições já autenticadas e em andamento.

Não foi instalado job de reconciliação, trigger em Auth, credencial service_role nem acesso de leitura a usuários pelo JDBC. Um 401, timeout ou ausência de login não é evidência suficiente para apagar dados. Não se infere a idade de um perfil por last_seen para uma exclusão automática.

A operação segura de homologação exige aceitar a retenção e definir responsável e janela antes da ativação. A proposta é limpar os registros de teste ao encerrar o ciclo de homologação ou após confirmação administrativa da exclusão de uma conta autorizada:

1. Obter confirmação confiável da exclusão e revisar somente UUIDs de staging pertencentes ao grupo de teste. Não exportar o cadastro real inteiro nem conferir existência usando credenciais do runtime.
2. Autorizar separadamente uma limpeza com lista explícita de UUIDs e escopo bs_staging. Esta sprint não executa essa limpeza no ambiente hospedado.
3. Interromper apenas as escritas da API de homologação e aguardar requisições em andamento, para evitar recriação durante a limpeza.
4. Rever e remover as salas hospedadas por essas identidades quando apropriado, antes de remover os perfis. As FKs internas fazem o restante das cascatas. Remover apenas o perfil deixaria host_id nulo em salas preservadas.
5. Conferir staging, políticas e ausência de operações em public/Auth. Reativar a API somente após a revisão. A revogação real de sessões/canais no Auth exige procedimento próprio autorizado.

Uma conta que ainda puder se autenticar poderá criar um perfil novo. Retenção, reutilização de usernames e resets do ambiente são decisões operacionais explícitas, não garantias herdadas da FK removida. Sem aceite desse comportamento e responsável pela limpeza, manter NO-GO para ativação.

## Realtime e fronteira do runtime

`bs_staging_owner` permanece sem LOGIN, SUPERUSER, BYPASSRLS ou privilégios administrativos. Recebe USAGE em realtime e INSERT em messages, com uma política que aceita somente invalidações privadas de formato fixo nos tópicos hml:user e hml:room. Os triggers de staging são funções fixas desse owner, com search_path vazio e sem EXECUTE concedido ao runtime. Não se publica estado privado de cartas no payload.

O runtime não recebe INSERT ou privilégios por coluna em messages e não pode assumir o owner. PUBLIC EXECUTE em uma função invoker não concede os direitos de gravação dessa função. O teste cobre inclusive o cenário em que o runtime passa a ter USAGE no schema: send continua recusado e nenhuma mensagem é criada. Conceder INSERT indevidamente faz assert_runtime_role rejeitar a conexão; remover o grant restaura o guard.

As duas políticas legadas e seus grants são preservados. Novas permissivas e guardas restritivas se aplicam aos tópicos hml, com autorização por UUID e membership. Nenhuma role administrativa gerenciada é concedida a owner/runtime/executor pela migration, nem se transfere ownership de objeto existente ou se modifica a RLS da produção.

### Capacidade de gerenciar políticas

No PostgreSQL comum, um executor não dono de messages e com INSERT delegável ainda não pode criar políticas. O teste negativo exige erro de autorização e rollback integral. O modelo positivo cria a tabela de fixture sob o executor desde o início, sem transferir ownership de um objeto existente; não constitui prova de capacidade hospedada. Um segundo executor sem ownership reproduz o caso negativo.

Também foi criado um projeto CLI **exclusivamente local e descartável**, `backstabber-035d-disposable`, com a imagem Supabase PostgreSQL 17.11.0.018. Seu postgres é não-superusuário e reproduz naturalmente os limites auditados, sem revogar ou conceder privilégios extras em Auth/send. O owner de messages continuou sendo supabase_realtime_admin. A declaração local de Supautils permite ao postgres gerenciar políticas naquela tabela.

Nesse ambiente foi executado CREATE/DROP de uma política de teste dentro de transação revertida, como postgres não dono. A migration, o tráfego privado real e o rollback/reaplicação também passaram pelo mesmo executor. Não houve transferência de ownership de messages nem concessão de membership administrativo nessa prova Supabase.

A documentação oficial descreve essa capacidade específica via `supautils.policy_grants`, independente das permissões de tabela. [Autorização Realtime](https://supabase.com/docs/guides/realtime/authorization), [Supautils: Manage Policies](https://github.com/supabase/supautils#manage-policies)

O usuário não forneceu um resultado específico dessa configuração no projeto hospedado. A Q26 adicionada ao pacote SELECT revela somente o booleano da entrada do executor, sem exportar toda a configuração. Não foi executada remotamente. Uma declaração, quando conhecida, continua sujeita à versão/carregamento efetivo do Supautils; não se tenta DDL remoto para sondagem nesta sprint.

## Ensaios locais e regressão

| Ensaio | Evidência |
| --- | --- |
| RED com a proposta anterior | Falha reproduzida: permission denied for column id of relation users |
| Limites gerenciados | Executor sem SUPERUSER/BYPASSRLS; sem delegação Auth/send; send invoker com PUBLIC EXECUTE; USAGE realtime e INSERT messages delegáveis |
| Avisos SQL | O fixture rejeita SQLWarning 01007 de GRANT que não efetua concessão |
| ManagedStagingDatabaseTest | Instalação, recusa de política sem autoridade, triggers, RLS, ausência de FK externa, 13 FKs internas, órfão após exclusão Auth, isolamento e ciclo de rollback |
| Identidade HTTP | UUID forjado não altera a vítima nem perfis públicos; bearer rejeitado pelo Auth não escreve; inválidos/expirados/anônimos recusados |
| Supabase real local | Auth, PostgreSQL e Realtime locais; policy CREATE/DROP por não-owner; migration aplicada com o executor restrito |
| Duas APIs Java | Readiness HTTP200 em 18095/staging e 18096/public, com Auth em 55431 e PostgreSQL em 55432, todos em loopback |
| Três identidades sintéticas | Perfis independentes, amizade, convite, lobby, início de partida, mãos privadas e um comando persistido só em staging |
| Canais privados reais | Presence com ACK ok e observação pelo peer; tópicos hml/legados isolados; terceiros recusados |
| Cleanup do roteiro | Remoção somente dos UUIDs sintéticos criados; fingerprints das oito tabelas públicas preservados |
| Rollback/reaplicação Supabase local | Mesmo executor postgres, sem alterações nas oito tabelas públicas, contagem Auth ou definições das políticas legadas; staging recriado vazio |
| Auditoria SELECT atualizada | 26 consultas executadas em transação read-only somente no Supabase descartável; Q26 mostrou não-owner e capacidade local declarada |
| Suíte Java completa | 113 testes passaram, zero falhas/erros/omitidos, com Testcontainers e paridade Node habilitados; execução em 7 min 40 s |
| Revisão final dos fixtures | Após eliminar transferências de ownership também nos fixtures, os 20 testes de ManagedStagingDatabaseTest, SharedStagingDatabaseTest e ProfileSocialTest passaram novamente, sem falhas/erros/omitidos |
| Frontend | 135 testes passaram, 8 opcionais de PostgreSQL nativo omitidos por falta de configuração dedicada; 22 direcionados também passaram |
| Typecheck/lint | Passaram |
| Build React | Simulação de Preview staging passou com API HTTPS fictícia e DATABASE_URL vazia; aviso preexistente de bundle acima de 500 kB |

O teste real local usou o JAR Java da base com código de produção idêntico: esta revisão altera SQL, testes, roteiro de teste e documentação, preservando as classes Java de produção e o contrato HTTP.

Ao final, as duas APIs foram encerradas, a senha local do runtime voltou a NULL e somente a stack descartável foi removida com seus volumes sintéticos. A configuração local padrão do repositório continua com Google desabilitado. Serviços não relacionados e o Docker Engine permaneceram disponíveis.

Ocorrências anteriores foram mantidas: um timeout de inicialização de container aconteceu antes dos testes SQL; o limite de startup do fixture foi ampliado para três minutos, sem relaxar as proteções de homologação. Outro ensaio passou os cinco métodos, mas o cleanup usava um grantor diferente no rollback; o fixture foi corrigido para usar o executor original e passou novamente. Isso motivou a instrução explícita no rollback.

Não foi repetida uma partida completa com três contas Google. Não se validaram OAuth/Realtime hospedados ou conectividade da futura API HTTPS nesta sprint.

### Como repetir

Na pasta backend, com Java 21, Maven e Docker locais:

```powershell
$env:BACKSTABBER_TESTCONTAINERS = 'true'
$env:BACKSTABBER_NODE_PARITY = 'true'
.\mvnw.cmd test
```

Para o ensaio Supabase, usar um diretório temporário com project_id próprio, a migration canônica como fixture pública e Google desabilitado. Na CLI 3.1.0, a seção SMTP local é local_smtp; não reutilizar inbucket. Usar API em 55431, PostgreSQL em 55432 e portas auxiliares livres. Não executar link, db push, reset remoto nem usar credenciais remotas.

Após iniciar a stack, verificar os privilégios e a capacidade local de políticas; aplicar somente ali a proposta revisada. Fornecer senha aleatória local ao app e iniciar os dois JARs em dev com Auth/PostgreSQL de loopback. No roteiro `web/e2e/shared-staging.mjs`, `BACKSTABBER_LOCAL_DISPOSABLE=true` seleciona exclusivamente as portas fixas 55431/55432/18095/18096; o comportamento padrão nas portas anteriores continua disponível. As URIs são recusadas se tiverem outro host, banco, porta, query ou fragmento.

Fornecer somente as variáveis locais BACKSTABBER_LOCAL_DATABASE_URL, BACKSTABBER_LOCAL_STAGING_DATABASE_URL e BACKSTABBER_LOCAL_SUPABASE_KEY por ambiente, sem logs ou arquivos versionados. O roteiro cria e limpa suas próprias identidades de teste. Em seguida, ensaiar rollback/reaplicação com o mesmo executor e comparar snapshots locais. Ao terminar, encerrar os JARs, voltar a senha do app a NULL e remover apenas a stack descartável, sem backup dos fixtures. Não usar a opção CLI --all.

## Arquivos da entrega

| Arquivo | Mudança |
| --- | --- |
| supabase/migrations/20261119000101_backstabber_shared_staging.sql | PK sem FK Auth, remoção de grants inviáveis e preflight de send/delegação |
| supabase/rollbacks/20261119000101_backstabber_shared_staging.rollback.sql | Remoção de REVOKEs inviáveis e instrução de mesmo executor |
| supabase/audits/20261119_shared_staging_preflight.sql | Diagnósticos antigos contextualizados e Q26 de capacidade de políticas |
| backend/src/test/java/com/backstabber/ManagedStagingDatabaseTest.java | Fixture com restrições gerenciadas e testes de instalação/segurança/lifecycle |
| backend/src/test/java/com/backstabber/SharedStagingDatabaseTest.java | Cleanup sem depender de cascade Auth e UUID forjado em staging |
| backend/src/test/java/com/backstabber/SocialIntegrationTest.java | Rejeição Auth mutável no fixture e startup local limitado a três minutos |
| backend/src/test/java/com/backstabber/ProfileSocialTest.java | Recusa de escrita após erro Auth e com bearer inválido |
| web/e2e/shared-staging.mjs | Portas isoladas opcionais e cleanup explícito de perfis sem FK Auth |
| docs/av3/10-sprint-03-5c-shared-staging.md | Proposta atualizada, histórico da regressão preservado |
| docs/av3/11-sprint-03-5c-preflight.md | Novos requisitos/gates e auditoria externa atribuída ao usuário |
| docs/av3/12-sprint-03-5d-managed-compatibility.md | Este relatório |

## Riscos residuais e GO/NO-GO

**GO técnico para a proposta revisada no ambiente local com os limites reproduzidos. NO-GO para aplicação hospedada nesta etapa.**

Antes de autorizar aplicação hospedada, permanecem os seguintes gates:

- [ ] Evidência específica da capacidade do executor postgres de gerenciar políticas em messages no projeto aprovado, distinta do INSERT delegável. A consulta complementar requer autorização própria.
- [ ] Revisão dos demais grants PUBLIC, defaults, funções definer e políticas, sem inferir compatibilidade completa a partir do resumo parcial fornecido. Interromper se houver drift desde a auditoria.
- [ ] Aceite explícito da ausência de cascade Auth, da retenção e do procedimento de limpeza de staging, incluindo responsável e janela.
- [ ] Revisão do commit, backup e rollback pelo mesmo executor, com senha exclusiva do runtime fora do Git.
- [ ] Nova autorização explícita para aplicar esta versão da migration. Nenhuma autorização de leitura anterior permite escrita.
- [ ] Gates separados para host Java HTTPS, CA/verify-full, conexão direta ou Supavisor session mode, limite de conexões, CORS, OAuth e Preview exclusivamente staging.

Infraestrutura, Auth, administração e quotas continuam compartilhados. A separação de schema não isola consumo de recursos nem impede administradores do projeto de acessar ambos os ambientes. Canais já abertos podem conservar decisões de autorização do serviço; o aceite gerenciado precisa validar reconexão e revogação quando autorizado.

Não foi acessado Supabase hospedado, não foram alterados Auth/Realtime/roles remotos, main ou Vercel, nem foi criada infraestrutura paga. Não houve merge ou cutover. O push da branch pode disparar um build Git de Preview, que permanece sujeito aos guards existentes; nenhum deploy é ativado manualmente por esta sprint.
