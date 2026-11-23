# Sprint 03.5E · Backup antes da migration

## Resultado resumido

**Backup hospedado: FAIL — exportação e recuperação não realizadas por falta da credencial PostgreSQL existente. Gate B permanece NO-GO.**

Data: 23/11/2026. Projeto solicitado: `ggddochwyxialyxmqbpa`. Branch: `feature/av3-sprint-03-spring-boot`, base `612b5f3cb41e9b3f2e33dacb74dfd0e237d8b004`.

O usuário confirmou que dispõe somente de acesso ao SQL Editor. Nenhuma senha PostgreSQL, URI autenticada ou arquivo pgpass estava disponível nesta sessão. O conector Supabase disponível não oferece listagem/download de backups. Isso não comprova a inexistência de backups no provedor; sua disponibilidade não foi verificada.

Não foi usado o SQL Editor como substituto de pg_dump, não foram extraídos registros via resultados do chat e nenhum fluxo de criação de role temporária foi iniciado. Não se redefiniu senha. **Há zero arquivos de backup do projeto hospedado nesta entrega.**

O ensaio separado com dados inteiramente sintéticos teve resultado PASS, inclusive restauração após descriptografia. Ele valida o procedimento local, sem provar recuperação do projeto hospedado nem satisfazer o gate de backup.

## Documentação e ferramentas verificadas

- Supabase CLI instalada: **3.1.0**, inspecionada com `--version` e `db dump --help`. A CLI informou atualização disponível, sem atualização automática nesta sprint.
- `db dump` usa o destino local por padrão. `--remote=<URI>` identifica uma conexão explícita; o fluxo por referência de projeto pode exigir credenciais de gerenciamento. Para esta tarefa, não usar uma autenticação que crie cli_login_postgres ou outra role no projeto.
- Foram inspecionados templates oficiais com `--dry-run`, contra uma URI fictícia de loopback, sem conexão a qualquer projeto hospedado. O template consumiu PGPASSWORD fornecida por ambiente; nenhum valor foi impresso. Essa observação não valida uma senha real ou o TLS do projeto.
- Os requisitos são Docker/cliente compatível, acesso de rede à porta PostgreSQL, credencial existente, endpoint correto e TLS validado. O acesso ao SQL Editor não substitui uma senha de conexão para pg_dump.
- O ensaio usou pg_dump/pg_restore PostgreSQL **17.12** em containers locais. A versão remota 17.11 é informação da auditoria anterior, não uma nova verificação remota de backup.

Referências oficiais consultadas em 23/11/2026: [CLI db dump](https://supabase.com/docs/reference/cli/supabase-db-dump), [backup/restauração pela CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [backups do provedor](https://supabase.com/docs/guides/platform/backups), [conexões PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres), [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Estratégia de exportação preparada

A execução hospedada depende de um operador com a **senha já existente**, fornecida em entrada local mascarada. Não colar a senha no chat, no histórico do terminal ou em uma URI de argumentos. Usar ambiente temporário do processo, preservar/restaurar seu valor anterior e limpar os buffers controláveis ao terminar. A sessão atual não recebeu essa credencial e não tentou autenticar no PostgreSQL hospedado.

O destino deve ser validado antes da conexão: banco postgres, referência exata do projeto e porta 5432. A conexão direta usa db.<ref>.supabase.co. A alternativa é o host real do Supavisor session mode copiado do painel Connect, com usuário postgres.<ref>. Não adivinhar a região/host nem usar transaction mode na porta 6543. Confirmar CA/hostname com verify-full para o endpoint escolhido; o TLS 1.3 da auditoria anterior não valida o TLS de uma exportação futura.

O roteiro de exportação lógica previsto contém:

| Artefato | Mecanismo oficial | Cobertura a comprovar |
| --- | --- | --- |
| roles.sql | CLI `db dump --role-only` | Roles customizadas e grants exportáveis, sem senhas de login |
| schema.sql | CLI `db dump` | Estrutura das tabelas públicas, constraints, índices, funções e triggers exportados |
| data.sql | CLI `db dump --data-only --use-copy` | Dados incluídos pelo template, com lista real de exclusões |
| managed-schema.sql | CLI com `--schema auth,realtime` quando compatível | Estruturas/dependências gerenciadas necessárias; ordem de recuperação deve ser ensaiada |
| database.dump complementar | pg_dump nativo em formato custom, no mesmo projeto | Snapshot consistente e TOC de dependências para recuperação com pg_restore |
| manifest privado | SHA-256, tamanho, ferramentas, horários e resultados | Integridade, cobertura observada, limitações e prova de restauração |

O arquivo custom complementar é recomendado porque os arquivos CLI possuem filtros e exportações independentes. Não presumir que três arquivos sequenciais representam o mesmo snapshot. A captura das roles e dos metadados deve registrar a janela e conferir drift. Não pausar ou reconfigurar a produção automaticamente para obter o backup.

Os comandos reais precisam usar `--file` privado ou streams capturados, sem imprimir o SQL. stdout/stderr devem ser tratados em memória e substituídos por mensagens fixas de status. Não usar debug, transcript, comandos echo de valores, URI com senha ou logs brutos. Uma falha de permissão, tabela ausente ou warning relevante impede PASS; não contornar RLS ou adquirir privilégios extras no projeto.

## Cobertura: o dump padrão não basta

Os filtros abaixo foram observados nos templates da CLI instalada. São evidência do comportamento da ferramenta, **não evidência de conteúdo de um backup hospedado**.

- O dump estrutural padrão exclui Auth, Realtime, Storage e vários schemas gerenciados/de extensões. Um arquivo estrutural vazio ou sem erro não comprova a recuperação de suas dependências.
- O dump de dados padrão inclui Auth, mas exclui auth.schema_migrations, storage.migrations e supabase_functions.migrations. Também exclui dados de Realtime e de outros schemas internos. Compatibilidade da base gerenciada de destino precisa ser verificada.
- O template de roles exclui roles reservadas, incluindo postgres, anon, authenticated, service_role e supabase_*. Usa no-role-passwords; não recupera senhas customizadas de login.
- O filtro estrutural modifica/omite algumas instruções de publications, event triggers, owners/default privileges e objetos gerenciados. Comparar os metadados efetivamente restaurados; não assumir fidelidade integral das permissões.

Lista estrutural padrão observada: information_schema, pg_*, _analytics, _realtime, _supavisor, auth, etl, extensions, pgbouncer, realtime, storage, supabase_functions, supabase_migrations, cron, dbdev, graphql, graphql_public, net, pgmq, pgsodium, pgsodium_masks, pgtle, repack, tiger, tiger_data, timescaledb_*, _timescaledb_*, topology e vault.

Para Backstabber, o aceite deve verificar conteúdo e recuperação das oito tabelas: bs_profiles, bs_friend_requests, bs_friends, bs_rooms, bs_room_members, bs_invites, bs_matches e bs_match_commands. A FK atual de public.bs_profiles depende dos mesmos UUIDs em auth.users. Recuperar somente public pode falhar ou deixar uma recuperação incompleta.

Também conferir as políticas legadas de realtime.messages, suas funções, grants, owners e dependências; roles; índices; constraints; triggers; sequências e extensões usadas. Os defaults do destino podem produzir permissões diferentes. Não desativar RLS na origem para exportar.

Não são cobertos por um backup lógico de banco, por si só: arquivos binários do Storage, configurações OAuth/SMTP/Auth, API keys, configurações Realtime, código de Edge Functions, integrações e configurações de infraestrutura. Dados cifrados em Vault/colunas podem depender de chaves externas ao dump. Não foram buscadas chaves nem alteradas essas configurações. Sem inventário e procedimento de recuperação apropriados, não declarar recuperação integral do projeto Supabase.

## Armazenamento privado

Foi preparado, fora de qualquer repositório Git, o diretório local:

`C:/Users/lucad/Documents/Codex/PrivateBackups/Backstabber/ggddochwyxialyxmqbpa/20261123-035e`

A ACL teve a herança desabilitada e acesso limitado ao usuário atual e SYSTEM. O diretório contém um status hospedado FAIL e um subdiretório `synthetic-drill`, sem dados do projeto hospedado.

Quatro artefatos **sintéticos** foram protegidos com Windows DPAPI CurrentUser: roles.sql, schema.sql, data.sql e database.dump. As cópias SQL/dump em claro foram removidas após a verificação. O manifest privado registra tamanho e SHA-256 antes/depois da criptografia e o resultado do roundtrip. Os templates de diagnóstico com valores fictícios também foram removidos.

DPAPI depende do perfil/chaves da conta Windows. O teste comprova recuperação nessa conta/máquina, não portabilidade para outro computador ou perda do perfil. Uma estratégia de recuperação de chave independente deve ser definida antes de usar esse mecanismo como única proteção de um backup hospedado. Não foi feito upload de nenhum artefato, manifest privado ou chave para GitHub ou outro serviço.

Inventário do ensaio, sem dados hospedados:

| Arquivo sintético cifrado | Bytes cifrados | Integridade |
| --- | ---: | --- |
| roles.sql.dpapi | 486 | SHA-256/roundtrip PASS |
| schema.sql.dpapi | 22662 | SHA-256/roundtrip PASS |
| data.sql.dpapi | 4790 | SHA-256/roundtrip PASS |
| database.dump.dpapi | 34998 | SHA-256/roundtrip PASS |

SHA-256 do manifest **sintético** privado: `BCB6CE3A5A8CA582D3E194BE30A433FC9E7F26ED58F8F92A2A74DB9454FA174D`. Os hashes individuais permanecem no manifest privado. Isso não corresponde a um backup de produção.

## Ensaio local de recuperação

Foram usados containers PostgreSQL descartáveis com `--network none`, sem portas publicadas ou serviços Auth/Realtime iniciados. Todos os registros foram criados para o ensaio; não há usuários ou dados reais. A migration canônica foi usada apenas para construir o fixture público local, sem instalar bs_staging em qualquer destino hospedado.

| Verificação | Resultado |
| --- | --- |
| Roles customizadas pelo template oficial | PASS: role e grant recuperados, sem senha exportada |
| Arquivo custom e extração de estrutura/dados | PASS |
| Restauração real em outro PostgreSQL, com exit-on-error e transação | PASS |
| Oito tabelas públicas e fingerprints de seus dados | PASS: iguais entre origem e primeira restauração |
| Dependência Auth | PASS no fixture: UUIDs recuperados e zero órfãos da FK |
| Políticas e privilégios do fixture | PASS: definições idênticas e grant da role customizada recuperado |
| Integridade criptográfica | PASS: quatro SHA-256 conferidos após descriptografia; corrupção de ciphertext recusada |
| Nova restauração a partir dos arquivos DPAPI | PASS em 23/11/2026 às 17:46:07 UTC: oito tabelas com RLS, UUIDs Auth sem órfãos, políticas legadas e grant customizado conferidos |
| Exportação do Supabase hospedado | FAIL: credencial existente indisponível |
| Restauração de dados hospedados | NÃO EXECUTADA; não há arquivo real para validar |

O fixture Auth representa somente a integridade dos UUIDs. Ele não comprova recuperação de sessões, identidades Google, chaves de criptografia ou operação de um Supabase hospedado completo. As provas locais não podem ser promovidas a PASS do projeto real.

Os containers de origem e os dois destinos locais foram removidos depois dos testes. Permaneceram apenas os artefatos sintéticos privados cifrados e as evidências sanitizadas. Os serviços existentes não relacionados ao ensaio não foram interrompidos.

## Recuperação futura, após exportação autorizada e completa

1. Verificar o manifest privado, hashes e mecanismo de descriptografia, sem publicar arquivos ou conteúdos.
2. Criar somente um destino local descartável e compatível com a versão/extensões/roles gerenciadas necessárias. Impedir acesso de saída e não iniciar serviços que possam enviar e-mails, webhooks ou executar jobs restaurados.
3. Restaurar roles customizadas e a base gerenciada compatível; manter a origem e suas credenciais fora da configuração desse destino. Não assumir que roles reservadas ou suas senhas estão no dump.
4. Restaurar o archive com pg_restore e parada no primeiro erro; para os arquivos SQL, usar psql com ON_ERROR_STOP e transação. Resolver a ordem de dependências Auth/public/Realtime no destino de teste, sem editar o backup original ou esconder erros.
5. Comparar dados, fingerprints, FKs, constraints validadas, índices, RLS, políticas, funções, triggers, owners e grants previstos. Conferir explicitamente usuários referenciados e ausência de órfãos. Registrar toda diferença e limitação.
6. Descartar o destino e as cópias em claro. Guardar somente os backups privados cifrados, manifest e relatório sanitizado.

`--clean` e comandos de restauração são exclusivamente para o destino descartável. Não são instruções para executar na produção. Recuperar o ambiente hospedado seria outra operação, sujeita à aprovação explícita e a seu plano de indisponibilidade.

## Condição para retomar

O responsável que conhece a senha PostgreSQL **existente** precisa fornecê-la por entrada local segura ou realizar a exportação oficial em terminal autorizado e deixar os arquivos em armazenamento local privado para validação. Alternativamente, um backup lógico oficial já exportado pode ser validado, se disponível; sua existência não foi confirmada.

Não se deve resetar senha, criar credencial temporária, habilitar recurso pago ou extrair dados pelo chat para contornar a ausência dessa credencial. Uma redefinição de senha exigiria autorização separada e análise de impacto nas aplicações.

**Não estamos preparados para solicitar a aplicação da migration 03.5D com o gate de backup satisfeito.** Falta exportar e restaurar o backup real. Os demais gates de políticas e retenção da 03.5D continuam independentes. Nenhuma migration hospedada, alteração remota, deploy, merge ou mudança de main foi realizada nesta sprint.

A documentação é registrada em commit local na branch Java. Não se executa git push nesta entrega: a integração Git existente pode disparar um deploy automático, incompatível com a restrição desta sprint. Não foram alteradas configurações da Vercel para contornar isso. [Builds automáticos por Git](https://vercel.com/docs/builds)
