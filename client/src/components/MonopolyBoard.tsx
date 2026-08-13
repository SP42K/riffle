import { useEffect, useRef } from 'react';
import {
  MONOPOLY_BOARD,
  emptyEstates,
  isEstateId,
  rentOf,
  type EstateTable,
  type MonopolyEstateView,
  type MonopolyTile,
  type PlayerId,
  type SeatView,
} from 'shared';
import { GROUP_TONE } from '../skins/casino';
import { useSkin } from '../state/skinContext';

interface Props {
  estates: readonly MonopolyEstateView[];
  seats: readonly SeatView[];
  /** playerId → 目前站在第幾格。 */
  positions: ReadonlyMap<PlayerId, number>;
  myPlayerId: PlayerId;
  /** 捲到這一格；通常是自己的位置。 */
  focusPosition: number;
}

/**
 * 清單式棋盤：一列一格，棋子當作列標記。
 *
 * 刻意不畫成方形環 —— 偽裝外觀要能把它讀成檔案樹或 `ls -l` 的輸出，
 * 一列一項是唯一站得住腳的排版。格子名一律走 skin.monopolyTile。
 */
export function MonopolyBoard({
  estates,
  seats,
  positions,
  myPlayerId,
  focusPosition,
}: Props) {
  const { skin, t } = useSkin();
  const listRef = useRef<HTMLOListElement>(null);

  // 棋盤有 40 列，捲動容器裝不下，換人／移動後把焦點那列拉回可視範圍
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-position='${focusPosition}']`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [focusPosition]);

  const owned = new Map(estates.map((estate) => [estate.tile, estate]));
  const nicknameOf = new Map(seats.map((seat) => [seat.playerId, seat.nickname]));

  // 還原成引擎用的那張表，右欄的租金就能直接叫 shared 的 rentOf ——
  // 滿貫加倍、機場張數這些規則只該有一份
  const table: EstateTable = emptyEstates();
  for (const estate of estates) {
    table[estate.tile] = {
      owner: estate.owner,
      houses: estate.houses,
      mortgaged: estate.mortgaged,
    };
  }

  // 先把棋子按格子分好，逐列再去查 —— 40 列 × N 人的巢狀迴圈沒必要
  const tokensAt = new Map<number, PlayerId[]>();
  for (const [playerId, position] of positions) {
    const list = tokensAt.get(position);
    if (list) list.push(playerId);
    else tokensAt.set(position, [playerId]);
  }

  return (
    <section className="board">
      <h2 className="board__title">{t('monopoly.boardTitle')}</h2>
      {/*
       * 棋子只印得下暱稱的第一個字，完整暱稱本來只掛在 title 上——手指裝置根本叫不出 title。
       * 在棋盤上方補一行對照表，40 列的列寬一點都不用動；桌機用 CSS 收起來，外觀不變。
       */}
      <div className="board__legend">
        {seats.map((seat) => (
          <span key={seat.playerId} className="board__legend-item">
            <span className="board__token" data-mine={seat.playerId === myPlayerId ? 'true' : undefined}>
              {seat.nickname.slice(0, 1)}
            </span>
            {seat.nickname}
          </span>
        ))}
      </div>
      <ol className="board__list" ref={listRef}>
        {MONOPOLY_BOARD.map((tile) => {
          const estate = isEstateId(tile.id) ? owned.get(tile.id) : undefined;
          const mine = estate?.owner === myPlayerId;
          const tokens = tokensAt.get(tile.position) ?? [];

          return (
            <li
              key={tile.id}
              className="board__row"
              data-position={tile.position}
              data-kind={tile.kind}
              data-tone={tile.group ? GROUP_TONE[tile.group] : undefined}
              data-mine={mine ? 'true' : undefined}
              data-here={tokens.includes(myPlayerId) ? 'true' : undefined}
            >
              <span className="board__tokens">
                {tokens.map((playerId) => (
                  <span
                    key={playerId}
                    className="board__token"
                    data-mine={playerId === myPlayerId ? 'true' : undefined}
                    title={nicknameOf.get(playerId) ?? playerId}
                  >
                    {(nicknameOf.get(playerId) ?? '?').slice(0, 1)}
                  </span>
                ))}
              </span>

              <span className="board__name">{skin.monopolyTile[tile.id]}</span>

              <span className="board__owner">
                {estate?.owner
                  ? mine
                    ? t('monopoly.mine')
                    : (nicknameOf.get(estate.owner) ?? estate.owner)
                  : tile.price > 0
                    ? t('monopoly.ownerless')
                    : ''}
              </span>

              <span className="board__houses">
                {estate && estate.houses > 0 ? skin.monopolyHouses(estate.houses) : ''}
                {estate?.mortgaged && (
                  <span className="tag tag--offline">{t('monopoly.mortgagedTag')}</span>
                )}
              </span>

              <span className="board__value">{tileValue(tile, table, t)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * 右欄：沒人買就顯示價格，有主就顯示踩到要付多少。
 *
 * 公用事業的租金是骰子的倍數，沒擲之前算不出來，這欄就退回顯示價格。
 */
function tileValue(
  tile: MonopolyTile,
  table: EstateTable,
  t: (key: 'monopoly.price' | 'monopoly.rent', vars: { n: number }) => string,
): string {
  if (tile.kind === 'tax') return t('monopoly.price', { n: tile.tax });
  if (!isEstateId(tile.id)) return '';
  const estate = table[tile.id];
  if (!estate.owner || estate.mortgaged || tile.kind === 'utility') {
    return t('monopoly.price', { n: tile.price });
  }
  return t('monopoly.rent', { n: rentOf(tile.id, table, 0) });
}
