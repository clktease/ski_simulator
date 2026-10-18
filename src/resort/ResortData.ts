export type Point2 = [number, number]; // [x, z] in local metres

export type Difficulty = 'novice' | 'easy' | 'intermediate' | 'advanced' | 'expert' | 'freeride';

export interface Run {
  id: string;
  name: string | null;
  difficulty: Difficulty;
  /** Traditional Chinese rendering of the name */
  nameZh?: string;
  /** course number on the official trail map */
  number?: number;
  /** true = polygon outline of a wide slope, false = centre line */
  area: boolean;
  points: Point2[];
}

export interface Lift {
  id: string;
  name: string | null;
  nameZh?: string;
  type: string;
  seats: number | null;
  /** bottom station -> pylons -> top station */
  points: Point2[];
}

export type Service = 'ticket' | 'rental' | 'locker' | 'restaurant' | 'dinner';

export interface InteractionPoint {
  service: Service;
  label: string;
  /** offset in the facility's local frame (x across the front, z towards the front) */
  at: Point2;
}

export interface Facility {
  id: string;
  name: string;
  type: 'parking' | 'center_house' | 'hotel' | 'restaurant';
  x: number;
  z: number;
  width: number;
  depth: number;
  height?: number;
  /** Three.js rotation.y in degrees; the front (local +z) faces (sin r, cos r) */
  rotation: number;
  points?: InteractionPoint[];
}

export interface ResortData {
  id: string;
  name: string;
  attribution: string[];
  runs: Run[];
  lifts: Lift[];
  spawn: { x: number; z: number; heading: number };
  facilities: Facility[];
  /** ploughed walkways between facilities */
  paths: { name: string; width: number; points: Point2[] }[];
}

export async function loadResort(baseUrl: string): Promise<ResortData> {
  return fetch(`${baseUrl}/resort.json`).then((r) => r.json());
}

