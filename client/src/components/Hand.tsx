import { sortCards, sortCardsBySuit, type Card } from 'shared';
import { PlayingCard } from './PlayingCard';

export type SortMode = 'rank' | 'suit';

interface Props {
  cards: Card[];
  selected: Set<string>;
  sortMode: SortMode;
  disabled?: boolean;
  emptyLabel: string;
  onToggle: (card: Card) => void;
}

export function Hand({ cards, selected, sortMode, disabled, emptyLabel, onToggle }: Props) {
  const ordered = sortMode === 'suit' ? sortCardsBySuit(cards) : sortCards(cards);

  return (
    <div className="hand">
      {ordered.map((card) => (
        <PlayingCard
          key={card.id}
          card={card}
          selected={selected.has(card.id)}
          onClick={disabled ? undefined : onToggle}
        />
      ))}
      {ordered.length === 0 && <p className="muted">{emptyLabel}</p>}
    </div>
  );
}
