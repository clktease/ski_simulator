import * as THREE from 'three';
import { Character } from './Character';

/** The player's physical presence, shared by every movement controller. */
export class PlayerBody {
  readonly character = new Character();
  readonly position = new THREE.Vector3();
  /** Three.js rotation.y; facing (sin h, cos h) */
  heading = 0;

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** Copy position/heading onto the visible character. */
  sync() {
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.heading;
  }
}
