import { expect, test } from 'vitest';
import { maskEmail, passwordRules, validNewPassword } from '../online/auth-policy';

test('requires the approved provider preset only for new passwords', () => {
  expect(validNewPassword('Password1!')).toBe(true);
  for (const value of ['Short1!', 'password1!', 'PASSWORD1!', 'Password!!', 'Password12']) {
    expect(validNewPassword(value)).toBe(false);
  }
  expect(validNewPassword('Long secure Password 123!'.repeat(6))).toBe(true);
  expect(passwordRules('Password1!')).toHaveLength(5);
  expect(passwordRules('Password1!').every(rule => rule.valid)).toBe(true);
});

test('masks addresses without inserting untrusted markup', () => {
  expect(maskEmail('player@example.com')).toBe('p•••••@example.com');
  expect(maskEmail('a@example.com')).toBe('a•••@example.com');
  expect(maskEmail('invalid')).toBe('seu email');
});
