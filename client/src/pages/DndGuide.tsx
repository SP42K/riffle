import { useState } from 'react';
import { DND_EQUIPMENT_NAME, DND_EQUIPMENT_SPEC, type DndClassId } from 'shared';
import { PixelSprite, type SpriteKey } from './dndSprites';

/**
 * 地下城的遊戲說明。從選角畫面點進來，四個分頁：勇者小隊／怪物／頭目／裝備。
 *
 * **怪物與頭目只寫外觀與來歷，不寫牠們的招式** —— 那是玩家該在牌桌上付出代價
 * 學到的東西。同理，這裡也不會寫任何一層的破關訣竅。
 */

type Tab = 'party' | 'monsters' | 'bosses' | 'gear';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'party', label: '🛡️ 勇者小隊' },
  { id: 'monsters', label: '👹 怪物圖鑑' },
  { id: 'bosses', label: '👑 頭目' },
  { id: 'gear', label: '⚔️ 裝備' },
];

interface ClassEntry {
  id: DndClassId;
  sprite: SpriteKey;
  name: string;
  line: string;
  personality: string;
  stats: string;
  active: { name: string; text: string };
  passive: { name: string; text: string };
}

const PARTY: ClassEntry[] = [
  {
    id: 'brave',
    sprite: 'brave',
    name: '騎士 Knight',
    line: '「退到盾後面來，這裡我守得住。」',
    personality:
      '受過冊封的重裝騎士，把守誓看得比性命重。他的塔盾內側刻著每一個他沒能護住的名字，'
      + '所以他寧可自己多挨兩下，也不肯讓那面盾再多一道刻痕。'
      + '鎖鏈是他把人拉回身邊的手段 —— 不管拉的是敵人還是同伴。',
    stats: 'HP 24 ／ AC 14 ／ 命中 +4 ／ 傷害 d8+2 ／ 移動 3 格 ／ 近戰 1 格',
    active: {
      name: '鎖鏈',
      text: '甩出帶鉤的鎖鏈，把 3 格內的一隻怪物、或一名隊友強行拉到身旁。拉隊友一次只能拉一個。',
    },
    passive: {
      name: '反射 ＋ 武勇',
      text: '【反射】常駐：受擊時把 1/3 的傷害原封不動彈回攻擊者。'
        + '【武勇】：出手時各 1/3 機率震暈目標、把目標擊退兩格，或進入極限防禦'
        + '（下一次怪物回合，每一下傷害都被壓到 2 點以內）—— 揮空也會發動。',
    },
  },
  {
    id: 'gladiator',
    sprite: 'gladiator',
    name: '鬥士 Gladiator',
    line: '「痛只是提醒你還活著。」',
    personality:
      '從南方競技場的沙坑裡爬出來的人。他不懂什麼叫防守，只知道對面倒下的速度要比自己快。'
      + '身上的疤比銅板還多，每一道都記得是哪一場、哪一隻手臂。',
    stats: 'HP 30 ／ AC 12 ／ 命中 +4 ／ 傷害 d10+2 ／ 移動 3 格 ／ 近戰 1 格',
    active: {
      name: '野蠻衝撞',
      text: '低身撞開人群，衝到 5 格內指定目標的身旁，造成 5 點傷害並震暈牠一回合。'
        + '目標周圍沒有空位時原地施放，傷害與暈眩照給。',
    },
    passive: {
      name: '嗜血',
      text: '命中時各 1/2 機率發動【致命斬殺】（這一擊的傷害 ×1.2）或【旋風】'
        + '（周圍八格的敵人各吃到這一刀的一半傷害）。這兩者都要吃這一刀的力道，所以揮空不會發動。',
    },
  },
  {
    id: 'bubble',
    sprite: 'bubble',
    name: '盜賊 Rogue',
    line: '「我沒有偷，只是先拿了。」',
    personality:
      '自稱俠盜，堅持自己劫的都是該劫的人。動作比嘴巴還快，經常在隊伍還在商量的時候'
      + '已經摸到了敵人背後 —— 然後回頭抱怨大家太慢。',
    stats: 'HP 18 ／ AC 12 ／ 命中 +5 ／ 傷害 d6+8 ／ 移動 6 格 ／ 近戰 1 格',
    active: {
      name: '撒網',
      text: '朝 5 格內的一隻怪物撒出羅網，把牠釘在原地三回合，期間每回合流失 1 點 HP。'
        + '被網住的怪仍然能攻擊搆得到的目標。',
    },
    passive: {
      name: '弱點打擊',
      text: '出手時各 1/2 機率劃開目標的護甲（AC 降到六成）或割斷肌腱（傷害降到六成），持續兩回合。揮空也會發動。',
    },
  },
  {
    id: 'archer',
    sprite: 'archer',
    name: '弓手 Archer',
    line: '「再往前一步，我就得換一支箭了。」',
    personality:
      '邊境森林的獵人，習慣在別人看不見的距離做完所有決定。話不多，但每次開口都是'
      + '「左邊三個」「牠背後還有一隻」這種救命的句子。',
    stats: 'HP 18 ／ AC 12 ／ 命中 +6 ／ 傷害 d8+2 ／ 移動 3 格 ／ 射程 5 格',
    active: {
      name: '狙擊',
      text: '屏息瞄準，無視距離對場上任何一隻怪物造成 5 點傷害。',
    },
    passive: {
      name: '獵殺',
      text: '出手時各 1/2 機率發動【放血】（目標三回合每回合流失 1 點 HP）或【穿刺】'
        + '（箭勢貫穿到目標正後方的那一隻怪，造成同樣傷害；這一箭沒射中就沒有貫穿）。',
    },
  },
  {
    id: 'tangerine',
    sprite: 'tangerine',
    name: '法師 Mage',
    line: '「這一頁我讀過了，結局不太好。」',
    personality:
      '法師塔最後一批學徒之一。地城裡的每一道法陣他都能認出來歷，也因此比誰都清楚'
      + '底下那東西不該被喚醒。體力差、脾氣硬，靠著一根法杖撐到現在。',
    stats: 'HP 16 ／ AC 10 ／ 命中 +3 ／ 傷害 d12+2 ／ 移動 2 格 ／ 射程 3 格',
    active: {
      name: '火牆',
      text: '對 3 格內的地面拉出一道三格火牆，站在火裡的怪物每回合被燒掉 3 點 HP，持續兩回合。',
    },
    passive: {
      name: '法術侵蝕',
      text: '出手時各 1/2 機率發動【破魔】（撕開目標的魔法防禦，兩回合內被火焰灼燒的傷害提高三成）'
        + '或【束縛】（目標三回合無法移動）。揮空也會發動。',
    },
  },
  {
    id: 'bard',
    sprite: 'bard',
    name: '吟遊詩人 Bard',
    line: '「別停下來，這一段還沒唱完。」',
    personality:
      '沒有人知道他是怎麼跟進地城的 —— 他自己說是為了寫一首「有結局的歌」。'
      + '打起來不太行，但只要他還在唱，整支隊伍就會覺得自己比實際上更強一點，'
      + '而那一點往往就是活下來的差距。',
    stats: 'HP 18 ／ AC 12 ／ 命中 +3 ／ 傷害 d6+3 ／ 移動 3 格 ／ 攻擊 2 格',
    active: {
      name: '進擊之歌',
      text: '奏起激昂的行軍曲，一回合內全隊的傷害提高 40%。冷卻兩回合。',
    },
    passive: {
      name: '即興吟唱',
      text: '出手時各 1/3 機率唱出【大地之歌】（這一輪全隊 AC +3）、'
        + '【專注之歌】（這一輪全隊命中 +2）或【生命之歌】（全隊恢復 1 點 HP）。揮空也會發動。',
    },
  },
  {
    id: 'summoner',
    sprite: 'summoner',
    name: '召喚術士 Summoner',
    line: '「你們不是敵人，你們是素材。」',
    personality:
      '把「浪費」看得比「殘忍」更嚴重的人。在他眼裡，倒下的哥布林是資源，'
      + '站著的哥布林是還沒說服的資源。隊友大多不太想知道他書上寫了什麼。',
    stats: 'HP 20 ／ AC 12 ／ 命中 +3 ／ 傷害 d6+2 ／ 移動 2 格 ／ 射程 2 格',
    active: {
      name: '魔物召喚',
      text: '撕開地面，召出 2 隻替你作戰的哥布林。牠們會自己找最近的敵人打，'
        + '也會被敵人當成目標。場上的隨從有數量上限，而且**每一層樓只能召喚兩次** —— '
        + '死了再召、死了再召的話，一層下來等於多打十幾隻怪。',
    },
    passive: {
      name: '墮落低語',
      text: '出手時三選一，各 1/3：【洗腦】把目標拉到我方（頭目、薩滿、英雄、巨魔免疫）、'
        + '【放逐】把牠丟進裂隙 2 回合後才吐回來（頭目免疫），'
        + '或【嗜魔鬥志】讓場上所有隨從這一輪的傷害提高 30%。',
    },
  },
  {
    id: 'star',
    sprite: 'star',
    name: '牧師 Cleric',
    line: '「祂還在看著我們。」',
    personality:
      '聖堂派下來記錄這座地城的年輕祭司。他的信仰不是溫和的那一種 —— 治癒與審判'
      + '在他手裡是同一件事：從敵人身上取來的，才配還給同伴。',
    stats: 'HP 20 ／ AC 12 ／ 命中 +3 ／ 傷害 d6+2 ／ 移動 2 格 ／ 近戰 1 格',
    active: {
      name: '神聖治癒',
      text: '為 3 格內的一名隊友恢復 4 點 HP。由 NPC 操作時，會優先搶救血量低於七成的隊友。',
    },
    passive: {
      name: '神聖判官',
      text: '每一次攻擊都從目標身上汲取 1 點生命 —— 自己回多少，目標就扣多少，揮空也照樣汲取。',
    },
  },
];

interface BeastEntry {
  sprite: SpriteKey;
  name: string;
  size: string;
  align: string;
  found: string;
  text: string;
}

/** 怪物圖鑑：只寫來歷與外觀，不寫招式。 */
const MONSTERS: BeastEntry[] = [
  {
    sprite: 'goblin',
    name: '哥布林 Goblin',
    size: '小型人形生物',
    align: '混亂邪惡',
    found: 'B1 起',
    text: '及腰高的綠皮生物，耳朵尖長、牙齒外翻，聞起來像是放了三天的肉湯。'
      + '牠們單獨時膽小如鼠，成群時卻能把一整支商隊拆成骨頭。地城裡的每一條走廊都有牠們的腳印。',
  },
  {
    sprite: 'goblinRogue',
    name: '哥布林盜賊 Goblin Rogue',
    size: '小型人形生物',
    align: '混亂邪惡',
    found: 'B2 起',
    text: '披著染黑獸皮的哥布林，腳掌纏著破布好讓自己不發出聲音。牠們從不正面出現 ——'
      + '你只會看見同伴忽然轉身，然後倒下。速度快得不像這種體型該有的東西。',
  },
  {
    sprite: 'goblinMage',
    name: '哥布林法師 Goblin Mage',
    size: '小型人形生物',
    align: '混亂邪惡',
    found: 'B4 起',
    text: '偷學了法師塔殘篇的哥布林，戴著自己削的骨角面具。牠們的咒文咬字錯得離譜，'
      + '但地城裡的虛空樂意把那些破碎的音節聽成祈禱。牠們總是躲在隊伍最後面。',
  },
  {
    sprite: 'goblinRogue',
    name: '菁英哥布林盜賊 Elite Goblin Rogue',
    size: '小型人形生物',
    align: '混亂邪惡',
    found: 'B6',
    text: '被大門另一側的東西挑選過的盜賊，皮膚泛著不健康的青灰。牠們的動作已經不像哥布林 ——'
      + '更像是有人在背後拉著線，讓那具身體以最有效率的方式殺人。',
  },
  {
    sprite: 'goblinMage',
    name: '菁英哥布林法師 Elite Goblin Mage',
    size: '小型人形生物',
    align: '混亂邪惡',
    found: 'B6',
    text: '面具已經與臉長在一起的法師。牠們不再需要咒文，只要張開嘴，異界的語言就會自己流出來。'
      + '被牠們盯上的人會覺得空氣忽然變得很燙。',
  },
  {
    sprite: 'goblinShaman',
    name: '哥布林薩滿 Goblin Shaman',
    size: '小型人形生物',
    align: '混亂邪惡',
    found: 'B6',
    text: '骨杖上掛滿同族的指骨。牠們在戰場邊緣來回踱步，嘴裡念著沒有人聽得懂的節拍 ——'
      + '而倒下的哥布林會重新站起來。殺牠們永遠比殺牠們照顧的那些划算。',
  },
  {
    sprite: 'goblinHero',
    name: '哥布林英雄 Goblin Hero',
    size: '小型人形生物',
    align: '中立邪惡',
    found: 'B6',
    text: '哥布林之中極少數活過三十場戰鬥的個體，戴著從人類騎士身上剝下來的頭盔，'
      + '盾牌邊緣有一整排刻痕。同族看見牠會讓路。牠是唯一一種會替同伴斷後的哥布林。',
  },
  {
    sprite: 'troll',
    name: '巨魔 Troll',
    size: '大型巨人',
    align: '混亂邪惡',
    found: 'B6',
    text: '兩個成年人高的灰綠色巨物，手臂長到指節會拖過地面。傳說牠們的傷口會自己癒合，'
      + '所以哥布林把牠當成攻城槌用 —— 只要餵飽，牠會一路撞到什麼都不剩。',
  },
];

/** 頭目：一樣只寫來歷與外觀，不寫招式，也不寫怎麼打。 */
const BOSSES: BeastEntry[] = [
  {
    sprite: 'boss1',
    name: '哥布林督軍 Goblin Warlord',
    size: '中型人形生物',
    align: '混亂邪惡',
    found: 'B1 貪婪地窖',
    text: '牠比一般哥布林高出一顆頭，戴著用四頂人類頭盔拼成的角盔。'
      + '地窖裡的每一枚金幣都是牠的，牠也真的一枚一枚數過。牠的咆哮會讓整層樓的同族安靜下來。',
  },
  {
    sprite: 'boss2',
    name: '大薩滿 Goblin High Shaman',
    size: '中型人形生物',
    align: '混亂邪惡',
    found: 'B2 薩滿祭壇',
    text: '臉上永遠戴著一張人類頭骨做的面具，沒有人看過底下是什麼。'
      + '牠在祭壇前站了不知道多少年，把每一個路過的活物都變成儀式的一部分。'
      + '牠說的話連自己的族人都聽不懂，但牠們照做。',
  },
  {
    sprite: 'boss4',
    name: '虛空酋長 Void Chief',
    size: '中型人形生物',
    align: '混亂邪惡',
    found: 'B4 酋長王座',
    text: '牠曾經是這座地城裡最強壯的哥布林，直到牠坐上了那張不該坐的王座。'
      + '現在牠的皮膚底下有東西在流動，眼睛的位置只剩兩點冷光。'
      + '牠的動作之間會有一瞬間的斷裂 —— 像是有人抽掉了幾格畫面。',
  },
  {
    sprite: 'boss5',
    name: '哥布林邪神 Goblin Evil God',
    size: '大型異界生物',
    align: '混亂邪惡',
    found: 'B5 邪神祭壇',
    text: '哥布林一族向虛空祈求了太久，久到虛空真的回頭看了牠們一眼。'
      + '這就是被看見之後長出來的東西：黑得像燒完的木炭，身上開著數不清的紅眼睛，'
      + '每一隻都在看不同的方向。牠很有耐心，因為牠知道你們遲早會走到牠面前。',
  },
];

const GEAR: Array<{ id: DndClassId; sprite: SpriteKey; owner: string; text: string; tiers: [string, string, string] }> = [
  {
    id: 'brave',
    sprite: 'shieldItem',
    owner: '騎士',
    text: '塔盾內側鑲著一面沒有倒影的鏡子。擋下的每一分力道都會找路回去。',
    tiers: ['AC 與 HP 各 +2、反射再 +20%、鎖鏈改成把 2 格內的怪物全部拖過來',
      'AC 與 HP 各 +4、反射再 +40%、鎖鏈範圍 3 格',
      'AC 與 HP 各 +6、反射再 +60%、鎖鏈範圍 4 格'],
  },
  {
    id: 'gladiator',
    sprite: 'swordItem',
    owner: '鬥士',
    text: '比持有者還高的雙手巨劍，劍身有一道從未被磨掉的血槽。握著它的人不容易死。',
    tiers: ['HP +20%、AC +1、休息時多回復 1 點、旋風倍率 0.6',
      'HP +40%、AC +2、休息時多回復 2 點、旋風倍率 0.7',
      'HP +60%、AC +4、休息時多回復 3 點、旋風倍率 0.8'],
  },
  {
    id: 'bubble',
    sprite: 'daggerItem',
    owner: '盜賊',
    text: '刀柄末端嵌著一顆會自己轉的骰子。它決定的事，連持有者也不能反悔。',
    tiers: ['攻擊追加「命中骰 ×0.3」的傷害（揮空也算）、撒網多綁 2 回合且每回合多扣 1 點、獲得【匿蹤】',
      '追加傷害 ×0.6、撒網多綁 4 回合／多扣 2 點、獲得【匿蹤】',
      '追加傷害 ×0.9、撒網多綁 6 回合／多扣 3 點、獲得【匿蹤】'],
  },
  {
    id: 'archer',
    sprite: 'bowItem',
    owner: '弓手',
    text: '弓臂是某種不會腐爛的白木。拉滿的時候，會有第二道弦聲。',
    tiers: ['狙擊變成 2 連射、放血每回合多扣 1 點、受擊時 1/4 機率留下一個【殘影】替身',
      '狙擊 3 連射、放血多扣 2 點、殘影機率 1/3',
      '狙擊 4 連射、放血多扣 3 點、殘影機率 1/2'],
  },
  {
    id: 'bard',
    sprite: 'lyreItem',
    owner: '吟遊詩人',
    text: '琴身是用某種會共鳴的木頭做的。它讓一整支隊伍聽見同一個節拍。',
    tiers: ['全隊 AC／傷害／命中常駐 +1，三首歌的效果各再 +1',
      '常駐 +2、三首歌各再 +2',
      '常駐 +3、三首歌各再 +3'],
  },
  {
    id: 'summoner',
    sprite: 'tomeItem',
    owner: '召喚術士',
    text: '封面用不知名的皮革包著，翻開時書頁自己會往後翻。',
    tiers: ['召喚上限 +1，改為召出菁英哥布林',
      '上限 +2，隨從包含菁英哥布林與菁英哥布林法師',
      '上限 +3，隨從包含菁英哥布林、菁英法師與菁英盜賊'],
  },
  {
    id: 'tangerine',
    sprite: 'orbItem',
    owner: '法師',
    text: '一顆溫熱的珠子，貼近耳朵能聽見很遠的地方有東西在燒。',
    tiers: ['火牆變成 2×2、每回合多燒 1 點', '火牆 3×3、多燒 2 點', '火牆 4×4、多燒 3 點'],
  },
  {
    id: 'star',
    sprite: 'staffItem',
    owner: '牧師',
    text: '杖頭的聖徽有被人反覆摩挲過的痕跡。它讓給予與奪取變成同一個動作。',
    tiers: ['主治療 5、其他隊員各回 2、神聖判官汲取 2',
      '主治療 6、其他隊員各回 3、判官汲取 3',
      '主治療 7、其他隊員各回 4、判官汲取 4'],
  },
];

const TIER_LABEL = ['一般', '困難', '地獄'] as const;

/**
 * 選角畫面用的一句台詞。跟手札共用同一份文字 —— 兩邊各寫一份遲早會漂移。
 * 選角時只要一句話說清楚這個人是誰就夠了，個性側寫與招式細節都留在手札裡。
 */
export const DND_CLASS_LINE = Object.fromEntries(
  PARTY.map((entry) => [entry.id, entry.line]),
) as Record<DndClassId, string>;

export function DndGuide({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('party');

  return (
    <div className="dnd-guide">
      <div className="dnd-guide__bar">
        <h2 className="dnd-guide__title">📖 地下城手札</h2>
        <button type="button" className="btn" onClick={onClose}>← 回到選角</button>
      </div>

      <div className="dnd-guide__tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`dnd-guide__tab${tab === item.id ? ' dnd-guide__tab--on' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'party' && (
        <div className="dnd-guide__body">
          <p className="dnd-guide__lead">
            六個職業，一次只能帶四個下去。空著的位置會由 NPC 隊友補上。
          </p>
          {PARTY.map((entry) => (
            <article key={entry.id} className="dnd-guide__card">
              <header className="dnd-guide__head">
                <PixelSprite name={entry.sprite} className="dnd-guide__portrait" />
                <div>
                  <h3>{entry.name}</h3>
                  <p className="dnd-guide__line">{entry.line}</p>
                  <p className="dnd-guide__stats">{entry.stats}</p>
                </div>
              </header>
              <p>{entry.personality}</p>
              <p><strong className="dnd-guide__skill">主動技能 · {entry.active.name}</strong>{entry.active.text}</p>
              <p><strong className="dnd-guide__skill">被動技能 · {entry.passive.name}</strong>{entry.passive.text}</p>
            </article>
          ))}
        </div>
      )}

      {(tab === 'monsters' || tab === 'bosses') && (
        <div className="dnd-guide__body">
          <p className="dnd-guide__lead">
            {tab === 'monsters'
              ? '以下是地城居民的觀察紀錄。牠們會做什麼，手札沒有寫 —— 那要你自己活著回來才知道。'
              : '四則來歷不明的傳聞。沒有人寫下牠們怎麼戰鬥，寫得下來的人都沒有回來。'}
          </p>
          {(tab === 'monsters' ? MONSTERS : BOSSES).map((entry) => (
            <article key={entry.name} className="dnd-guide__card">
              <header className="dnd-guide__head">
                <PixelSprite name={entry.sprite} className="dnd-guide__portrait" />
                <div>
                  <h3>{entry.name}</h3>
                  <p className="dnd-guide__stats">
                    {entry.size} ・ {entry.align} ・ 出沒於 {entry.found}
                  </p>
                </div>
              </header>
              <p>{entry.text}</p>
            </article>
          ))}
        </div>
      )}

      {tab === 'gear' && (
        <div className="dnd-guide__body">
          <p className="dnd-guide__lead">
            聖物只在一般以上的難度掉落，取得之後會一路帶到最深處。每個人只會拿到自己職業的那一件。
          </p>
          {GEAR.map((entry) => (
            <article key={entry.id} className="dnd-guide__card">
              <header className="dnd-guide__head">
                <PixelSprite name={entry.sprite} className="dnd-guide__portrait" />
                <div>
                  <h3>{DND_EQUIPMENT_NAME[entry.id]}</h3>
                  <p className="dnd-guide__stats">{entry.owner}專用 ・ 共通加值 AC／HP／命中 +2 / +4 / +6</p>
                </div>
              </header>
              <p>{entry.text}</p>
              <ul className="dnd-guide__tiers">
                {entry.tiers.map((line, idx) => (
                  <li key={TIER_LABEL[idx]}>
                    <strong>{TIER_LABEL[idx]}</strong>
                    {line}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          <p className="dnd-guide__lead">
            共通加值的實際數字：一般 +{DND_EQUIPMENT_SPEC.normal.stat}、
            困難 +{DND_EQUIPMENT_SPEC.hard.stat}、地獄 +{DND_EQUIPMENT_SPEC.hell.stat}。
          </p>
        </div>
      )}
    </div>
  );
}
