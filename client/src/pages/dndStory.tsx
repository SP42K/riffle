import { useEffect, useState } from 'react';
import type { DndClassId, DndSeatInfo } from 'shared';
import { PixelSprite } from './dndSprites';

/**
 * 層間分鏡與終章。
 *
 * 插圖放在 `client/public/story/`（詳見那裡的 README），**有圖就顯示圖、沒圖就只留讀本框**——
 * 這樣八張圖可以一張一張慢慢補，缺圖的章節不會破版。圖檔不進打包流程，換圖不用重編譯。
 *
 * 這裡全部是前端狀態：不進伺服器、不進 RoomView。每個人各自看自己的，關掉不影響別人。
 */

export interface StoryChapter {
  /** 章名前綴，例如「第 一 章」 */
  ordinal: string;
  title: string;
  lines: string[];
}

export const DND_STORY: Record<number, StoryChapter> = {
  1: {
    ordinal: '第 一 章',
    title: '貪婪的地窖',
    lines: [
      '微光聖物在你們掌心裡跳了一下，然後指向地面。',
      '法師塔的地基比傳說中更深，也更潮濕 —— 石縫裡滲出來的不是水，是某種聞起來像鏽的東西。',
      '樓梯盡頭傳來金屬碰撞的聲響，一枚、又一枚，像有人在數錢。',
      '牠們數了很久了。',
    ],
  },
  2: {
    ordinal: '第 二 章',
    title: '薩滿祭壇',
    lines: [
      '這一層的空氣會黏在皮膚上。',
      '地板被人用血畫出一圈又一圈的符號，最外圈已經乾成褐色，最內圈還是濕的。',
      '有人在這裡向不該回應的東西提問，而它回應了。',
      '儀式沒有停下來的意思 —— 現在你們也在圓圈裡面了。',
    ],
  },
  3: {
    ordinal: '第 三 章',
    title: '逃亡之路',
    lines: [
      '你們推開最後一道石門，撲面而來的是風 —— 真正的、外面的風。',
      '隘口那頭是村莊的方向，而隘口這頭，蜷縮著十個被關了不知道多久的人。',
      '他們認不出你們是誰，只認得出光是從哪一邊來的。',
      '後面的東西也醒了。跑，別回頭數還剩幾個。',
    ],
  },
  4: {
    ordinal: '第 四 章',
    title: '酋長王座',
    lines: [
      '王座是用打敗過的人拼起來的：骨頭、斷劍、還有幾面已經認不出紋章的旗。',
      '坐在上面的東西曾經是這座地城最強壯的哥布林。',
      '現在牠的皮膚底下有東西在流動，而牠的動作之間，偶爾會少掉一格。',
      '牠等你們很久了 —— 或者說，牠背後那道裂縫等很久了。',
    ],
  },
  5: {
    ordinal: '第 五 章',
    title: '邪神祭壇',
    lines: [
      '哥布林一族向虛空祈求了太久。',
      '久到虛空真的回頭，看了牠們一眼。',
      '祭壇前跪滿了信徒，牠們沒有回頭看你們 —— 因為牠們等的東西已經開始睜眼。',
      '每一隻眼睛都看著不同的方向，但你們知道，其中有一隻在看你。',
    ],
  },
  6: {
    ordinal: '第 六 章',
    title: '異世界大門',
    lines: [
      '邪神在斷氣前笑了。',
      '然後牠把自己獻了出去 —— 用自己的軀殼當柴火，把門點著。',
      '石地板從中央裂開，裂縫後面不是岩層，是某個沒有地平線的地方。',
      '這裡沒有樓梯了。往下已經到底，往回也沒有路。只有你們，和那道門。',
    ],
  },
};

export const DND_ENDING: Record<'win' | 'lose', StoryChapter> = {
  win: {
    ordinal: '終 章',
    title: '門闔上了',
    lines: [
      '最後一聲轟鳴之後，地城安靜了下來。',
      '安靜得能聽見石屑落地的聲音，能聽見自己的呼吸，能聽見身邊還有幾個人在呼吸。',
      '微光聖物在掌心裡熄滅了 —— 它指的路已經走完。',
      '你們爬回地面的時候，天正要亮。',
    ],
  },
  lose: {
    ordinal: '終 章',
    title: '火把熄了',
    lines: [
      '最後一支火把倒在石地板上，滾了兩圈，熄了。',
      '地城重新變回它原本的樣子：黑的、濕的、有耐心的。',
      '它不急。它已經等過比你們更強的人。',
      '微光聖物躺在某個沒有人會經過的角落，等下一雙手。',
    ],
  },
};

/** 每個職業的歸宿，分通關與敗北兩版。 */
export const DND_FATE: Record<DndClassId, { win: string; lose: string }> = {
  brave: {
    win: '他把塔盾留在了門前，說那面盾該待在它守住的地方。回到北方守備隊之後，他從不提地城的事，只是每年入冬的第一個夜裡，會在城牆下多點一支火把。',
    lose: '他倒在最前面，盾還舉著。清理地城的人後來搬不動那面盾，就讓它留在原地 —— 現在那裡是一個路標。',
  },
  gladiator: {
    win: '競技場想請他回去打一場表演賽，開價很高。他把錢收下，然後買了一整車的酒送去給地城口的村子，自己一場也沒打。',
    lose: '他笑到最後一刻，因為對面倒得比他早。競技場替他立了一塊碑，上面只刻了一句他的口頭禪。',
  },
  bubble: {
    win: '他確實從地城裡順走了東西 —— 一枚沒有人認得的銅幣。他說那不算偷，因為原主人已經沒手了。他現在在南方的港口，據說在教一群孩子怎麼跑得比追兵快。',
    lose: '沒有人找到他的屍體。有人堅持說在南方的港口看過他，但那人也承認，自己看見的只是一個跑得很快的背影。',
  },
  archer: {
    win: '他回到邊境的森林，繼續在別人看不見的距離做決定。獵人們說森林裡多了一條規矩：往北的路上，箭矢從不落空。',
    lose: '他的箭袋在最後一刻是空的。地城口的樹上多了一支箭，插得很深，方向指著北方 —— 沒有人知道那是誰射的。',
  },
  tangerine: {
    win: '他花了三年寫完那份紀錄，最後一頁只有一句話 ——「那扇門是從裡面開的。」寫完之後他把整份稿子鎖進了法師塔的地下室。',
    lose: '他的紀錄只寫到第五章，最後幾行字被水暈開了。抄寫員照著謄了一份，在那個空白處註明：「此後無存。」',
  },
  star: {
    win: '聖堂想給他一個席位，他拒絕了。他在地城入口蓋了一座很小的禮拜堂，牆上釘著一份名單：救出來的村民在左邊，沒能帶回來的同伴在右邊。他每天替右邊那一排點燭，一個名字一支，一支也不多。',
    lose: '他倒下之前做的最後一件事，是把手按在身邊的同伴身上，而不是自己身上。從敵人那裡取來的每一分，他最後一分也沒有留給自己。',
  },
  bard: {
    win: '他終於寫完了那首「有結局的歌」。歌很長、很少人聽得完，但每一段副歌都會出現同一句：「別停下來。」',
    lose: '那首歌只寫到一半。奇怪的是，這半首歌反而傳得比任何一首完整的歌都遠 —— 因為每個聽的人都會自己補上結局。',
  },
  summoner: {
    win: '他帶走了那本書，也帶走了最後一隻隨從 —— 那隻哥布林現在替他看家。鄰居有意見，他說那是家人。',
    lose: '他最後召出來的隨從沒有消失。牠在原地站了很久，久到後來的探險者以為那是一尊雕像。',
  },
};

const CLASS_NAME: Record<DndClassId, string> = {
  brave: '騎士',
  gladiator: '鬥士',
  bubble: '盜賊',
  archer: '弓手',
  tangerine: '法師',
  star: '牧師',
  bard: '吟遊詩人',
  summoner: '召喚術士',
};

/**
 * 歸宿卡的人物畫像。沒有圖檔就退回棋盤上的像素立繪 ——
 * 十六張可以一張一張補，缺的那幾張不會開天窗。
 */
function FateArt({ classId, won }: { classId: DndClassId; won: boolean }) {
  const base = `/story/fate-${classId}-${won ? 'win' : 'lose'}`;
  const [src, setSrc] = useState(`${base}.jpg`);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    setSrc(`${base}.jpg`);
    setGone(false);
  }, [base]);

  if (gone) {
    return (
      <div className="dnd-fate-card__art dnd-fate-card__art--pixel">
        <PixelSprite name={classId} />
      </div>
    );
  }
  return (
    <div className="dnd-fate-card__art">
      <img
        src={src}
        alt=""
        onError={() => {
          if (src.endsWith('.jpg')) setSrc(`${base}.png`);
          else setGone(true);
        }}
      />
    </div>
  );
}

/**
 * 插圖。找不到檔案就整個收起來，只留讀本框 ——
 * `onError` 是這裡唯一可靠的判斷方式（public 底下的檔案沒有清單可以查）。
 */
function StoryArt({ name }: { name: string }) {
  const [src, setSrc] = useState(`/story/${name}.jpg`);
  const [gone, setGone] = useState(false);

  // 換章時要重新試一次，不然上一章的失敗狀態會沿用
  useEffect(() => {
    setSrc(`/story/${name}.jpg`);
    setGone(false);
  }, [name]);

  if (gone) return null;
  return (
    <div className="dnd-story__art">
      <img
        src={src}
        alt=""
        onError={() => {
          // 先試 jpg（壓過的圖是這個格式），再試 png，兩個都沒有就整塊收起來
          if (src.endsWith('.jpg')) setSrc(`/story/${name}.png`);
          else setGone(true);
        }}
      />
    </div>
  );
}

function StoryFrame({
  art, chapter, footer,
}: {
  art: string;
  chapter: StoryChapter;
  footer: React.ReactNode;
}) {
  return (
    <div className="dnd-story__frame">
      <StoryArt name={art} />
      <div className="dnd-story__caption">
        <p className="dnd-story__chapter">
          {chapter.ordinal} · <b>{chapter.title}</b>
        </p>
        <div className="dnd-story__text">
          {chapter.lines.map((line) => <span key={line}>{line}</span>)}
        </div>
        {footer}
      </div>
    </div>
  );
}

/**
 * 進新樓層時蓋上來的分鏡。
 *
 * 伺服器的回合計時器**不會**因為它暫停，所以輪到自己而且倒數快沒了的時候會自動關掉——
 * 不能讓人因為在讀劇情而被判超時。
 */
export function DndStoryOverlay({
  level, urgent, onClose,
}: {
  level: number;
  urgent: boolean;
  onClose: () => void;
}) {
  const chapter = DND_STORY[level];

  useEffect(() => {
    if (urgent) onClose();
  }, [urgent, onClose]);

  if (!chapter) return null;
  return (
    <div className="dnd-story" role="dialog" aria-modal="true">
      <StoryFrame
        art={`b${level}`}
        chapter={chapter}
        footer={(
          <div className="dnd-story__go">
            <button type="button" className="btn" onClick={onClose}>繼 續</button>
          </div>
        )}
      />
    </div>
  );
}

/**
 * 整局結束的終章，兩頁：
 * 第一頁是全隊的大圖與旁白，第二頁把這一局四個座位的歸宿卡並排。
 * 分兩頁是因為一頁塞不下 —— 大圖加四張直式卡片會逼使用者一直捲。
 */
export function DndEndingOverlay({
  won, seats, onClose,
}: {
  won: boolean;
  seats: Record<number, DndSeatInfo>;
  onClose: () => void;
}) {
  const [page, setPage] = useState<'scene' | 'fates'>('scene');
  const key = won ? 'win' : 'lose';
  const fates = [0, 1, 2, 3]
    .map((seat) => ({ seat, info: seats[seat] }))
    .filter((entry): entry is { seat: number; info: DndSeatInfo } => !!entry.info);

  if (page === 'scene') {
    return (
      <div className="dnd-story" role="dialog" aria-modal="true">
        <StoryFrame
          art={`ending-${key}`}
          chapter={DND_ENDING[key]}
          footer={(
            <div className="dnd-story__go">
              <button type="button" className="btn" onClick={() => setPage('fates')}>
                他們後來怎麼了 →
              </button>
            </div>
          )}
        />
      </div>
    );
  }

  return (
    <div className="dnd-story" role="dialog" aria-modal="true">
      <div className="dnd-story__frame dnd-story__frame--wide">
        <div className="dnd-story__caption">
          <p className="dnd-story__chapter">
            終 章 · <b>{won ? '他們後來' : '留下來的東西'}</b>
          </p>
          <ul className="dnd-fate-cards">
            {fates.map(({ seat, info }) => {
              const classId = info.classId ?? 'brave';
              return (
                <li key={seat} className="dnd-fate-card">
                  <FateArt classId={classId} won={won} />
                  <div className="dnd-fate-card__body">
                    <strong>{info.name?.split(' ')[0] ?? `P${seat + 1}`}</strong>
                    <span className="dnd-fate-card__class">{CLASS_NAME[classId]}</span>
                    <p>{DND_FATE[classId][key]}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="dnd-story__go">
            <button type="button" className="btn" onClick={() => setPage('scene')}>← 回終章</button>
            <button type="button" className="btn" onClick={onClose}>闔 上</button>
          </div>
        </div>
      </div>
    </div>
  );
}
