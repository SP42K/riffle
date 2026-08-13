import { useMemo } from 'react';
import type { DndPiece } from 'shared';

/**
 * 地下城的像素圖庫。
 *
 * 每張圖是 12×12 的字元格，一個字元一個像素，`.` 是透明；顏色查 `PALETTE`。
 * 用手寫字元格而不是圖檔，是因為 riffle 沒有靜態資產管線（`shared` 連 build 都沒有），
 * 圖檔還得處理路徑與快取；字元格直接編譯進 bundle，改一個像素就是改一個字元。
 *
 * 繪製時同一列連續的同色像素會併成一個 `<rect>`，一張圖大約 20~30 個矩形，
 * 棋盤上十幾隻棋子也還在幾百個節點的量級。
 */

const PALETTE: Record<string, string> = {
  o: '#161620', // 輪廓／陰影
  k: '#2b2b3a', // 黑（邪神、盜賊斗篷）
  s: '#f0c9a0', // 膚色
  h: '#c3cbd8', // 鋼
  H: '#79839a', // 暗鋼
  r: '#d4443c', // 紅
  R: '#8e2b25', // 暗紅
  g: '#6cb85c', // 哥布林綠
  G: '#3f7d3a', // 哥布林暗綠
  y: '#f0c040', // 金
  b: '#4a7fc1', // 藍
  B: '#2b4d7d', // 暗藍
  p: '#9b5fd0', // 紫
  P: '#5b3690', // 暗紫
  w: '#f2efe4', // 白／布
  n: '#8a6238', // 木頭／棕
  N: '#54391f', // 暗棕
  c: '#4fd6d0', // 青（法術光）
  e: '#ffe9a8', // 暖光
  m: '#9ad64f', // 毒綠
};

interface Sprite {
  rows: string[];
}

/** 12×12，`.` 透明。每一列一定要剛好 12 個字元。 */
const SPRITES: Record<string, Sprite> = {
  // ---- 玩家四職業（人型：頭、身體、武器）----
  brave: { rows: [
    '....rr......',
    '...hhhhhh...',
    '...hooooh...',
    '...hssssh.h.',
    '..hhhhhhh.h.',
    '.rrhbbbbh.h.',
    '.ryhbbbbh.h.',
    '.rrhbbbbhyy.',
    '..hbbbbbb...',
    '...nnnnnn...',
    '...BB..BB...',
    '...oo..oo...',
  ] },
  // 俠盜而不是小偷：兜帽下露臉、紅圍巾、皮甲與雙短刃
  bubble: { rows: [
    '....bbbb....',
    '...bbbbbb...',
    '...bssssb...',
    '...bsoosb...',
    '...rrrrrr...',
    '..BBnnnnBB..',
    '.hBBnnnnBB.h',
    '.hBBynnyBB.h',
    '..BBnnnnBB..',
    '...NNNNNN...',
    '...NN..NN...',
    '...oo..oo...',
  ] },
  tangerine: { rows: [
    '.....p......',
    '....ppp.....',
    '...ppppp....',
    '..ppppppp...',
    '...soos...c.',
    '...swws...n.',
    '..bbwwbb..n.',
    '..bbbbbb..n.',
    '..bbbbbb..n.',
    '..bbbbbb..n.',
    '.bbbbbbbb.n.',
    '.oooooooo...',
  ] },
  star: { rows: [
    '....yyyy....',
    '...wwwwww...',
    '...wssssw...',
    '...wsoosw...',
    '..wwwwwwww..',
    '..wwwyyww...',
    '..wyyyyyyw..',
    '..wwwyyww...',
    '..wwwyyww...',
    '..wwwwwww...',
    '...ww..ww...',
    '...oo..oo...',
  ] },

  // 鬥士：無盔露臉、雙手扛巨劍、皮甲護肩
  gladiator: { rows: [
    '...nnnn...h.',
    '..nssssn..h.',
    '..nsoosn..h.',
    '...ssss...h.',
    '..RRRRRR.hh.',
    '.RRnnnnRR.h.',
    '.RRnnnnRR.h.',
    '.RRnnnnRR...',
    '..nnnnnn....',
    '..yyyyyy....',
    '..NN..NN....',
    '..oo..oo....',
  ] },
  // 弓手：兜帽、拉滿的長弓、背後箭袋
  archer: { rows: [
    '...GGGG..n..',
    '..GssssG.nw.',
    '..GsoosG.n.w',
    '...GGGG..n.w',
    '..GGmmGG.n.w',
    '.rGGmmGGnn.w',
    '.rGGmmGG.n.w',
    '.rGGmmGG.n.w',
    '..GmmmmG.n.w',
    '..NN..NN.n..',
    '..NN..NN....',
    '..oo..oo....',
  ] },

  // 吟遊詩人：羽毛帽、披風、手上的里拉琴
  bard: { rows: [
    '.....e......',
    '....pppp....',
    '...pppppp...',
    '...pssssp...',
    '...psoosp...',
    '..rrrrrrr...',
    '.prrrrrrp.yy',
    '.prrrrrrp.ny',
    '..rrrrrr..ny',
    '..NN..NN..yy',
    '..NN..NN....',
    '..oo..oo....',
  ] },
  // 召喚術士：兜帽、飄浮的召喚陣、手上的書
  summoner: { rows: [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkcccckk..',
    '..kkcookck..',
    '..kkkkkkkk..',
    '.PPPPPPPPP..',
    '.PPPPPPPPPnn',
    '.PPPPPPPPPwn',
    '.PPPPPPPPPwn',
    '..PPPPPPP.nn',
    '..PP...PP...',
    '..oo...oo...',
  ] },

  // ---- 一般怪物（比人矮一截，佔不滿上下兩列）----
  goblin: { rows: [
    '............',
    '.G........G.',
    '.GGggggggGG.',
    '..grrgrrg...',
    '..ggwwwwgg..',
    '..GgggggG.n.',
    '..GgggggG.n.',
    '...gggggg...',
    '...gg.gg....',
    '...gg.gg....',
    '...oo.oo....',
    '............',
  ] },
  goblinRogue: { rows: [
    '............',
    '...kkkkkk...',
    '..kkggggkk..',
    '..kgrrggk...',
    '...kkkkkk...',
    '..kkGGGGk.h.',
    '..kkGGGGk.h.',
    '...GGGGG....',
    '...GG.GG....',
    '...GG.GG....',
    '...oo.oo....',
    '............',
  ] },
  goblinMage: { rows: [
    '............',
    '..p......p..',
    '..pgggggp...',
    '..gccgccg...',
    '...gwwwwg...',
    '..PPPPPPP.c.',
    '..PPPPPPP.n.',
    '..PPPPPPP.n.',
    '..PPPPPPP.n.',
    '...PPPPP....',
    '...ooooo....',
    '............',
  ] },
  // B6：拿盾的哥布林英雄，比一般哥布林高一截
  goblinHero: { rows: [
    '............',
    '..y......y..',
    '..GggggggG..',
    '..grrggrrg..',
    '..ggwwwwgg..',
    'hhGgggggG.n.',
    'hhGgggggG.n.',
    'hh.gggggg...',
    '...gg.gg....',
    '...gg.gg....',
    '...oo.oo....',
    '............',
  ] },
  // B6：巨魔，塞滿整格的大塊頭
  troll: { rows: [
    '..mmmmmmmm..',
    '.mmmmmmmmmm.',
    '.mmrrmmrrmm.',
    '.mmmmmmmmmm.',
    '.mmwwwwwwmm.',
    'mmmmmmmmmmmm',
    'mmmmmmmmmmmm',
    'mmmmmmmmmmmm',
    '.mmmmmmmmmm.',
    '.mmm....mmm.',
    '.mmm....mmm.',
    '.ooo....ooo.',
  ] },
  // B6：哥布林薩滿，比大薩滿小一號
  goblinShaman: { rows: [
    '............',
    '..w..ww..w..',
    '..wwwwwwww..',
    '..wkkwwkkw..',
    '..wwkkkkww.c',
    '..PPPPPPP.n.',
    '..PPPPPPP.n.',
    '..PPPPPPP.n.',
    '...PPPPP....',
    '...PP.PP....',
    '...oo.oo....',
    '............',
  ] },
  // B6：異界祭壇，跟 B5 的石祭壇不同 —— 中央是一道撐開的紫綠色裂隙
  gateAltar: { rows: [
    '...c....c...',
    '..cpc..cpc..',
    '...ppppp....',
    '..pppppppp..',
    '..ppmmmmpp..',
    '..pmmmmmmp..',
    '..pmmmmmmp..',
    '..ppmmmmpp..',
    '.HHHHHHHHHH.',
    '.HHHHHHHHHH.',
    '..HH....HH..',
    '..oo....oo..',
  ] },
  villager: { rows: [
    '............',
    '....nnnn....',
    '...nssssn...',
    '...ssoos....',
    '..nnnnnnn...',
    '..nnnnnnn...',
    '..nnnnnnn...',
    '...nnnnn....',
    '...nn.nn....',
    '...nn.nn....',
    '...oo.oo....',
    '............',
  ] },

  // ---- 四個 Boss（塞滿整格，體型明顯大一號）----
  boss1: { rows: [ // B1 哥布林督軍：角盔＋斧頭
    '..H......H..',
    '..HHHHHHHH..',
    '..HggggggH..',
    '..grrggrrgnh',
    '..gwwwwwwgnh',
    '.GGgggggGGnh',
    '.GGgggggGGn.',
    '.GGgggggGGn.',
    '..GgggggG...',
    '..GGG.GGG...',
    '..GGG.GGG...',
    '..ooo.ooo...',
  ] },
  boss2: { rows: [ // B2 大薩滿：骷髏面具＋羽冠＋法杖
    '..y.y..y.y..',
    '..PPPPPPPP..',
    '..wwwwwwww..',
    '..wkkwwkkw..',
    '..wwkkkkww.c',
    '.PPPPPPPPP.n',
    '.PPPPPPPPP.n',
    '.PPPPPPPPP.n',
    '..PPPPPPPP.n',
    '..PPPPPPPP.n',
    '..PPP..PPP..',
    '..ooo..ooo..',
  ] },
  boss4: { rows: [ // B4 虛空酋長：王冠＋虛空核心
    '.y.y.yy.y.y.',
    '.yyyyyyyyyy.',
    '..PPPPPPPP..',
    '..PccPPccP..',
    '..PPkkkkPP..',
    '.PPPPPPPPPP.',
    'cPPPkkkkPPPc',
    '.PPPkkkkPPP.',
    '.PPPPPPPPPP.',
    '..PPPPPPPP..',
    '..PP....PP..',
    '..oo....oo..',
  ] },
  boss5: { rows: [ // B5 哥布林邪神：黑軀、雙角、滿臉紅眼
    '.r........r.',
    '.rr......rr.',
    '..kkkkkkkk..',
    '.krrkkkkrrk.',
    '.kkrkkkkrkk.',
    '.kkkrrrrkkk.',
    'rkkkkkkkkkkr',
    '.kkrkkkkrkk.',
    '.kkkkkkkkkk.',
    '..kkkkkkkk..',
    '..kk....kk..',
    '..rr....rr..',
  ] },

  staircase: { rows: [
    '............',
    '............',
    '.........hhh',
    '.........HHH',
    '......hhhhhh',
    '......HHHHHH',
    '...hhhhhhhhh',
    '...HHHHHHHHH',
    'hhhhhhhhhhhh',
    'HHHHHHHHHHHH',
    '............',
    '............',
  ] },

  // ---- 八件聖物（手札的裝備頁用）----
  shieldItem: { rows: [
    '...hhhhhh...',
    '..hhhhhhhh..',
    '.hheeeeeehh.',
    '.hheeeeeehh.',
    '.hheeeeeehh.',
    '.hheeeeeehh.',
    '.hhheeeehhh.',
    '..hhheehhh..',
    '...hhhhhh...',
    '....hhhh....',
    '.....hh.....',
    '............',
  ] },
  swordItem: { rows: [
    '.....hh.....',
    '.....hh.....',
    '.....hh.....',
    '.....hh.....',
    '....hHHh....',
    '.....hh.....',
    '.....hh.....',
    '..yyyyyyyy..',
    '.....nn.....',
    '.....nn.....',
    '....yyyy....',
    '............',
  ] },
  daggerItem: { rows: [
    '......h.....',
    '.....hh.....',
    '.....hh.....',
    '.....hh.....',
    '.....hh.....',
    '....yyyy....',
    '.....n......',
    '....wwww....',
    '....wkwk....',
    '....wwww....',
    '....wkwk....',
    '............',
  ] },
  bowItem: { rows: [
    '....nn......',
    '...n..w.....',
    '..n...w.....',
    '..n...w.....',
    '.n....w.....',
    '.n....whhh..',
    '.n....w.....',
    '..n...w.....',
    '..n...w.....',
    '...n..w.....',
    '....nn......',
    '............',
  ] },
  orbItem: { rows: [
    '............',
    '....cccc....',
    '...cceecc...',
    '..cceeeecc..',
    '..cceeeecc..',
    '..cccccccc..',
    '...cccccc...',
    '....cccc....',
    '....pppp....',
    '...pppppp...',
    '..pppppppp..',
    '............',
  ] },
  staffItem: { rows: [
    '.....y......',
    '....yyy.....',
    '...yyyyy....',
    '....yyy.....',
    '.....y......',
    '.....n......',
    '.....n......',
    '.....n......',
    '.....n......',
    '.....n......',
    '....NNN.....',
    '............',
  ] },
  lyreItem: { rows: [
    '............',
    '..y......y..',
    '..yy....yy..',
    '..y.y..y.y..',
    '..y.y..y.y..',
    '..y.wwww.y..',
    '..y.wwww.y..',
    '..yyyyyyyy..',
    '...yyyyyy...',
    '....yyyy....',
    '............',
    '............',
  ] },
  tomeItem: { rows: [
    '............',
    '..kkkkkkkk..',
    '.kkkkkkkkkk.',
    '.kkkkcckkkk.',
    '.kkkcccckkk.',
    '.kkcccccckk.',
    '.kkkcccckkk.',
    '.kkkkcckkkk.',
    '.kkkkkkkkkk.',
    '..kkkkkkkk..',
    '...wwwwww...',
    '............',
  ] },

  // ---- 場景裝飾（純視覺，不影響任何規則）----
  altar: { rows: [ // 邪神祭壇：石台＋燭火＋血槽
    '............',
    '.r........r.',
    '.e........e.',
    '.n........n.',
    '..HHHHHHHH..',
    '.HHHHHHHHHH.',
    '.HHrrrrrrHH.',
    '.HHHHHHHHHH.',
    '..HHHHHHHH..',
    '..HH....HH..',
    '..HH....HH..',
    '..oo....oo..',
  ] },
  throne: { rows: [ // 酋長王座
    '..P......P..',
    '..PPPPPPPP..',
    '..PyyyyyyP..',
    '..PyPPPPyP..',
    '..PyPPPPyP..',
    '..PyyyyyyP..',
    '..PPPPPPPP..',
    '.NNNNNNNNNN.',
    '.N........N.',
    '.N........N.',
    '.NN......NN.',
    '.oo......oo.',
  ] },
  ritual: { rows: [ // 薩滿的儀式法陣
    '....pppp....',
    '..pp....pp..',
    '.p........p.',
    '.p..cccc..p.',
    'p..c....c..p',
    'p..c....c..p',
    'p..c....c..p',
    'p..c....c..p',
    '.p..cccc..p.',
    '.p........p.',
    '..pp....pp..',
    '....pppp....',
  ] },
  crate: { rows: [ // 地窖的木箱
    '............',
    '............',
    '..nnnnnnnn..',
    '..nNnnnnNn..',
    '..nnNnnNnn..',
    '..nnnNNnnn..',
    '..nnnNNnnn..',
    '..nnNnnNnn..',
    '..nNnnnnNn..',
    '..nnnnnnnn..',
    '..oooooooo..',
    '............',
  ] },
  barrel: { rows: [ // 地窖的酒桶
    '............',
    '............',
    '...nnnnnn...',
    '..nnnnnnnn..',
    '..NNNNNNNN..',
    '..nnnnnnnn..',
    '..nnnnnnnn..',
    '..NNNNNNNN..',
    '..nnnnnnnn..',
    '...nnnnnn...',
    '...oooooo...',
    '............',
  ] },
  bones: { rows: [ // 骸骨
    '............',
    '............',
    '............',
    '..ww....ww..',
    '...wwwwww...',
    '....wwww....',
    '...wwwwww...',
    '..ww....ww..',
    '............',
    '..w......w..',
    '............',
    '............',
  ] },
  torch: { rows: [ // 壁上的火炬
    '.....e......',
    '....eye.....',
    '...eyrye....',
    '...eyrye....',
    '....ere.....',
    '.....n......',
    '.....n......',
    '.....n......',
    '....NNN.....',
    '............',
    '............',
    '............',
  ] },
  tent: { rows: [ // 護送關的村莊帳篷
    '............',
    '.....w......',
    '....www.....',
    '...wwwww....',
    '..wwwwwww...',
    '.wwwwwwwww..',
    '.wwwNNNwww..',
    '.wwwNNNwww..',
    '.wwwNNNwww..',
    '.wwwNNNwww..',
    '.oooooooooo.',
    '............',
  ] },
  rock: { rows: [
    '............',
    '............',
    '............',
    '....HHH.....',
    '...HHHHH....',
    '..HHHHHHH...',
    '..HHHHHHH...',
    '...HHHHH....',
    '....ooo.....',
    '............',
    '............',
    '............',
  ] },
};

export type SpriteKey = keyof typeof SPRITES;

/** 一列裡連續的同色像素併成一條 `<rect>`，省掉大半節點。 */
function runsOf(rows: string[]): Array<{ x: number; y: number; w: number; fill: string }> {
  const runs: Array<{ x: number; y: number; w: number; fill: string }> = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      if (ch === '.' || !PALETTE[ch]) { x += 1; continue; }
      let end = x;
      while (end + 1 < row.length && row[end + 1] === ch) end += 1;
      runs.push({ x, y, w: end - x + 1, fill: PALETTE[ch]! });
      x = end + 1;
    }
  });
  return runs;
}

export function PixelSprite({ name, className, style }: {
  name: SpriteKey;
  className?: string;
  style?: React.CSSProperties;
}) {
  const sprite = SPRITES[name];
  const runs = useMemo(() => (sprite ? runsOf(sprite.rows) : []), [sprite]);
  if (!sprite) return null;
  return (
    <svg
      className={`pixel-sprite${className ? ` ${className}` : ''}`}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={style}
    >
      {runs.map((run, i) => (
        <rect key={i} x={run.x} y={run.y} width={run.w} height={1} fill={run.fill} />
      ))}
    </svg>
  );
}

/** 棋子 → 圖。怪物只有名字可以判斷種類，跟原本的 emoji 判斷同一套規則。 */
export function spriteFor(piece: DndPiece): SpriteKey {
  if (piece.type === 'player') {
    const classId = piece.classId ?? 'brave';
    if (classId in SPRITES) return classId as SpriteKey;
    return 'brave';
  }
  if (piece.type === 'villager') return 'villager';
  if (piece.type === 'staircase') return 'staircase';

  // 邪神分身照著被複製的職業長 —— 外觀跟本尊同一張圖，靠 copy-token 的濾鏡染成紫色
  if (piece.copyClass) {
    if (piece.copyClass in SPRITES) return piece.copyClass as SpriteKey;
    return 'brave';
  }
  if (piece.type === 'altar') return 'gateAltar';
  // 殘影用弓手的圖，靠 decoy-token 的濾鏡壓成半透明的影子
  if (piece.type === 'decoy') return 'archer';
  if (piece.id === 'boss-5') return 'boss5';
  if (piece.id === 'boss-1') return 'boss1';
  if (piece.id === 'boss-2') return 'boss2';
  if (piece.id === 'boss-3' || piece.id === 'boss-4') return 'boss4';
  if (piece.name.includes('酋長') || piece.name.includes('Chief')) return 'boss4';
  if (piece.name.includes('薩滿') || piece.name.includes('Shaman')) return 'boss2';
  if (piece.name.includes('督軍') || piece.name.includes('Warlord')) return 'boss1';
  if (piece.name.includes('巨魔') || piece.name.includes('Troll')) return 'troll';
  if (piece.name.includes('英雄') || piece.name.includes('Hero')) return 'goblinHero';
  if (piece.name.includes('薩滿') || piece.name.includes('Shaman')) return 'goblinShaman';
  if (piece.name.includes('法師') || piece.name.includes('Mage')) return 'goblinMage';
  if (piece.name.includes('盜賊') || piece.name.includes('Rogue')) return 'goblinRogue';
  return 'goblin';
}

/**
 * 每一層的固定佈景。純前端的裝飾，只畫在沒有棋子／火牆／陷阱的格子上，
 * 不會擋路也不進伺服器 —— 目的是讓「貪婪地窖」跟「邪神祭壇」一眼看得出來是兩個地方。
 */
export const LEVEL_DECOR: Record<number, Array<{ r: number; c: number; name: SpriteKey }>> = {
  1: [ // 貪婪地窖：箱子、酒桶、火炬
    { r: 0, c: 0, name: 'torch' }, { r: 0, c: 15, name: 'torch' },
    { r: 1, c: 2, name: 'crate' }, { r: 1, c: 3, name: 'barrel' },
    { r: 2, c: 13, name: 'crate' }, { r: 3, c: 12, name: 'barrel' },
    { r: 7, c: 0, name: 'crate' }, { r: 8, c: 15, name: 'barrel' },
    { r: 13, c: 1, name: 'barrel' }, { r: 14, c: 14, name: 'crate' },
    { r: 15, c: 0, name: 'torch' }, { r: 15, c: 15, name: 'torch' },
  ],
  2: [ // 薩滿祭壇：中央法陣＋骸骨
    { r: 6, c: 7, name: 'ritual' }, { r: 6, c: 8, name: 'ritual' },
    { r: 7, c: 7, name: 'ritual' }, { r: 7, c: 8, name: 'ritual' },
    { r: 0, c: 0, name: 'torch' }, { r: 0, c: 15, name: 'torch' },
    { r: 2, c: 5, name: 'bones' }, { r: 4, c: 11, name: 'bones' },
    { r: 11, c: 3, name: 'bones' }, { r: 13, c: 12, name: 'bones' },
  ],
  3: [ // 逃亡之路：頂端是村莊的帳篷，兩側是碎石
    { r: 0, c: 2, name: 'tent' }, { r: 0, c: 7, name: 'tent' }, { r: 0, c: 12, name: 'tent' },
    { r: 4, c: 0, name: 'rock' }, { r: 5, c: 15, name: 'rock' },
    { r: 8, c: 1, name: 'rock' }, { r: 9, c: 14, name: 'rock' },
    { r: 12, c: 0, name: 'rock' }, { r: 12, c: 15, name: 'rock' },
    { r: 15, c: 4, name: 'bones' }, { r: 15, c: 11, name: 'bones' },
  ],
  4: [ // 酋長王座：上方一整排王座與火炬
    { r: 0, c: 7, name: 'throne' }, { r: 0, c: 8, name: 'throne' },
    { r: 0, c: 5, name: 'torch' }, { r: 0, c: 10, name: 'torch' },
    { r: 1, c: 2, name: 'bones' }, { r: 1, c: 13, name: 'bones' },
    { r: 6, c: 0, name: 'rock' }, { r: 6, c: 15, name: 'rock' },
    { r: 10, c: 3, name: 'bones' }, { r: 10, c: 12, name: 'bones' },
    { r: 15, c: 0, name: 'torch' }, { r: 15, c: 15, name: 'torch' },
  ],
  6: [ // 異世界大門：祭壇本身是棋子，這裡只鋪破碎的地景
    { r: 0, c: 7, name: 'torch' }, { r: 0, c: 8, name: 'torch' },
    { r: 1, c: 1, name: 'bones' }, { r: 1, c: 14, name: 'bones' },
    { r: 7, c: 0, name: 'rock' }, { r: 8, c: 15, name: 'rock' },
    { r: 14, c: 1, name: 'bones' }, { r: 14, c: 14, name: 'bones' },
    { r: 15, c: 7, name: 'torch' }, { r: 15, c: 8, name: 'torch' },
    { r: 5, c: 2, name: 'rock' }, { r: 10, c: 13, name: 'rock' },
  ],
  5: [ // 邪神祭壇：正中央的祭壇＋環繞的燭火與骸骨
    { r: 7, c: 7, name: 'altar' }, { r: 7, c: 8, name: 'altar' },
    { r: 8, c: 7, name: 'altar' }, { r: 8, c: 8, name: 'altar' },
    { r: 5, c: 5, name: 'torch' }, { r: 5, c: 10, name: 'torch' },
    { r: 10, c: 5, name: 'torch' }, { r: 10, c: 10, name: 'torch' },
    { r: 2, c: 2, name: 'bones' }, { r: 2, c: 13, name: 'bones' },
    { r: 13, c: 2, name: 'bones' }, { r: 13, c: 13, name: 'bones' },
    { r: 0, c: 0, name: 'torch' }, { r: 0, c: 15, name: 'torch' },
    { r: 15, c: 0, name: 'torch' }, { r: 15, c: 15, name: 'torch' },
  ],
};
