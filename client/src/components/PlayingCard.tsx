import { RANK_LABEL, SUIT_SYMBOL, type Card } from 'shared';

const RED_SUITS = new Set(['H', 'D']);

interface Props {
  card: Card;
  selected?: boolean;
  small?: boolean;
  onClick?: (card: Card) => void;
}

export function PlayingCard({ card, selected, small, onClick }: Props) {
  const className = [
    'card',
    RED_SUITS.has(card.suit) ? 'card--red' : 'card--black',
    selected ? 'card--selected' : '',
    small ? 'card--small' : '',
    onClick ? 'card--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const label = `${SUIT_SYMBOL[card.suit]}${RANK_LABEL[card.rank]}`;

  return (
    <button
      type="button"
      className={className}
      disabled={!onClick}
      onClick={onClick ? () => onClick(card) : undefined}
      aria-label={label}
      aria-pressed={onClick ? Boolean(selected) : undefined}
    >
      <span className="card__corner card__corner--top">
        <span className="card__rank">{RANK_LABEL[card.rank]}</span>
        <span className="card__suit">{SUIT_SYMBOL[card.suit]}</span>
      </span>
      <span className="card__center">{SUIT_SYMBOL[card.suit]}</span>
      <span className="card__corner card__corner--bottom">
        <span className="card__rank">{RANK_LABEL[card.rank]}</span>
        <span className="card__suit">{SUIT_SYMBOL[card.suit]}</span>
      </span>
    </button>
  );
}

/** 牌背，用來表示「還有幾張牌」。 */
export function CardBack({ count }: { count: number }) {
  const shown = Math.min(count, 6);
  return (
    <span className="card-back-stack" title={`剩 ${count} 張`}>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="card-back" />
      ))}
      <span className="card-back-stack__count">{count}</span>
    </span>
  );
}
