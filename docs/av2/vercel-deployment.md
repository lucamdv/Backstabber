# Preview Vercel

O projeto `backstabber-homologacao` usa a raiz do repositório. As variáveis públicas do Supabase e as do servidor que contêm apenas URL e chave Publishable já foram cadastradas para **Preview**. Cadastre `DATABASE_URL` em **Settings → Environment Variables**, marcada como **Sensitive** e limitada a **Preview**. Use **Connect → Transaction pooler** no Supabase, com a senha do banco e TLS com verificação do certificado. Se o pooler exigir CA personalizada, use a cadeia oficial da conexão no ambiente do servidor.

O runtime Node.js usa a função `api/index.ts`. As reescritas encaminham `/api/v1/*` para ela. O pool é reutilizado por instância e conectado ao ciclo de vida da Vercel com `attachDatabasePool`. Cada requisição usa uma transação com limites locais de 3 s para locks, 8 s por instrução e 10 s ociosa. A API reverte a transação em caso de erro e descarta a conexão se o rollback falhar.

Para publicar um preview autorizado, faça login na CLI Vercel, vincule o checkout da Sprint 02.1 ao projeto dedicado e rode `vercel deploy` na raiz. O comando sem a opção de produção publica o preview. Na URL publicada, confirme que `GET /api/v1/profile` sem token retorna JSON 401 e não o HTML do Vite. Com uma conta autenticada, carregue o perfil, crie uma sala e confirme nos logs que a função acessou o banco. Inclua a origem do preview nas configurações Google e Supabase antes do teste autenticado. Um build local do frontend não substitui essas verificações.

[Runtime Node.js](https://vercel.com/docs/functions/runtimes/node-js) · [Pooling em Vercel Functions](https://vercel.com/kb/guide/connection-pooling-with-functions).
