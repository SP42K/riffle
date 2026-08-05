import { SUITS, SUIT_ORDER, makeCard } from 'shared';
import { useSkin } from '../state/skinContext';

/** 由小到大，只算一次 —— 花色順序不會變。 */
const ASCENDING = [...SUITS].sort((a, b) => SUIT_ORDER[a] - SUIT_ORDER[b]);

/**
 * 花色由小到大的對照表。
 * 偽裝外觀把花色換成了副檔名或代號，看不出誰大誰小，所以在手牌上方標一排出來。
 * 每一格沿用牌面的色調 class，三種外觀的顏色就自動跟著走。
 */
export function SuitOrder() {
  const { skin, t } = useSkin();

  return (
    <p className="suit-order">
      <span className="suit-order__label">{t('bigTwo.suitOrder')}</span>
      {ASCENDING.map((suit, index) => {
        const face = skin.card(makeCard(suit, 3));
        return (
          <span key={suit} className="suit-order__step">
            {index > 0 && (
              <span className="suit-order__lt" aria-hidden="true">
                {'<'}
              </span>
            )}
            <span className={`suit-order__item card--t${face.tone}`}>{face.sub}</span>
          </span>
        );
      })}
    </p>
  );
}
