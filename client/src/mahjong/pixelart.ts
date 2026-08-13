import type { MahjongTileId } from 'shared';

/** 麻將牌的像素風繪製，全部用 canvas 2D 基本圖形程式化畫出，沒有外部圖片素材。 */

const BASE_W = 28;
const BASE_H = 38;

const PALETTE = {
  face: '#f2e8ce',
  faceShade: '#e2d3ac',
  border: '#2b1c12',
  back: '#7a1f1f',
  backPattern: '#9c3030',
  ink: '#1a1a1a',
  red: '#b7231f',
  green: '#1f7a3a',
  blue: '#1f4f9c',
  gold: '#c9982f',
  highlight: '#ffe98a',
};

export function tileWidth(scale = 1): number {
  return Math.round(BASE_W * scale);
}

export function tileHeight(scale = 1): number {
  return Math.round(BASE_H * scale);
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

type ParsedTile =
  | { kind: 'wind'; value: string }
  | { kind: 'dragon'; value: string }
  | { kind: 'flower'; sub: string; value: number }
  | { kind: 'suit'; suit: string; rank: number }
  | { kind: 'unknown' };

function parseTile(code: MahjongTileId): ParsedTile {
  if (code[0] === 'W' && code.length === 2) return { kind: 'wind', value: code[1]! };
  if (code[0] === 'D') return { kind: 'dragon', value: code[1]! };
  if (code[0] === 'F') return { kind: 'flower', sub: code[1]!, value: Number(code[2]) };
  const rank = Number(code[0]);
  const suit = code[1];
  if (Number.isFinite(rank) && suit) return { kind: 'suit', suit, rank };
  return { kind: 'unknown' };
}

export interface DrawTileOptions {
  scale?: number;
  faceDown?: boolean;
  highlighted?: boolean;
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileCode: MahjongTileId,
  options: DrawTileOptions = {},
): void {
  const scale = options.scale ?? 1;
  const faceDown = options.faceDown ?? false;
  const highlighted = options.highlighted ?? false;

  const w = tileWidth(scale);
  const h = tileHeight(scale);

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const shadowOff = Math.max(1, Math.round(2 * scale));
  px(ctx, x + shadowOff, y + shadowOff, w, h, 'rgba(0,0,0,0.35)');

  px(ctx, x, y, w, h, PALETTE.border);
  const bezel = Math.max(1, Math.round(2 * scale));
  px(ctx, x + bezel, y + bezel, w - bezel * 2, h - bezel * 2, faceDown ? PALETTE.back : PALETTE.face);

  if (faceDown) {
    drawTileBack(ctx, x, y, w, h, scale);
  } else {
    px(ctx, x + bezel, y + bezel, w - bezel * 2, Math.max(1, Math.round(4 * scale)), '#ffffff55');
    px(
      ctx,
      x + bezel,
      y + h - bezel - Math.max(1, Math.round(3 * scale)),
      w - bezel * 2,
      Math.max(1, Math.round(3 * scale)),
      PALETTE.faceShade,
    );
    drawTileFace(ctx, x, y, w, h, scale, tileCode);
  }

  if (highlighted) {
    ctx.strokeStyle = PALETTE.highlight;
    ctx.lineWidth = Math.max(2, Math.round(2 * scale));
    ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    px(ctx, x - 2 * scale, y - 2 * scale, w + 4 * scale, Math.max(1, 2 * scale), PALETTE.highlight);
  }

  ctx.restore();
}

function drawTileBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number): void {
  const m = Math.max(2, Math.round(4 * scale));
  px(ctx, x + m, y + m, w - m * 2, h - m * 2, PALETTE.backPattern);
  const step = Math.max(3, Math.round(6 * scale));
  ctx.fillStyle = PALETTE.back;
  for (let yy = y + m; yy < y + h - m; yy += step * 2) {
    for (let xx = x + m; xx < x + w - m; xx += step * 2) {
      ctx.fillRect(xx, yy, step, step);
    }
  }
  px(
    ctx,
    x + w / 2 - Math.round(3 * scale),
    y + h / 2 - Math.round(3 * scale),
    Math.round(6 * scale),
    Math.round(6 * scale),
    PALETTE.gold,
  );
}

function drawTileFace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  tileCode: MahjongTileId,
): void {
  const info = parseTile(tileCode);
  const cx = x + w / 2;
  const cy = y + h / 2;

  if (info.kind === 'suit' && info.suit === 'p') {
    drawDots(ctx, x, y, w, h, info.rank);
  } else if (info.kind === 'suit' && info.suit === 's') {
    drawBamboo(ctx, x, y, w, h, scale, info.rank);
    // 一條的圖案是鳥形圖騰，不像 2~9 條那樣一眼數得出根數，同樣補印數字
    drawRankBadge(ctx, x, y, w, scale, info.rank);
  } else if (info.kind === 'suit' && info.suit === 'm') {
    drawCharacters(ctx, x, y, w, h, info.rank);
  } else if (info.kind === 'wind') {
    drawWind(ctx, x, y, w, h, info.value);
  } else if (info.kind === 'dragon') {
    drawDragon(ctx, x, y, w, h, scale, info.value);
  } else if (info.kind === 'flower') {
    drawFlower(ctx, x, y, w, h, info.sub, info.value);
  } else {
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `${Math.round(10 * scale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('?', cx, cy);
  }
}

/** 筒／條花色圖案角落的小數字，避免點數／竹枝在小尺寸下數不清楚（尤其一筒一條）。 */
function drawRankBadge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, scale: number, rank: number): void {
  const size = Math.max(8, Math.round(9 * scale));
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const px_ = x + Math.max(1, 2 * scale);
  const py_ = y + Math.max(1, 1 * scale);
  ctx.fillStyle = '#ffffffb0';
  ctx.fillText(String(rank), px_ + 1, py_ + 1);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(String(rank), px_, py_);
}

const DOT_LAYOUTS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
  7: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  8: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  9: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
};

/**
 * 「一餅」的同心圓造型（紅外圈、金中圈、紅內圈、一點高光），2~9 筒的每一顆點
 * 現在也套用同一套畫法，只是縮小排成點陣——整個筒子花色看起來都是縮小版的餅，
 * 不再是 2~9 筒用小色點、1 筒用另一套圖案的兩種畫法。
 */
function drawBingCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number): void {
  ctx.fillStyle = PALETTE.red;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PALETTE.gold;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR * 0.72, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PALETTE.red;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // 圓心一點高光，讓整塊餅看起來有點光澤，不是純平塗的色塊
  ctx.fillStyle = '#ffffff55';
  ctx.beginPath();
  ctx.arc(cx - outerR * 0.15, cy - outerR * 0.15, outerR * 0.14, 0, Math.PI * 2);
  ctx.fill();
}

function drawBing(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  drawBingCircle(ctx, x + w / 2, y + h / 2, Math.min(w, h) * 0.4);
}

function drawDots(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rank: number): void {
  if (rank === 1) {
    drawBing(ctx, x, y, w, h);
    return;
  }
  const layout = DOT_LAYOUTS[rank] ?? DOT_LAYOUTS[1]!;
  const pad = w * 0.18;
  const gridW = w - pad * 2;
  const gridH = h * 0.62;
  const gridY = y + h * 0.2;
  const r = Math.max(1.5, gridW / 3 / 2 - 1);
  layout.forEach(([col, row]) => {
    const px_ = x + pad + (col + 0.5) * (gridW / 3);
    const py_ = gridY + (row + 0.5) * (gridH / 3);
    drawBingCircle(ctx, px_, py_, r);
  });
}

function drawBamboo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number, rank: number): void {
  // 一條跟二~九條用同一套「畫幾根竹枝」邏輯，畫一根就好，不再用鳥形／圓餅那種特例圖案
  const cols = rank <= 4 ? rank : Math.ceil(rank / 2);
  const rows = rank <= 4 ? 1 : 2;
  const count = rank;
  const pad = w * 0.14;
  const gridW = w - pad * 2;
  const cellW = gridW / cols;
  const barW = Math.max(2, cellW * 0.4);
  const barH = h * (rows === 1 ? 0.55 : 0.26);
  let placed = 0;
  for (let r = 0; r < rows && placed < count; r++) {
    const rowCount = Math.min(cols, count - placed);
    const rowOffset = (cols - rowCount) / 2;
    for (let c = 0; c < rowCount; c++) {
      const bx = x + pad + (c + rowOffset) * cellW + (cellW - barW) / 2;
      const by = rows === 1 ? y + h * 0.22 : y + h * 0.16 + r * (barH + h * 0.08);
      ctx.fillStyle = PALETTE.green;
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = '#ffffff40';
      ctx.fillRect(bx, by, Math.max(1, barW * 0.25), barH);
      ctx.fillStyle = PALETTE.ink;
      const nodeY = by + barH * 0.5;
      ctx.fillRect(bx, nodeY, barW, Math.max(1, scale));
      placed++;
    }
  }
}

function drawCharacters(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rank: number): void {
  const cx = x + w / 2;
  ctx.fillStyle = PALETTE.red;
  ctx.font = `bold ${Math.round(h * 0.4)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), cx, y + h * 0.36);

  ctx.fillStyle = PALETTE.ink;
  ctx.font = `bold ${Math.round(h * 0.32)}px "Courier New", monospace`;
  ctx.fillText('萬', cx, y + h * 0.72);
}

const WIND_LETTERS: Record<string, string> = { E: '東', S: '南', W: '西', N: '北' };

function drawWind(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, value: string): void {
  const letter = WIND_LETTERS[value] ?? value;
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.fillStyle = PALETTE.blue;
  ctx.font = `bold ${Math.round(h * 0.52)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, cx, cy + h * 0.02);
}

function drawDragon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number, value: string): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pad = w * 0.2;
  if (value === 'R') {
    ctx.fillStyle = PALETTE.red;
    ctx.font = `bold ${Math.round(h * 0.5)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('中', cx, cy);
  } else if (value === 'G') {
    ctx.fillStyle = PALETTE.green;
    ctx.font = `bold ${Math.round(h * 0.5)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('發', cx, cy);
  } else {
    ctx.strokeStyle = PALETTE.blue;
    ctx.lineWidth = Math.max(2, Math.round(2 * scale));
    ctx.strokeRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
    ctx.lineWidth = Math.max(1, Math.round(scale));
    ctx.strokeRect(x + pad + 3 * scale, y + pad + 3 * scale, w - pad * 2 - 6 * scale, h - pad * 2 - 6 * scale);
  }
}

const SEASON_LABELS: Record<number, string> = { 1: '春', 2: '夏', 3: '秋', 4: '冬' };
const PLANT_LABELS: Record<number, string> = { 1: '梅', 2: '蘭', 3: '竹', 4: '菊' };
const FLOWER_COLORS = ['#c9982f', '#1f7a3a', '#b7231f', '#1f4f9c'];

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, sub: string, value: number): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const label = (sub === 'S' ? SEASON_LABELS[value] : PLANT_LABELS[value]) ?? '?';
  const color = FLOWER_COLORS[(value - 1) % FLOWER_COLORS.length]!;
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(h * 0.46)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.34, 0, Math.PI * 2);
  ctx.stroke();
}

export interface DrawDiscardFanOptions {
  scale?: number;
  perRow?: number;
  gap?: number;
}

export function drawDiscardFan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  discards: readonly MahjongTileId[],
  options: DrawDiscardFanOptions = {},
): void {
  const scale = options.scale ?? 0.7;
  const perRow = options.perRow ?? 6;
  const gap = options.gap ?? 2;
  const w = tileWidth(scale);
  const h = tileHeight(scale);
  discards.forEach((tile, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    drawTile(ctx, x + col * (w + gap), y + row * (h + gap), tile, { scale, faceDown: false });
  });
}
