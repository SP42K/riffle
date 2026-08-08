import { useState, type CSSProperties } from 'react';
import bossLineup from './assets/pve-boss-lineup-v1.jpg';
import './downstairsPvePrototype.css';

type SceneId = 'garden' | 'workshop' | 'rooftop' | 'ruins';
type ReviewMoment = 'explore' | 'entry' | 'boss' | 'fever';

interface SceneDesign {
  id: SceneId;
  name: string;
  depth: number;
  boss: string;
  bossHint: string;
  bossHp: [number, number];
  minions: readonly [string, string];
  mechanic: string;
  platformLabels: readonly string[];
}

const BOSS_LINEUP = bossLineup;

const SCENES: readonly SceneDesign[] = [
  {
    id: 'garden',
    name: '苔芽庭園',
    depth: 86,
    boss: '苔甲巨龜・芽盾',
    bossHint: '踩亮 2 個花苞，讓背甲弱點開花',
    bossHp: [14, 26],
    minions: ['芽跳球', '露珠史萊姆'],
    mechanic: '教學踩擊 · 藤蔓與蘑菇彈台',
    platformLabels: ['樹根土台', '蘑菇芽', '枯木'],
  },
  {
    id: 'workshop',
    name: '齒輪工坊',
    depth: 386,
    boss: '發條巨像・鏘鏘',
    bossHint: '依箭頭踩左右斷電台，停止胸口發條',
    bossHp: [34, 40],
    minions: ['齒輪小鬼', '磁鐵蝠'],
    mechanic: '吊軌 · 活塞 · 方向輸送帶',
    platformLabels: ['鉚釘鋼板', '活塞', '裂齒輪'],
  },
  {
    id: 'rooftop',
    name: '暴風屋頂',
    depth: 718,
    boss: '雷雲鯨・轟隆',
    bossHint: '踩避雷平台導走電荷，再攻擊雷冠',
    bossHp: [31, 46],
    minions: ['風羽鴉', '雨雲精'],
    mechanic: '風向 · 落雷預告 · 屋瓦平台',
    platformLabels: ['屋瓦', '積雲墊', '避雷台'],
  },
  {
    id: 'ruins',
    name: '星光遺跡',
    depth: 1084,
    boss: '吞星龍・夜曜',
    bossHint: '依序收集 3 枚星符，使胸口星核實體化',
    bossHp: [42, 56],
    minions: ['彗星蟲', '鏡光靈'],
    mechanic: '軌道台 · 星流 · 虛空裂板',
    platformLabels: ['星砂石', '星核', '虛空裂板'],
  },
] as const;

const MOMENTS: readonly { id: ReviewMoment; label: string; note: string }[] = [
  { id: 'explore', label: '探索', note: '場景、平台、小怪與個人 Combo' },
  { id: 'entry', label: '小怪入場', note: '方向、落點與秒數三重預告' },
  { id: 'boss', label: 'Boss 戰', note: '共享 HP、攻擊與弱點反制' },
  { id: 'fever', label: 'Team Fever', note: '全隊 5 秒共享獎勵與特效' },
] as const;

const PLATFORM_LAYOUT = [
  { x: 7, y: 25, width: 27, kind: 'normal' },
  { x: 47, y: 29, width: 18, kind: 'spring' },
  { x: 75, y: 23, width: 20, kind: 'normal' },
  { x: 18, y: 47, width: 22, kind: 'moving' },
  { x: 55, y: 50, width: 30, kind: 'mechanism' },
  { x: 4, y: 70, width: 21, kind: 'fragile' },
  { x: 36, y: 73, width: 24, kind: 'normal' },
  { x: 72, y: 68, width: 23, kind: 'conveyor' },
] as const;

const PLAYER_LAYOUT = [
  { x: 21, y: 39, color: 'brave', name: '小勇', hearts: '♥♥♥' },
  { x: 57, y: 63, color: 'bubble', name: '泡泡', hearts: '♥♥' },
  { x: 78, y: 17, color: 'star', name: '小星', hearts: '♥♥♥' },
] as const;

function BossConcept({ scene, compact = false }: { scene: SceneDesign; compact?: boolean }) {
  const index = SCENES.findIndex((item) => item.id === scene.id);
  const position = index === 0 ? '0% 50%' : index === 1 ? '33.333% 50%' : index === 2 ? '66.667% 50%' : '100% 50%';
  return (
    <div
      className={'pve-review__boss-concept' + (compact ? ' is-compact' : '')}
      style={{ backgroundImage: 'url(' + BOSS_LINEUP + ')', backgroundPosition: position }}
      role="img"
      aria-label={scene.boss + ' 原創造型概念'}
    >
      <span className="pve-review__weakpoint" aria-hidden="true" />
    </div>
  );
}

function EnemyToken({
  scene,
  index,
  entry,
}: {
  scene: SceneDesign;
  index: 0 | 1;
  entry?: boolean;
}) {
  const style = {
    left: (index === 0 ? 27 : 67) + '%',
    top: (index === 0 ? 19 : 54) + '%',
  } satisfies CSSProperties;
  return (
    <div className={'pve-review__enemy is-' + index + (entry ? ' is-entering' : '')} data-scene={scene.id} style={style}>
      {entry && <span className="pve-review__entry-path" aria-hidden="true">↘</span>}
      {entry && <b className="pve-review__entry-time">0.9s</b>}
      <i aria-hidden="true"><span /></i>
      <strong>{scene.minions[index]}</strong>
      {index === 1 && <em><span /><span /></em>}
    </div>
  );
}

function ReviewBoard({ scene, moment }: { scene: SceneDesign; moment: ReviewMoment }) {
  const fever = moment === 'fever';
  const bossVisible = moment === 'boss' || fever;
  const entry = moment === 'entry';
  const [hp, maxHp] = scene.bossHp;
  const bossPercent = Math.round((hp / maxHp) * 100);

  return (
    <section className="pve-review__device" aria-label={scene.name + ' ' + MOMENTS.find((item) => item.id === moment)?.label + ' UI 預覽'}>
      <div className="pve-review__scorebar">
        <strong>{scene.depth}m</strong>
        <span>{scene.name}</span>
        <span>3 人存活</span>
      </div>
      <div className={'pve-review__team-rail' + (fever ? ' is-active' : '')}>
        <div>
          <strong>{fever ? 'TEAM FEVER 3.8s' : 'TEAM FEVER'}</strong>
          <span>{fever ? '小星觸發 · 傷害 +1' : '小星 27 READY'}</span>
          <b>{fever ? '◆ ×3' : '27/30'}</b>
        </div>
        <i><span style={{ width: fever ? '76%' : '90%' }} /></i>
      </div>
      <div className="pve-review__self-hud">
        <strong>我：COMBO ×{fever ? 8 : 18}</strong>
        <span>技能 6.2s</span>
        <b>♥♥♥</b>
      </div>
      {bossVisible && (
        <div className="pve-review__boss-hud">
          <div><strong>{scene.boss}</strong><span>下一招：{scene.id === 'garden' ? '種子雨' : scene.id === 'workshop' ? '雙手拍擊' : scene.id === 'rooftop' ? '三點落雷' : '暗影光束'}</span><b>{hp}/{maxHp}</b></div>
          <i><span style={{ width: bossPercent + '%' }} /></i>
        </div>
      )}
      <div className={'pve-review__playfield is-' + scene.id + (fever ? ' has-fever' : '')}>
        <div className="pve-review__sky is-far" />
        <div className="pve-review__sky is-near" />
        <div className="pve-review__danger is-top">▲ 頂端危險</div>
        {entry && <div className="pve-review__notice">小怪入場 · 看箭頭與落點</div>}
        {bossVisible && <div className="pve-review__notice">{scene.bossHint}</div>}
        {PLATFORM_LAYOUT.map((platform, index) => (
          <div
            key={index}
            className={'pve-review__platform is-' + platform.kind + (bossVisible && index === 4 ? ' is-weak' : '')}
            style={{ left: platform.x + '%', top: platform.y + '%', width: platform.width + '%' }}
          >
            <i /><span>{platform.kind === 'spring' ? '↟' : platform.kind === 'moving' ? '↔' : platform.kind === 'fragile' ? '⌁' : platform.kind === 'conveyor' ? '››' : bossVisible && index === 4 ? '◆' : ''}</span>
          </div>
        ))}
        {!bossVisible && <EnemyToken scene={scene} index={0} entry={entry} />}
        {(moment === 'explore' || entry) && <EnemyToken scene={scene} index={1} />}
        {bossVisible && <BossConcept scene={scene} compact />}
        {PLAYER_LAYOUT.map((player, index) => (
          <div
            key={player.name}
            className={'pve-review__player is-' + player.color + (fever ? ' has-fever' : '')}
            style={{ left: player.x + '%', top: player.y + '%' }}
          >
            <span><strong>{player.name}</strong><b>{player.hearts}</b></span>
            <i aria-hidden="true">•ᴗ•</i>
            {index === 0 && <em>{fever ? '傷害 +1' : 'PERFECT'}</em>}
          </div>
        ))}
        {fever && <div className="pve-review__fever-fx" aria-hidden="true"><i /><i /><i /><i /><i /></div>}
        {bossVisible && <div className="pve-review__boss-callout">弱點 {scene.id === 'ruins' ? '2/3' : 'READY'} · 每 cycle 傷害上限</div>}
        <div className="pve-review__danger is-bottom">▼ 往更深處</div>
      </div>
    </section>
  );
}

export default function DownstairsPvePrototype() {
  const query = new URLSearchParams(window.location.search);
  const requestedScene = query.get('scene');
  const requestedMoment = query.get('moment');
  const [sceneId, setSceneId] = useState<SceneId>(() =>
    SCENES.some((item) => item.id === requestedScene) ? requestedScene as SceneId : 'garden'
  );
  const [moment, setMoment] = useState<ReviewMoment>(() =>
    MOMENTS.some((item) => item.id === requestedMoment) ? requestedMoment as ReviewMoment : 'explore'
  );
  const scene = SCENES.find((item) => item.id === sceneId)!;

  return (
    <main className="pve-review">
      <header className="pve-review__header">
        <div>
          <span className="pve-review__eyebrow">PHASE 6B · CLIENT-ONLY FIXTURE</span>
          <h1>樓梯小勇者 · 深度 PvE UI/UX 設計稿</h1>
          <p>固定 mock state，不建立房間、不連 Socket、不修改正式遊戲。使用 F8 切換三套外觀，F9 驗證隱藏／恢復。</p>
        </div>
        <a className="pve-review__back" href="/">返回平台</a>
      </header>

      <nav className="pve-review__tabs" aria-label="選擇場景">
        {SCENES.map((item) => (
          <button key={item.id} type="button" aria-pressed={sceneId === item.id} onClick={() => setSceneId(item.id)}>
            <span>{item.depth}m</span><strong>{item.name}</strong><small>{item.boss}</small>
          </button>
        ))}
      </nav>

      <nav className="pve-review__moments" aria-label="選擇遊戲狀態">
        {MOMENTS.map((item) => (
          <button key={item.id} type="button" aria-pressed={moment === item.id} onClick={() => setMoment(item.id)}>
            <strong>{item.label}</strong><small>{item.note}</small>
          </button>
        ))}
      </nav>

      <div className="pve-review__workspace">
        <ReviewBoard scene={scene} moment={moment} />
        <aside className="pve-review__notes">
          <section>
            <span className="pve-review__eyebrow">SCENE CONTRACT</span>
            <h2>{scene.name}</h2>
            <p>{scene.mechanic}</p>
            <div className="pve-review__chips">{scene.platformLabels.map((label) => <span key={label}>{label}</span>)}</div>
          </section>
          <section>
            <span className="pve-review__eyebrow">ENEMY READABILITY</span>
            <div className="pve-review__enemy-cards">
              {scene.minions.map((name, index) => (
                <article key={name} data-scene={scene.id}>
                  <i aria-hidden="true"><span /></i>
                  <div><strong>{name}</strong><small>{index === 0 ? '1–2 HP · 快速輪廓' : '2–3 HP · 顯示短 HP pips'}</small></div>
                </article>
              ))}
            </div>
            <p>入場必須同時顯示方向／落點、剪影與倒數；預告期沒有碰撞。</p>
          </section>
          <section>
            <span className="pve-review__eyebrow">BOSS COUNTERPLAY</span>
            <BossConcept scene={scene} />
            <h3>{scene.boss}</h3>
            <p>{scene.bossHint}</p>
          </section>
          <section className="pve-review__approval">
            <span className="pve-review__eyebrow">本版確認重點</span>
            <ul>
              <li>個人 Combo 與共享 Fever 是否一眼可分</li>
              <li>怪物入場與 Boss 弱點是否不用猜</li>
              <li>平台材質是否仍保留一致功能輪廓</li>
              <li>360×640、F8、F9 與 reduced-motion 是否清楚</li>
            </ul>
          </section>
        </aside>
      </div>
      <figure className="pve-review__concept-board">
        <img src={BOSS_LINEUP} alt="芽盾、鏘鏘、轟隆與夜曜四隻原創 Boss 完整造型概念板" />
        <figcaption>
          <span className="pve-review__eyebrow">ORIGINAL BOSS LINEUP V1</span>
          <strong>完整身體、關節連接與發光弱點的視覺方向</strong>
          <small>此圖只供 UI/UX 核准；正式動畫需拆成一致 sprite frame 或 root → joint → limb 分層 rig。</small>
        </figcaption>
      </figure>
    </main>
  );
}
