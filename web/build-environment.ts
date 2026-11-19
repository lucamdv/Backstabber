import { resolveGameSchema } from './src/online/environment';

export function validateBuildEnvironment(environment: Record<string, string | undefined>): void {
  const schema = resolveGameSchema(environment.VITE_GAME_SCHEMA);
  const javaPreview = environment.VERCEL_ENV === 'preview'
    && environment.VERCEL_GIT_COMMIT_REF === 'feature/av3-sprint-03-spring-boot';
  if (javaPreview && schema !== 'bs_staging') {
    throw new Error('The Java branch Preview requires VITE_GAME_SCHEMA=bs_staging.');
  }
  if (javaPreview && environment.DATABASE_URL) {
    throw new Error('The Java branch Preview requires DATABASE_URL to be absent or empty so the legacy Node API cannot access the database.');
  }
  if (schema !== 'bs_staging') return;

  const api = environment.VITE_API_URL;
  let url: URL | undefined;
  try { url = api ? new URL(api) : undefined; } catch { /* Report only the variable name, never its value. */ }
  const localHttp = !environment.VERCEL && !javaPreview && api !== undefined
    && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(api);
  if (!url || (url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash) {
    throw new Error('bs_staging requires an explicit HTTPS VITE_API_URL for the Java API (HTTP loopback is allowed only outside Vercel).');
  }
}
