import type { RoomView } from 'shared';
import { BigTwoRoom } from './BigTwoTable';
import { HoldemRoom } from './HoldemTable';
import { MonopolyRoom } from './MonopolyTable';

/** 依房間的玩法挑桌面。共用的外殼在 RoomShell。 */
export function Room({ room }: { room: RoomView }) {
  // 寫成 switch 而不是三元 —— 新玩法漏接的話會編譯失敗，不會被默默當成大老二
  switch (room.gameType) {
    case 'bigTwo':
      return <BigTwoRoom room={room} />;
    case 'holdem':
      return <HoldemRoom room={room} />;
    case 'monopoly':
      return <MonopolyRoom room={room} />;
  }
}
