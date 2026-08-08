import {
  activatePveBossMechanism,
  advancePveEncounter,
  createPveEncounter,
  createPveEnemy,
  downstairsView,
  requestTeamFever,
  startDownstairs,
  type RoomView,
} from 'shared';
import { DownstairsBoardContent } from '../../pages/DownstairsTable';

const playerIds = ['p1', 'p2', 'p3', 'p4'];
const state = startDownstairs(playerIds, 8_080, { p1: 'brave', p2: 'bubble', p3: 'tangerine', p4: 'star' }, 'pve');
const pve = state.pve!;
pve.progression.worldDepthM = 486;
pve.progression.sceneId = 'workshop';
pve.progression.sceneIndex = 1;
pve.progression.sceneStartDepthM = 220;
pve.progression.sceneDepthM = 266;
pve.progression.phase = 'boss';
pve.encounter = createPveEncounter('workshop', 0, 4, 486);
advancePveEncounter(pve.encounter, 3_000, false);
activatePveBossMechanism(pve.encounter);
activatePveBossMechanism(pve.encounter);
pve.encounter.hp = 31;
requestTeamFever(pve.teamFever, 'p3', 30, playerIds);
state.players.p1!.combo = 18;
state.players.p2!.combo = 24;
state.players.p3!.combo = 0;
state.players.p4!.combo = 12;
state.players.p1!.x = 62; state.players.p1!.y = 308;
state.players.p2!.x = 155; state.players.p2!.y = 438;
state.players.p3!.x = 248; state.players.p3!.y = 350;
state.players.p4!.x = 112; state.players.p4!.y = 188;
const runtimePlatforms = state.platforms.filter((platform) => platform.y > 90 && platform.y < 580);
if (runtimePlatforms[0]) runtimePlatforms[0].pveRole = 'bossWeakPoint';
if (runtimePlatforms[1]) { runtimePlatforms[1].pveRole = 'bossMechanism'; runtimePlatforms[1].kind = 'bossSwitch'; }
const enemyA = createPveEnemy(1, { type: 'gearImp', entry: 'portalPop', platformId: runtimePlatforms[2]!.id, telegraphMs: 1_300, x: runtimePlatforms[2]!.x + 8, y: runtimePlatforms[2]!.y - 24 });
enemyA.phase = 'active'; enemyA.hp = 1;
const enemyB = createPveEnemy(2, { type: 'magnetBat', entry: 'edgeLeap', platformId: runtimePlatforms[3]!.id, telegraphMs: 900, x: runtimePlatforms[3]!.x + 8, y: runtimePlatforms[3]!.y - 24 });
enemyB.phaseRemainingMs = 620;
pve.enemies = [enemyA, enemyB];

const game = downstairsView(state);
const room: Pick<RoomView, 'me' | 'seats' | 'hostId'> = {
  hostId: 'p1',
  me: { playerId: 'p1', mode: 'play' },
  seats: playerIds.map((playerId, index) => ({
    seat: index,
    playerId,
    nickname: ['小勇', '泡泡', '阿橘', '星仔'][index]!,
    isHost: index === 0,
    ready: true,
    connected: true,
    characterId: ['brave', 'bubble', 'tangerine', 'star'][index] as 'brave' | 'bubble' | 'tangerine' | 'star',
  })),
};

export default function DownstairsPveRuntimeFixture() {
  return <main style={{ minHeight: '100vh', padding: 16, background: 'var(--bg)', color: 'var(--text)' }}>
    <div style={{ width: 'min(430px, 100%)', margin: '0 auto' }}>
      <DownstairsBoardContent game={game} room={room} />
    </div>
  </main>;
}
