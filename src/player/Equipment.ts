import type { Outfit } from './Character';
import type { GearKind } from '../flow/GameState';

/** Rental catalogue (game prices). */
export const RENTAL_PRICES = {
  ski: 5000, // skis + poles + boots
  snowboard: 5000, // board + boots
  wear: 4000, // jacket + pants
  helmet: 1500,
};

export const GEAR_LENGTHS: Record<GearKind, number[]> = {
  ski: [140, 150, 160, 170, 180],
  snowboard: [140, 145, 150, 155, 160],
};

export const BOOT_SIZES = [23, 24, 25, 26, 27, 28, 29, 30];

export const WEAR_COLORS: { name: string; outfit: Outfit }[] = [
  { name: '紅', outfit: { jacket: 0xc8282d, pants: 0x1d1f26, hat: 0xf2f2f2 } },
  { name: '藍', outfit: { jacket: 0x1f5fbf, pants: 0x2b2f38, hat: 0xffc23d } },
  { name: '綠', outfit: { jacket: 0x2f8a55, pants: 0x1f2a24, hat: 0xeeeeee } },
  { name: '橘', outfit: { jacket: 0xe8762a, pants: 0x2a2a30, hat: 0x222222 } },
  { name: '白', outfit: { jacket: 0xeef0f2, pants: 0x3a4250, hat: 0xc8282d } },
  { name: '紫', outfit: { jacket: 0x7146b8, pants: 0x22222a, hat: 0xf5f5f5 } },
];

/** Own clothes after changing into boots only (when no wear is rented). */
export const OWN_SKI_OUTFIT: Outfit = { jacket: 0x44505e, pants: 0x2b3442, hat: 0x8a2a2a };

/**
 * How gear length affects handling: longer = more stable at speed, slower to turn.
 * Returns multipliers relative to a medium setup.
 */
export function gearHandling(kind: GearKind, lengthCm: number) {
  const mid = kind === 'ski' ? 160 : 150;
  const t = (lengthCm - mid) / 20;
  return { turn: 1 - t * 0.18, stability: 1 + t * 0.25 };
}
