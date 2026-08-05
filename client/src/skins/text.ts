/**
 * 牌桌外觀的文案表。這一份同時也是 TextKey 的來源 ——
 * 其他外觀的 text 必須是同一組 key，缺一個編譯就會擋下來。
 *
 * 值裡的 {name} 會被 t() 的第二個參數代換。
 */
export const CASINO_TEXT = {
  // 進入畫面
  'gate.title': '線上牌桌',
  'gate.titleAccent': 'Online',
  'gate.subtitle': '大老二 2~4 人、德州撲克 2~9 人，可開房、加入、觀戰',
  'gate.nicknamePlaceholder': '輸入暱稱',
  'gate.submit': '開始',

  'toast.failed': '操作失敗',

  // 大廳
  'lobby.nicknameLabel': '暱稱',
  'lobby.rename': '更名',
  'lobby.connected': '已連線',
  'lobby.connecting': '連線中…',
  'lobby.createTitle': '建立房間',
  'lobby.roomNamePlaceholder': '{name} 的房間',
  'lobby.gameTypeLabel': '玩法',
  'lobby.maxPlayersLabel': '人數上限',
  'lobby.seatOption': '{n} 人',
  'lobby.create': '開房',
  'lobby.codeTitle': '用房號加入',
  'lobby.codePlaceholder': '例如 K7QM',
  'lobby.join': '加入',
  'lobby.listTitle': '房間列表（{n}）',
  'lobby.empty': '目前沒有房間，開一間吧。',
  'lobby.host': '房主 {name}',
  'lobby.playerCount': '{n}/{max} 人',
  'lobby.spectatorCount': '觀戰 {n}',
  'lobby.started': '這局已開打',
  'lobby.full': '房間已滿',
  'lobby.spectate': '觀戰',
  'lobby.status.waiting': '等待中',
  'lobby.status.playing': '遊戲中',
  'lobby.status.finished': '已結束',

  // 房間外框
  'room.code': '房號 #{id}',
  'room.spectating': '觀戰中',
  'room.sitDown': '坐下來玩',
  'room.toSpectator': '改為觀戰',
  'room.leave': '離開房間',
  'room.emptySeat': '空位',
  'room.godView': '上帝視角',
  'room.turnTag': '輪到',
  'room.spectators': '觀戰者（{n}）',
  'room.chatTitle': '房間聊天',
  'room.turnPrefix': '輪到',
  'room.you': '你',

  // 聊天
  'chat.lobbyTitle': '大廳聊天',
  'chat.empty': '還沒有人說話',
  'chat.placeholder': '說點什麼…',
  'chat.send': '送出',

  // 座位
  'seat.you': '你',
  'seat.host': '房主',
  'seat.offline': '斷線',
  'seat.button': 'D',
  'seat.sb': 'SB',
  'seat.bb': 'BB',
  'seat.pass': 'PASS',
  'seat.ready': '已準備',
  'seat.notReady': '未準備',
  'seat.rank': '{medal} 第 {n} 名',
  'seat.chips': '🪙 {n}',
  'seat.sitOut': '坐出',
  'seat.allIn': 'ALL-IN',
  'seat.bet': '下注 {n}',
  'seat.left': '(已離開)',

  // 牌
  'card.backTitle': '剩 {n} 張',

  // 開局
  'start.ready': '準備',
  'start.cancelReady': '取消準備',
  'start.startBigTwo': '開始遊戲',
  'start.startHoldem': '開始牌局',
  'start.needPlayers': '需要至少 {min} 人，且所有人都已準備',

  // 大老二
  'bigTwo.idleTitle': '等待房主開始遊戲',
  'bigTwo.idleHint': '目前 {n}/{max} 人，至少 {min} 人可開始',
  'bigTwo.lastPlay': '{name} 的 {combo}',
  'bigTwo.freeLead': '自由出牌',
  'bigTwo.mustIncludeOpening': ' · 這一手必須包含開局牌',
  'bigTwo.resultTitle': '本局結束',
  'bigTwo.playAgain': '再來一局',
  'bigTwo.waitHost': '等房主開下一局',
  'bigTwo.play': '出牌',
  'bigTwo.pass': 'PASS',
  'bigTwo.suggest': '提示',
  'bigTwo.cannotPass': '你有領牌權，不能 PASS',
  'bigTwo.sortRank': '排序：按大小',
  'bigTwo.sortSuit': '排序：按花色',
  'bigTwo.handEmpty': '手牌已出完',
  'bigTwo.waitingDeal': '等待發牌',
  'hint.notPlaying': '按下準備，等房主開局',
  'hint.waitOthers': '等待其他玩家出牌',
  'hint.selectToFollow': '請選 {n} 張牌跟牌',
  'hint.selectCards': '請選擇要出的牌',
  'hint.invalidCombo': '這不是合法的牌型',
  'hint.mustIncludeOpening': '第一手必須包含開局牌',
  'hint.mustPlayN': '必須出 {n} 張',
  'hint.cannotBeat': '{combo} 壓不過上一手',
  'hint.canPlay': '可出：{combo}',

  // 德州撲克
  'holdem.idleTitle': '等待房主開始牌局',
  'holdem.idleHint': '目前 {n}/{max} 人，至少 {min} 人可開始',
  'holdem.handNo': '第 {n} 手',
  'holdem.blinds': '盲注 {sb}/{bb}',
  'holdem.pot': '底池 {n}',
  'holdem.mainPot': '主池 {n}',
  'holdem.sidePot': '邊池 {i} {n}',
  'holdem.currentBet': '目前注額 {n}',
  'holdem.showdownTitle': '第 {n} 手結束',
  'holdem.nextHandSoon': '稍後自動發下一手',
  'holdem.fold': '蓋牌',
  'holdem.check': '過牌',
  'holdem.call': '跟注 {n}',
  'holdem.raiseTo': '加注到 {n}',
  'holdem.allIn': 'All-in',
  'holdem.raiseAmountLabel': '加注金額',
  'holdem.raiseToLabel': '加注到',
  'holdem.myCommitted': '本街已下注 {n}',
  'holdem.strength': '目前：{hand}',
  'holdem.noCards': '這一手沒有你的牌',
  'holdemHint.notStarted': '按下準備，等房主開局',
  'holdemHint.handOver': '這一手結束了，稍後自動發下一手',
  'holdemHint.waitStart': '等待開局',
  'holdemHint.waitOthers': '等待其他玩家下注',
  'holdemHint.notInHand': '你這一手沒有參與',
  'holdemHint.canCheck': '可以過牌，或加注到 {n} 以上',
  'holdemHint.mustCall': '要跟 {n} 才能繼續',
  'holdemHint.yourTurn': '輪到你了',
} as const;

export type TextKey = keyof typeof CASINO_TEXT;

export type TextTable = Record<TextKey, string>;
