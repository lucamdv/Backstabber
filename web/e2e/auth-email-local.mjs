import { randomBytes, randomUUID } from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import { setTimeout as wait } from 'node:timers/promises';
import { URL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// Never emit SDK exceptions, session objects, recipients, passwords, codes or mail contents.
console.log = console.warn = console.error = console.debug = () => undefined;
let stage = 'LOCAL_AUTH_GUARD';
let passed = 0;
let failedStatus;
const clients = [];
const storages = new WeakMap();
const output = label => process.stdout.write(label + '\n');
const check = (condition, label, status) => {
  stage = label;
  if (!condition) {
    failedStatus = status;
    throw Error('LOCAL_PROOF_FAILED');
  }
  passed++;
  output(`PASS ${label}${Number.isInteger(status) ? ` HTTP_${status}` : ''}`);
};
const requireLocal = (value, port) => {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== String(port)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('LOCAL_ENDPOINT_REQUIRED');
  return url.origin;
};

try {
  if (process.env.BACKSTABBER_AUTH_EMAIL_PROOF !== 'auth-email-proof') throw Error('LOCAL_OPT_IN_REQUIRED');
  const api = requireLocal(process.env.BACKSTABBER_AUTH_EMAIL_PROOF_URL, 55441);
  const mailpit = requireLocal(process.env.BACKSTABBER_AUTH_EMAIL_PROOF_MAILPIT, 55444);
  const key = process.env.BACKSTABBER_AUTH_EMAIL_PROOF_PUBLISHABLE_KEY;
  if (!key) throw Error('LOCAL_PUBLIC_KEY_REQUIRED');
  const redirectTo = 'http://127.0.0.1:4263/?online=salas&auth=recovery';
  const email = `proof-${randomUUID()}@auth-email-proof.test`;
  const password = `Aa1!${randomBytes(18).toString('hex')}`;
  const replacement = `Bb2!${randomBytes(18).toString('hex')}`;
  const seen = new Set();
  let lastStatus;
  const localFetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== api || !/^\/auth\/v1\/(settings|signup|token|verify|user|logout|recover)$/.test(url.pathname)
      || url.username || url.password) throw Error('LOCAL_AUTH_REQUEST_REQUIRED');
    const response = await globalThis.fetch(input, { ...init, redirect: 'error', signal: globalThis.AbortSignal.timeout(15000) });
    lastStatus = response.status;
    return response;
  };
  const client = () => {
    const values = new Map();
    const supabase = createClient(api, key, {
      auth: {
        flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: `local-proof-${randomUUID()}`,
        storage: { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) },
      }, global: { fetch: localFetch },
    });
    clients.push(supabase);
    storages.set(supabase, values);
    return supabase;
  };
  const mailRequest = async path => {
    const response = await globalThis.fetch(mailpit + path, { redirect: 'error', signal: globalThis.AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('LOCAL_MAILPIT_UNAVAILABLE');
    return response.json();
  };
  const messagesFor = async recipient => {
    const listing = await mailRequest('/api/v1/messages?limit=100');
    return (listing.messages ?? []).filter(message => message.To?.some(to => to.Address === recipient));
  };
  const readMail = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const messages = await messagesFor(email);
      const message = messages.find(item => !seen.has(item.ID));
      if (message) {
        seen.add(message.ID);
        return mailRequest('/api/v1/message/' + encodeURIComponent(message.ID));
      }
      await wait(250);
    }
    throw Error('LOCAL_MAIL_TIMEOUT');
  };

  stage = 'REAL_AUTH_SETTINGS';
  const settingsResponse = await localFetch(api + '/auth/v1/settings', { headers: { apikey: key } });
  const settings = await settingsResponse.json();
  check(settingsResponse.ok && settings.external?.email === true && settings.external?.google !== true
    && settings.mailer_autoconfirm === false, 'REAL_AUTH_SETTINGS', settingsResponse.status);

  stage = 'SHORT_PASSWORD_REJECTED';
  const shortPassword = await client().auth.signUp({ email, password: 'Aa1!xyz' });
  check(shortPassword.error?.code === 'weak_password' && !shortPassword.data.session, 'SHORT_PASSWORD_REJECTED', lastStatus);
  stage = 'MISSING_PASSWORD_CLASSES_REJECTED';
  const missingClasses = await client().auth.signUp({ email, password: 'lettersbutnoclasses' });
  check(missingClasses.error?.code === 'weak_password' && !missingClasses.data.session, 'MISSING_PASSWORD_CLASSES_REJECTED', lastStatus);

  const signup = client();
  stage = 'SIGNUP_REQUIRES_EMAIL_CONFIRMATION';
  const created = await signup.auth.signUp({ email, password });
  const id = created.data.user?.id;
  check(!created.error && id && !created.data.session && !created.data.user.email_confirmed_at, 'SIGNUP_REQUIRES_EMAIL_CONFIRMATION', lastStatus);

  stage = 'UNCONFIRMED_PASSWORD_LOGIN_REJECTED';
  const blocked = await client().auth.signInWithPassword({ email, password });
  check(blocked.error?.code === 'email_not_confirmed' && !blocked.data.session, 'UNCONFIRMED_PASSWORD_LOGIN_REJECTED', lastStatus);

  stage = 'CUSTOM_CONFIRMATION_EMAIL_RECEIVED';
  const confirmation = await readMail();
  const html = confirmation.HTML ?? '';
  const tokens = [...html.matchAll(/>\s*(\d{6})\s*</g)].map(match => match[1]);
  check(tokens.length === 1 && html.includes('IDENTIDADE PENDENTE') && !html.includes('{{ .Token }}'), 'CUSTOM_CONFIRMATION_EMAIL_RECEIVED');
  const otp = tokens[0];
  const wrongOtp = String((Number(otp) + 1) % 1000000).padStart(6, '0');

  stage = 'WRONG_OTP_REJECTED';
  const wrong = await signup.auth.verifyOtp({ email, token: wrongOtp, type: 'signup' });
  check(Boolean(wrong.error) && !wrong.data.session, 'WRONG_OTP_REJECTED', lastStatus);

  stage = 'CORRECT_OTP_CONFIRMS_SAME_UUID';
  const verified = await signup.auth.verifyOtp({ email, token: otp, type: 'signup' });
  check(!verified.error && verified.data.user?.id === id && verified.data.user.email_confirmed_at
    && verified.data.session?.access_token, 'CORRECT_OTP_CONFIRMS_SAME_UUID', lastStatus);

  stage = 'OTP_REUSE_REJECTED';
  const reused = await client().auth.verifyOtp({ email, token: otp, type: 'signup' });
  check(Boolean(reused.error) && !reused.data.session, 'OTP_REUSE_REJECTED', lastStatus);

  stage = 'VERIFIED_PASSWORD_LOGIN_SAME_UUID';
  const passwordClient = client();
  const signedIn = await passwordClient.auth.signInWithPassword({ email, password });
  check(!signedIn.error && signedIn.data.user?.id === id && signedIn.data.session?.access_token, 'VERIFIED_PASSWORD_LOGIN_SAME_UUID', lastStatus);
  stage = 'TRUSTED_GET_USER_CONFIRMED_UUID';
  const trusted = await passwordClient.auth.getUser();
  check(!trusted.error && trusted.data.user?.id === id && trusted.data.user.email_confirmed_at, 'TRUSTED_GET_USER_CONFIRMED_UUID', lastStatus);

  const recovery = client();
  const events = [];
  recovery.auth.onAuthStateChange((event, session) => { events.push({ event, id: session?.user.id }); });
  stage = 'RECOVERY_REQUEST_ACCEPTED';
  const reset = await recovery.auth.resetPasswordForEmail(email, { redirectTo });
  check(!reset.error, 'RECOVERY_REQUEST_ACCEPTED', lastStatus);
  stage = 'CUSTOM_RECOVERY_CONFIRMATION_URL_RECEIVED';
  const recoveryMail = await readMail();
  const recoveryHtml = recoveryMail.HTML ?? '';
  const links = [...recoveryHtml.matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
  const confirmationLink = links.map(link => new URL(link)).find(url => url.origin === api && url.pathname === '/auth/v1/verify' && url.searchParams.get('type') === 'recovery');
  check(confirmationLink && recoveryHtml.includes('RESTAURAR ACESSO') && !recoveryHtml.includes('{{ .ConfirmationURL }}'), 'CUSTOM_RECOVERY_CONFIRMATION_URL_RECEIVED');

  stage = 'OFFICIAL_RECOVERY_LINK_RETURNS_PKCE_CODE';
  const consume = await globalThis.fetch(confirmationLink, { redirect: 'manual', signal: globalThis.AbortSignal.timeout(15000) });
  const callback = new URL(consume.headers.get('location') ?? 'http://invalid.test');
  const code = callback.searchParams.get('code');
  check(consume.status === 303 && callback.origin === 'http://127.0.0.1:4263' && code && !callback.hash.includes('access_token'), 'OFFICIAL_RECOVERY_LINK_RETURNS_PKCE_CODE', consume.status);

  stage = 'RECOVERY_CODE_EXCHANGED_SAME_UUID';
  const verifierSnapshot = [...storages.get(recovery)].filter(([name]) => name.endsWith('-code-verifier'));
  const exchanged = await recovery.auth.exchangeCodeForSession(code);
  check(!exchanged.error && exchanged.data.user?.id === id && exchanged.data.session?.access_token, 'RECOVERY_CODE_EXCHANGED_SAME_UUID', lastStatus);
  check(events.some(event => event.event === 'PASSWORD_RECOVERY' && event.id === id), 'PASSWORD_RECOVERY_EVENT_OBSERVED');

  stage = 'RECOVERY_CODE_REUSE_REJECTED';
  // Replay the real code with its original verifier, so the rejection comes from Auth,
  // rather than merely proving the SDK removed its local verifier after first use.
  for (const [name, value] of verifierSnapshot) storages.get(recovery).set(name, value);
  lastStatus = undefined;
  const repeatedCode = await recovery.auth.exchangeCodeForSession(code);
  check(verifierSnapshot.length > 0 && repeatedCode.error && !repeatedCode.data.session && lastStatus >= 400,
    'RECOVERY_CODE_REUSE_REJECTED', lastStatus);

  stage = 'RECOVERY_UPDATES_PASSWORD_SAME_UUID';
  const updated = await recovery.auth.updateUser({ password: replacement });
  check(!updated.error && updated.data.user?.id === id, 'RECOVERY_UPDATES_PASSWORD_SAME_UUID', lastStatus);
  stage = 'OLD_PASSWORD_REJECTED';
  const oldPassword = await client().auth.signInWithPassword({ email, password });
  check(oldPassword.error?.code === 'invalid_credentials' && !oldPassword.data.session, 'OLD_PASSWORD_REJECTED', lastStatus);
  stage = 'NEW_PASSWORD_LOGIN_SAME_UUID';
  const finalClient = client();
  const newPassword = await finalClient.auth.signInWithPassword({ email, password: replacement });
  check(!newPassword.error && newPassword.data.user?.id === id && newPassword.data.session?.access_token, 'NEW_PASSWORD_LOGIN_SAME_UUID', lastStatus);
  stage = 'REFRESH_PRESERVES_UUID';
  const refreshed = await finalClient.auth.refreshSession();
  check(!refreshed.error && refreshed.data.user?.id === id && refreshed.data.session?.refresh_token, 'REFRESH_PRESERVES_UUID', lastStatus);
  const lastRefreshToken = refreshed.data.session.refresh_token;
  stage = 'LOGOUT_CLEARS_SESSION';
  const signedOut = await finalClient.auth.signOut();
  const ended = await finalClient.auth.getSession();
  check(!signedOut.error && !ended.error && ended.data.session === null, 'LOGOUT_CLEARS_SESSION', lastStatus);
  stage = 'LOGOUT_REVOKES_REFRESH_TOKEN';
  const revokedRefresh = await client().auth.refreshSession({ refresh_token: lastRefreshToken });
  check(revokedRefresh.error && !revokedRefresh.data.session, 'LOGOUT_REVOKES_REFRESH_TOKEN', lastStatus);

  stage = 'MISSING_ACCOUNT_RECOVERY_GENERIC';
  const unknownEmail = `missing-${randomUUID()}@auth-email-proof.test`;
  const missing = await client().auth.resetPasswordForEmail(unknownEmail, { redirectTo });
  check(!missing.error && JSON.stringify(missing.data) === JSON.stringify(reset.data), 'MISSING_ACCOUNT_RECOVERY_GENERIC', lastStatus);
  await wait(750);
  check((await messagesFor(unknownEmail)).length === 0, 'MISSING_ACCOUNT_NO_EMAIL');
  output(`PASS REAL_AUTH_CASES_${passed}`);
} catch {
  output(`FAIL ${stage}${Number.isInteger(failedStatus) ? ` HTTP_${failedStatus}` : ''}`);
  process.exitCode = 1;
} finally {
  for (const supabase of clients) supabase.auth.stopAutoRefresh();
}
