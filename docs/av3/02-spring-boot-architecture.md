# Arquitetura Spring Boot · Sprint 03.1

## Stack

Java 21 LTS, Spring Boot 4.1.2 e Maven 3.9.11 com Wrapper 3.3.4. Spring MVC serve JSON com Jackson 3. Spring Security protege a API e Spring JDBC/HikariCP controla as conexões e transações. Jakarta Validation está disponível para as rotas com entrada estruturada das próximas sprints. O endpoint atual recebe a identidade validada e não consome corpo. Actuator expõe a saúde técnica.

O BOM gerencia pgJDBC 42.7.14, Mockito 5.23.0, Testcontainers 2.0.5 e JUnit Jupiter 6.0.3. Foi testada a opção JUnit 5.14.4, que falhou com `NoSuchMethodError` em `SpringExtension` porque o Spring Framework usa `ExtensionContext.Store.computeIfAbsent`. A versão gerenciada do JUnit mantém a compatibilidade do conjunto, com Java 21 e Spring Boot 4.1.2.

[Requisitos do Spring Boot](https://docs.spring.io/spring-boot/system-requirements.html) · [Starters e BOM](https://docs.spring.io/spring-boot/reference/using/build-systems.html)

## Módulos e limites

| Pacote | Responsabilidade atual |
| --- | --- |
| `com.backstabber` | Inicialização do monólito Spring Boot. |
| `api` | Rota de perfil e tratamento HTTP, com envelope `{"error":"ERROR_CODE"}`. |
| `security` | Bearer stateless, validação no Supabase Auth e CORS por origens explícitas. |
| `social` | Representação do perfil e leitura parametrizada do próprio perfil. |
| `config` | DataSource PostgreSQL e política de TLS e pool. |

As próximas sprints introduzem os pacotes de lobby, jogo e persistência das partidas conforme seus casos de uso. O código atual não precisa de filas, cache distribuído ou servidor auxiliar.

## Identidade e HTTP

Spring Security extrai o Bearer e faz `GET /auth/v1/user` com o access token e a chave pública do projeto. A requisição não segue redirecionamentos. O limite total inclui a leitura do corpo e é de seis segundos por padrão. O UUID retornado pelo Auth se torna o principal, e o controller ignora identificadores fornecidos pelo cliente. A validação rejeita usuários anônimos.

Credencial ausente, sintaxe inválida, sessão rejeitada e identidade inválida retornam `401 UNAUTHENTICATED`. Falha de rede, timeout e resposta upstream indisponível retornam `503 SERVICE_UNAVAILABLE`. Uma resposta de sucesso com JSON malformado conserva `500 INTERNAL_ERROR`, como no Node. O logger registra apenas eventos, classes de erro e status upstream, sem credenciais, URLs ou corpos. Respostas da API usam `Cache-Control: no-store` e `Vary: Origin`. O preflight usa 204 e uma lista explícita de origens.

O Actuator é público apenas nos caminhos de saúde previstos e omite detalhes de componentes. `/actuator/health/liveness` indica a disponibilidade do processo. `/actuator/health/readiness` inclui o banco. As demais rotas de negócio exigem sessão e continuam pendentes. O rewrite interno da Vercel `/api/index` pertence ao deploy do Node.

## PostgreSQL e transações

A configuração decompõe a URI PostgreSQL em host, porta, banco, usuário e senha antes de montar o DataSource. O pool tem até três conexões e espera por uma conexão por até cinco segundos. O driver limita conexão, login e leitura do socket. Conexões remotas exigem a CA fornecida e `sslmode=verify-full` para validar certificado e hostname. A CA é gravada em arquivo temporário para o pgJDBC e removida quando o pool fecha. Apenas `dev` e `test` permitem banco em loopback sem CA.

O perfil abre uma transação de leitura e usa `SET LOCAL` para limitar locks a 3 s, statements a 8 s e inatividade em transação a 10 s. A consulta usa um parâmetro UUID. Falhas de conexão e SQLSTATEs transitórios do Node mapeiam para 503. Erros inesperados retornam 500 sem detalhes de SQL.

Na migração de escritas, a ordem de locks é **sala → partida**, dentro da transação que também decide a revisão, grava a chave de idempotência e publica as invalidações via triggers do esquema. A mesma conexão deve carregar os `SET LOCAL`, locks e mutações. A API Java não inicializa ou altera o esquema.

[Verificação TLS no pgJDBC](https://jdbc.postgresql.org/documentation/ssl/)

## Verificação e uso

Os testes HTTP inicializam o servidor Spring em uma porta efêmera e um Auth simulado em loopback. A suíte nativa usa o PostgreSQL 17, aplica a migração canônica a uma base descartável e simula só os esquemas gerenciados de Auth e Realtime. Ela exercita leitura de perfil, identidade, ausência de perfil, timeout, transações e as permissões SQL dos papéis clientes. A origem Supabase real e o fluxo Google ficam para a homologação AV3. Os modos de execução e as variáveis estão no [README do backend](../../backend/README.md).

As diferenças deliberadas da fundação são a saúde técnica, a política JDBC explícita para TLS e a ausência de redirecionamentos no cliente Auth. Node.js permanece a referência de conformidade e o servidor oficial do jogo.
