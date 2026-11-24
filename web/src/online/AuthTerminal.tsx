import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { maskEmail, passwordRules, validNewPassword } from './auth-policy';
import './auth-terminal.css';

export type AuthView = 'login' | 'signup' | 'verify-email' | 'request-password' | 'set-password' | 'password-saved';

export type AuthTerminalProps = {
  view: AuthView;
  busy: boolean;
  error: string;
  notice: string;
  cooldown: number;
  pendingEmail: string;
  recoveryAuthorized: boolean;
  onNavigate: (view: AuthView) => void;
  onGoogle: () => Promise<void>;
  onPasswordSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
  onConfirmEmail: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onRequestPassword: (email: string) => Promise<void>;
  onSavePassword: (password: string) => Promise<void>;
};

const copy: Record<AuthView, { title: string; subtitle: string; step: string }> = {
  login: { title: 'Entrar no sistema', subtitle: 'Sua próxima jogada começa aqui.', step: 'ACESSO / 01' },
  signup: { title: 'Criar conta', subtitle: 'Escolha suas credenciais. Prepare sua estratégia.', step: 'CADASTRO / 01' },
  'verify-email': { title: 'Verifique sua identidade', subtitle: 'Só mais um passo para entrar na partida.', step: 'CADASTRO / 02' },
  'request-password': { title: 'Recuperar acesso', subtitle: 'Defina ou recupere sua senha por e-mail.', step: 'RECUPERAÇÃO / 01' },
  'set-password': { title: 'Definir nova senha', subtitle: 'Uma nova chave para a sua conta.', step: 'RECUPERAÇÃO / 02' },
  'password-saved': { title: 'Senha salva', subtitle: 'Seu acesso está pronto para a próxima jogada.', step: 'ACESSO / PRONTO' },
};

function EyeIcon({ visible }: { visible: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {visible && <path d="m3 3 18 18" />}
  </svg>;
}

function PasswordField({ id, label, value, onChange, disabled, current, description }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  disabled: boolean; current?: boolean; description?: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-field">
    <label htmlFor={id}>{label}</label>
    <div className="auth-password">
      <input id={id} type={visible ? 'text' : 'password'} value={value} required disabled={disabled}
        autoComplete={current ? 'current-password' : 'new-password'}
        aria-describedby={description} onChange={event => onChange(event.target.value)} />
      <button type="button" className="auth-eye" aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}
        aria-pressed={visible} disabled={disabled} onClick={() => setVisible(!visible)}>
        <EyeIcon visible={visible} />
      </button>
    </div>
  </div>;
}

function TerminalPanel(props: AuthTerminalProps) {
  const { view, busy, error, notice, cooldown, pendingEmail, recoveryAuthorized } = props;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const active = useRef(true);
  const id = useId();
  const disabled = busy || submitting;
  const newPassword = view === 'signup' || view === 'set-password';
  const emailView = view === 'login' || view === 'signup' || view === 'request-password';
  const passwordView = view === 'login' || view === 'signup' || (view === 'set-password' && recoveryAuthorized);
  const message = localError || error;
  const descriptions = [newPassword ? `${id}-rules` : '', message ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

  useEffect(() => {
    active.current = true;
    title.current?.focus();
    return () => { active.current = false; };
  }, []);

  function clearFields() {
    setEmail('');
    setPassword('');
    setConfirmation('');
    setCode('');
  }

  function navigate(destination: AuthView) {
    clearFields();
    setLocalError('');
    props.onNavigate(destination);
  }

  async function run(operation: () => Promise<void>) {
    if (disabled) return;
    setLocalError('');
    setSubmitting(true);
    try {
      await operation();
      if (active.current) clearFields();
    } catch {
      if (active.current) setLocalError('Não foi possível concluir. Tente novamente.');
    } finally {
      if (active.current) setSubmitting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    if (newPassword && !validNewPassword(password)) {
      setLocalError('Complete todos os requisitos de senha abaixo.');
      return;
    }
    if (newPassword && password !== confirmation) {
      setLocalError('As senhas não coincidem. Confira a confirmação.');
      return;
    }
    if (view === 'login') void run(() => props.onPasswordSignIn(email.trim(), password));
    if (view === 'signup') void run(() => props.onSignUp(email.trim(), password));
    if (view === 'request-password') void run(() => props.onRequestPassword(email.trim()));
    if (view === 'set-password' && recoveryAuthorized) void run(() => props.onSavePassword(password));
    if (view === 'verify-email') {
      if (!/^\d{6}$/.test(code)) {
        setLocalError('Digite os 6 dígitos do código recebido.');
        return;
      }
      void run(() => props.onConfirmEmail(code));
    }
  }

  const submitLabels = {
    login: ['Entrar', 'Entrando…'], signup: ['Criar conta', 'Criando conta…'],
    'verify-email': ['Confirmar código', 'Confirmando…'],
    'request-password': ['Enviar link de recuperação', 'Enviando…'],
    'set-password': ['Salvar senha', 'Salvando…'], 'password-saved': ['', ''],
  };

  return <section className="auth-terminal" aria-labelledby={`${id}-title`} aria-busy={disabled}>
    <div className="auth-terminal-bar" aria-hidden="true">
      <span><i /> BACKSTABBER // ONLINE</span><span>AUTH_TERMINAL</span>
    </div>
    <div className="auth-terminal-body">
      <header className="auth-heading">
        <img src="images/isotipo.png" alt="" width="50" height="50" />
        <div><p className="auth-step">{copy[view].step}</p>
          <h2 id={`${id}-title`} ref={title} tabIndex={-1}>{copy[view].title}</h2>
        </div>
      </header>
      <p className="auth-subtitle">{copy[view].subtitle}</p>
      <div className="auth-feedback">
        <p id={`${id}-error`} className="auth-error" role="alert" aria-atomic="true">{message}</p>
        <p className="auth-notice" role="status" aria-live="polite" aria-atomic="true">
          {notice || (view === 'password-saved' ? 'Sua senha foi salva. Entre com a nova senha.' : '')}
        </p>
      </div>
      {view === 'request-password' && <p className="auth-info">Se este endereço estiver associado a uma conta, você receberá um link para definir uma nova senha.</p>}
      {view === 'verify-email' && <div className="auth-info" id={`${id}-code-help`}>
        <p>Se houver uma confirmação pendente, use o código enviado para <strong>{pendingEmail ? maskEmail(pendingEmail) : 'seu e-mail'}</strong>.</p>
        <p>O código pode expirar. Use o mais recente recebido.</p>
      </div>}
      {view === 'set-password' && !recoveryAuthorized ? <div className="auth-expired">
        <p className="auth-info">Abra o link enviado ao seu e-mail para definir a senha. Se o link não funcionar, solicite outro.</p>
        <button type="button" className="auth-primary" disabled={disabled} onClick={() => navigate('request-password')}>Solicitar novo link</button>
      </div> : view !== 'password-saved' && <form className="auth-form" onSubmit={submit}>
        {emailView && <div className="auth-field">
          <label htmlFor={`${id}-email`}>E-mail</label>
          <input id={`${id}-email`} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            placeholder="voce@exemplo.com" value={email} disabled={disabled} required
            aria-describedby={message ? `${id}-error` : undefined} onChange={event => setEmail(event.target.value)} />
        </div>}
        {passwordView && <PasswordField id={`${id}-password`} label={view === 'set-password' ? 'Nova senha' : 'Senha'}
          value={password} onChange={setPassword} disabled={disabled} current={view === 'login'} description={descriptions} />}
        {newPassword && <>
          <ul className="auth-rules" id={`${id}-rules`} aria-label="Requisitos de senha">
            {passwordRules(password).map(rule => <li key={rule.id} data-valid={rule.valid}>
              <span aria-hidden="true">{rule.valid ? '✓' : '○'}</span>
              <span className="auth-sr-only">{rule.valid ? 'Atendido: ' : 'Pendente: '}</span>{rule.label}
            </li>)}
          </ul>
          <PasswordField id={`${id}-confirmation`} label="Confirmar senha" value={confirmation}
            onChange={setConfirmation} disabled={disabled} description={message ? `${id}-error` : undefined} />
          {confirmation && <p className="auth-match" data-valid={password === confirmation}>
            {password === confirmation ? '✓ As senhas coincidem.' : 'As senhas ainda não coincidem.'}
          </p>}
        </>}
        {view === 'verify-email' && <div className="auth-field">
          <label htmlFor={`${id}-code`}>Código de 6 dígitos</label>
          <input className="auth-code" id={`${id}-code`} type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} required disabled={disabled}
            aria-describedby={`${id}-code-help${message ? ` ${id}-error` : ''}`}
            onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>}
        <button type="submit" className="auth-primary" disabled={disabled}>
          {submitLabels[view][disabled ? 1 : 0]}<span aria-hidden="true">↗</span>
        </button>
      </form>}
      {view === 'login' && <>
        <div className="auth-divider"><span>ou continue com</span></div>
        <button type="button" className="auth-google" disabled={disabled} onClick={() => void run(props.onGoogle)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
            <path fill="#34a853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z" />
            <path fill="#fbbc05" d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z" />
            <path fill="#ea4335" d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59C7.2 7.71 9.4 5.95 12 5.95Z" />
          </svg>Continuar com Google
        </button>
        <button type="button" className="auth-link auth-recovery" disabled={disabled} onClick={() => navigate('request-password')}>
          Esqueci minha senha <span>Definir ou recuperar senha</span>
        </button>
        <div className="auth-bottom"><span>Ainda não tem uma conta?</span>
          <button type="button" className="auth-link" disabled={disabled} onClick={() => navigate('signup')}>Criar conta</button>
        </div>
      </>}
      {view === 'verify-email' && <div className="auth-secondary">
        <button type="button" className="auth-outline" disabled={disabled || cooldown > 0} onClick={() => void run(props.onResend)}>
          {cooldown > 0 ? `Reenviar código em ${cooldown}s` : 'Reenviar código'}
        </button>
        <button type="button" className="auth-link" disabled={disabled} onClick={() => navigate('signup')}>Corrigir e-mail</button>
      </div>}
      {view !== 'login' && <button type="button" className="auth-link auth-back" disabled={disabled} onClick={() => navigate('login')}>
        {view === 'password-saved' ? 'Voltar para entrar' : '← Voltar para entrar'}
      </button>}
    </div>
    <footer className="auth-terminal-footer" aria-hidden="true"><span>CONEXÃO SEGURA</span><span>JOGUE COM ESTRATÉGIA.</span></footer>
  </section>;
}

export function AuthTerminal(props: AuthTerminalProps) {
  return <TerminalPanel key={props.view} {...props} />;
}
