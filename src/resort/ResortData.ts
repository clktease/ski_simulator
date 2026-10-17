export type Point2 = [number, number]; // [x, z] in local metres

export type Difficulty = 'novice' | 'easy' | 'intermediate' | 'advanced' | 'expert' | 'freeride';

export interface Run {
  id: string;
  name: string | null;
  difficulty: Difficulty;
  /** true = polygon outline of a wide slope, false = centre line */
  area: boolean;
  points: Point2[];
}

export interface Lift {
  id: string;
  name: string | null;
  type: string;
  seats: number | null;
  /** bottom station -> pylons -> top station */
  points: Point2[];
}

export interface ResortData {
  id: string;
  name: string;
  attribution: string[];
  runs: Run[];
  lifts: Lift[];
  facilities: unknown[];
}

export async function loadResort(baseUrl: string): Promise<ResortData> {
  return fetch(`${baseUrl}/resort.json`).then((r) => r.json());
}

export const DIFFICULTY_COLOR: Record<Difficulty, number> = {
  novice: 0x3cb371,
  easy: 0x3cb371,
  intermediate: 0xd23c3c,
  advanced: 0x222222,
  expert: 0x222222,
  freeride: 0xe08a1e,
};
