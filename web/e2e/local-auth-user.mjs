import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

/** Test fixture only. Reads confirmation mail exclusively from loopback Mailpit. */
export async function confirmLocalSignup(client, signup, email, mailpit) {
  const url = new URL(mailpit);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.equal(Boolean(signup.error), false, 'Local signup failed');
  if (signup.data.session) return; // Older disposable fixtures may auto-confirm.
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await globalThis.fetch(new URL('/api/v1/messages', url), { redirect: 'error' });
    assert.equal(response.status, 200, 'Local SMTP capture unavailable');
    const inbox = await response.json();
    const message = inbox.messages?.find(item => item.To?.some(recipient => recipient.Address === email));
    if (message) {
      const detail = await (await globalThis.fetch(new URL(`/api/v1/message/${encodeURIComponent(message.ID)}`, url), { redirect: 'error' })).json();
      const text = detail.Text || String(detail.HTML ?? '').replace(/<[^>]*>/g, ' ');
      const token = text.match(/(?<![a-zA-Z0-9])\d{6}(?![a-zA-Z0-9])/)?.[0];
      assert.ok(token, 'Local confirmation mail lacks a numeric OTP');
      const verified = await client.auth.verifyOtp({ email, token, type: 'signup' });
      assert.equal(Boolean(verified.error), false, 'Local confirmation failed');
      return;
    }
    await delay(200);
  }
  throw new Error('Local confirmation mail did not arrive');
}
