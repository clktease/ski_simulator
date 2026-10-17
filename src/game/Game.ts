import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { Input } from '../core/Input';
import { FlyCamera } from '../core/FlyCamera';
import { FollowCamera } from '../core/FollowCamera';
import type { Heightmap } from '../world/Heightmap';
import type { TreeIndex } from '../world/Trees';
import type { SkyLight } from '../world/SkyLight';
import { Weather, WEATHER, type WeatherType } from '../world/Weather';
import { SNOW, snowAt, type SnowType } from '../world/SnowConditions';
import { SnowParticles } from '../world/SnowParticles';
import { NightLights } from '../world/NightLights';
import type { ResortData } from '../resort/ResortData';
import { MASK_PISTE, type PisteMask } from '../resort/PisteMask';
import type { LiftLine } from '../resort/Lifts';
import type { Buildings, WorldInteraction } from '../resort/Buildings';
import { PlayerBody } from '../player/PlayerBody';
import { STREET_OUTFIT } from '../player/Character';
import { OWN_SKI_OUTFIT } from '../player/Equipment';
import { WalkController } from '../player/WalkController';
import { SkiController } from '../player/SkiController';
import { LiftRide } from '../player/LiftRide';
import { NpcSkiers } from '../npc/NpcSkiers';
import { SkiAudio } from '../audio/SkiAudio';
import { DINNER_FROM, GameState, LIFTS_CLOSE_DAY, LIFTS_CLOSE_NIGHT, LIFTS_OPEN } from '../flow/GameState';
import { objectives, showSummary } from '../flow/DayFlow';
import { openService, type ServiceContext } from '../flow/Services';
import { Hud } from '../ui/Hud';
import { SkiHud } from '../ui/SkiHud';
import { Panel, h } from '../ui/Panel';
import { InteractionUI } from '../ui/Interaction';
import { switchQuality, type QualityLevel } from '../core/Quality';
import { Guidance, type GuideTarget } from '../ui/Guidance';
import { Minimap } from '../ui/Minimap';
import { WalkGraph } from '../resort/WalkGraph';
import type { RunPath } from '../resort/RunPaths';
import type { PisteGuide } from '../world/PisteGuide';

export type Mode = 'walk' | 'ski' | 'lift' | 'fly';

const HELP: Record<Mode, string> = {
  walk: 'WASD 走路 · Shift 跑步 · Space 快速移動 · E 互動 · Q 穿上雪板 · G 引導 · M 雪道導覽 · N 地圖 · O 設定',
  ski: 'A/D 轉彎 · W 蹲低/推進 · S 煞車 · V 第一人稱 · E 搭纜車 · Q 脫雪板 · G 引導 · M 雪道導覽 · N 地圖 · O 設定',
  lift: '按住 Space 快轉 · Enter 跳過 · 滑鼠環視風景 · V 第一人稱 · N 地圖',
  fly: '飛行模式 · WASD 移動 · Space/Shift 升降 · R 加速 · M 雪道導覽 · F 回到角色',
};

/** Lifts that keep running for night skiing (game setting). */
const NIGHT_LIFT = /中央/;

export interface World {
  hm: Heightmap;
  resort: ResortData;
  mask: PisteMask;
  trees: TreeIndex;
  sky: SkyLight;
  lifts: LiftLine[];
  buildings: Buildings;
  runPaths: RunPath[];
  pisteGuide: PisteGuide;
}

export class Game {
  readonly state = new GameState();
  readonly input: Input;
  readonly weather = new Weather();
  readonly body = new PlayerBody();
  mode: Mode = 'walk';
  private modeBeforeFly: Mode = 'walk';
  weatherAuto = true;
  npcEnabled = true;

  private readonly cam: FollowCamera;
  private readonly fly: FlyCamera;
  private readonly walk: WalkController;
  readonly ski: SkiController;
  private readonly ride: LiftRide;
  private readonly hud = new Hud();
  private readonly skiHud = new SkiHud();
  private readonly panel: Panel;
  private readonly interaction: InteractionUI;
  private readonly particles = new SnowParticles();
  private readonly nightLights: NightLights;
  private readonly npcs: NpcSkiers;
  private readonly audio = new SkiAudio();
  private readonly services: ServiceContext;
  private readonly guide: Guidance;
  private readonly minimap: Minimap;
  private readonly walkGraph: WalkGraph;
  private guideRoute: THREE.Vector2[] | null = null;
  private routeTimer = 0;

  private runDrop = 0;
  private skipping = false;
  /** lift the player is (or was last) riding, for unloading at its top */
  private ridingLift: LiftLine | null = null;
  private stillTime = 0;
  private weatherTimer = 90;
  private warnTimer = 0;
  private skyTimer = 0;
  private ended = false;

  constructor(
    private readonly engine: Engine,
    private readonly w: World,
  ) {
    const { scene, camera } = engine;
    this.input = new Input(engine.renderer.domElement);
    const ground = (x: number, z: number) => w.hm.heightAt(x, z);
    this.cam = new FollowCamera(camera, this.input, ground);
    this.fly = new FlyCamera(camera, this.input, ground);
    this.walk = new WalkController(this.input, w.hm, w.buildings.colliders);
    this.ski = new SkiController(this.input, w.hm, w.trees, w.buildings.colliders);
    this.ride = new LiftRide(this.input);
    this.panel = new Panel(this.input);

    this.ski.onFall = (reason) => {
      this.state.stats.falls++;
      this.state.stamina = Math.max(0, this.state.stamina - 4);
      this.hud.toast(`💥 ${reason}`);
    };

    // lift boarding points join the facility counters
    const points: WorldInteraction[] = [...w.buildings.interactions];
    for (const lift of w.lifts) {
      points.push({ service: 'lift', label: `搭乘 ${lift.data.name ?? '纜車'}`, at: [0, 0], facility: null, position: lift.boardingPoint, range: 7, lift });
    }
    this.interaction = new InteractionUI(this.input, points, (p) => this.activate(p));
    this.services = {
      state: this.state,
      panel: this.panel,
      hud: this.hud,
      refreshLook: () => this.refreshLook(),
      endDay: () => this.endDay(),
    };

    scene.add(this.body.character.root, this.particles.points);
    const nightRuns = w.resort.runs.filter((r) => {
      const central = w.lifts.find((l) => NIGHT_LIFT.test(l.data.name ?? ''));
      if (!central) return false;
      return r.points.some(([x, z]) => Math.hypot(x - central.top.x, z - central.top.z) < 200 || Math.hypot(x - central.bottom.x, z - central.bottom.z) < 200);
    });
    this.nightLights = new NightLights(w.hm, nightRuns);
    scene.add(this.nightLights.group);
    this.npcs = new NpcSkiers(w.hm, w.runPaths, w.lifts, engine.quality.npcs, (l) => this.liftOpen(l));
    scene.add(this.npcs.group);

    this.guide = new Guidance(w.hm);
    scene.add(this.guide.group);
    this.minimap = new Minimap(w.hm, w.resort, w.runPaths);
    const skip = document.getElementById('skip-lift')!;
    skip.addEventListener('click', () => this.skipLift());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.minimap.bigOpen) this.minimap.toggleBig(false);
    });
    this.walkGraph = new WalkGraph(w.resort);

    this.state.onChange(() => this.refreshLook());
    this.refreshLook();
  }

  spawn(x: number, z: number, headingDeg: number) {
    this.body.heading = THREE.MathUtils.degToRad(headingDeg);
    this.body.position.set(x, this.w.hm.heightAt(x, z), z);
    this.cam.reset(this.body.position, this.body.heading);
    this.setMode('walk');
  }

  setMode(m: Mode) {
    if (m === 'fly') {
      this.engine.camera.position.y += 30;
      this.fly.lookAt(this.body.position);
    }
    if (this.mode === 'fly' && m !== 'fly') this.cam.reset(this.body.position, this.body.heading);
    this.mode = m;
    this.hud.setHelp(HELP[m]);
    this.skiHud.visible = m === 'ski' || m === 'lift';
    document.getElementById('skip-lift')!.hidden = m !== 'lift';
    this.refreshLook();
  }

  /** Switch to the free camera at a given viewpoint. */
  flyTo(position: THREE.Vector3, lookAt: THREE.Vector3) {
    this.setMode('fly');
    this.engine.camera.position.copy(position);
    this.fly.lookAt(lookAt);
  }

  /** Dress the character for the current state and mode. */
  private refreshLook() {
    const s = this.state;
    const c = this.body.character;
    c.setOutfit(s.changed && s.rental ? s.rental.wear ?? OWN_SKI_OUTFIT : STREET_OUTFIT);
    c.setSkiwear(s.changed);
    this.walk.inBoots = s.changed;
    const geared = (this.mode === 'ski' || this.mode === 'lift') && s.rental;
    c.setGear(geared ? s.rental!.kind : null, s.rental?.lengthCm);
    if (s.rental) this.ski.setGear(s.rental.kind, s.rental.lengthCm);
  }

  private activate(p: WorldInteraction) {
    if (p.service === 'lift') return this.boardLift(p.lift!);
    if (this.mode === 'ski') {
      this.hud.toast('先按 Q 脫下雪板再進建築物');
      return;
    }
    openService(p.service, p.facility?.id, p.label, this.services);
  }

  private liftOpen(lift: LiftLine, minutes = this.state.minutes) {
    if (minutes < LIFTS_OPEN) return false;
    if (minutes <= LIFTS_CLOSE_DAY) return true;
    return minutes <= LIFTS_CLOSE_NIGHT && NIGHT_LIFT.test(lift.data.name ?? '');
  }

  private boardLift(lift: LiftLine) {
    const s = this.state;
    if (!s.canSki) return this.hud.toast('需要先租借雪具並在更衣室換裝');
    if (!s.ticketValid()) return this.hud.toast(s.ticket ? '纜車票已過期，請到售票處購買' : '需要纜車票，請到センターハウス售票處購買');
    if (!this.liftOpen(lift)) return this.hud.toast('這條纜車目前停止運行');
    this.finishRun();
    this.setMode('lift');
    this.ridingLift = lift;
    this.ride.board(lift, this.body, this.cam);
    s.stats.liftRides++;
    s.emit();
    this.hud.toast(`搭上 ${lift.data.name ?? '纜車'}，按住 Space 可以快轉`);
  }

  private togglePisteGuide(on = !this.w.pisteGuide.visible) {
    this.w.pisteGuide.visible = on;
    this.hud.toast(on ? '雪道導覽：開（顏色＋行進方向箭頭）' : '雪道導覽：關');
  }

  /** Jump straight to the top station; the clock advances by the ride time. */
  private skipLift() {
    const lift = this.ridingLift;
    if (this.mode !== 'lift' || !lift || this.skipping) return;
    this.skipping = true;
    const realSeconds = this.ride.remaining / lift.speed;
    void this.hud.fade(`搭乘${lift.data.name ?? '纜車'}中…`, () => {
      this.skipping = false;
      // the chair may have arrived on its own while the screen faded
      if (this.mode !== 'lift') return;
      this.state.pass((realSeconds * this.state.timeScale) / 60);
      lift.speedMultiplier = 1;
      this.ride.lift = null;
      this.arriveTop();
    }, 250);
  }

  private toggleSkis() {
    if (this.mode === 'walk') {
      if (!this.state.canSki) return this.hud.toast('需要先租借雪具並換裝才能滑雪');
      this.setMode('ski');
      this.ski.start(this.body);
      this.runDrop = 0;
    } else if (this.mode === 'ski') {
      if (this.ski.speed > 1.5) return this.hud.toast('停下來才能脫雪板');
      this.finishRun();
      this.setMode('walk');
    }
  }

  /** Count a run once the skier has descended enough and stopped / boards a lift. */
  private finishRun() {
    if (this.runDrop >= 60) {
      this.state.stats.runs++;
      this.hud.toast(`完成第 ${this.state.stats.runs} 趟！落差 ${Math.round(this.runDrop)} m`);
      this.state.emit();
    }
    this.runDrop = 0;
  }

  private endDay() {
    if (this.ended) return;
    this.ended = true;
    this.interaction.update(this.body.position, false);
    this.guide.enabled = false;
    this.guide.update(0, 0, this.body.position, null, null, 0);
    this.skiHud.visible = false;
    showSummary(this.state);
  }

  private openSettings() {
    this.panel.open('設定・模擬條件', (body) => {
      const render = () => {
        body.replaceChildren();
        const row = (label: string, chips: [string, boolean, () => void][]) => {
          const r = h('div', { className: 'row' }, h('span', {}, label));
          for (const [text, selected, act] of chips) {
            const c = h('button', { className: `chip${selected ? ' selected' : ''}` }, text);
            c.addEventListener('click', () => { act(); render(); });
            r.append(c);
          }
          body.append(r);
        };
        row('天氣', [
          ['自動', this.weatherAuto, () => (this.weatherAuto = true)],
          ...(Object.keys(WEATHER) as WeatherType[]).map((t) => [WEATHER[t].label, !this.weatherAuto && this.weather.type === t, () => { this.weatherAuto = false; this.weather.set(t); }] as [string, boolean, () => void]),
        ]);
        row('雪況', [
          ['自動', this.weather.snowOverride === null, () => (this.weather.snowOverride = null)],
          ...(Object.keys(SNOW) as SnowType[]).map((t) => [SNOW[t].label.replace(/（.*/, ''), this.weather.snowOverride === t, () => (this.weather.snowOverride = t)] as [string, boolean, () => void]),
        ]);
        row('時間', [8 * 60 + 30, 12 * 60, 15 * 60 + 30, 17 * 60 + 30, 19 * 60].map((t) => [
          `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, false, () => { this.state.minutes = t; this.state.emit(); },
        ] as [string, boolean, () => void]));
        row('雪道導覽', [['開', this.w.pisteGuide.visible, () => this.togglePisteGuide(true)], ['關', !this.w.pisteGuide.visible, () => this.togglePisteGuide(false)]]);
        row('其他滑雪者', [['顯示', this.npcEnabled, () => (this.npcEnabled = true)], ['隱藏', !this.npcEnabled, () => (this.npcEnabled = false)]]);
        row('音效', [['開', !this.audio.muted, () => (this.audio.muted = false)], ['關', this.audio.muted, () => (this.audio.muted = true)]]);
        row('畫質', (['low', 'medium', 'high'] as QualityLevel[]).map((q) => [{ low: '低', medium: '中', high: '高' }[q], this.engine.quality.level === q, () => switchQuality(q)] as [string, boolean, () => void]));
        const tp = (label: string, x: number, z: number, heading: number) => [label, false, () => { this.teleport(x, z, heading); this.panel.close(); }] as [string, boolean, () => void];
        const top = (name: RegExp) => this.w.lifts.find((l) => name.test(l.data.name ?? ''));
        const quad = top(/中央/), summit = top(/山頂/);
        const liftTp = (label: string, l: LiftLine | undefined) => (l ? [tp(label, l.top.x + l.topDir.x * 10, l.top.z + l.topDir.z * 10, THREE.MathUtils.radToDeg(Math.atan2(-l.topDir.x, -l.topDir.z)))] : []);
        row('傳送', [
          tp('停車場', this.w.resort.spawn.x, this.w.resort.spawn.z, this.w.resort.spawn.heading),
          ...liftTp('中央クワッド山頂', quad),
          ...liftTp('山頂クワッド山頂', summit),
        ]);
        body.append(h('p', { className: 'muted' }, '天氣與雪況會影響能見度、風、摩擦力、抓地力與跌倒機率。'));
      };
      render();
    });
  }


  teleport(x: number, z: number, headingDeg: number) {
    this.body.heading = THREE.MathUtils.degToRad(headingDeg);
    this.body.position.set(x, this.w.hm.heightAt(x, z), z);
    this.cam.reset(this.body.position, this.body.heading);
    if (this.state.canSki) {
      this.setMode('ski');
      this.ski.start(this.body);
    } else this.setMode('walk');
    this.runDrop = 0;
  }

  update(dt: number, elapsed: number) {
    const k = this.input;
    const s = this.state;
    if (this.ended) return;

    if (k.wasPressed('KeyF') && this.mode !== 'lift') {
      if (this.mode === 'fly') this.setMode(this.modeBeforeFly);
      else {
        this.modeBeforeFly = this.mode;
        this.setMode('fly');
      }
    }
    if (k.wasPressed('KeyM')) this.togglePisteGuide();
    if (k.wasPressed('KeyN')) this.minimap.toggleBig();
    if (k.wasPressed('Minus') || k.wasPressed('NumpadSubtract')) this.minimap.zoomBy(1);
    if (k.wasPressed('Equal') || k.wasPressed('NumpadAdd')) this.minimap.zoomBy(-1);
    if (k.wasPressed('Enter') && this.mode === 'lift') this.skipLift();
    if (k.wasPressed('KeyV')) {
      this.cam.firstPerson = !this.cam.firstPerson;
      this.cam.pitch = this.cam.firstPerson ? 0.08 : 0.25;
    }
    if (k.wasPressed('KeyQ')) this.toggleSkis();
    if (k.wasPressed('KeyO')) this.openSettings();
    if (k.wasPressed('KeyG')) {
      this.guide.enabled = !this.guide.enabled;
      this.hud.toast(this.guide.enabled ? '路線引導：開' : '路線引導：關');
    }

    // --- player ---
    const env = { snowAt: (x: number, z: number) => this.snowAt(x, z), wind: this.weather.wind, stamina: s.stamina };
    let activity = 0;
    let speedup = 1;
    if (this.mode === 'walk') {
      this.walk.update(dt, this.body, this.cam);
      activity = 0.15 * Math.min(1, this.walk.speed / 1.5);
    } else if (this.mode === 'ski') {
      this.ski.update(dt, this.body, this.cam, env);
      const v = this.ski.speed;
      activity = this.ski.fallen ? 0.6 : 0.3 + 0.7 * Math.min(1, v / 15);
      this.trackRun(dt, v);
    } else if (this.mode === 'lift') {
      speedup = this.ride.speedup;
      if (this.ride.update(dt, this.body, this.cam)) this.arriveTop();
    } else {
      this.fly.update(dt);
    }
    this.body.character.root.visible = !(this.cam.firstPerson && this.mode !== 'fly');
    this.body.sync();

    // --- world ---
    const indoors = this.panel.isOpen;
    const gameMinutes = (dt * s.timeScale * speedup) / 60;
    const night = s.minutes > 17 * 60;
    const cold = this.weather.current.cold + (night ? 0.2 : 0) + (this.mode === 'lift' ? 0.15 : 0);
    if (!indoors) s.tick(dt, activity, cold, false, speedup);
    if (s.satiety < 10) s.stamina = Math.max(0, s.stamina - gameMinutes * 0.15);
    this.weather.update(dt, gameMinutes);
    this.autoWeather(gameMinutes);

    this.skyTimer -= dt;
    if (this.skyTimer <= 0) {
      this.skyTimer = 0.25;
      this.w.sky.set({ minutes: s.minutes, cloud: this.weather.current.cloud, fogDensity: this.weather.current.fog });
    }
    const viewer = this.mode === 'fly' ? this.engine.camera.position : this.body.position;
    this.w.sky.follow(viewer);
    this.particles.update(dt, this.engine.camera, this.weather.current.snowfall, this.weather.wind, 0.75 + 0.25 * this.w.sky.daylight);
    this.nightLights.update(this.w.sky.daylight < 0.6 && s.minutes <= LIFTS_CLOSE_NIGHT + 30, viewer);
    for (const l of this.w.lifts) {
      const ridingThis = this.mode === 'lift' && this.ridingLift === l;
      l.running = ridingThis || this.liftOpen(l) || this.liftOpen(l, s.minutes - 30);
      l.update(dt);
    }
    this.w.buildings.update(elapsed);
    this.npcs.update(dt, this.body.position, this.npcEnabled && s.minutes >= LIFTS_OPEN && this.npcsAllowed());

    // --- interaction & UI ---
    const canInteract = !this.panel.isOpen && (this.mode === 'walk' || (this.mode === 'ski' && this.ski.speed < 2.5));
    this.interaction.update(this.body.position, canInteract);
    this.updateGuidance(dt, elapsed);
    this.updateHud(dt);
    this.audio.update(this.mode === 'ski' ? this.ski.speed : 0, this.ski.telemetry.skid, this.weather.current.wind, this.ski.telemetry.snow?.fallRisk === SNOW.ice.fallRisk);
    this.warnings(dt);

    if (s.minutes >= 21 * 60 + 30 && !s.dinnerDone) {
      this.hud.toast('太晚了，今天就到這裡吧');
      this.endDay();
    }
  }

  private npcsAllowed() {
    // the crowd leaves when the day lifts close, except night skiers on the central slope
    return this.state.minutes <= LIFTS_CLOSE_NIGHT;
  }

  private snowAt(x: number, z: number) {
    const onPiste = (this.w.mask.get(x, z) & MASK_PISTE) !== 0;
    return snowAt(onPiste, this.weather.pisteSnow(this.state.minutes), this.weather.freshSnowCm);
  }

  private trackRun(dt: number, speed: number) {
    const s = this.state;
    s.stats.distanceM += this.ski.distance;
    s.stats.verticalM += this.ski.drop;
    this.runDrop += this.ski.drop;
    this.ski.distance = 0;
    this.ski.drop = 0;
    s.stats.topSpeed = Math.max(s.stats.topSpeed, speed);
    this.stillTime = speed < 0.8 ? this.stillTime + dt : 0;
    if (this.stillTime > 3 && this.runDrop >= 60) this.finishRun();
  }

  private arriveTop() {
    const p = this.body.position;
    const lift = this.ridingLift;
    if (lift) {
      // leave the unloading area onto the nearest run, facing the way it goes downhill
      const start = this.runStartNear(lift.top, 25);
      if (start) {
        p.set(start.x, 0, start.z);
        this.body.heading = start.heading;
      } else {
        p.set(lift.top.x + lift.topDir.x * 12, 0, lift.top.z + lift.topDir.z * 12);
        this.body.heading = Math.atan2(lift.topDir.x, lift.topDir.z);
      }
    }
    p.y = this.w.hm.heightAt(p.x, p.z);
    this.setMode('ski');
    this.ski.start(this.body, 1.5);
    this.runDrop = 0;
    this.cam.reset(p, this.body.heading);
    this.hud.toast('到達山頂站！A/D 轉彎、S 煞車，祝滑行愉快');
  }

  /**
   * A point on a run near `to` (at least `minDist` from it, clear of the station) and the
   * heading that follows the run downhill from there.
   */
  private runStartNear(to: THREE.Vector3, minDist: number) {
    const hm = this.w.hm;
    let best: { x: number; z: number; heading: number } | null = null;
    let bestD = 250;
    for (const run of this.w.resort.runs) {
      if (run.area) continue;
      for (let i = 0; i < run.points.length - 1; i++) {
        const [ax, az] = run.points[i], [bx, bz] = run.points[i + 1];
        // walk along the segment in 5 m steps
        const len = Math.hypot(bx - ax, bz - az);
        for (let d = 0; d < len; d += 5) {
          const x = ax + ((bx - ax) * d) / len, z = az + ((bz - az) * d) / len;
          const dist = Math.hypot(x - to.x, z - to.z);
          if (dist < minDist || dist >= bestD) continue;
          // direction of the segment that goes downhill
          const down = hm.heightAt(bx, bz) < hm.heightAt(ax, az) ? 1 : -1;
          bestD = dist;
          best = { x, z, heading: Math.atan2((bx - ax) * down, (bz - az) * down) };
        }
      }
    }
    return best;
  }

  private autoWeather(gameMinutes: number) {
    if (!this.weatherAuto) return;
    this.weatherTimer -= gameMinutes;
    if (this.weatherTimer > 0) return;
    this.weatherTimer = 60 + Math.random() * 90;
    // Niigata in winter: snow is common, blizzards and fog occasionally
    const roll = Math.random();
    const next: WeatherType = roll < 0.3 ? 'clear' : roll < 0.55 ? 'cloudy' : roll < 0.85 ? 'snow' : roll < 0.93 ? 'fog' : 'blizzard';
    if (next !== this.weather.type) {
      this.weather.set(next);
      this.hud.toast(`天氣變化：${WEATHER[next].label}`);
    }
  }

  private point(service: string, facility?: string) {
    return this.interaction.points.find((p) => p.service === service && (!facility || p.facility?.id === facility));
  }

  /** Where the current objective wants the player to go. */
  private guideTarget(): GuideTarget | null {
    const s = this.state;
    const at = (service: string, label: string, facility?: string): GuideTarget | null => {
      const p = this.point(service, facility);
      return p ? { position: p.position, label } : null;
    };
    if (!s.ticket) return at('ticket', '售票處');
    if (!s.rental) return at('rental', '雪具租借');
    if (!s.changed && s.stats.liftRides === 0) return at('locker', '更衣室');
    const central = this.w.lifts.find((l) => NIGHT_LIFT.test(l.data.name ?? ''));
    if (s.stats.liftRides === 0 && central && this.mode !== 'lift') return { position: central.boardingPoint, label: '中央クワッド 乘車處' };
    if (!s.dinnerDone && s.minutes >= DINNER_FROM - 30) return at('dinner', 'ホテルアルパイン 晚餐');
    if (this.mode === 'lift' && this.ridingLift) return { position: this.ridingLift.top, label: '山頂站' };
    if (!s.lunchDone && s.minutes >= 11 * 60 && s.minutes <= 15 * 60) {
      const options = this.interaction.points.filter((p) => p.service === 'restaurant');
      const near = options.sort((a, b) => a.position.distanceTo(this.body.position) - b.position.distanceTo(this.body.position))[0];
      if (near) return { position: near.position, label: `午餐：${near.facility?.name ?? '餐廳'}` };
    }
    // otherwise: the nearest lift that is loading
    const open = this.w.lifts.filter((l) => this.liftOpen(l));
    const lift = open.sort((a, b) => a.boardingPoint.distanceTo(this.body.position) - b.boardingPoint.distanceTo(this.body.position))[0];
    return lift ? { position: lift.boardingPoint, label: `纜車：${lift.data.name ?? '乘車處'}` } : null;
  }

  private updateGuidance(dt: number, elapsed: number) {
    const target = this.guideTarget();
    const p = this.body.position;
    this.routeTimer -= dt;
    if (this.routeTimer <= 0 || !target) {
      this.routeTimer = 0.3;
      this.guideRoute = target
        ? this.mode === 'walk'
          ? this.walkGraph.route(p, target.position)
          : [new THREE.Vector2(p.x, p.z), new THREE.Vector2(target.position.x, target.position.z)]
        : null;
    } else if (this.guideRoute) {
      // keep the first point glued to the player between re-routes
      this.guideRoute[0].set(p.x, p.z);
    }
    const dir = this.engine.camera.getWorldDirection(new THREE.Vector3());
    const viewYaw = Math.atan2(dir.x, dir.z);
    const viewer = this.mode === 'fly' ? this.engine.camera.position : p;
    // ground chevrons only make sense on foot
    this.guide.update(dt, elapsed, viewer, target, this.mode === 'walk' ? this.guideRoute : null, viewYaw);
    this.minimap.update(dt, viewer, this.mode === 'fly' ? viewYaw : this.body.heading, this.guide.enabled ? target?.position ?? null : null, this.guide.enabled ? this.guideRoute : null, elapsed);
  }

  private updateHud(dt: number) {
    const s = this.state;
    const p = this.body.position;
    this.hud.update(s, `${this.weather.current.label}${this.weather.freshSnowCm > 1 ? ` 新雪${this.weather.freshSnowCm.toFixed(0)}cm` : ''}`, objectives(s),
      this.mode === 'lift' ? `距離山頂站 ${this.ride.remaining.toFixed(0)} m${this.ride.fastForward ? '（快轉中）' : ''}` : '');
    if (this.mode === 'ski' || this.mode === 'lift') {
      const run = this.nearestRun(p.x, p.z);
      const tele = this.mode === 'ski' ? this.ski.telemetry : { speed: 0, slopeDeg: this.w.hm.slopeAt(p.x, p.z), travelPitchDeg: 0, skid: 0, snow: null };
      this.skiHud.update(dt, tele, {
        altitude: this.w.hm.heightAt(p.x, p.z),
        runName: run,
        snowLabel: SNOW[this.weather.pisteSnow(s.minutes)].label,
        topSpeedKmh: s.stats.topSpeed * 3.6,
        distanceM: s.stats.distanceM,
        wind: this.weather.wind.length(),
      });
    }
  }

  private nearestRun(x: number, z: number) {
    if ((this.w.mask.get(x, z) & MASK_PISTE) === 0) return '圧雪區外';
    let best = '', bestD = Infinity;
    for (const p of this.w.runPaths) {
      for (const v of p.pts) {
        const d = (v.x - x) ** 2 + (v.y - z) ** 2;
        if (d < bestD) { bestD = d; best = p.name; }
      }
    }
    return best || '雪道';
  }

  private warnings(dt: number) {
    this.warnTimer -= dt;
    if (this.warnTimer > 0) return;
    const s = this.state;
    if (s.warmth < 20) this.hud.toast('🥶 好冷…到室內喝杯熱飲暖暖身子吧');
    else if (s.stamina < 15) this.hud.toast('😮‍💨 體力快沒了，容易跌倒，休息一下吧');
    else if (s.satiety < 15) this.hud.toast('🍜 肚子餓了，去餐廳吃點東西吧');
    else return;
    this.warnTimer = 30;
  }
}
