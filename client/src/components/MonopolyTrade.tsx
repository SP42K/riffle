import { useState } from 'react';
import type { MonopolyEstateId, MonopolyEstateView, PlayerId, SeatView } from 'shared';
import { useSkin } from '../state/skinContext';

export interface TradeOffer {
  to: PlayerId;
  give: MonopolyEstateId[];
  giveCash: number;
  want: MonopolyEstateId[];
  wantCash: number;
}

interface Props {
  /** 可以交易的對象，已經濾掉自己與破產的人。 */
  partners: readonly SeatView[];
  estates: readonly MonopolyEstateView[];
  myPlayerId: PlayerId;
  onOffer: (offer: TradeOffer) => void;
  onCancel: () => void;
}

/**
 * 提出交易的雙欄選擇器。
 * 只負責把提議組出來，合不合法交給伺服器judge —— 這裡不重寫規則。
 */
export function MonopolyTrade({ partners, estates, myPlayerId, onOffer, onCancel }: Props) {
  const { skin, t } = useSkin();
  const [to, setTo] = useState<PlayerId>(partners[0]?.playerId ?? '');
  const [give, setGive] = useState<MonopolyEstateId[]>([]);
  const [want, setWant] = useState<MonopolyEstateId[]>([]);
  const [giveCash, setGiveCash] = useState(0);
  const [wantCash, setWantCash] = useState(0);

  const mine = estates.filter((estate) => estate.owner === myPlayerId);
  const theirs = estates.filter((estate) => estate.owner === to);

  // 換了對象，原本勾的對方地產就不再屬於他了
  const pickPartner = (playerId: PlayerId) => {
    setTo(playerId);
    setWant([]);
    setWantCash(0);
  };

  const toggle = (
    list: MonopolyEstateId[],
    set: (next: MonopolyEstateId[]) => void,
    tile: MonopolyEstateId,
  ) => set(list.includes(tile) ? list.filter((id) => id !== tile) : [...list, tile]);

  const empty = give.length + want.length === 0 && giveCash === 0 && wantCash === 0;

  return (
    <form
      className="monopoly__trade"
      onSubmit={(event) => {
        event.preventDefault();
        onOffer({ to, give, giveCash, want, wantCash });
      }}
    >
      <label className="monopoly__trade-target">
        {t('monopoly.tradeTarget')}
        <select value={to} onChange={(event) => pickPartner(event.target.value)}>
          {partners.map((seat) => (
            <option key={seat.playerId} value={seat.playerId}>
              {seat.nickname}
            </option>
          ))}
        </select>
      </label>

      <div className="monopoly__trade-cols">
        <TradeColumn
          title={t('monopoly.tradeGive')}
          options={mine}
          picked={give}
          cash={giveCash}
          onToggle={(tile) => toggle(give, setGive, tile)}
          onCash={setGiveCash}
          label={(tile) => skin.monopolyTile[tile]}
          emptyText={t('monopoly.tradeNothing')}
          cashLabel={t('monopoly.tradeCashLabel')}
        />
        <TradeColumn
          title={t('monopoly.tradeWant')}
          options={theirs}
          picked={want}
          cash={wantCash}
          onToggle={(tile) => toggle(want, setWant, tile)}
          onCash={setWantCash}
          label={(tile) => skin.monopolyTile[tile]}
          emptyText={t('monopoly.tradeNothing')}
          cashLabel={t('monopoly.tradeCashLabel')}
        />
      </div>

      <div className="monopoly__trade-actions">
        <button type="submit" className="btn btn--primary" disabled={!to || empty}>
          {t('monopoly.offerTrade')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('monopoly.cancelTrade')}
        </button>
      </div>
    </form>
  );
}

function TradeColumn({
  title,
  options,
  picked,
  cash,
  onToggle,
  onCash,
  label,
  emptyText,
  cashLabel,
}: {
  title: string;
  options: readonly MonopolyEstateView[];
  picked: readonly MonopolyEstateId[];
  cash: number;
  onToggle: (tile: MonopolyEstateId) => void;
  onCash: (value: number) => void;
  label: (tile: MonopolyEstateId) => string;
  emptyText: string;
  cashLabel: string;
}) {
  return (
    <div className="monopoly__trade-col">
      <h3>{title}</h3>
      {options.length === 0 && <p className="muted">{emptyText}</p>}
      <ul>
        {options.map((estate) => (
          <li key={estate.tile}>
            <label>
              <input
                type="checkbox"
                checked={picked.includes(estate.tile)}
                onChange={() => onToggle(estate.tile)}
              />
              {label(estate.tile)}
            </label>
          </li>
        ))}
      </ul>
      <label className="monopoly__trade-cash">
        {cashLabel}
        <input
          type="number"
          min={0}
          value={cash}
          onChange={(event) => onCash(Math.max(0, Number(event.target.value)))}
        />
      </label>
    </div>
  );
}
