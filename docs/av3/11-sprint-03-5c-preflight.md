# Sprint 03.5C · Preflight de compatibilidade hospedada

## Decisão desta entrega

Base revisada: `1b4c870c245066e0e09ea844cb2ceb5acea26cc3`, branch `feature/av3-sprint-03-spring-boot`.

O pacote de auditoria está preparado. **A execução no Supabase hospedado não está autorizada e não foi realizada.** O estado para aplicação da migration continua **NO-GO**, por falta das evidências do ambiente de destino. A aprovação arquitetural preliminar não equivale a aprovação para executar consultas, aplicar SQL ou ativar serviços.

Esta alteração contém somente documentação e o [script SELECT de auditoria](../../supabase/audits/20261119_shared_staging_preflight.sql). A migration, o rollback, o Java, o frontend e as configurações remotas permanecem como na base revisada.

## Plano e limites do preflight

1. Conferir estaticamente os comandos exigidos pela migration e pelo rollback.
2. Preparar consultas de catálogo para cada pré-condição, sem ler linhas do jogo ou do Auth.
3. Validar a sintaxe em PostgreSQL local descartável, com transação somente leitura.
4. Conferir o bloqueio do Preview usando somente leitura da Vercel.
5. Publicar o pacote nesta branch e aguardar autorização específica para a auditoria hospedada.

Não foi criado papel da aplicação, não foi aplicada migration e nenhum Supabase foi iniciado para esta entrega. O container PostgreSQL usado para a validação é descartável, sem rede e sem portas expostas. Nenhum comando é enviado ao Supabase remoto por este script ou por um runner automático.

## Contrato do script

O arquivo contém **25 instruções SELECT**, algumas com CTEs de leitura. As fontes são catálogos `pg_catalog`, incluindo a visão `pg_roles`, que não divulga hashes de senha. Não há `DO`, `SET ROLE`, DDL, DML, consultas às tabelas `public.bs_*`, `bs_staging.*`, `auth.users` ou `realtime.messages`, nem execução de funções do projeto.

As funções usadas são auxiliares explícitas de `pg_catalog` para verificar privilégios e descrever metadados. Não são chamadas `auth.uid()`, `realtime.send()` ou `bs_staging.assert_runtime_role()`. Referências a tabelas do jogo/Auth/Realtime são identificadores encontrados nos catálogos, sem leitura de seus dados.

Corpos de funções, expressões de políticas/defaults, argumentos de triggers e configurações arbitrárias não são exportados. O relatório usa hashes e indicadores limitados. A identidade do executor, nomes de roles/objetos e concessões são metadados administrativos e devem ficar em evidência de acesso restrito. Não versionar uma saída remota bruta.

### Cobertura e interpretação

| Consultas | Evidência | Condição a conferir |
| --- | --- | --- |
| Q01 | Identidade efetiva/login, versão, transação, CREATE no banco | Executor exato aprovado; PostgreSQL 17 como baseline validada; sessão read-only |
| Q02 | Colisões de schema, papéis e cinco nomes de políticas | Zero resultados antes da primeira aplicação |
| Q03–Q04 | Atributos e memberships, grantor, ADMIN/INHERIT/SET | Capacidade administrativa do executor; nenhum caminho de elevação concedido ao runtime |
| Q05–Q06 | Ownership, USAGE e permissões delegáveis | USAGE delegável em Auth/Realtime; REFERENCES(id), INSERT e EXECUTE delegáveis nos objetos exigidos |
| Q07–Q09 | Relações, RLS, ACLs de tabela e coluna | Dependências presentes, RLS já habilitada em messages, nenhuma concessão PUBLIC incompatível |
| Q10–Q11 | Default ACLs e privilégios PUBLIC de banco/schema | Ausência de CREATE para PUBLIC e de defaults de terceiros não aprovados |
| Q12 | Políticas, comandos, permissividade, roles e hashes | Composição das políticas atuais compatível com os guardas `hml:` |
| Q13–Q14 | Assinaturas, definer/invoker, owners, ACLs e hashes de funções | Dependências corretas, sem caminho callable de escalada ou publicação arbitrária |
| Q15 | Indícios de `supautils` e configurações específicas por hash | Evidência auxiliar; presença da extensão não comprova delegação nem ownership |
| Q16–Q17 | Triggers e event triggers | Nenhuma automação que replique, altere grants ou afete dados/DDL de produção ao criar staging |
| Q18–Q19 | Constraints, FKs e índices | Estrutura conhecida e ausência de dependências externas de staging |
| Q20–Q21 | Dependências locais e de papéis no cluster | Rollback restrito possível; nenhuma dependência externa inesperada |
| Q22–Q25 | Linguagens, TLS, partições e ACLs de schema | PL/pgSQL utilizável, conexão protegida e escopo real de grants/revokes compreendido |

O script permite diagnóstico em servidores anteriores ao PostgreSQL 16 sem referenciar diretamente colunas de membership inexistentes. Isso **não torna a migration compatível** com esses servidores. Ela usa opções de membership recentes e foi validada em PostgreSQL 17. Outra versão exige revisão e ensaio local específicos antes de GO.

Resultados vazios não significam sucesso. Q06 precisa retornar as três dependências com as permissões esperadas, Q05 precisa encontrar Auth/Realtime, e Q13 precisa encontrar as assinaturas necessárias: `realtime.send(jsonb,text,text,boolean)` retornando `void`, `realtime.topic()` retornando `text`, `auth.uid()` e `pg_catalog.gen_random_uuid()` retornando `uuid`.

Os hashes servem para comparar snapshots do mesmo cluster/versão, em condições equivalentes. Árvores de expressão podem conter OIDs internos e não devem ser comparadas cegamente entre o fixture local e o hospedado. Um hash não classifica a segurança de uma função ou política. Indicadores `mentions_*` e `literal_true` são heurísticas conservadoras, sem prova de equivalência lógica.

## Viabilidade das permissões da migration e do rollback

| Operação proposta | Evidência SELECT | Limite da conclusão |
| --- | --- | --- |
| Criar os dois papéis e ajustar memberships | Q01, Q03, Q04 | Exige CREATEROLE efetivo ou superusuário. Não basta ser membro de uma role com atributo CREATEROLE |
| Criar schema, tabelas, funções e transferir ownership | Q01, Q04, Q22 | Exige CREATE no banco, linguagem e capacidade temporária de SET/INHERIT sobre os novos papéis |
| FK compartilhada com Auth | Q05, Q06, Q09 | Exige USAGE delegável em auth e REFERENCES(id) delegável em auth.users, sem leitura/escrita de usuários |
| Triggers de invalidação | Q05, Q06, Q13, Q14 | Exige USAGE delegável em realtime e EXECUTE delegável em send, com implementação compatível |
| Ponte INSERT do owner sem login | Q06, Q08, Q12, Q15 | Exige INSERT delegável em messages e política compatível. Permissão de gerenciar políticas não comprova esta delegação |
| Criar/remover cinco políticas em messages | Q07, Q12, Q15 | Ownership efetivo ou capacidade gerenciada explicitamente comprovada para o executor exato |
| Revogar concessões no rollback | Q06, Q08, Q09, Q14, Q25 | Examinar grantor real e opções de grant. O mesmo executor ou administrador aprovado precisa poder revogar exatamente os grants novos |
| Remover schema/funções/tabelas e papéis novos | Q04, Q16–Q21 | ADMIN-only deve permitir bootstrap temporário restrito. Dependências não previstas precisam ser recusadas, sem CASCADE/DROP OWNED |

### Ponto crítico do serviço gerenciado

O Supabase documenta uma exceção gerenciada para o papel `postgres` administrar políticas em `realtime.messages` sem ser dono da tabela. Também documenta que os objetos de Realtime costumam pertencer a `supabase_realtime_admin` e que concessões/revogações dependem do grantor e das opções realmente disponíveis. **A exceção de políticas não é uma autorização geral para alterar grants.** [Autorização Realtime](https://supabase.com/docs/guides/realtime/authorization), [grants e revokes em objetos gerenciados](https://supabase.com/kb/troubleshooting/revoking-privileges-on-storage-pg_cron-vault-and-extension-objects-has-no-effect-916576)

A proposta atual precisa executar `GRANT INSERT ON realtime.messages TO bs_staging_owner`, além dos grants de schema, função e FK. Se o executor não puder delegar qualquer um desses privilégios, a aplicação permanece **NO-GO**. Um GRANT/REVOKE pode produzir aviso sem realizar a mudança esperada; aceitar um comando sem erro não comprova o grant final.

O preflight SELECT identifica ACLs e capacidades declaradas, mas não ensaia DDL delegado por extensões, não cria roles de sondagem e não tenta mudar o owner gerenciado. Evidência insuficiente sobre a exceção de políticas continua pendente. Não conceder membership em `supabase_realtime_admin`, não transferir ownership de objetos existentes e não enfraquecer PUBLIC/RLS para contornar uma incompatibilidade. Uma revisão da proposta, se necessária, será outra alteração submetida à aprovação.

O criador CREATEROLE pode conservar memberships automáticas ADMIN-only sobre os dois novos papéis em PostgreSQL 17. A proposta preserva essas associações, sem INHERIT/SET ao fim. Isso permite administração futura e também representa poder administrativo real sobre staging, que precisa constar do aceite. O runtime não pode receber membership algum. [Atributos de roles](https://www.postgresql.org/docs/17/role-attributes.html), [membership](https://www.postgresql.org/docs/17/role-membership.html)

Defaults de grants para terceiros merecem bloqueio explícito: a migration remove os grants novos de PUBLIC, anon, authenticated e do runtime antes de conceder seu conjunto previsto, mas não remove automaticamente defaults arbitrários de outras roles. Q10 deve ser revisada para o executor que criará os objetos. Concessões não aprovadas exigem revisão da proposta, sem alterar defaults da produção nesta etapa.

## Interferência potencial no Realtime existente

As cinco políticas propostas são adicionais, porém compartilham a mesma tabela de autorização. A combinação lógica depende das políticas atuais e dos privilégios dos owners das funções envolvidas.

| Risco | Critério de preflight | Decisão |
| --- | --- | --- |
| Política permissiva ampla permitir `hml:` a terceiros | Revisar Q12 e dependências. Os guardas restritivos precisam cobrir SELECT e INSERT para authenticated | NO-GO se houver caminho de acesso não coberto |
| Política restritiva existente rejeitar tópicos novos | Todas as restritivas aplicáveis são combinadas por AND, inclusive as que só conhecem tópicos legados | NO-GO se uma delas negar `hml:` e exigir edição de política de produção |
| Restritiva aplicável a PUBLIC bloquear o owner de broadcast | Avaliar aplicabilidade ao futuro owner sem login, condição INSERT e `private/extension/event/payload` | NO-GO sem prova de compatibilidade da ponte |
| Funções usadas em políticas lançarem erros ou tiverem efeitos laterais | Q13, Q16, Q20 e revisão semântica adicional quando necessária | A neutralidade lógica do guard não garante ausência de erro, custo ou efeito lateral em outra expressão |
| Corpo de send divergir do fixture | Conferir assinatura, definer/invoker, ACLs, owner e fingerprint | NO-GO para comportamento desconhecido, payload alterado ou possibilidade de publicação direta pelo runtime |
| PUBLIC EXECUTE de SECURITY DEFINER alcançar dados de produção | Q11, Q13, Q14 e dependências, incluindo USAGE de schema | Hash desconhecido ou função dinâmica privilegiada mantém a análise pendente |
| Novas políticas aumentarem custo dos joins | Avaliar membership/indexes e depois medir latência de inscrição em aceite autorizado | Limitar carga e conexões; dados e quotas permanecem compartilhados |
| Canais públicos contornarem o modelo privado | Conferência futura da configuração Realtime, sem a modificar | Canais de staging devem usar private:true. Não mudar o acesso público global sem analisar consumidores atuais |

Na proposta, os guardas são verdadeiros fora de `hml:`. Isso preserva a expressão lógica dos guardas para tópicos legados; não é prova universal de ausência de interferência de políticas customizadas do hospedado. Políticas permissivas combinam por OR e restritivas por AND. [Composição de políticas PostgreSQL](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)

As dependências de `pg_depend` não descobrem SQL dinâmico, referências textuais em PL/pgSQL, consumidores externos ou toda a semântica de funções. O script evita exportar corpos para não vazar literais sensíveis. Se hashes/metadados e a base conhecida forem insuficientes, solicitar autorização para uma revisão adicional com redação de dados sensíveis, antes de GO. Não declarar segurança apenas pela ausência de resultados em Q20.

O baseline anterior documenta testes locais com os dois schemas, três identidades e Realtime. Esta entrega não repete o motor de jogo nem promove esses resultados a uma validação do serviço hospedado.

## Conexão futura da API Java HTTPS

O backend será um processo persistente separado da Vercel. A Vercel continuará servindo React, com API Java absoluta via HTTPS. A origem autorizada de CORS será somente o alias estável da branch Java. O pool Hikari existente tem máximo de três conexões por instância; o orçamento precisa incluir produção, Auth, Realtime e administração.

| Caminho | Host/porta e usuário, sem senha | Condição |
| --- | --- | --- |
| PostgreSQL direto | `db.<ref>.supabase.co:5432`, `bs_staging_app` | Preferível se o host Java dispuser de IPv6 funcional ou IPv4 já disponível no projeto |
| Supavisor session mode | Host exato copiado de Connect, `aws-<índice>-<região>.pooler.supabase.com:5432`, `bs_staging_app.<ref>` | Alternativa para host IPv4, preservando sessão e prepared statements |
| Transaction mode / porta 6543 | Não admitido pelo guard de shared staging | NO-GO; não relaxar a proteção para aceitá-lo |

A documentação admite custom roles com sufixo do projeto no Supavisor. O host não pode ser deduzido só pela região. Copiar o endpoint do projeto aprovado depois da autorização, sem reutilizar a credencial `postgres`. Session mode mantém uma conexão de servidor reservada por conexão cliente, portanto não elimina o consumo das três conexões JDBC. [Conexões e formatos](https://supabase.com/docs/guides/database/connecting-to-postgres), [terminologia Supavisor](https://supabase.com/kb/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO)

O código atual aceita os dois formatos acima, exige `BACKSTABBER_STAGING_MODE=shared`, `BACKSTABBER_GAME_SCHEMA=bs_staging`, o mesmo `<ref>` em Auth e PostgreSQL, banco `/postgres` e role restrita. O modo dedicated continua rejeitando o projeto de produção. Senhas com caracteres especiais devem ser percent-encoded no valor local/secret da URI, sem publicá-la em logs.

O Java exige `verify-full`. A cadeia de CA confiável deve corresponder ao endpoint escolhido: não presumir que o certificado do PostgreSQL direto valida o hostname do pooler. O PEM/bundle em `SUPABASE_DB_CA_CERT` precisa validar aquele host, sem aceitar certificado inválido, trocar para sslmode=require ou desabilitar a checagem de hostname. Q23 comprova apenas o TLS da conexão de auditoria, não o futuro JDBC nem todo o caminho interno do pooler. [TLS do PostgreSQL/Supavisor](https://supabase.com/docs/guides/platform/ssl-enforcement)

Ainda ficam pendentes, para uma fase autorizada após o papel existir: DNS/IPv4/IPv6 a partir do host Java, conexão real com senha exclusiva, rejeição de senha e CA incorretas, identificação efetiva como `bs_staging_app`, configuração de sessão/currentSchema aceita pelo pooler, execução do init guard pelo Java e readiness. Esses testes não podem usar credenciais administrativas como fallback. Não se compra add-on IPv4 para resolver conectividade nesta fase.

## Preview Vercel permanece bloqueado

Inspeção somente leitura, reconfirmada em 23/11/2026, confirmou o deployment `dpl_4TQSvtyLfm5GKE5jHdb8CLjmTvQU`, da base `1b4c870c245066e0e09ea844cb2ceb5acea26cc3`, no projeto `backstabber-homologacao`, em estado **ERROR**. Os eventos de build confirmaram a mensagem fixa `The Java branch Preview requires VITE_GAME_SCHEMA=bs_staging.` Nenhum valor de variável foi consultado ou impresso.

O [alias estável da branch Java](https://backstabber-homologacao-git-feat-6522ba-luca-monteiros-projects.vercel.app) não recebeu uma versão nova desta preparação. O último Preview aprovado pode continuar acessível no alias; o bloqueio do build não desliga uma versão anteriormente publicada. Não tratar esse conteúdo antigo como a futura homologação compartilhada.

O guard existente exige schema staging, `VITE_API_URL` HTTPS explícita e ausência/valor vazio de `DATABASE_URL` do Node nesse Preview. Alterações futuras ficam limitadas a **Preview + branch Java**, preservando Production. Uma URL HTTPS por si só não comprova que o destino é Java/staging: a origem aprovada precisa de revisão humana e teste de identidade/readiness. Também será preciso verificar que o rewrite legado não dispõe de credencial de produção.

Foram reexecutados os testes existentes de configuração do frontend. Nenhuma variável, autenticação, rewrite, alias ou integração Git da Vercel foi alterada. O push de documentação pode disparar outro build automático, que continua sujeito aos mesmos guards. [Integração Git Vercel](https://vercel.com/docs/git)

## Checklist GO / NO-GO

Há dois gates separados. Autorizar SELECTs não autoriza aplicar a migration, provisionar a API ou ativar o Preview.

### Gate A · Permissão para coletar metadados

- [x] Script revisado como SELECT-only e validado em PostgreSQL local com transação read-only.
- [x] Arquivos limitados à documentação e auditoria; migration/rollback da base preservados.
- [x] Bloqueio do Preview confirmado por inspeção somente leitura.
- [ ] Usuário aprova explicitamente a execução hospedada deste arquivo e seu SHA/hash.
- [ ] Usuário confirma projeto, endpoint, executor e janela da auditoria, sem enviar credenciais no chat.
- [ ] Preparar cliente com credenciais fora do Git, TLS, transação read-only, ON_ERROR_STOP e timeouts. Não adicionar SET/DO/DDL ao arquivo de consultas.
- [ ] Definir armazenamento restrito para a evidência. Compartilhar apenas resultado resumido e redigido.

**Estado atual do Gate A: aguardando aprovação.** Nenhuma execução hospedada será feita por este commit ou automaticamente no push.

### Gate B · Compatibilidade para futura aplicação

- [ ] Todos os 25 resultados disponíveis, completos e associados ao executor/projeto aprovados. Falha de permissão ou resultado ausente significa evidência insuficiente.
- [ ] Versão compatível com o ensaio local e zero colisões de nomes.
- [ ] CREATEROLE, CREATE no banco, linguagem e bootstrap de ownership/memberships viáveis, sem concessões administrativas ao runtime.
- [ ] Todos os grants necessários delegáveis, com grantor e reversibilidade compreendidos, incluindo INSERT em messages e REFERENCES(id) no Auth.
- [ ] Capacidade de CREATE/DROP POLICY em messages comprovada para o executor, sem membership em role gerenciada nem troca de owner.
- [ ] PUBLIC, defaults, grants por coluna, funções definer e event triggers sem caminhos não aprovados para produção/staging.
- [ ] Políticas atuais compatíveis nos dois sentidos: guardas hml fecham acesso indevido e restritivas existentes não impedem o fluxo novo nem exigem alteração em produção.
- [ ] Rollback sem dependências externas inesperadas, inclusive em outros bancos; executor e grants exatos preservados. Backup e aceite de perda dos dados de staging definidos.
- [ ] Endpoint direto ou Supavisor sessão, role, CA, TLS e limite de conexões aprovados. Rede real do futuro host ainda sujeita a aceite próprio.
- [ ] Custos/franquia, host Java, CORS e overrides exclusivos da branch revisados, sem ativação automática nesta etapa.
- [ ] Aprovação explícita posterior para aplicar a migration. Provisionamento, Auth/redirects e deploy exigem escopos próprios.

**Regra de decisão:** um item bloqueado ou desconhecido mantém NO-GO. Não corrigir grants, políticas, configurações ou roles remotamente durante a coleta. Relatar a divergência e apresentar outra proposta para aprovação. Mesmo um preflight sem incompatibilidades não autoriza aplicação automática.

## Evidências desta preparação

- 25 SELECTs executados sem erro em PostgreSQL **17.12**, com verificação final em 23/11/2026, em container local sem rede, usando `--single-transaction`, `default_transaction_read_only=on`, `statement_timeout=10000` e `lock_timeout=1000`. Q01 confirmou read-only. O container não contém os schemas Supabase, portanto este ensaio valida sintaxe/uso dos catálogos e resultados ausentes, sem simular a compatibilidade hospedada.
- Nenhuma role da aplicação ou migration foi criada/executada nesta preparação. O container foi removido após o ensaio.
- Os 15 testes existentes de `web/src/tests/shared-staging-environment.test.ts` passaram em 23/11/2026. Cobrem schema, tópicos, Preview Java, HTTPS e rejeição da conexão Node herdada. Os resultados da homologação local anterior continuam no relatório 10.
- Changelog e documentação oficial consultados em 19/11/2026. A distinção entre permissões gerenciadas de política e delegação SQL foi incorporada como bloqueador, sem alterar a proposta de migration silenciosamente.

## Próxima autorização solicitada

Autorizar, em etapa posterior, **somente a execução das 25 consultas SELECT deste arquivo contra catálogos do projeto Backstabber aprovado, pelo executor definido, para produzir relatório redigido de compatibilidade**. Essa autorização deverá citar o commit publicado e excluir aplicação de SQL de escrita, criação de roles, alterações de Auth/Realtime e ativação de infraestrutura.

O [relatório original de impacto](10-sprint-03-5c-shared-staging.md) e as propostas de migration/rollback continuam sujeitos ao Gate B e a uma autorização de aplicação separada.
