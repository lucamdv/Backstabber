# Backstabber · Homologação da versão Node.js

Validação em 24/11/2026. A versão oficial segue com React/Vite, API Node.js e PostgreSQL. O checkout local de `main` contém os quatro commits de autenticação anteriores à retomada. A base é o release `f5c38d2bd0a898f3df8ef3a7f784b33d40f537d1`, conferido no GitHub e como origem do deploy de produção READY `dpl_4eR6VVEFdLVhQwQhBKrRXfqkSc2r`. A publicação deste candidato depende de aprovação explícita.

## Preview isolado

Foi usado o frontend compilado em `127.0.0.1:4253`, a API HTTP Node em `127.0.0.1:8769` e a stack Docker descartável `node-preview-proof` com Supabase Auth, PostgreSQL 17.11, Realtime e Mailpit. As URLs recebidas da CLI foram conferidas em memória antes de iniciar os processos. O banco recebeu somente a migration canônica e dados sintéticos. O endpoint de perfil sem sessão retornou HTTP 401 e o frontend respondeu HTTP 200.

| Fluxo | Evidência |
| --- | --- |
| Cadastro, OTP e API | HTTP 200 no cadastro sem abertura de sessão, bloqueio antes da confirmação, código de seis dígitos recebido no Mailpit, verificação HTTP 200 com o UUID original e abertura do perfil pela API Node real. |
| Senha, sessão e refresh | Login HTTP 200, refresh automático do SDK HTTP 200 sem acionar uma atualização manual, mesmo UUID e sessão restaurada após recarga. A validade reduzida a 120 segundos foi aplicada somente ao Auth descartável. |
| Recuperação, retorno e logout | Pedido HTTP 200, email local recebido, retorno HTTP 303 com rota preservada, troca PKCE HTTP 200, senha salva HTTP 200, saída da sessão, senha anterior recusada e nova senha aceita para o mesmo UUID. |
| Logs | Prova do navegador conferiu que credenciais, OTPs, links e tokens sintéticos não apareciam no console. A saída do ensaio usou etapas e status HTTP. |
| Multiplayer pela API | Duas identidades verificadas jogaram do lobby até vitória e revanche. A terceira foi recusada nas rotas privadas e nos canais de terceiros. Bloqueio, Broker e perda foram testados. As mãos e escolhas permaneceram separadas. |
| Multiplayer pelo frontend compilado | Playwright passou em três contextos independentes, com amizade, convite, entrada por código, prontidão, privacidade das mãos, contestação após reconexão, vitória e revanche. Um cenário live aprovado em 56,4 s. |

Os 18 passos do ensaio de Auth passaram usando os endpoints reais em loopback, sem stub de API. O primeiro ensaio de multiplayer parou esperando uma invalidação social do Realtime. A repetição com os serviços saudáveis recebeu a invalidação e concluiu os dois roteiros. A causa exata do primeiro atraso permanece em aberto.

Google OAuth real e vinculação em ambos os sentidos foram comprovados com a interface comum no Preview Java, conforme o [relatório de autenticação](validation-report.md). O ensaio real com a API Node usou email e senha. As credenciais Google de desenvolvimento estavam indisponíveis nesta sessão e o provedor da fixture ficou desabilitado. O retorno para o domínio de produção desta revisão também requer o candidato hospedado ou um ensaio autorizado específico. Os testes de rota verificam o retorno à própria origem, a preservação do código de convite válido e a remoção dos dados do callback.

O Preview testado acima é local. A Vercel contém variáveis de produção e a configuração de Preview do Java. O Node consulta explicitamente `public.bs_*`, por isso um Preview Node hospedado precisa de um PostgreSQL de jogo independente. A stack em loopback fornece esse isolamento para a prova local. Nenhum ambiente Vercel novo foi provisionado para o Node nesta execução.

## Estabilidade e dependências

- A mensagem de sessão expirada passou a oferecer novo login a qualquer jogador. O teste simulou HTTP 401 e confirmou uma renovação, seguida por uma única repetição com o token novo. A renovação recusada manteve o erro de sessão sem repetir a API.
- O npm audit não reportou alertas nas dependências de produção de `web` ou da raiz. O lockfile web anterior acusou dois itens críticos ligados ao Vitest/Tinypool e oito moderados nas ferramentas de desenvolvimento. O candidato usa Vitest 4.1.12 e typescript-eslint 8.74.0. A nova auditoria completa do lockfile web retornou zero alertas. A instalação ficou separada da árvore usada pelos outros checkouts.
- O manifesto desktop ainda usa Electron 38.8.6. O npm registrou três itens altos e sete moderados no grafo completo da raiz, incluindo Electron e dependências de empacotamento. O processo desktop carrega arquivos locais, usa sandbox e isolamento de contexto, desabilita Node no renderer e restringe navegação. Esses controles limitam a superfície observada. A atualização de Electron exige prova dos instaladores, navegação e atualização automática em Windows/macOS. O manifesto e os instaladores ficam fora deste candidato de publicação web. [Política de suporte do Electron](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- O build preserva o aviso existente de chunk acima de 500 kB.

No Vitest 4.1.12, a execução conjunta com PostgreSQL real registrou **181 asserções aprovadas**, em 25 arquivos. Os 24 arquivos padrão passaram e o arquivo nativo excedeu o tempo de 30 segundos no hook de limpeza. A instrumentação isolada mostrou pools encerrados em milissegundos e remoção do banco em cerca de 6,3 s nessa rodada, que encontrou também um timeout de 5 s no cenário de contestação. O código e os limites da suíte original foram preservados. Na repetição final da suíte nativa original em PostgreSQL 17.11, **8 testes passaram**, com código de saída zero e limpeza confirmada. Também passaram typecheck, lint e build com o lockfile novo.

## Entregabilidade

O Gmail SMTP entregou email de confirmação e de recuperação no ensaio hospedado. Uma mensagem de definição de senha caiu no spam e permitiu concluir o fluxo. A busca pelo assunto e destinatário do ensaio no Gmail conectado não encontrou a mensagem, então faltam os resultados SPF, DKIM e DMARC do cabeçalho original. O recebimento e a classificação relatados ficam registrados como resultados distintos.

Para diagnosticar com o mesmo Gmail SMTP, inspecionar apenas os resultados de autenticação em **Mostrar original** da mensagem existente e conferir o alinhamento do remetente. Os templates instalados têm um único CTA de recuperação e o código de confirmação em texto. O Supabase recomenda manter o email transacional focado, sem rastreamento que reescreva links. A autenticação do domínio e a decisão de classificação dependem do provedor. A confirmação de causa exige os cabeçalhos sanitizados. Nenhum ajuste remoto de SMTP ou dos templates foi aplicado. [Orientações do Gmail](https://support.google.com/mail/answer/81126) · [SMTP no Supabase](https://supabase.com/docs/guides/auth/auth-smtp)

## Publicação

O diff foi revisado contra o release atual. A Vercel tem as variáveis Auth/PostgreSQL esperadas em Production e `VITE_API_URL=/api/v1` foi conferido como configuração pública. O rewrite continua encaminhando para o Node. A homologação real de Google no candidato e a prova em Preview hospedado ficam em aberto. A regressão de Electron para Windows/macOS permanece separada do release web.

Aprovação do responsável precede o push de `main`. Após autorização, verificar o SHA e estado READY no alias oficial, o perfil sem sessão, o retorno Google iniciado no domínio oficial e a preservação do perfil de uma conta autorizada. O deploy de produção anterior acima é a referência de reversão no Vercel. O Auth é compartilhado e suas configurações são independentes do rollback de frontend.
