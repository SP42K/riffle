import type { RoomView } from 'shared';
import { BigTwoRoom } from './BigTwoTable';
import { HoldemRoom } from './HoldemTable';

/** 依房間的玩法挑桌面。共用的外殼在 RoomShell。 */
export function Room({ room }: { room: RoomView }) {
  return room.gameType === 'holdem' ? <HoldemRoom room={room} /> : <BigTwoRoom room={room} />;
}
