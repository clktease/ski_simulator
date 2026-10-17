import type { Input } from '../core/Input';
import type { FollowCamera } from '../core/FollowCamera';
import type { LiftLine } from '../resort/Lifts';
import type { PlayerBody } from './PlayerBody';

const FAST_FORWARD = 8;

/** Sitting on a real chair of a lift until it reaches the top station. */
export class LiftRide {
  lift: LiftLine | null = null;
  private chair = 0;
  /** true while the player holds the fast-forward key */
  fastForward = false;

  constructor(private readonly input: Input) {}

  board(lift: LiftLine, body: PlayerBody, cam: FollowCamera) {
    this.lift = lift;
    this.chair = lift.nextChair();
    const seat = lift.seatAt(lift.chairDistance(this.chair));
    body.position.copy(seat.pos);
    body.heading = seat.yaw;
    cam.reset(body.position, seat.yaw);
  }

  /** Remaining distance to the top, in metres. */
  get remaining() {
    if (!this.lift) return 0;
    return Math.max(0, this.lift.upLength - this.lift.chairDistance(this.chair));
  }

  /** Returns true when the chair arrived at the top. */
  update(dt: number, body: PlayerBody, cam: FollowCamera) {
    const lift = this.lift!;
    this.fastForward = this.input.isDown('Space');
    lift.speedMultiplier = this.fastForward ? FAST_FORWARD : 1;
    const d = lift.chairDistance(this.chair);
    const seat = lift.seatAt(d);
    body.position.copy(seat.pos);
    body.heading = seat.yaw;
    body.character.setPose('sit');
    body.character.animate(dt, 0);
    cam.update(dt, body.position, { eye: 1.1, speed: 0 });
    // the chair keeps going round; arriving = within the last few metres of the up side
    if (d >= lift.upLength - 3 && d < lift.upLength + 20) {
      lift.speedMultiplier = 1;
      this.lift = null;
      return true;
    }
    return false;
  }

  get speedup() {
    return this.fastForward ? FAST_FORWARD : 1;
  }
}
