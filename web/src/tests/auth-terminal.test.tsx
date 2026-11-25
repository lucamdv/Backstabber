import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AuthTerminal, type AuthTerminalProps } from '../online/AuthTerminal';

function props(overrides: Partial<AuthTerminalProps> = {}): AuthTerminalProps {
  return {
    view: 'login', busy: false, error: '', notice: '', cooldown: 0,
    pendingEmail: 'jogador@example.com', recoveryAuthorized: false,
    onNavigate: vi.fn(), onGoogle: vi.fn(async () => undefined),
    onPasswordSignIn: vi.fn(async () => undefined), onSignUp: vi.fn(async () => undefined),
    onConfirmEmail: vi.fn(async () => undefined), onResend: vi.fn(async () => undefined),
    onRequestPassword: vi.fn(async () => undefined), onSavePassword: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

test('apresenta o terminal com o modo atual e alterna para cadastro por teclado', async () => {
  const config = props();
  const user = userEvent.setup();
  const view = render(<AuthTerminal {...config} />);
  expect(screen.getByRole('heading', { name: /sua próxima traição começa aqui/i })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Login' })).toHaveAttribute('aria-pressed', 'true');
  screen.getByRole('button', { name: 'Cadastro' }).focus();
  await user.keyboard('{Enter}');
  expect(config.onNavigate).toHaveBeenCalledExactlyOnceWith('signup');
  view.rerender(<AuthTerminal {...config} view="signup" />);
  expect(screen.getByRole('button', { name: 'Cadastro' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Criar conta' })).toHaveFocus();
});

test('login submits credentials and clears them without writing secrets or logging', async () => {
  const user = userEvent.setup();
  const log = vi.spyOn(console, 'log');
  const store = vi.spyOn(Storage.prototype, 'setItem');
  const prompt = vi.spyOn(window, 'prompt');
  const alert = vi.spyOn(window, 'alert');
  const config = props();
  render(<AuthTerminal {...config} />);
  await user.type(screen.getByLabelText('E-mail'), 'jogador@example.com');
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'Password1!');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(config.onPasswordSignIn).toHaveBeenCalledWith('jogador@example.com', 'Password1!');
  await waitFor(() => expect(screen.getByLabelText('Senha', { exact: true })).toHaveValue(''));
  expect(screen.getByLabelText('E-mail')).toHaveValue('');
  expect(store).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  expect(prompt).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(location.href).not.toContain('Password1');
});

test('login offers Google, signup and password recovery with accessible visibility toggle', async () => {
  const user = userEvent.setup();
  const config = props();
  render(<AuthTerminal {...config} />);
  const password = screen.getByLabelText('Senha', { exact: true });
  expect(password).toHaveAttribute('type', 'password');
  await user.click(screen.getByRole('button', { name: 'Mostrar senha' }));
  expect(password).toHaveAttribute('type', 'text');
  await user.click(screen.getByRole('button', { name: 'Ocultar senha' }));
  expect(password).toHaveAttribute('type', 'password');
  await user.click(screen.getByRole('button', { name: 'Continuar com Google' }));
  expect(config.onGoogle).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: /Esqueci minha senha/ }));
  expect(config.onNavigate).toHaveBeenCalledWith('request-password');
  await user.click(screen.getByRole('button', { name: 'Cadastro' }));
  expect(config.onNavigate).toHaveBeenCalledWith('signup');
});

test('signup enforces all password categories and matching confirmation before sending', async () => {
  const user = userEvent.setup();
  const config = props({ view: 'signup' });
  render(<AuthTerminal {...config} />);
  await user.type(screen.getByLabelText('E-mail'), 'novo@example.com');
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'password');
  await user.type(screen.getByLabelText('Confirmar senha'), 'password');
  await user.click(screen.getByRole('button', { name: 'Criar conta' }));
  expect(config.onSignUp).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/requisitos/i);
  await user.clear(screen.getByLabelText('Senha', { exact: true }));
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'Password1!');
  await user.click(screen.getByRole('button', { name: 'Criar conta' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/coincidem/i);
  await user.clear(screen.getByLabelText('Confirmar senha'));
  await user.type(screen.getByLabelText('Confirmar senha'), 'Password1!');
  await user.click(screen.getByRole('button', { name: 'Criar conta' }));
  expect(config.onSignUp).toHaveBeenCalledWith('novo@example.com', 'Password1!');
});

test('view changes clear credentials and put keyboard focus on the new title', async () => {
  const user = userEvent.setup();
  const config = props();
  const { rerender } = render(<AuthTerminal {...config} />);
  await user.type(screen.getByLabelText('E-mail'), 'private@example.com');
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'Secret1!');
  rerender(<AuthTerminal {...config} view="signup" />);
  expect(screen.getByLabelText('E-mail')).toHaveValue('');
  expect(screen.getByLabelText('Senha', { exact: true })).toHaveValue('');
  expect(screen.getByRole('heading', { name: 'Criar conta' })).toHaveFocus();
});

test('verification uses one six digit input, masks email and respects resend cooldown', async () => {
  const user = userEvent.setup();
  const config = props({ view: 'verify-email', cooldown: 27 });
  const { rerender } = render(<AuthTerminal {...config} />);
  expect(screen.queryByText('jogador@example.com')).not.toBeInTheDocument();
  const code = screen.getByLabelText('Código de 6 dígitos');
  expect(code).toHaveAttribute('inputmode', 'numeric');
  expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await user.type(code, '12a34');
  await user.click(screen.getByRole('button', { name: 'Confirmar código' }));
  expect(config.onConfirmEmail).not.toHaveBeenCalled();
  await user.clear(code);
  await user.type(code, '123456');
  await user.click(screen.getByRole('button', { name: 'Confirmar código' }));
  expect(config.onConfirmEmail).toHaveBeenCalledWith('123456');
  expect(screen.getByRole('button', { name: /Reenviar código/ })).toBeDisabled();
  rerender(<AuthTerminal {...config} cooldown={0} />);
  await user.click(screen.getByRole('button', { name: /Reenviar código/ }));
  expect(config.onResend).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: /Corrigir e-mail/ }));
  expect(config.onNavigate).toHaveBeenCalledWith('signup');
  expect(screen.getByText(/código pode expirar/i)).toBeInTheDocument();
});

test('recovery requests email with generic account existence messaging', async () => {
  const user = userEvent.setup();
  const config = props({ view: 'request-password' });
  render(<AuthTerminal {...config} />);
  expect(screen.getByText(/Se este endereço estiver associado/i)).toBeInTheDocument();
  await user.type(screen.getByLabelText('E-mail'), 'recuperar@example.com');
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperação' }));
  expect(config.onRequestPassword).toHaveBeenCalledWith('recuperar@example.com');
});

test('password update requires recovery authorization and validates confirmation', async () => {
  const user = userEvent.setup();
  const config = props({ view: 'set-password' });
  const { rerender } = render(<AuthTerminal {...config} />);
  expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Solicitar novo link/ })).toBeEnabled();
  rerender(<AuthTerminal {...config} recoveryAuthorized />);
  await user.type(screen.getByLabelText('Nova senha'), 'Password1!');
  await user.type(screen.getByLabelText('Confirmar senha'), 'Different1!');
  await user.click(screen.getByRole('button', { name: 'Salvar senha' }));
  expect(config.onSavePassword).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/coincidem/i);
  await user.clear(screen.getByLabelText('Confirmar senha'));
  await user.type(screen.getByLabelText('Confirmar senha'), 'Password1!');
  await user.click(screen.getByRole('button', { name: 'Salvar senha' }));
  expect(config.onSavePassword).toHaveBeenCalledWith('Password1!');
});

test('saved screen returns to login and announces success', async () => {
  const user = userEvent.setup();
  const config = props({ view: 'password-saved' });
  render(<AuthTerminal {...config} />);
  expect(screen.getByRole('status')).toHaveTextContent(/salva/i);
  await user.click(screen.getByRole('button', { name: 'Voltar para entrar' }));
  expect(config.onNavigate).toHaveBeenCalledWith('login');
});

test('busy disables submission and navigation and provider errors are announced', () => {
  const config = props({ busy: true, error: 'Não foi possível entrar.', notice: 'Tente novamente.' });
  render(<AuthTerminal {...config} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível entrar.');
  expect(screen.getByRole('status')).toHaveTextContent('Tente novamente.');
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  fireEvent.submit(screen.getByRole('button', { name: /Entrando/ }).closest('form')!);
  expect(config.onPasswordSignIn).not.toHaveBeenCalled();
});
