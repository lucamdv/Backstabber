/** Matches Supabase lower_upper_letters_digits_symbols for new/updated passwords. */
export function passwordRules(password: string) {
  return [
    { id: 'length', label: 'Pelo menos 8 caracteres', valid: password.length >= 8 },
    { id: 'upper', label: 'Uma letra maiúscula', valid: /[A-Z]/.test(password) },
    { id: 'lower', label: 'Uma letra minúscula', valid: /[a-z]/.test(password) },
    { id: 'number', label: 'Um número', valid: /[0-9]/.test(password) },
    { id: 'symbol', label: 'Um símbolo (!, @, #…)', valid: /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(password) },
  ];
}

export function validNewPassword(password: string) {
  return passwordRules(password).every(rule => rule.valid);
}

export function maskEmail(email: string) {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return 'seu email';
  return `${email[0]}${'•'.repeat(Math.min(5, Math.max(3, at - 1)))}${email.slice(at)}`;
}
