import type { Card } from 'shared';
import { useSkin } from '../state/skinContext';

interface Props {
  card: Card;
  selected?: boolean;
  small?: boolean;
  onClick?: (card: Card) => void;
}

/**
 * 一張牌。長什麼樣完全由外觀決定 —— 牌桌是 'A♠'，
 * 偽裝外觀是看起來像檔名或指令代號的字，花色只留下四種色調。
 */
export function PlayingCard({ card, selected, small, onClick }: Props) {
  const { skin } = useSkin();
  const face = skin.card(card);

  const className = [
    'card',
    `card--t${face.tone}`,
    selected ? 'card--selected' : '',
    small ? 'card--small' : '',
    onClick ? 'card--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      disabled={!onClick}
      onClick={onClick ? () => onClick(card) : undefined}
      aria-label={face.label}
      aria-pressed={onClick ? Boolean(selected) : undefined}
    >
      <span className="card__corner card__corner--top">
        <span className="card__rank">{face.main}</span>
        <span className="card__suit">{face.sub}</span>
      </span>
      <span className="card__center">{face.sub}</span>
      <span className="card__corner card__corner--bottom">
        <span className="card__rank">{face.main}</span>
        <span className="card__suit">{face.sub}</span>
      </span>
    </button>
  );
}

/** 牌背，用來表示「還有幾張牌」。 */
export function CardBack({ count }: { count: number }) {
  const { t } = useSkin();
  const shown = Math.min(count, 6);
  return (
    <span className="card-back-stack" title={t('card.backTitle', { n: count })}>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="card-back" />
      ))}
      <span className="card-back-stack__count">{count}</span>
    </span>
  );
}
