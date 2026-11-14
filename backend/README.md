# Backstabber Backend · Spring Boot

Backend AV3 para a migração incremental do servidor. A Sprint 03.2 cobre perfis, amizades, convites e lobby. O backend Node.js continua atendendo o jogo publicado. O [mapa de rotas](../docs/av3/04-sprint-03-2-social-lobby.md) descreve as operações e a fronteira do início de partida.

## Executar localmente

Use JDK 21 e PostgreSQL de desenvolvimento com o esquema canônico. O Maven Wrapper baixa o Maven 3.9.11 e verifica o SHA-256 da distribuição. Os exemplos pressupõem que o PostgreSQL de desenvolvimento já foi provisionado, inclusive os esquemas gerenciados exigidos pela [migração canônica](../supabase/migrations/20261112000101_backstabber_multiplayer.sql). A aplicação não executa migrations.

Configure as variáveis no processo que inicia o Java. [.env.example](.env.example) lista os nomes e pode servir como referência para o seu gerenciador de ambiente. O Spring Boot não carrega esse arquivo automaticamente.

| Variável | Uso |
| --- | --- |
| `SERVER_PORT` | Porta HTTP, padrão 8080. O perfil `dev` liga o servidor em `127.0.0.1`. |
| `SUPABASE_URL` | Origem do Supabase Auth de desenvolvimento. HTTPS é exigido para hosts remotos. |
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública do Auth de desenvolvimento. |
| `DATABASE_URL` | URI `postgresql://usuario:senha@host:porta/banco` ou `postgres://...`. Codifique caracteres reservados nos componentes de credencial. |
| `SUPABASE_DB_CA_CERT` | Certificado CA em PEM, com quebras de linha reais ou sequências literais `\n`. Exigido para o PostgreSQL remoto. |
| `BACKSTABBER_ALLOWED_ORIGIN` | Origens completas permitidas, separadas por vírgula. Vazio permite apenas o uso sem CORS. |
| `SPRING_PROFILES_ACTIVE` | Padrão `dev`. Use `test` para fixtures locais. `homologation` usa os defaults estritos e o ambiente externo. |

A URI é convertida em parâmetros do pgJDBC. O formato `jdbc:` e parâmetros arbitrários não são aceitos. O único parâmetro de consulta aceito é um `sslmode` legado, que não determina a política TLS do aplicativo. Para bancos remotos, o cliente aplica `verify-full`. Em `dev` e `test`, o banco local de loopback pode operar sem TLS se a CA estiver ausente.

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

```sh
cd backend
./mvnw spring-boot:run
```

Com o ambiente configurado, `mvnw clean verify` gera `target/backstabber-backend-0.1.0.jar`, executável com `java -jar target/backstabber-backend-0.1.0.jar`.

## Verificar

```powershell
curl.exe -i http://127.0.0.1:8080/actuator/health/liveness
curl.exe -i http://127.0.0.1:8080/actuator/health/readiness
curl.exe -i http://127.0.0.1:8080/api/v1/profile
```

Liveness verifica o processo. Readiness inclui o PostgreSQL e devolve `503` se ele não responder. Sem sessão, o perfil devolve `401 {"error":"UNAUTHENTICATED"}`. Uma sessão válida consulta apenas o próprio UUID e recebe o perfil ou JSON `null` com HTTP 200. Os testes demonstram o fluxo completo com um Auth simulado.

## Testes

- `mvnw clean verify` roda as verificações de segurança, configuração, CORS, health e falhas de dependências. A suíte nativa é habilitada por um dos modos abaixo.
- `BACKSTABBER_TESTCONTAINERS=true` habilita a suíte de PostgreSQL via Docker/Testcontainers.
- `BACKSTABBER_JAVA_TEST_DATABASE_URL` habilita a mesma suíte num PostgreSQL 17 descartável em `127.0.0.1`. A URI deve apontar para a base de controle `backstabber_native` e para um usuário de teste com permissão de criar bancos e papéis. O teste cria uma base com nome aleatório e a descarta ao final. Use somente credenciais de um cluster de teste isolado.
- `BACKSTABBER_NODE_PARITY=true` adiciona a comparação direta com o handler Node.js. Requer Node no PATH, dependências de `web/` instaladas e um dos modos de PostgreSQL acima.

[Inventário Node.js](../docs/av3/01-backend-inventory.md) · [Arquitetura Java](../docs/av3/02-spring-boot-architecture.md) · [Roteiro de migração](../docs/av3/03-migration-roadmap.md)
