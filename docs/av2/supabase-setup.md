# Supabase de homologação

Use o projeto dedicado `backstabber-homologacao`. Para desenvolvimento com Docker, rode `npx supabase start` na raiz e aplique as migrações locais com `npx supabase migration up --local`. O projeto remoto de homologação já recebeu a migração `20261112000101_backstabber_multiplayer`. Para novos ambientes remotos, confira primeiro o projeto vinculado e o histórico de migrações, depois aplique os arquivos versionados com a CLI ou pelo conector autorizado.

Em **Project Settings → API Keys**, obtenha a URL do projeto e a chave **Publishable**. Copie `web/.env.example` para `web/.env` e preencha:

| Variável | Origem |
| --- | --- |
| `VITE_SUPABASE_URL`, `SUPABASE_URL` | URL HTTPS do projeto. HTTP é aceito para Supabase no loopback. |
| `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Chave Publishable do mesmo projeto. |
| `VITE_API_URL` | `/api/v1` quando frontend e API compartilham origem. |
| `DATABASE_URL` | String PostgreSQL com senha do banco, obtida em **Connect**. Para Vercel, selecione **Transaction pooler**. |
| `SUPABASE_DB_CA_CERT` | Para conexão PostgreSQL remota, conteúdo PEM completo do certificado CA baixado em **Supabase → Database Settings → SSL Configuration → Download Certificate**. Cadastrar como variável do servidor apenas (Preview na homologação). O cliente `pg` valida certificado e hostname sem desativar SSL. |
| `BACKSTABBER_ALLOWED_ORIGIN` | Origens exatas permitidas, separadas por vírgula, somente para API em outra origem. |

Guarde a string do banco no ambiente do servidor. A CA é um certificado público, mas **não** inclua a senha ou outras credenciais em Git. Para usar `ssl: { ca, rejectUnauthorized: true }`, o servidor remove opções `sslmode`/`sslrootcert` da URI antes de passá-la ao driver, evitando que `pg` sobrescreva a configuração explícita. Sem CA válida a conexão remota falha de forma segura (HTTP 503). O Git ignora `web/.env` e os arquivos de sessão do Playwright. O cliente nunca recebe senha, role privilegiada ou secret key. Execute `npm run dev:api` e `npm run dev` em terminais separados, ambos em `web/`.

Em **Realtime → Settings**, desabilite o acesso por canais públicos. Confirme que o cliente se inscreve em `room:<uuid>` e `user:<uuid>` como canais privados. A alteração de sala ou amizade deve emitir apenas `invalidate`, seguida de um novo snapshot HTTP. Presence indica conectividade e o heartbeat autorizado valida a prontidão. Verifique com um membro, um não membro e uma sessão que acabou de sair da sala. Mesmo se uma conexão antiga continuar recebendo invalidações em cache, a API deve rejeitar seus snapshots.

Os advisors do projeto vazio registraram avisos informativos de RLS sem política nas sete tabelas destinadas à API e índices ainda sem uso. A política restritiva nessas tabelas é intencional. Na leitura pelo papel `authenticated`, a exceção é o próprio vínculo em colunas específicas de membros para autorizar o Realtime. Consulte os [advisors de banco](https://supabase.com/docs/guides/database/database-linter) novamente após a primeira rodada de uso. [Autorização Realtime](https://supabase.com/docs/guides/realtime/authorization) · [Conexões PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).
