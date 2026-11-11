import type { ReactNode } from 'react';
import type { Character } from '../../game/application/contracts';
import { characterName } from './gameDisplay';

interface CardProps {
  character?: Character;
  label?: string;
  className?: string;
  children?: ReactNode;
  animationDelay?: string;
  onSelect?: () => void;
  selected?: boolean;
}

export function Card({ character, label, className = '', children, animationDelay, onSelect, selected }: CardProps) {
  const art = `carta carta-${character ?? 'verso'} ${className}`;
  const accessibleName = label ?? (character ? characterName[character] : 'Influência virada para baixo');
  if (onSelect) {
    return <button type="button" className={`${art} carta-escolha`} aria-label={accessibleName}
      aria-pressed={selected} onClick={onSelect} />;
  }
  return <div className={art} role="img" aria-label={accessibleName} title={accessibleName}
    style={animationDelay ? { animationDelay } : undefined}>{children}</div>;
}
