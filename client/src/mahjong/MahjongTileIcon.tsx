import { useEffect, useRef } from 'react';
import { mahjongTileLabel, type MahjongTileId } from 'shared';
import { drawTile, tileHeight, tileWidth } from './pixelart';

/** 單張像素風麻將牌，手牌／面子／棄牌堆共用。不給 onClick 就是純顯示、不能點。 */
export function MahjongTileIcon({
  tile,
  onClick,
  disabled,
  faceDown,
  highlighted,
  scale = 1.3,
}: {
  tile: MahjongTileId;
  onClick?: () => void;
  disabled?: boolean;
  faceDown?: boolean;
  /** 黃框，標示牌桌上「當前這一張」棄牌。 */
  highlighted?: boolean;
  scale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = tileWidth(scale) + 4;
  const h = tileHeight(scale) + 4;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTile(ctx, 2, 2, tile, { scale, faceDown, highlighted });
  }, [tile, scale, faceDown, highlighted]);

  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      className={`mahjong-tile${onClick && !disabled ? ' mahjong-tile--clickable' : ''}`}
      title={faceDown ? undefined : mahjongTileLabel(tile)}
      onClick={onClick && !disabled ? onClick : undefined}
    />
  );
}
