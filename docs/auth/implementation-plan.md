# Autenticação unificada — desenho e execução

## Decisões

Supabase Auth continua sendo o único emissor de identidade e responsável por senhas, códigos, sessões, recuperação e vinculação. A aplicação mantém o UUID como chave canônica e não associa contas por email. A vinculação automática depende da confirmação segura do email pelo provedor; emails distintos não são vinculados por esta interface. Não há alteração de dados, regras, migrations ou políticas do jogo nesta entrega.

O frontend compartilhado terá seis vistas: login, cadastro, confirmação, solicitação de recuperação/primeira senha, definição autorizada e sucesso. Campos sensíveis vivem apenas no estado do formulário e são apagados ao mudar de vista ou concluir uma operação. A sessão oficial permanece sob o mecanismo de persistência do SDK; isso não significa persistir senhas ou OTPs. A política aprovada para **novas** senhas é a predefinição suportada pelo Supabase: 8 caracteres, maiúscula, minúscula, número e símbolo. O login não aplica a nova composição a senhas antigas.

Somente `PASSWORD_RECOVERY` autoriza a tela de alteração. Um parâmetro de URL não concede autorização. O contexto permanece em memória com o cliente e é associado ao UUID. Antes da alteração, o frontend consulta a identidade atual e vincula o PUT à autorização validada, recusando uma troca de conta concorrente. O backend continua validando cada bearer por `/auth/v1/user`, exigindo identidade não anônima e `email_confirmed_at` confiável.

Todos os retornos são construídos a partir da origem/caminho do frontend atual; somente a rota conhecida e um convite hexadecimal válido são preservados. O SDK consome PKCE antes da limpeza da URL. Não há domínio de produção como fallback. A lista de Redirect URLs do Supabase precisa permitir exatamente cada retorno em uso; se o provedor substituir um destino não permitido por Site URL, corrigir sua lista, sem contornar a verificação no frontend.

## Sequência implementada

1. Auditar contratos atuais, documentação oficial e diferenças entre branches; preparar checkout separado de main atualizada ao remoto existente.
2. Escrever testes que demonstram falhas: confirmação ausente no backend, sanitização, contrato das seis vistas, política, rotas e fluxos SDK.
3. Implementar terminal, controller e proteção de transporte; revisar concorrência e navegação de recuperação independentemente.
4. Versionar HTML/texto dos emails e configuração **local** do provedor; validar entregas no Mailpit descartável.
5. Executar regressões Java/Node/React, browser e builds. Separar provas com mocks, Supabase local e serviços hospedados.
6. Replicar somente arquivos comuns e Node em main, preservando tópicos/schema/build guard exclusivos da branch Java. Revisar e criar commits identificáveis. Publicação em produção depende da validação externa pertinente.

## Fronteiras de ambiente

`main` mantém backend Node, esquema público e tópicos atuais. A branch Java mantém `VITE_GAME_SCHEMA=bs_staging`, API HTTPS Java explícita e proteção que impede `DATABASE_URL` no Preview. Esta entrega não instala staging remoto, não preenche uma URL Render inventada, não muda rewrite oficial para Java e não remove os gates de backup/migration/hospedagem anteriores. Um projeto Supabase compartilhado pode compartilhar Auth conforme a arquitetura já aprovada; compartilhar Auth não concede acesso aos dados do outro schema. Projetos de Auth diferentes não têm UUIDs mesclados.

## Critério de liberação

O relatório `validation-report.md` distingue execução real, mocks e pendências. Sem prova de entrega SMTP externa, Google nos dois sentidos e preservação do UUID hospedado, o aceite integral permanece pendente. O endereço autorizado para um teste controlado não é incluído em fixtures, capturas ou bundles. Não há disparos automáticos em falha de senha nem testes massivos remotos.
