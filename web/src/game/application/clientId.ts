// Web Crypto allows getRandomValues on local HTTP origins as well as HTTPS.
export function createClientId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
