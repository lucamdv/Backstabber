import { useState } from 'react';
import type { Profile as ProfileData, ProfileInput } from './types';

export function Avatar({ profile }: { profile: Pick<ProfileData, 'avatarUrl' | 'displayName'> }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const avatarUrl = profile.avatarUrl;
  if (avatarUrl?.startsWith('https://') && failedUrl !== avatarUrl) {
    return <img className="online-avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer"
      onError={() => setFailedUrl(avatarUrl)} />;
  }
  return <span className="online-avatar" aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase()}</span>;
}

export function ProfileEditor({ profile, defaults, busy, onSave }: {
  profile: ProfileData | null;
  defaults: { displayName: string; avatarUrl: string };
  busy: boolean;
  onSave: (profile: ProfileInput) => void;
}) {
  const [username, setUsername] = useState(profile?.username ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? defaults.displayName);
  const [avatar, setAvatar] = useState(profile ? (profile.avatarUrl ?? '') : defaults.avatarUrl);
  const [showOnline, setShowOnline] = useState(profile?.showOnline ?? false);
  const [error, setError] = useState('');

  return <form className="online-card online-form" onSubmit={event => {
    event.preventDefault();
    const cleanName = displayName.trim();
    const cleanAvatar = avatar.trim();
    if (!cleanName || (cleanAvatar && !cleanAvatar.startsWith('https://'))) {
      setError('Informe um nome de exibição e use um endereço HTTPS para a foto.');
      return;
    }
    setError('');
    onSave({ username: username.trim().toLowerCase(), displayName: cleanName, avatarUrl: cleanAvatar || null, showOnline });
  }}>
    <h2>{profile ? 'Seu perfil' : 'Configure seu perfil'}</h2>
    <label htmlFor="online-username">Nome de usuário</label>
    <input id="online-username" value={username} onChange={event => setUsername(event.target.value)}
      autoComplete="username" minLength={3} maxLength={18} pattern="[A-Za-z0-9_]{3,18}"
      title="Use de 3 a 18 letras sem acento, números ou sublinhados" required />
    <label htmlFor="online-display-name">Nome de exibição</label>
    <input id="online-display-name" value={displayName} onChange={event => setDisplayName(event.target.value)}
      autoComplete="nickname" maxLength={40} required />
    <label htmlFor="online-avatar">URL da foto (opcional)</label>
    <input id="online-avatar" type="url" value={avatar} onChange={event => setAvatar(event.target.value)} maxLength={2048} />
    <label className="online-check">
      <input type="checkbox" checked={showOnline} onChange={event => setShowOnline(event.target.checked)} />
      Mostrar minha disponibilidade aos amigos
    </label>
    {error && <p role="alert">{error}</p>}
    <button className="online-primary" disabled={busy}>Salvar perfil</button>
  </form>;
}
