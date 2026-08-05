import { casinoSkin } from './casino';
import { terminalSkin } from './terminal';
import type { Skin, SkinId } from './types';
import { vscodeSkin } from './vscode';

/** 順序就是快捷鍵循環切換的順序。 */
export const SKINS: Skin[] = [vscodeSkin, terminalSkin, casinoSkin];

export const DEFAULT_SKIN_ID: SkinId = 'vscode';

export function resolveSkin(id: string | null | undefined): Skin {
  return SKINS.find((skin) => skin.id === id) ?? SKINS.find((skin) => skin.id === DEFAULT_SKIN_ID)!;
}

export type { Skin, SkinId, CardFace } from './types';
export { fill } from './types';
