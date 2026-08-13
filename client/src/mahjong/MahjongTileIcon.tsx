import { useEffect, useRef } from 'react';
import { mahjongTileLabel, type MahjongTileId } from 'shared';
import { drawTile, tileHeight, tileWidth } from './pixelart';
import { useTileScale } from './useTileScale';

/** 單張像素風麻將牌，手牌／面子／棄牌堆共用。不給 onClick 就是純顯示、不能點。 */
export function MahjongTileIcon({
  tile,
  onClick,
  disabled,
  faceDown,
  highlighted,
  selected,
  scale = 1.3,
}: {
  tile: MahjongTileId;
  onClick?: () => void;
  disabled?: boolean;
  faceDown?: boolean;
  /** 黃框，標示牌桌上「當前這一張」棄牌。 */
  highlighted?: boolean;
  /** 兩段式打牌選起來的那一張：沿用同一個黃框，再往上抬一點做出「拿起來」的感覺。 */
  selected?: boolean;
  scale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 窄螢幕整體縮小：呼叫端傳進來的相對比例照舊，這裡再統一乘上螢幕係數，
  // 各呼叫端一行都不用改，桌機的係數是 1 所以尺寸跟以前一模一樣。
  const effective = scale * useTileScale();
  const w = tileWidth(effective) + 4;
  const h = tileHeight(effective) + 4;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTile(ctx, 2, 2, tile, { scale: effective, faceDown, highlighted: highlighted || selected });
  }, [tile, effective, faceDown, highlighted, selected]);

  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      className={`mahjong-tile${onClick && !disabled ? ' mahjong-tile--clickable' : ''}${selected ? ' mahjong-tile--selected' : ''}`}
      title={faceDown ? undefined : mahjongTileLabel(tile)}
      onClick={onClick && !disabled ? onClick : undefined}
    />
  );
}
