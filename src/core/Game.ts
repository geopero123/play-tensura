import * as THREE from 'three';
import { Settings, DEBUG, IS_TOUCH } from './Settings';
import { Time } from './Time';
import { Input } from './Input';
import { GameCamera } from './Camera';
import { events } from './Events';
import { rand, clamp, damp, smoothstep } from './Math';
import { Renderer } from '../render/Renderer';
import { globalUniforms } from '../render/ToonMaterial';
import { Terrain, Colliders, LANDMARKS } from '../world/Terrain';
import { Grass, Trees, Flora } from '../world/Vegetation';
import { Water } from '../world/Water';
import { Props, Interactable } from '../world/Props';
import { Ambient } from '../world/Ambient';
import { Particles, Shape } from '../vfx/Particles';
import { Effects } from '../vfx/Effects';
import { Combat } from '../combat/Combat';
import { SkillSystem } from '../combat/Skills';
import { Progression } from '../progression/Progression';
import { ENEMIES, EnemyKind, SKILLS, SkillId, TRAITS, TraitId, STORM_QUEST, SUN_QUEST, SKILL_ORDER } from '../progression/Data';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { NPC, NPCDef } from '../entities/NPC';
import { HUD, HudState } from '../ui/HUD';
import { Minimap, MinimapBlip } from '../ui/Minimap';
import { Menus } from '../ui/Menus';
import { Notifications } from '../ui/Notifications';
import { Dialogue, DialogueLine } from '../ui/Dialogue';
import { TouchControls } from '../ui/TouchControls';
import { audio, sfx } from '../audio/Audio';

type GameState = 'loading' | 'title' | 'playing' | 'paused' | 'dead' | 'cinematic';

interface SpawnDef { kind: EnemyKind; pos: THREE.Vector3; level?: number; respawn?: boolean; tag?: string }
interface Spawn extends SpawnDef { enemy: Enemy | null; timer: number; killed: boolean }
interface Essence { mesh: THREE.Group; pos: THREE.Vector3; kind: EnemyKind; t: number }

const ZONES: { name: string; sub: string; short: string; pos: THREE.Vector3; r: number }[] = [
  { name: 'Awakening Glade', sub: 'GREAT JURA FOREST', short: 'Glade', pos: LANDMARKS.glade, r: 34 },
  { name: 'Hollow Pine Village', sub: 'A QUIET SETTLEMENT', short: 'Village', pos: LANDMARKS.village, r: 36 },
  { name: 'Training Field', sub: 'PRACTICE YOUR COMBOS', short: 'Training', pos: LANDMARKS.training, r: 22 },
  { name: 'Ancient Ruins', sub: 'REMNANTS OF A FORGOTTEN AGE', short: 'Ruins', pos: LANDMARKS.ruins, r: 26 },
  { name: 'Whisper Cave', sub: 'RESONATING CRYSTALS', short: 'Cave', pos: new THREE.Vector3(LANDMARKS.cave.x, 0, LANDMARKS.cave.z - 12), r: 16 },
  { name: 'Sky Falls', sub: 'WHERE THE RIVER LEAPS', short: 'Falls', pos: new THREE.Vector3(LANDMARKS.waterfall.x, 0, LANDMARKS.waterfall.z + 10), r: 18 },
  { name: 'The Moonwell', sub: 'HIDDEN SANCTUARY', short: 'Moonwell', pos: LANDMARKS.hidden, r: 10 },
  { name: 'Wolf Territory', sub: 'STORM-TOUCHED WOODS', short: 'Wolves', pos: LANDMARKS.wolfWoods, r: 34 },
  { name: 'Storm Crater', sub: 'THE EYE OF THE STORM', short: 'Crater', pos: LANDMARKS.arena, r: 36 },
];

export class Game {
  settings = new Settings();
  time = new Time();
  input: Input;
  touch: TouchControls | null = null;
  renderer: Renderer;
  gcam: GameCamera;
  terrain!: Terrain;
  colliders = new Colliders();
  grass!: Grass;
  trees!: Trees;
  flora!: Flora;
  water!: Water;
  props!: Props;
  ambient!: Ambient;
  particles!: Particles;
  fx!: Effects;
  combat!: Combat;
  prog!: Progression;
  skills!: SkillSystem;
  player!: Player;
  hud: HUD;
  menus: Menus;
  notes: Notifications;
  dialogue: Dialogue;
  state: GameState = 'loading';
  spawns: Spawn[] = [];
  enemies: Enemy[] = [];
  npcs: NPC[] = [];
  essences: Essence[] = [];
  interactables: Interactable[] = [];
  private nearInteract: Interactable | NPC | null = null;
  private questStep = -1; // -1 not started
  private questProgress = 0;
  private questDone = false;
  private zoneCurrent = '';
  private zoneVisited = new Set<string>();
  private boss: Enemy | null = null;
  private bossDefeated = false;
  private bossStorm = 0;
  private stormLevel = 0;
  private tipsShown = new Set<string>();
  private tip: { key?: string; text: string } | null = null;
  private tipT = 0;
  private checkpoint = new THREE.Vector3(0, 0, 4);
  private cineT = 0;
  private cineFn: ((t: number, dt: number) => boolean) | null = null;
  private victoryT = -1;
  private musicCombatT = 0;
  private playT = 0;
  private lastSpawnCheck = 0;
  private shardTaken = false;
  private relicRead = false;
  private moonUsed = false;
  private caveUsed = false;
  private springUsed = false;
  private mira!: NPC;
  private elder!: NPC;
  minimap: Minimap;
  /** second questline: -1 locked, 0..5 steps, done when sunDone */
  private sunQuestStep = -1;
  private sunProgress = 0;
  private sunDone = false;
  private trialWave = 0;
  private trialEnemies: Enemy[] = [];
  private trialActive = false;
  private sunLevel = 0;
  private nightLevel = 0;
  private introShown = false;
  private tmp = new THREE.Vector3();
  private uiRoot: HTMLElement;
  private fpsAcc = 0; private fpsN = 0; fps = 60;
  /** debug profiler: accumulated ms per section (reset by reading) */
  profile: Record<string, number> = {};
  private profOn = DEBUG;
  private profT = 0;
  private prof(label: string) { if (!this.profOn) return; const now = performance.now(); this.profile[label] = (this.profile[label] || 0) + (now - this.profT); this.profT = now; }
  private titleFocus = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas, this.settings.preset);
    this.gcam = new GameCamera(this.renderer.camera);
    this.hud = new HUD(uiRoot);
    this.hud.camera = this.renderer.camera;
    this.minimap = new Minimap(this.hud.hud);
    this.notes = new Notifications(uiRoot);
    this.dialogue = new Dialogue(uiRoot);
    this.menus = new Menus(uiRoot, this.settings);
    this.menus.onPlay = () => this.startGame();
    this.menus.onResume = () => this.resume();
    this.menus.onQuit = () => this.toTitle();
    this.menus.onRetry = () => this.respawn();
    this.menus.getProgression = () => this.prog ?? null;
    this.settings.onChange((s, key) => this.applySettings(key));
    if (IS_TOUCH) this.touch = new TouchControls(this.input, uiRoot, canvas);
    canvas.addEventListener('click', () => {
      if (!audio.ready) audio.init();
      audio.resume();
      if (this.state === 'playing' || this.state === 'cinematic') this.input.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && !this.input.allowUnlocked && this.state === 'playing' && this.menus.screen === 'none' && !this.dialogue.active) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.menus.back()) return;
        if (this.state === 'playing') this.pause();
      }
      if (e.code === 'KeyK' && this.state === 'playing' && this.menus.screen === 'none') { this.pause(); this.menus.openSkills(); }
      if (e.code === 'KeyM' && this.state === 'playing') { this.minimap.cycleZoom(); sfx('ui', 0.5); }
      if (this.state === 'title' && (e.code === 'Enter' || e.code === 'Space') && this.menus.screen === 'title') { if (!audio.ready) audio.init(); this.menus.show('none'); this.startGame(); }
    });
  }

  // ------------------------------------------------------------ setup
  async init() {
    const m = this.menus;
    m.setLoading(0.05, 'SHAPING THE LAND');
    await this.next();
    this.terrain = new Terrain();
    this.renderer.scene.add(this.terrain.mesh);
    this.gcam.setWorld(this.terrain, this.colliders);
    this.minimap.build(this.terrain);
    m.setLoading(0.25, 'RAISING THE VILLAGE');
    await this.next();
    this.props = new Props(this.terrain, this.colliders);
    this.renderer.scene.add(this.props.group);
    this.interactables = this.props.interactables;
    m.setLoading(0.45, 'GROWING THE FOREST');
    await this.next();
    this.trees = new Trees(this.terrain, this.colliders, this.settings.preset.treeDetail);
    this.renderer.scene.add(this.trees.group);
    m.setLoading(0.6, 'PAINTING THE GRASS');
    await this.next();
    this.grass = new Grass(this.terrain, this.settings.preset.grassCount, this.renderer.fog, this.colliders);
    this.renderer.scene.add(this.grass.mesh);
    this.flora = new Flora(this.terrain, this.colliders, this.settings.preset.treeDetail);
    this.renderer.scene.add(this.flora.group);
    m.setLoading(0.75, 'FILLING THE RIVER');
    await this.next();
    this.water = new Water(this.terrain, this.renderer.fog);
    this.renderer.scene.add(this.water.group);
    this.ambient = new Ambient(this.terrain);
    this.ambient.campfires = this.props.campfires;
    this.ambient.chimneys = this.props.chimneys;
    this.renderer.scene.add(this.ambient.group);
    this.particles = new Particles(this.settings.preset.particleCap);
    this.renderer.scene.add(this.particles.group);
    this.fx = new Effects(this.renderer.scene, this.particles);
    this.fx.heightAt = (x, z) => this.terrain.heightAt(x, z);
    m.setLoading(0.88, 'AWAKENING THE SLIME');
    await this.next();
    this.combat = new Combat(this.time, this.fx, this.renderer.camera);
    this.prog = new Progression();
    this.skills = new SkillSystem(this.renderer.scene, this.fx, this.particles, this.combat, this.prog, this.time, this.renderer.post, this.gcam, this.terrain);
    this.skills.onDevour = (c) => this.onDevour(c as Enemy);
    this.skills.onTechnique = (name, sub, color) => this.notes.technique(name, sub, color);
    this.skills.onBars = (on) => this.notes.cinematicBars(on);
    this.player = new Player(this.input, this.time, this.gcam, this.terrain, this.colliders, this.combat, this.skills, this.prog, this.fx, this.particles, this.renderer.post);
    this.renderer.scene.add(this.player.root);
    this.player.onDeath = () => this.onPlayerDeath();
    this.player.onPerfectDodge = () => this.notes.say('PERFECT DODGE');
    this.setupNPCs();
    this.setupSpawns();
    this.bindEvents();
    this.applySettings('quality', true);
    m.setLoading(1, 'READY');
    this.titleFocus.set(LANDMARKS.village.x, this.terrain.heightAt(LANDMARKS.village.x, LANDMARKS.village.z), LANDMARKS.village.z);
    this.player.spawn(new THREE.Vector3(LANDMARKS.village.x + 3, 0, LANDMARKS.village.z + 6));
    this.state = 'title';
    this.gcam.mode = 'title';
    this.menus.show('title');
    this.menus.showClickHint(false);
    this.renderer.setStorm(0);
    this.loop(performance.now());
  }

  private next() { return new Promise((r) => setTimeout(r, 30)); }

  /** game-time scheduler (pauses with the game, unaffected by hit-stop) */
  private timers: { t: number; fn: () => void }[] = [];
  after(seconds: number, fn: () => void) { this.timers.push({ t: seconds, fn }); }
  private tickTimers(dt: number) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
  }

  private applySettings(key: keyof Settings['data'], silent = false) {
    const d = this.settings.data;
    if (key === 'quality') {
      const p = this.settings.preset;
      this.renderer.applyPreset(p);
      if (this.grass && this.grass.count !== p.grassCount) {
        this.renderer.scene.remove(this.grass.mesh);
        this.grass = new Grass(this.terrain, p.grassCount, this.renderer.fog, this.colliders);
        this.renderer.scene.add(this.grass.mesh);
      }
      if (this.particles) this.particles.setCap(p.particleCap);
    }
    audio.setVolumes(d.masterVolume, d.musicVolume, d.sfxVolume);
    this.gcam.sensitivity = d.mouseSensitivity;
    this.gcam.shakeScale = d.cameraShake;
    this.gcam.invertY = d.invertY;
    this.hud.showDamage = d.showDamage;
    void silent;
  }

  private bindEvents() {
    events.on('levelUp', (lv: number) => {
      this.notes.levelUp(lv);
      this.fx.pillar(this.player.pos, 0xffe3a3, 1.2, 12, 0.8);
      this.fx.shockwave(this.player.pos, 0xffe3a3, 6, 0.7);
      this.fx.healSparkles(this.player.pos, 0xffe3a3, 30);
      this.player.model.setMood('happy', 2);
    });
    events.on('skillEvolved', ({ from, to, desc }: any) => {
      this.notes.evolution('SKILL EVOLUTION', from, to, desc);
      this.evolveFx(0xc39bff);
    });
    events.on('traitEvolved', ({ from, to }: { from: TraitId; to: TraitId }) => {
      this.notes.evolution('TRAIT EVOLUTION', TRAITS[from].name, TRAITS[to].name, TRAITS[to].desc);
      this.evolveFx(0x9fffb0);
    });
    events.on('traitFused', ({ from, to }: { from: TraitId[]; to: TraitId }) => {
      this.notes.evolution('SKILL FUSION', from.map((f) => TRAITS[f].name).join(' + '), TRAITS[to].name, TRAITS[to].desc);
      this.evolveFx(0xffe3a3);
    });
    events.on('traitStacked', ({ id, stacks, needed }: any) => {
      this.hud.floatingText(`${TRAITS[id as TraitId].name} ${stacks}/${needed}`, this.player.pos.clone().setY(this.player.pos.y + 1.6));
    });
    events.on('skillUsed', (id: SkillId) => this.hud.flashSkill(id));
  }

  private evolveFx(color: number) {
    this.time.slowmo(1.2, 0.3);
    this.fx.pillar(this.player.pos, color, 2, 30, 1.6);
    this.fx.shockwave(this.player.pos, color, 12, 1.2);
    this.fx.shockwave(this.player.pos, 0xffffff, 8, 0.8, { y: 0.3 });
    this.particles.emit({ pos: this.player.pos.clone().setY(this.player.pos.y + 0.5), count: 80, velSpread: 6, velUp: 8, life: 1.8, size: 0.2, color: [color, 0xffffff], shape: Shape.STAR, gravity: 2, drag: 1 });
    this.renderer.post.flash(0.5, color);
    this.player.model.setMood('surprised', 1.5);
  }

  // ------------------------------------------------------------ NPCs & quest
  private setupNPCs() {
    const v = LANDMARKS.village;
    const g = this;
    const defs: NPCDef[] = [
      {
        id: 'mira', name: 'Mira', preset: 0, pos: new THREE.Vector3(v.x + 4, 0, v.z - 4),
        lines: () => g.miraLines(),
        onTalkEnd: () => g.onMiraTalked(),
      },
      {
        id: 'elder', name: 'Elder Torren', preset: 1, pos: new THREE.Vector3(v.x - 10, 0, v.z + 8),
        lines: () => g.elderLines(),
        onTalkEnd: () => g.onElderTalked(),
      },
      {
        id: 'child', name: 'Pip', preset: 2, pos: new THREE.Vector3(v.x - 4, 0, v.z - 12), waypoints: [new THREE.Vector3(v.x - 4, 0, v.z - 12), new THREE.Vector3(v.x + 8, 0, v.z - 14), new THREE.Vector3(v.x + 10, 0, v.z + 2), new THREE.Vector3(v.x - 2, 0, v.z + 4)],
        lines: () => g.bossDefeated
          ? [{ speaker: 'Pip', text: 'You beat the giant wolf?! When I grow up I want to be a slime too!' }, { speaker: 'Pip', text: 'Elder Torren keeps muttering about "the second line". Grown-ups are weird.' }]
          : [{ speaker: 'Pip', text: 'Whoa! A blue slime! Can you really shoot water? Do it, do it!' }, { speaker: 'Pip', text: 'The training field is past the fence. Nobody minds if you hit the dummies.' }],
      },
      {
        id: 'villagerA', name: 'Bram', preset: 3, pos: new THREE.Vector3(v.x - 8, 0, v.z - 6), waypoints: [new THREE.Vector3(v.x - 8, 0, v.z - 6), new THREE.Vector3(v.x - 18, 0, v.z + 2), new THREE.Vector3(v.x - 6, 0, v.z + 14)],
        lines: () => g.sunQuestStep >= 0 && !g.sunDone
          ? [{ speaker: 'Bram', text: 'The relic in the ruins? My grandfather said it only shows its second face to someone who has swallowed a storm.' }, { speaker: 'Bram', text: 'The Warlord still prowls there if you never dealt with him. Mind yourself.' }]
          : [{ speaker: 'Bram', text: 'Goblins have been creeping closer to the ruins east of the glade. Be careful out there.' }, { speaker: 'Bram', text: 'They say a Goblin Warlord guards an old relic in the ruins. Nobody comes back with it.' }],
      },
      {
        id: 'villagerB', name: 'Sela', preset: 4, pos: new THREE.Vector3(v.x + 14, 0, v.z + 2), waypoints: [new THREE.Vector3(v.x + 14, 0, v.z + 2), new THREE.Vector3(v.x + 6, 0, v.z + 12), new THREE.Vector3(v.x + 18, 0, v.z - 8)],
        lines: () => g.sunQuestStep >= 2 && !g.sunDone
          ? [{ speaker: 'Sela', text: 'Wisps are just light that forgot how to leave. Devour enough of them and you might remember for them.' }, { speaker: 'Sela', text: 'They gather thickest in Whisper Cave and around the ruins.' }]
          : [{ speaker: 'Sela', text: 'Hellfire wisps float around the ruins at dusk. Their flames are unnaturally dark.' }, { speaker: 'Sela', text: 'If you can... absorb them or whatever slimes do, maybe you could use that fire yourself.' }],
      },
    ];
    for (const d of defs) {
      const n = new NPC(d, this.terrain, this.colliders);
      this.renderer.scene.add(n.root);
      this.npcs.push(n);
      if (d.id === 'mira') this.mira = n;
      if (d.id === 'elder') this.elder = n;
    }
    this.mira.setQuestMarker(true);
  }

  private miraLines(): DialogueLine[] {
    const s = this.questStep;
    if (s < 0) return [
      { speaker: 'Mira', text: 'A slime that walks into a village on its own... You are not an ordinary monster, are you?' },
      { speaker: 'Mira', text: 'The wolves have been acting strangely since the storm appeared over the northern plateau.' },
      { speaker: 'Mira', text: 'Two hunters went to Wolf Territory. Neither returned. I cannot leave the village unguarded.' },
      { speaker: 'Mira', text: 'Go north-east, past the ruins, up the ramp. Find out what is happening. Please.' },
    ];
    if (this.questDone) return this.sunDone
      ? [{ speaker: 'Mira', text: 'The whole village saw the light over the crater. Rimura... what are you becoming?' }, { speaker: 'Mira', text: 'Whatever it is, come home for dinner sometimes.' }]
      : [{ speaker: 'Mira', text: 'You saved us all, little slime. Or... maybe not so little anymore.' }, { speaker: 'Mira', text: 'Elder Torren wants to see you. He has been staring at that old rubbing of the relic all night.' }];
    if (s === 4 && this.bossDefeated) return [
      { speaker: 'Mira', text: 'The storm is gone! The wolves have calmed down... it was you, wasn\'t it?' },
      { speaker: 'Mira', text: 'From now on, you will always have a home in Hollow Pine. Thank you, Rimura.' },
    ];
    if (s >= 4) return [{ speaker: 'Mira', text: 'The heart of the storm is in the crater. Be careful. That howling is no ordinary wolf.' }];
    if (s >= 2) return [{ speaker: 'Mira', text: 'Corrupted wolves... so it is true. Find what is corrupting them. It must be at the center of the storm.' }];
    return [{ speaker: 'Mira', text: 'Wolf Territory is north-east, up on the plateau past the ruins. Follow the path.' }];
  }

  private onMiraTalked() {
    if (this.questStep < 0) { this.questStep = 1; this.mira.setQuestMarker(false); this.notes.areaTitle('QUEST ACCEPTED', 'STORM IN THE FOREST'); sfx('system'); }
    else if (this.questStep === 4 && this.bossDefeated) {
      this.questStep = 5; this.questDone = true; this.prog.addXp(400);
      this.notes.acquired('QUEST COMPLETE', 'Storm in the Forest', 'The forest is safe. +400 XP', 'quest');
      // unlock the second questline
      this.sunQuestStep = 0;
      this.elder.setQuestMarker(true);
      this.after(4, () => this.showTip('elder', 'Elder Torren has something for you. Find him in the village.', 'F'));
    }
  }

  // ------------------------------------------------------------ quest 2: The Lens of the Sun
  private elderLines(): DialogueLine[] {
    const E = 'Elder Torren';
    if (this.questStep < 0) return [{ speaker: E, text: 'A talking slime? Ha! The forest never stops surprising me.' }, { speaker: E, text: 'Mira by the well has been worried sick about the wolves. Speak with her, little one.' }];
    if (!this.bossDefeated) return [{ speaker: E, text: 'Storms like this are not natural. Something ancient stirs in the north-east.' }, { speaker: E, text: 'If you go, drink from the Moonwell above Sky Falls first. It strengthens magic.' }];
    const s = this.sunQuestStep;
    if (s === 0) return [
      { speaker: E, text: 'The sky is clear again. Whatever you are, you have our gratitude.' },
      { speaker: E, text: 'But listen. The relic in the ruins carries two inscriptions. Only the first can be read by ordinary eyes.' },
      { speaker: E, text: '"When the star falls, the guardian howls." You have lived that line. The second one is older, and it speaks of the sun.' },
      { speaker: E, text: 'Go back to the relic. If the storm truly answers to you now, it will show you the rest.' },
    ];
    if (s === 1) return [{ speaker: E, text: 'The relic is in the Ancient Ruins, east of the glade. Touch it as you did before.' }];
    if (s === 2) return [{ speaker: E, text: 'Captured light... the wisps. Their fire is sunlight that went wrong. Devour enough of them and you may understand it.' }];
    if (s === 3) return [{ speaker: E, text: 'The Moonwell above Sky Falls. Water that remembers the sky. Offer the light there.' }];
    if (s === 4) return [{ speaker: E, text: 'The crater still hums with the star\'s memory. The relic said the trial waits there. Do not go unprepared.' }];
    if (s === 5) return [
      { speaker: E, text: 'We saw it from the village. A pillar of daylight in the middle of the afternoon.' },
      { speaker: E, text: 'The old texts called it Megiddo: the sky\'s judgment, borrowed by the one who devoured the storm.' },
      { speaker: E, text: 'Keep it close, Rimura. And keep coming back to us. Heroes who forget their village stop being heroes.' },
    ];
    return [{ speaker: E, text: 'The forest is quiet. Too quiet, some would say, but I have earned a little quiet.' }];
  }

  private onElderTalked() {
    if (this.sunQuestStep === 0) {
      this.sunQuestStep = 1; this.elder.setQuestMarker(false);
      this.notes.areaTitle('QUEST ACCEPTED', 'THE LENS OF THE SUN'); sfx('system');
    } else if (this.sunQuestStep === 5) {
      this.sunQuestStep = 6; this.sunDone = true; this.elder.setQuestMarker(false);
      this.prog.addXp(700);
      this.notes.acquired('QUEST COMPLETE', 'The Lens of the Sun', 'The village sleeps under a calm sky. +700 XP', 'quest');
      this.after(3.6, () => this.notes.analyzing(() => {
        const r = this.prog.acquireTrait('solarCore');
        if (r) { this.notes.acquired('TRAIT ACQUIRED', TRAITS.solarCore.name, TRAITS.solarCore.desc, 'sun'); this.acquireFx(); }
      }, 1200));
    }
  }

  private advanceSunQuest(to: number) { if (this.sunQuestStep < to && this.sunQuestStep >= 0) { this.sunQuestStep = to; this.sunProgress = 0; sfx('system'); if (to === 5) this.elder.setQuestMarker(true); } }

  /** Sun Trial: three waves in the crater, then the questline advances */
  private startTrial() {
    if (this.trialActive) return;
    this.trialActive = true;
    this.trialWave = 0;
    this.notes.areaTitle('THE SUN TRIAL', 'SURVIVE THREE WAVES');
    sfx('phase');
    this.bossStorm = 0.3;
    this.after(2.2, () => this.spawnTrialWave());
  }

  private spawnTrialWave() {
    const a = LANDMARKS.arena;
    const waves: { kind: EnemyKind; level: number }[][] = [
      [{ kind: 'goblin', level: 3 }, { kind: 'goblin', level: 3 }, { kind: 'wolf', level: 3 }, { kind: 'wolf', level: 3 }, { kind: 'slime', level: 4 }],
      [{ kind: 'wisp', level: 3 }, { kind: 'wisp', level: 3 }, { kind: 'stormWolf', level: 3 }, { kind: 'stormWolf', level: 3 }, { kind: 'goblin', level: 4 }],
      [{ kind: 'warlord', level: 2 }, { kind: 'wolf', level: 4 }, { kind: 'wolf', level: 4 }, { kind: 'wisp', level: 4 }],
    ];
    const wave = waves[this.trialWave];
    if (!wave) return;
    this.notes.say(`WAVE ${this.trialWave + 1}`);
    sfx('system');
    wave.forEach((w, i) => {
      const ang = (i / wave.length) * Math.PI * 2 + this.trialWave;
      const p = new THREE.Vector3(a.x + Math.cos(ang) * 16, 0, a.z + Math.sin(ang) * 16);
      this.after(0.25 * i, () => {
        p.y = this.terrain.heightAt(p.x, p.z);
        this.fx.pillar(p, 0xffe3a3, 0.8, 14, 0.7);
        this.fx.shockwave(p, 0xfff0c0, 4, 0.5);
        sfx('crystal', 0.5);
        const e = new Enemy(w.kind, p, this.enemyWorld(), { level: w.level });
        e.onDeath = (en, devoured) => { this.onEnemyDeath(en, devoured, null); this.checkTrial(); };
        e.state = 'chase';
        this.enemies.push(e);
        this.trialEnemies.push(e);
      });
    });
    this.trialWave++;
  }

  private checkTrial() {
    if (!this.trialActive) return;
    this.trialEnemies = this.trialEnemies.filter((e) => e.alive);
    if (this.trialEnemies.length) return;
    if (this.trialWave < 3) { this.after(2.5, () => this.spawnTrialWave()); return; }
    // all three waves cleared
    this.trialActive = false;
    this.bossStorm = 0;
    this.advanceSunQuest(5);
    this.time.slowmo(1.0, 0.4);
    this.renderer.post.flash(0.6, 0xfff4d0);
    this.fx.pillar(this.player.pos, 0xfff0c0, 2.5, 40, 1.6);
    this.fx.shockwave(this.player.pos, 0xfff0c0, 20, 1.2);
    this.notes.areaTitle('TRIAL COMPLETE', 'RETURN TO ELDER TORREN');
    this.player.model.setMood('happy', 3);
  }

  private advanceQuest(to: number) { if (this.questStep < to && this.questStep >= 0) { this.questStep = to; this.questProgress = 0; sfx('system'); } }

  // ------------------------------------------------------------ enemies
  private setupSpawns() {
    const V = (x: number, z: number) => new THREE.Vector3(x, 0, z);
    const R = LANDMARKS.ruins, W = LANDMARKS.wolfWoods, C = LANDMARKS.cave, T = LANDMARKS.training;
    const list: SpawnDef[] = [
      // glade: first weak creatures
      { kind: 'slime', pos: V(12, -6), respawn: true }, { kind: 'slime', pos: V(-14, 8), respawn: true }, { kind: 'slime', pos: V(6, 18), respawn: true },
      // path to village
      { kind: 'goblin', pos: V(-40, 30), respawn: true }, { kind: 'slime', pos: V(-58, 44), respawn: true }, { kind: 'goblin', pos: V(-66, 52), respawn: true },
      // forests
      { kind: 'goblin', pos: V(50, 45), respawn: true }, { kind: 'goblin', pos: V(60, 60), respawn: true }, { kind: 'wisp', pos: V(70, 40), respawn: true },
      { kind: 'wolf', pos: V(-40, -60), respawn: true }, { kind: 'wolf', pos: V(-52, -70), respawn: true }, { kind: 'slime', pos: V(-30, -45), respawn: true },
      { kind: 'wolf', pos: V(60, -75), respawn: true }, { kind: 'slime', pos: V(30, -50), respawn: true }, { kind: 'goblin', pos: V(-100, 10), respawn: true }, { kind: 'wisp', pos: V(-120, -30), respawn: true },
      // ruins: goblins, wisps, warlord
      { kind: 'goblin', pos: V(R.x - 18, R.z + 14), respawn: true, level: 2 }, { kind: 'goblin', pos: V(R.x + 16, R.z + 10), respawn: true, level: 2 }, { kind: 'wisp', pos: V(R.x + 6, R.z - 18), respawn: true }, { kind: 'wisp', pos: V(R.x - 14, R.z - 12), respawn: true },
      { kind: 'warlord', pos: V(R.x, R.z + 6), respawn: false, tag: 'warlord' },
      // training dummies
      { kind: 'dummy', pos: V(T.x - 4, T.z - 2) }, { kind: 'dummy', pos: V(T.x + 2, T.z + 4) }, { kind: 'dummy', pos: V(T.x + 6, T.z - 4) },
      // wolf territory: quest wolves
      { kind: 'stormWolf', pos: V(W.x - 8, W.z + 6), respawn: false, tag: 'storm', level: 2 }, { kind: 'stormWolf', pos: V(W.x + 12, W.z - 4), respawn: false, tag: 'storm', level: 2 }, { kind: 'stormWolf', pos: V(W.x + 2, W.z - 16), respawn: false, tag: 'storm', level: 2 },
      { kind: 'wolf', pos: V(W.x - 16, W.z - 10), respawn: true, level: 2 }, { kind: 'wolf', pos: V(W.x + 18, W.z + 10), respawn: true, level: 2 },
      // cave
      { kind: 'wisp', pos: V(C.x, C.z - 20), respawn: true, level: 2 }, { kind: 'slime', pos: V(C.x + 2, C.z - 32), respawn: true, level: 2 }, { kind: 'wisp', pos: V(LANDMARKS.caveEnd.x - 4, LANDMARKS.caveEnd.z + 4), respawn: true, level: 2 },
      // plateau near waterfall
      { kind: 'wolf', pos: V(30, -130), respawn: true, level: 2 }, { kind: 'goblin', pos: V(70, -125), respawn: true, level: 2 },
    ];
    for (const d of list) this.spawns.push({ ...d, enemy: null, timer: 0, killed: false });
  }

  private enemyWorld() {
    return {
      scene: this.renderer.scene, terrain: this.terrain, colliders: this.colliders, combat: this.combat, fx: this.fx, particles: this.particles, time: this.time,
      camera: this.renderer.camera, gcam: this.gcam, post: this.renderer.post, player: this.player,
      onBossEvent: (ev: any, e: Enemy) => this.onBossEvent(ev, e),
    };
  }

  private spawnEnemy(s: Spawn) {
    const e = new Enemy(s.kind, s.pos, this.enemyWorld(), { level: s.level });
    e.onDeath = (en, devoured) => this.onEnemyDeath(en, devoured, s);
    s.enemy = e;
    this.enemies.push(e);
    return e;
  }

  private onEnemyDeath(e: Enemy, devoured: boolean, s: Spawn | null) {
    if (e.kind === 'dummy') return;
    this.prog.kills++;
    this.prog.addXp(Math.round(e.def.xp * (1 + (e.maxHp / e.def.hp - 1) * 0.5)));
    this.hud.floatingText(`+${e.def.xp} XP`, e.pos.clone().setY(e.pos.y + e.height + 0.5), 'text');
    if (s) { s.killed = true; s.timer = 60; }
    if (e.kind === 'stormWolf' && this.questStep === 2) { this.questProgress++; if (this.questProgress >= 3) this.advanceQuest(3); }
    if (e.kind === 'warlord' && !devoured) this.spawnEssence(e.pos, e.kind);
    else if (!devoured && e.def.grants.length && Math.random() < (e.kind === 'stormWolf' ? 0.8 : 0.45)) this.spawnEssence(e.pos, e.kind);
    if (this.player.target === e) { this.player.target = null; this.gcam.lockTarget = null; }
  }

  private onDevour(e: Enemy) {
    if (!e.def) return;
    this.prog.recordAbsorb(e.kind);
    this.player.model.setMood('happy', 1.5);
    if (e.kind === 'wisp' && this.sunQuestStep === 2) { this.sunProgress++; if (this.sunProgress >= 3) { this.advanceSunQuest(3); this.showTip('lens', 'The captured light hums inside you. Carry it to the Moonwell above Sky Falls.'); } }
    this.notes.analyzing(() => this.applyGrants(e.kind), 1400);
    if (e.kind === 'boss') { this.bossDefeated = true; this.onBossEvent('dead', e); }
  }

  private applyGrants(kind: EnemyKind) {
    const def = ENEMIES[kind];
    for (const g of def.grants) {
      if (g.skill) {
        if (this.prog.acquireSkill(g.skill)) {
          const sd = SKILLS[g.skill];
          this.notes.acquired(sd.ultimate ? 'ULTIMATE ACQUIRED' : 'ABILITY ACQUIRED', sd.name, `${sd.desc}  [${sd.key}]`, sd.icon);
          this.acquireFx();
          this.showTip('skill-' + g.skill, `Press ${sd.key} to use ${sd.name}`, sd.key);
        } else {
          this.prog.addSkillXp(g.skill, 2);
          this.hud.floatingText(`${SKILLS[g.skill].name} +2`, this.player.pos.clone().setY(this.player.pos.y + 1.6));
        }
      }
      if (g.trait) {
        const r = this.prog.acquireTrait(g.trait);
        if (r && !r.evolved) { const td = TRAITS[r.result]; this.notes.acquired('TRAIT ACQUIRED', td.name, td.desc, td.icon); this.acquireFx(); }
      }
    }
  }

  private acquireFx() {
    this.fx.pillar(this.player.pos, 0x9fe8ff, 0.8, 16, 1.0);
    this.fx.shockwave(this.player.pos, 0xffe3a3, 5, 0.8);
    this.particles.emit({ pos: this.player.pos.clone().setY(this.player.pos.y + 0.5), count: 50, velSpread: 4, velUp: 7, life: 1.5, size: 0.18, color: [0x9fe8ff, 0xffe3a3, 0xffffff], shape: Shape.STAR, gravity: 3, drag: 1 });
    this.renderer.post.flash(0.35, 0xbfe8ff);
  }

  private spawnEssence(pos: THREE.Vector3, kind: EnemyKind) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xc39bff, toneMapped: false }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0x9a40ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(core, glow);
    g.position.copy(pos).setY(this.terrain.heightAt(pos.x, pos.z) + 0.8);
    this.renderer.scene.add(g);
    this.essences.push({ mesh: g, pos: g.position.clone(), kind, t: 0 });
  }

  // ------------------------------------------------------------ boss
  private startBossFight() {
    if (this.boss || this.bossDefeated) return;
    const a = LANDMARKS.arena;
    const spawnPos = new THREE.Vector3(a.x - 8, 0, a.z - 12);
    const boss = new Enemy('boss', spawnPos, this.enemyWorld());
    boss.onDeath = (e, devoured) => { this.onEnemyDeath(e, devoured, null); if (!devoured) { this.bossDefeated = true; this.spawnEssence(e.pos, 'boss'); } };
    this.enemies.push(boss);
    this.boss = boss;
    boss.state = 'idle';
    boss.frozen = true;
    // cinematic intro: the wolf leaps in from the rim
    boss.root.visible = false;
    this.player.target = null; this.gcam.lockTarget = null;
    audio.setMusic('boss');
    audio.duckMusic(0.4, 0.2);
    const cam = this.renderer.camera;
    const look = spawnPos.clone().setY(this.terrain.heightAt(spawnPos.x, spawnPos.z) + 2);
    const camPos = look.clone().add(new THREE.Vector3(10, 4, 14));
    this.gcam.cinematic(camPos, look, 48, true);
    this.notes.cinematicBars(true);
    let landed = false;
    this.startCinematic(5.2, (t, dt) => {
      const groundY = this.terrain.heightAt(spawnPos.x, spawnPos.z);
      if (t > 0.6 && !landed) {
        // falling in
        const k = clamp((t - 0.6) / 0.7, 0, 1);
        boss.root.visible = true;
        boss.pos.set(spawnPos.x, groundY + 30 * (1 - k * k), spawnPos.z);
        boss.root.position.copy(boss.pos);
        boss.yaw = Math.atan2(camPos.x - spawnPos.x, camPos.z - spawnPos.z) + 0.6;
        if (k >= 1) {
          landed = true;
          boss.grounded = true;
          this.fx.landDust(boss.pos, 4); this.fx.shockwave(boss.pos, 0xbfe8ff, 16, 0.8); this.fx.shockwave(boss.pos, 0xffffff, 10, 0.5, { y: 0.3 });
          this.gcam.addTrauma(0.8); sfx('slam', 1.5); this.renderer.post.flash(0.3, 0xdff0ff);
          this.particles.emit({ pos: boss.pos.clone().setY(boss.pos.y + 1), count: 60, velSpread: 12, velUp: 6, life: 1, size: 0.25, color: [0xbfe8ff, 0xffffff], shape: Shape.SPARK, stretch: 1.2, gravity: 10 });
        }
      }
      if (t > 1.8 && t < 1.85) { sfx('howl', 1.3); this.notes.boss('ANCIENT GUARDIAN OF THE STORM', 'ANCIENT TEMPEST WOLF', 'CORRUPTED BY THE FALLEN STAR'); boss.rig.animate('howl', this.time.elapsed, dt, 0, 0); }
      if (t > 1.8 && t < 4.4) { boss.rig.animate('howl', this.time.elapsed, dt, 0, t - 1.8); this.bossStorm = Math.min(0.45, this.bossStorm + dt * 0.3); if (Math.random() < 0.4) this.particles.emit({ pos: boss.pos.clone().setY(boss.pos.y + 3), count: 3, spread: 3, velSpread: 6, life: 0.8, size: 0.2, color: [0xbfe8ff, 0xa080ff], shape: Shape.SPARK, stretch: 1 }); }
      if (t > 2.0) { const orbit = t * 0.25; const cp = look.clone().add(new THREE.Vector3(Math.cos(orbit) * 12, 3.5 + (t - 2) * 0.6, Math.sin(orbit) * 12)); this.gcam.cinematic(cp, look.clone().setY(look.y + 1.5), 44); }
      return t < 5.2;
    }, () => {
      boss.frozen = false;
      boss.state = 'chase';
      this.notes.cinematicBars(false);
      audio.duckMusic(1, 0.6);
      this.advanceQuest(4);
      this.showTip('boss', 'Watch the red rings. Dodge through attacks with SHIFT for a Perfect Dodge.', 'SHIFT');
    });
  }

  private onBossEvent(ev: 'phase2' | 'phase3' | 'howl' | 'ultimate' | 'dead', boss: Enemy) {
    if (ev === 'phase2') {
      this.bossStorm = 0.75;
      audio.setAmbience(1, 0, 0.7);
      const look = boss.pos.clone().setY(boss.pos.y + 3);
      const cp = look.clone().add(this.player.pos.clone().sub(boss.pos).setY(0).normalize().multiplyScalar(18)).setY(look.y + 7);
      this.gcam.cinematic(cp, look, 52);
      this.notes.cinematicBars(true);
      this.startCinematic(2.6, () => true, () => this.notes.cinematicBars(false));
      this.notes.say('THE STORM AWAKENS');
    } else if (ev === 'phase3') {
      this.bossStorm = 1;
      audio.setMusic('boss3');
      const look = boss.pos.clone().setY(boss.pos.y + 3);
      const cp = look.clone().add(new THREE.Vector3(6, 10, 14));
      this.gcam.cinematic(cp, look, 46);
      this.notes.cinematicBars(true);
      this.startCinematic(2.2, () => true, () => this.notes.cinematicBars(false));
      this.notes.say('TEMPEST UNLEASHED');
      this.renderer.post.impactFrame(0.7);
    } else if (ev === 'ultimate') {
      this.notes.say('GET AWAY FROM THE HOWL');
    } else if (ev === 'dead') {
      this.bossDefeated = true;
      this.boss = null;
      this.victoryT = 0;
      this.notes.cinematicBars(true);
      const look = boss.pos.clone().setY(boss.pos.y + 2);
      this.gcam.cinematic(look.clone().add(new THREE.Vector3(8, 5, 10)), look, 45);
      this.startCinematic(3.0, () => true, () => { this.notes.cinematicBars(false); audio.setMusic('victory'); this.notes.areaTitle('THE STORM BREAKS', 'RETURN TO HOLLOW PINE VILLAGE'); });
    }
  }

  private startCinematic(dur: number, fn: (t: number, dt: number) => boolean, onEnd?: () => void) {
    this.state = 'cinematic';
    this.cineT = 0;
    this.cineFn = (t, dt) => {
      const cont = fn(t, dt) && t < dur;
      if (!cont) { this.gcam.endCinematic(); this.state = 'playing'; onEnd?.(); }
      return cont;
    };
  }

  // ------------------------------------------------------------ interactables
  private useInteractable(it: Interactable) {
    switch (it.id) {
      case 'spring': {
        if (this.springUsed) { this.hud.floatingText('The spring is calm.', it.pos.clone().setY(it.pos.y + 2)); return; }
        this.springUsed = true;
        this.fx.pillar(it.pos, 0x9fe8ff, 1.4, 20, 1.2);
        this.particles.emit({ pos: it.pos.clone().setY(it.pos.y + 0.5), count: 60, spread: 2, velUp: 6, velSpread: 2, life: 1.5, size: 0.15, color: [0x9fe8ff, 0xffffff], shape: Shape.DOT, gravity: 6 });
        sfx('crystal'); sfx('water');
        this.notes.analyzing(() => {
          this.prog.acquireSkill('waterBlade');
          this.notes.acquired('ABILITY ACQUIRED', 'Water Blade', 'The spring\'s water answers you. Press Q to fire a blade of water.', 'waterBlade');
          this.acquireFx();
          this.showTip('skill-waterBlade', 'Press Q to fire Water Blade. Use it on the slimes nearby.', 'Q');
        }, 1300);
        break;
      }
      case 'moonwell': {
        if (this.sunQuestStep === 3) { this.grantMegiddo(it); return; }
        if (this.moonUsed) { this.hud.floatingText('The water is still.', it.pos.clone().setY(it.pos.y + 2)); return; }
        this.moonUsed = true;
        sfx('crystal'); this.fx.pillar(it.pos, 0xbfe8ff, 4, 30, 1.5);
        this.notes.analyzing(() => { const r = this.prog.acquireTrait('moonBlessing'); if (r) { this.notes.acquired('BLESSING RECEIVED', TRAITS.moonBlessing.name, TRAITS.moonBlessing.desc, 'evolve'); this.acquireFx(); } this.prog.mp = this.prog.maxMp; }, 1200);
        break;
      }
      case 'caveHeart': {
        if (this.caveUsed) return;
        this.caveUsed = true;
        sfx('crystal'); this.fx.pillar(it.pos, 0x9fd4ff, 3, 20, 1.5); if (it.obj) it.obj.visible = false;
        this.notes.analyzing(() => { const r = this.prog.acquireTrait('magicSense'); if (r) { this.notes.acquired('TRAIT ACQUIRED', TRAITS.magicSense.name, TRAITS.magicSense.desc, 'sense'); this.acquireFx(); } }, 1200);
        break;
      }
      case 'relic': {
        if (this.sunQuestStep === 1) {
          // the second inscription reveals itself to the one who devoured the storm
          sfx('crystal'); sfx('chargeUp');
          this.fx.pillar(it.pos, 0xfff0c0, 1.6, 30, 1.6);
          this.fx.shockwave(it.pos, 0xffe3a3, 12, 1);
          this.renderer.post.flash(0.4, 0xfff4d0);
          this.dialogue.start([
            { speaker: 'Ancient Relic', text: 'The stone warms under you. Lines you could not see before rise to the surface like breath on glass.' },
            { speaker: 'Ancient Relic', text: '"The sun does not strike. It is gathered. Water that remembers the sky becomes a lens; light that forgot how to leave becomes the fire."' },
            { speaker: 'Ancient Relic', text: '"Devour the lost light. Offer it to the well of the moon. Then stand in the eye of the star and be judged."' },
            { speaker: 'Great Sage', text: 'Notice. Interpretation complete. Lost light: Hellfire Wisps. Well of the moon: the Moonwell. Eye of the star: the Storm Crater.' },
            { speaker: 'Rimura', text: '...You could have led with that. But thanks.' },
          ], () => { this.advanceSunQuest(2); this.prog.addXp(200); this.hud.floatingText('+200 XP', this.player.pos.clone().setY(this.player.pos.y + 1.6)); });
          return;
        }
        if (this.relicRead) { this.hud.floatingText('The inscription is silent.', it.pos.clone().setY(it.pos.y + 2)); return; }
        this.relicRead = true;
        this.dialogue.start([
          { speaker: 'Ancient Relic', text: 'An inscription glows as you touch it: "When the star falls, the guardian howls. Only one who devours the storm may calm it."' },
          { speaker: 'Rimura', text: '...Devours the storm? I can do that. Probably.' },
          { speaker: '???', text: 'Notice. Individual Rimura has made contact with an Analysis Relic. Requesting permission to assist.' },
          { speaker: 'Rimura', text: 'Wh— who said that?! ...Fine. Permission granted, voice in my head.' },
        ], () => {
          this.prog.addXp(120); this.hud.floatingText('+120 XP', this.player.pos.clone().setY(this.player.pos.y + 1.6));
          this.notes.analyzing(() => { const r = this.prog.acquireTrait('sage'); if (r) { this.notes.acquired('UNIQUE SKILL ACQUIRED', TRAITS.sage.name, TRAITS.sage.desc, 'sense'); this.acquireFx(); } }, 1200);
        });
        sfx('crystal');
        break;
      }
      case 'starShard': {
        if (this.shardTaken) return;
        this.shardTaken = true;
        sfx('crystal'); sfx('chargeUp');
        this.fx.pillar(it.pos, 0xc39bff, 5, 60, 2.0);
        this.fx.shockwave(it.pos, 0xc39bff, 30, 1.5);
        this.particles.emit({ pos: it.pos.clone().setY(it.pos.y + 5), count: 100, velSpread: 10, life: 2, size: 0.2, color: [0xc39bff, 0xffffff, 0xffe3a3], shape: Shape.STAR, gravity: 2 });
        if (this.props.starShard) this.props.starShard.visible = false;
        this.renderer.post.flash(0.6, 0xd0c0ff);
        this.advanceQuest(4);
        this.notes.analyzing(() => {
          this.prog.acquireSkill('meteor');
          this.notes.acquired('ULTIMATE ACQUIRED', 'METEOR', 'The fallen star\'s memory is yours. Press X to call it down.', 'meteor');
          this.acquireFx();
          this.after(3.2, () => this.startBossFight());
        }, 1600);
        break;
      }
      default:
        if (it.id.startsWith('sign-')) this.hud.floatingText(it.label, it.pos.clone().setY(it.pos.y + 2.4));
    }
  }

  /** the Moonwell accepts the captured light: cinematic, then Megiddo Ray is acquired */
  private grantMegiddo(it: Interactable) {
    this.advanceSunQuest(4);
    const look = it.pos.clone().setY(it.pos.y + 1.5);
    this.gcam.cinematic(look.clone().add(new THREE.Vector3(6, 3.5, 8)), look, 44, true);
    this.notes.cinematicBars(true);
    sfx('crystal'); sfx('chargeUp');
    this.player.target = null; this.gcam.lockTarget = null;
    this.startCinematic(5.4, (t) => {
      this.skills.sunRequest = Math.min(1, t / 2.5);
      if (t > 0.3 && Math.random() < 0.6) this.particles.emit({ pos: it.pos.clone().setY(it.pos.y + 0.2), count: 2, spread: 3, vel: { x: 0, y: rand(6, 12), z: 0 }, life: 1.8, size: 0.16, color: [0xbfe8ff, 0xffffff, 0xfff0b0], shape: Shape.GLOW });
      if (t > 1.2 && t < 1.25) { this.fx.pillar(it.pos, 0xbfe8ff, 3, 60, 2.5, { fadeIn: 0.3 }); this.fx.shockwave(it.pos, 0xffffff, 18, 1.2); sfx('water'); }
      if (t > 2.6 && t < 2.65) { this.renderer.post.flash(0.9, 0xfff8e8); this.renderer.post.impactFrame(0.6); this.fx.pillar(it.pos, 0xfff0b0, 1.2, 80, 1.4); this.fx.burst(it.pos.clone().setY(it.pos.y + 2), 0xffffff, 8, 0.6); this.gcam.addTrauma(0.5); sfx('lightning', 0.8); sfx('crystal', 0.8); }
      if (t > 2.65) { const orbit = t * 0.35; this.gcam.cinematic(look.clone().add(new THREE.Vector3(Math.cos(orbit) * 9, 4 + (t - 2.6) * 0.8, Math.sin(orbit) * 9)), look.clone().setY(look.y + 2), 42); }
      return true;
    }, () => {
      this.notes.cinematicBars(false);
      this.notes.analyzing(() => {
        this.prog.acquireSkill('megiddo');
        this.notes.acquired('ULTIMATE ACQUIRED', 'MEGIDDO RAY', 'Water becomes a lens. The sun becomes a weapon. Press V to gather the light.', 'megiddo');
        this.acquireFx();
        this.showTip('skill-megiddo', 'Press V to fire Megiddo Ray. Beams never miss: they snap to the nearest enemies.', 'V');
        this.after(2.5, () => this.dialogue.start([
          { speaker: 'Great Sage', text: 'Notice. Ultimate Skill "Megiddo Ray" acquired. Water lens: stable. Solar focus: stable. Recommend testing on the training dummies before the trial.' },
          { speaker: 'Rimura', text: 'A sun laser. I have a sun laser. Okay. Okay okay okay.' },
          { speaker: 'Great Sage', text: 'Notice. The relic\'s trial waits in the Storm Crater. Individual Rimura is advised to bring snacks.' },
        ]));
      }, 1500);
    });
  }

  // ------------------------------------------------------------ hidden console commands
  /** comet() / ray(): a short flourish when a hidden command grants an ultimate */
  cheatFlourish(name: string, sub: string, color: string, hex: number) {
    const p = this.player.pos;
    this.notes.technique(name, sub, color);
    this.fx.pillar(p, hex, 1.4, 40, 1.4, { fadeIn: 0.1 });
    this.fx.shockwave(p, hex, 14, 1.0);
    this.fx.shockwave(p, 0xffffff, 8, 0.6, { y: 0.3 });
    this.particles.emit({ pos: p.clone().setY(p.y + 0.5), count: 60, velSpread: 5, velUp: 9, life: 1.8, size: 0.2, color: [hex, 0xffffff], shape: Shape.STAR, gravity: 2, drag: 1 });
    this.renderer.post.flash(0.5, hex);
    this.renderer.post.impactFrame(0.4);
    this.time.slowmo(0.5, 0.25);
    this.gcam.addTrauma(0.3);
    this.player.model.setMood('surprised', 2);
    this.acquireFx();
  }

  /** max(): every skill unlocked and evolved to its final form, staged as an anime awakening */
  awakenAll() {
    const r = this.prog.maxAllSkills();
    this.prog.hp = this.prog.maxHp; this.prog.mp = this.prog.maxMp;
    if (this.state !== 'playing') return r;
    const look = this.player.pos.clone().setY(this.player.pos.y + 1);
    this.notes.cinematicBars(true);
    this.gcam.cinematic(look.clone().add(new THREE.Vector3(5, 2.5, 7)), look, 40, true);
    audio.duckMusic(0.5, 0.3);
    this.player.target = null; this.gcam.lockTarget = null;
    this.player.model.setMood('focused', 4);
    const colors: Record<SkillId, number> = { waterBlade: 0x7fd8ff, blackFlame: 0x9a3cff, windCutter: 0xbfffe0, lightning: 0xfff2a0, predator: 0x8a3cff, meteor: 0xff9a3c, megiddo: 0xfff0b0 };
    let idx = 0, climaxed = false;
    sfx('chargeUp');
    this.startCinematic(6.2, (t) => {
      const pp = this.player.pos;
      const orbit = t * 0.45;
      // slow orbit that pulls out and rises as the light builds, then holds wide for the climax
      const rad = 6 + Math.min(1, t / 3.7) * 6 + (t > 3.7 ? (t - 3.7) * 2 : 0);
      this.gcam.cinematic(look.clone().add(new THREE.Vector3(Math.cos(orbit) * rad, 2.0 + t * 0.7, Math.sin(orbit) * rad)), look.clone().setY(look.y + t * 0.3), 44 - t * 1.2);
      // motes rise from the ground into the slime; aura rings pulse
      if (t < 4.2) for (let i = 0; i < 3; i++) { const a = rand(0, Math.PI * 2), rr = rand(1, 6); const x = pp.x + Math.cos(a) * rr, z = pp.z + Math.sin(a) * rr; this.particles.emit({ pos: { x, y: this.terrain.heightAt(x, z) + 0.1, z }, count: 1, vel: { x: (pp.x - x) * 0.6, y: rand(2, 5), z: (pp.z - z) * 0.6 }, life: 1.4, size: 0.14, color: [0xc39bff, 0xffffff, 0xffe3a3], shape: Shape.GLOW }); }
      if (Math.random() < 0.35) this.fx.auraRing(this.player.root, t < 3.6 ? 0xc39bff : 0xffffff, 1.4, 0.9);
      // one pulse per skill, in its own color, with its final-form name
      if (idx < SKILL_ORDER.length && t > 0.7 + idx * 0.38) {
        const id = SKILL_ORDER[idx]; const c = colors[id];
        this.fx.pillar(pp, c, 0.35 + idx * 0.05, 22, 0.6);
        this.fx.shockwave(pp, c, 6 + idx * 1.2, 0.6);
        this.hud.floatingText(this.prog.skillName(id).toUpperCase(), pp.clone().setY(pp.y + 2.2 + idx * 0.05), 'text');
        this.hud.flashSkill(id);
        this.renderer.post.flash(0.22, c);
        this.player.model.impulseWobble(0.8);
        sfx('evolve', 0.45); sfx('bolt', 0.3);
        idx++;
      }
      // climax
      if (!climaxed && t > 3.7) {
        climaxed = true;
        this.time.slowmo(0.9, 0.18);
        this.renderer.post.impactFrame(0.9);
        this.renderer.post.flash(1, 0xffffff);
        this.renderer.post.chromaTarget = 0.03; this.after(0.5, () => (this.renderer.post.chromaTarget = 0));
        this.fx.pillar(pp, 0xffffff, 0.9, 80, 1.8, { fadeIn: 0.05 });
        this.fx.pillar(pp, 0xc39bff, 1.8, 50, 1.4, { fadeIn: 0.1 });
        this.fx.pillar(pp, 0x7fd8ff, 2.8, 30, 1.0, { fadeIn: 0.15 });
        this.fx.shockwave(pp, 0xffffff, 30, 1.2);
        this.fx.shockwave(pp, 0xc39bff, 22, 0.9, { y: 0.4 });
        this.fx.shockwave(pp, 0xffe3a3, 16, 0.7, { y: 0.8 });
        this.particles.emit({ pos: pp.clone().setY(pp.y + 0.5), count: 140, velSpread: 12, velUp: 14, life: 2.2, size: 0.22, color: [0xc39bff, 0xffffff, 0xffe3a3, 0x7fd8ff], shape: Shape.STAR, gravity: 3, drag: 0.8 });
        this.notes.technique('AWAKENING', 'ALL SKILLS · FINAL FORM', '#c39bff');
        this.gcam.addTrauma(0.9);
        sfx('explosion', 0.9); sfx('shockwave', 1); sfx('levelup');
        this.player.model.setMood('happy', 4);
      }
      return true;
    }, () => {
      this.notes.cinematicBars(false);
      audio.duckMusic(1, 0.6);
      this.notes.evolution('AWAKENING COMPLETE', 'RIMURA · SLIME', 'RIMURA · TRUE FORM', `${r.unlocked ? r.unlocked + ' skills unlocked. ' : ''}Every skill has reached its final evolution.`);
      this.evolveFx(0xc39bff);
    });
    return r;
  }

  // ------------------------------------------------------------ flow
  startGame() {
    this.touch?.enterFullscreen();
    if (!audio.ready) audio.init();
    audio.resume();
    this.menus.fadeTo(true);
    this.timers.length = 0;
    setTimeout(() => {
      this.player.spawn(new THREE.Vector3(0, 0, 4));
      this.player.yaw = Math.PI; this.player.facing.set(0, 0, -1);
      this.gcam.yaw = 0; this.gcam.pitch = 0.3; this.gcam.mode = 'explore';
      this.checkpoint.set(0, 0, 4);
      this.state = 'playing';
      this.hud.setVisible(true);
      this.input.requestLock();
      this.menus.fadeTo(false);
      audio.setMusic('explore');
      this.playT = 0;
      this.zoneCurrent = '';
      if (!this.introShown) {
        this.introShown = true;
        this.after(1.4, () => this.dialogue.start([
          { speaker: 'Rimura', text: '...Cold. Dark. Soft? Why is everything soft.' },
          { speaker: 'Rimura', text: 'I remember a street. Headlights. Then... nothing. And now grass, and trees, and I can\'t see my hands.' },
          { speaker: 'Rimura', text: 'Wait. I don\'t HAVE hands. I\'m... round. Blue. Bouncy. I\'m a slime.' },
          { speaker: 'Rimura', text: 'Okay. New life, new rules. First rule: figure out what a slime can eat. Second rule: find people. Third rule: don\'t die again.' },
        ], () => this.showTip('move', 'Move with W A S D. Move the mouse to look around.', 'WASD')));
      } else this.after(1.2, () => this.showTip('move', 'Move with W A S D. Move the mouse to look around.', 'WASD'));
      // spawn nearby enemies now
      this.checkSpawns(true);
    }, 700);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseLock();
    this.touch?.sync(false);
    this.menus.openPause();
    audio.duckMusic(0.35, 0.3);
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.requestLock();
    audio.duckMusic(1, 0.4);
  }
  toTitle() {
    this.state = 'title';
    this.touch?.sync(false);
    this.gcam.mode = 'title';
    this.hud.setVisible(false);
    this.input.releaseLock();
    this.dialogue.end();
    audio.setMusic('title');
    audio.duckMusic(1, 0.4);
    this.notes.cinematicBars(false);
    if (this.boss) { this.boss.dispose(); this.combat.unregister(this.boss); this.boss = null; }
    this.bossStorm = 0;
  }
  private onPlayerDeath() {
    this.state = 'dead';
    this.renderer.post.u.uDesat.value = 0;
    this.after(1.8, () => { if (this.state === 'dead') { this.menus.show('death'); this.input.releaseLock(); } });
    audio.duckMusic(0.3, 1);
  }
  respawn() {
    this.player.spawn(this.checkpoint);
    this.state = 'playing';
    this.hud.setVisible(true);
    this.input.requestLock();
    this.renderer.post.u.uDesat.value = 0;
    audio.duckMusic(1, 0.5);
    // reset boss if it was active
    if (this.boss) { this.boss.dispose(); this.combat.unregister(this.boss); this.boss = null; this.bossStorm = 0; this.shardTaken = false; if (this.props.starShard) this.props.starShard.visible = true; audio.setMusic('explore'); }
    if (this.trialActive) { for (const e of this.trialEnemies) { e.dispose(); this.combat.unregister(e); } this.trialEnemies = []; this.trialActive = false; this.bossStorm = 0; this.checkpoint.set(LANDMARKS.wolfWoods.x, 0, LANDMARKS.wolfWoods.z); this.player.spawn(this.checkpoint); }
    // heal enemies near checkpoint? keep as is; kill aggro by teleport
    for (const e of this.enemies) if (e.alive) { e.state = 'idle'; }
  }

  private showTip(id: string, text: string, key?: string) {
    if (this.tipsShown.has(id)) return;
    this.tipsShown.add(id);
    if (this.touch) ({ text, key } = touchTip(text, key));
    this.tip = { text, key };
    this.tipT = 6;
  }

  private checkSpawns(force = false) {
    const p = this.player.pos;
    for (const s of this.spawns) {
      if (s.enemy && s.enemy.dead) s.enemy = null;
      if (s.enemy) continue;
      if (s.killed) { if (!s.respawn) continue; s.timer -= 1; if (s.timer > 0) continue; if (p.distanceTo(s.pos) < 40) continue; s.killed = false; }
      const d = Math.hypot(p.x - s.pos.x, p.z - s.pos.z);
      if (force || d < 140) this.spawnEnemy(s);
    }
    // despawn far enemies that are idle (keeps CPU low)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }
      if (e.kind === 'boss') continue;
      const d = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
      if (d > 200 && e.alive && e.hp === e.maxHp) { e.dispose(); this.combat.unregister(e); const s = this.spawns.find((sp) => sp.enemy === e); if (s) s.enemy = null; this.enemies.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------ main loop
  private rafId = 0;
  private loop = (now: number) => {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.loop);
    this.time.tick(now);
    const dt = this.time.dt;
    const rawDt = this.time.rawDt;
    this.fpsAcc += rawDt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    audio.update(rawDt);
    this.notes.update(this.state === 'paused' ? 0 : rawDt);

    if (this.state === 'title') {
      this.updateWorld(dt, this.titleFocus);
      this.gcam.update(rawDt, this.titleFocus, 0, { sprint: false, inCombat: false, velocity: this.tmp.set(0, 0, 0) });
      this.renderer.setStorm(this.stormLevel = damp(this.stormLevel, 0, 1, rawDt));
      this.finishFrame(dt);
      return;
    }
    if (this.state === 'paused') {
      // frozen world, still render
      this.renderer.update(this.time.rawElapsed, 0);
      this.renderer.render();
      this.input.endFrame();
      return;
    }

    const playing = this.state === 'playing' || this.state === 'dead' || this.state === 'cinematic';
    if (!playing) { this.finishFrame(dt); return; }
    this.playT += rawDt;
    this.tickTimers(rawDt);

    // dialogue advance (a press that closes the dialogue must not also trigger a new interaction this frame)
    const dialogueWasActive = this.dialogue.active;
    if (this.dialogue.active) {
      if (this.input.justPressed('KeyF') || this.input.justPressed('Space') || this.input.justPressed('Enter') || this.input.mouseJustPressed(0)) this.dialogue.advance();
      this.dialogue.update(rawDt);
    }
    const allowInput = this.state === 'playing' && !this.dialogue.active && !dialogueWasActive;
    if (this.state === 'playing') this.gcam.handleInput(this.input, rawDt);

    // player (uses last frame's interaction prompt so F talks/uses instead of casting Predator)
    this.profT = performance.now();
    this.player.interactNearby = !!this.nearInteract;
    this.player.update(dt, allowInput);
    this.prof('player');
    if (this.state === 'cinematic' && this.cineFn) { this.cineT += rawDt; if (!this.cineFn(this.cineT, rawDt)) this.cineFn = null; }

    // enemies
    const ppos = this.player.pos;
    this.lastSpawnCheck += rawDt;
    if (this.lastSpawnCheck > 1) { this.lastSpawnCheck = 0; this.checkSpawns(); }
    let combatNear = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - ppos.x, e.pos.z - ppos.z);
      if (d < 130 || e.kind === 'boss') e.update(dt);
      if (e.alive && (e.state === 'chase' || e.state === 'attack' || e.state === 'windup' || e.state === 'circle' || e.state === 'cast') && d < 30) combatNear = true;
      if (e.alive && e.kind !== 'dummy' && d < 12 && e.hp / e.maxHp < 0.36 && this.prog.hasSkill('predator')) this.showTip('predator', 'That enemy is weak. Press F near it to DEVOUR it and gain its power.', 'F');
      if (e.alive && e.kind !== 'dummy' && d < 12) { this.showTip('attack', 'Left click to attack. Chain 3 hits, then right click to launch.', 'LMB'); }
    }
    if (combatNear) this.player.inCombat = true;
    for (const e of this.enemies) if (e.alive && e.kind !== 'dummy' && Math.hypot(e.pos.x - ppos.x, e.pos.z - ppos.z) < 14) { this.showTip('lock', 'Press TAB to lock onto a target. SHIFT to dodge.', 'TAB'); break; }
    this.prof('enemies');

    // essences
    for (let i = this.essences.length - 1; i >= 0; i--) {
      const es = this.essences[i];
      es.t += dt;
      es.mesh.rotation.y += dt * 2;
      es.mesh.position.y = es.pos.y + Math.sin(es.t * 3) * 0.15;
      if (Math.random() < 0.3) this.particles.emit({ pos: es.mesh.position, count: 1, spread: 0.3, velUp: 1, life: 0.8, size: 0.1, color: [0xc39bff, 0xffffff], shape: Shape.GLOW });
      const d = es.mesh.position.distanceTo(ppos);
      if (d < 4) { es.mesh.position.lerp(ppos.clone().setY(ppos.y + 0.6), dt * 4); es.pos.copy(es.mesh.position); }
      if (d < 1.2 || es.t > 90) {
        this.renderer.scene.remove(es.mesh);
        this.essences.splice(i, 1);
        if (d < 1.2) { sfx('absorbDone'); this.prog.recordAbsorb(es.kind); this.notes.analyzing(() => this.applyGrants(es.kind), 1200); this.particles.emit({ pos: ppos.clone().setY(ppos.y + 0.6), count: 20, velSpread: 3, life: 0.6, size: 0.15, color: [0xc39bff, 0xffffff], shape: Shape.STAR }); }
      }
    }

    // npcs & interactables
    this.nearInteract = null;
    let nearD = 3.2;
    for (const n of this.npcs) {
      n.update(dt, this.time.elapsed, ppos);
      const d = n.pos.distanceTo(ppos);
      if (d < nearD && !this.dialogue.active) { nearD = d; this.nearInteract = n; }
    }
    for (const it of this.interactables) {
      const d = it.pos.distanceTo(ppos);
      if (d < it.radius && d < nearD + 1.5 && !this.dialogue.active) { nearD = d; this.nearInteract = it; }
    }
    if (allowInput && this.nearInteract && this.input.justPressed('KeyF') && !this.skills.ultActive) {
      const ni = this.nearInteract;
      if (ni instanceof NPC) {
        ni.talking = true;
        this.dialogue.start(ni.def.lines(), () => { ni.talking = false; ni.def.onTalkEnd?.(); });
        sfx('ui');
      } else this.useInteractable(ni);
    }
    // consumed F should not also cast predator: handled by ordering (player updated earlier). Compensate: if interact available, refund predator cast? We prevent by checking prompt in player: simple approach below
    // quest triggers
    if (this.questStep === 1 && ppos.distanceTo(LANDMARKS.wolfWoods) < 26) this.advanceQuest(2);
    if (this.sunQuestStep === 4 && !this.trialActive && ppos.distanceTo(LANDMARKS.arena) < 22 && this.state === 'playing') this.startTrial();
    if (this.trialActive && ppos.distanceTo(LANDMARKS.arena) > 60) { this.hud.floatingText('The trial holds you here.', ppos.clone().setY(ppos.y + 1.8)); this.player.pos.lerp(LANDMARKS.arena.clone().setY(ppos.y), 0.02); }
    // zones
    this.updateZones(ppos);
    // boss storm & fog
    const distArena = ppos.distanceTo(LANDMARKS.arena);
    const approach = this.bossDefeated ? 0 : (1 - smoothstep(30, 110, distArena)) * 0.45;
    const targetStorm = Math.max(this.bossStorm, approach, this.skills.stormRequest);
    this.stormLevel = damp(this.stormLevel, targetStorm, 1.2, rawDt);
    // Megiddo's night reuses the storm darkening (sky, fog, lights) without the storm's lightning
    this.renderer.setStorm(Math.max(this.stormLevel, this.nightLevel * 0.6));
    this.renderer.setNight(this.nightLevel);
    globalUniforms.uNight.value = this.nightLevel;
    if (this.stormLevel > 0.3 && this.nightLevel < 0.3 && Math.random() < 0.004 * this.stormLevel) { this.renderer.sky.flash = 0.8; if (Math.random() < 0.5) sfx('lightning', 0.15); }
    globalUniforms.uWindStrength.value = 1 + this.stormLevel * 2.2 + this.skills.windRequest;
    this.sunLevel = damp(this.sunLevel, this.skills.sunRequest, 4, rawDt);
    this.renderer.sky.sunBoost = this.sunLevel;
    this.nightLevel = damp(this.nightLevel, this.skills.nightRequest, 5, rawDt);
    this.renderer.post.u.uTint.value.copy(this.skills.tint);
    if (this.victoryT >= 0) { this.victoryT += rawDt; this.bossStorm = Math.max(0, 1 - this.victoryT / 6); }
    // death desaturation
    if (this.state === 'dead') this.renderer.post.u.uDesat.value = damp(this.renderer.post.u.uDesat.value, 0.85, 1, rawDt);

    // music
    const bossActive = (!!this.boss && this.boss.alive && this.boss.state !== 'idle') || this.trialActive;
    if (bossActive) { if (audio.currentMusic !== 'boss3' && audio.currentMusic !== 'boss') audio.setMusic('boss'); }
    else if (this.victoryT >= 0 && this.victoryT < 14) { /* victory playing */ }
    else { if (combatNear) this.musicCombatT = 4; else this.musicCombatT -= rawDt; audio.setMusic(this.musicCombatT > 0 ? 'combat' : 'explore'); }
    // ambience
    const info = this.terrain.info(ppos.x, ppos.z);
    const waterNear = Math.max(info.water, 1 - smoothstep(6, 40, ppos.distanceTo(this.water.fallBase)));
    audio.setAmbience(0.3 + this.stormLevel * 0.7 + (info.plateau > 0.5 ? 0.2 : 0), waterNear, this.stormLevel);

    // tips
    if (this.tip) { this.tipT -= rawDt; if (this.tipT <= 0) this.tip = null; }
    if (this.tip && this.tipsShown.has('move') && this.tip.text.startsWith('Move') && this.player.vel.length() > 3) this.tipT = Math.min(this.tipT, 1.5);
    if (this.playT > 8 && this.prog.hasSkill('waterBlade') === false && this.player.pos.distanceTo(LANDMARKS.spring) < 22) this.showTip('spring', 'Something glows near the spring. Approach and press F.', 'F');
    if (this.playT > 40 && this.questStep < 0) this.showTip('village', 'Follow the dirt path west to reach Hollow Pine Village.');

    // camera
    const ult = this.skills.ultActive;
    this.gcam.ultFocus = this.skills.ultFocus;
    if (this.state !== 'cinematic') this.gcam.mode = this.player.inCombat ? 'combat' : 'explore';
    this.gcam.update(rawDt, ppos, this.player.yaw, { sprint: this.player.sprinting, inCombat: this.player.inCombat, velocity: this.player.vel, ult, playerHeight: 1.0 });
    // boss framing: nudge pitch/dist handled by lock; auto-lock boss when none
    if (this.boss && this.boss.alive && !this.player.target && this.state === 'playing' && this.boss.state !== 'idle') { this.player.target = this.boss; this.gcam.lockTarget = this.boss.root; this.gcam.lockHeight = this.boss.height; this.gcam.lockRadius = this.boss.radius; }

    this.prof('gameLogic');
    this.updateWorld(dt, ppos);
    this.updateHud(rawDt, combatNear);
    this.prof('hud');
    this.finishFrame(dt);
    this.prof('render');
  };

  private updateZones(ppos: THREE.Vector3) {
    for (const z of ZONES) {
      if (Math.hypot(ppos.x - z.pos.x, ppos.z - z.pos.z) < z.r) {
        if (this.zoneCurrent !== z.name) {
          this.zoneCurrent = z.name;
          if (!this.zoneVisited.has(z.name)) { this.zoneVisited.add(z.name); this.notes.areaTitle(z.name, z.sub); }
          if (z.name === 'Hollow Pine Village') { this.checkpoint.set(LANDMARKS.village.x + 3, 0, LANDMARKS.village.z + 6); if (this.questStep < 0) this.showTip('mira', 'Talk to Mira by the well. Press F near her.', 'F'); }
          if (z.name === 'Storm Crater') { this.checkpoint.set(LANDMARKS.wolfWoods.x, 0, LANDMARKS.wolfWoods.z); if (!this.shardTaken) this.showTip('shard', 'A star shard hums at the center of the crater. Analyze it with F.', 'F'); }
          if (z.name === 'Wolf Territory') this.checkpoint.set(LANDMARKS.ruins.x, 0, LANDMARKS.ruins.z + 20);
        }
        return;
      }
    }
    this.zoneCurrent = '';
  }

  private updateWorld(dt: number, focus: THREE.Vector3) {
    const t = this.time.elapsed;
    globalUniforms.uPlayerPos.value.copy(this.player ? this.player.pos : focus);
    this.renderer.updateShadowFocus(focus);
    this.grass.update(this.renderer.fog, this.settings.preset.drawDistance);
    this.water.update(dt, this.renderer.fog, this.particles, this.renderer.camera.position);
    this.props.update(dt, t);
    this.prof('world');
    this.ambient.update(dt, t, this.particles, focus, this.stormLevel);
    this.prof('ambient');
    this.skills.update(dt);
    this.fx.update(dt);
    this.prof('skillsFx');
    this.particles.update(dt, t);
    this.prof('particles');
    this.combat.camera = this.renderer.camera;
    if (this.state === 'title') for (const n of this.npcs) n.update(dt, t, focus.clone().add(new THREE.Vector3(100, 0, 100)));
  }

  private updateHud(dt: number, combatNear: boolean) {
    const p = this.prog;
    const lock = this.player.target && this.player.target.alive ? this.player.target : null;
    let lockScreen: { x: number; y: number } | null = null;
    if (lock) {
      const v = lock.pos.clone().setY(lock.pos.y + lock.height * 0.6).project(this.renderer.camera);
      if (v.z < 1) lockScreen = { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
    }
    const q = this.questStep >= 0 && !this.questDone ? STORM_QUEST[Math.min(this.questStep, STORM_QUEST.length - 1)] : null;
    const q2 = this.sunQuestStep >= 1 && !this.sunDone ? SUN_QUEST[Math.min(this.sunQuestStep - 1, SUN_QUEST.length - 1)] : null;
    const questHud = q ? { title: 'Storm in the Forest', objective: q.text, progress: q.count ? `${this.questProgress}/${q.count}` : undefined }
      : q2 ? { title: 'The Lens of the Sun', objective: this.trialActive ? `Survive the Sun Trial · Wave ${this.trialWave}/3` : q2.text, progress: q2.count ? `${this.sunProgress}/${q2.count}` : undefined }
      : this.sunDone ? { title: 'The Lens of the Sun', objective: 'Completed', done: true }
      : this.questDone ? { title: 'Storm in the Forest', objective: 'Completed', done: true } : null;
    const state: HudState = {
      hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, level: p.level, xp: p.xp, xpNext: p.xpToNext,
      skills: SKILL_ORDER.map((id) => { const s = p.skill(id); const def = SKILLS[id]; return { id, name: p.skillName(id), level: s?.level ?? 0, cooldown: s?.cooldown ?? 0, maxCooldown: def.cooldown, mp: p.mpCost(id), owned: !!s, ready: !!s && p.mp >= p.mpCost(id) }; }),
      target: lock ? { name: lock.name, hp: lock.hp, maxHp: lock.maxHp, level: (lock as Enemy).kind === 'warlord' ? 'ELITE' : undefined } : null,
      boss: this.boss && this.boss.alive && this.boss.state !== 'idle' ? { name: 'ANCIENT TEMPEST WOLF', sub: this.boss.bossPhase === 3 ? 'PHASE III · TEMPEST UNLEASHED' : this.boss.bossPhase === 2 ? 'PHASE II · THE STORM AWAKENS' : 'PHASE I · GUARDIAN OF THE CRATER', hp: this.boss.hp, maxHp: this.boss.maxHp, phases: [0.3, 0.65] } : null,
      quest: questHud,
      prompt: this.nearInteract && !this.dialogue.active && this.state === 'playing' ? { key: 'F', text: this.nearInteract instanceof NPC ? `Talk to ${this.nearInteract.def.name}` : this.nearInteract.label } : null,
      combo: this.player.combo, comboTimer: this.player.comboTimer,
      lockScreen,
      tip: this.tip,
      hpLow: p.hp / p.maxHp < 0.25,
    };
    this.hud.update(state, dt);
    this.updateMinimap(dt);
    void combatNear;
  }

  /** where the active objective is in the world, for the minimap marker */
  private objectivePos(): THREE.Vector3 | null {
    if (this.questStep >= 0 && !this.questDone) {
      switch (this.questStep) {
        case 1: case 2: return LANDMARKS.wolfWoods;
        case 3: case 4: return LANDMARKS.arena;
        case 5: return this.mira.pos;
      }
    }
    if (this.sunQuestStep >= 0 && !this.sunDone) {
      switch (this.sunQuestStep) {
        case 0: return this.elder.pos;
        case 1: return LANDMARKS.ruins;
        case 2: return null; // wisps: shown as enemy blips
        case 3: return LANDMARKS.hidden;
        case 4: return LANDMARKS.arena;
        case 5: return this.elder.pos;
      }
    }
    if (this.questStep < 0 && this.playT > 20) return this.mira.pos;
    return null;
  }

  private minimapBlips: MinimapBlip[] = [];
  private updateMinimap(dt: number) {
    const p = this.player.pos;
    const blips = this.minimapBlips;
    blips.length = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.kind === 'dummy') continue;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > 130) continue;
      blips.push({ x: e.pos.x, z: e.pos.z, kind: e.kind === 'boss' ? 'boss' : e.kind === 'warlord' ? 'elite' : 'enemy' });
    }
    for (const n of this.npcs) blips.push({ x: n.pos.x, z: n.pos.z, kind: n.hasQuestMarker ? 'quest' : 'npc' });
    for (const es of this.essences) blips.push({ x: es.pos.x, z: es.pos.z, kind: 'essence' });
    for (const z of ZONES) if (this.zoneVisited.has(z.name)) blips.push({ x: z.pos.x, z: z.pos.z, kind: 'landmark', label: z.short });
    const obj = this.objectivePos();
    const fwd = this.gcam.getForward(this.tmp);
    this.minimap.setVisible(this.state === 'playing' || this.state === 'cinematic' || this.state === 'dead');
    this.touch?.sync(this.state === 'playing' && this.menus.screen === 'none' && !this.dialogue.active);
    this.minimap.update({ x: p.x, z: p.z, playerYaw: this.player.yaw, camFx: fwd.x, camFz: fwd.z, blips, objective: obj ? { x: obj.x, z: obj.z } : null, zone: this.zoneCurrent || 'GREAT JURA FOREST' }, dt);
  }

  private finishFrame(dt: number) {
    this.renderer.update(this.time.rawElapsed, this.time.rawDt);
    this.renderer.render();
    this.input.endFrame();
    void dt;
  }
}

/** rewrite keyboard/mouse tips for the on-screen controls */
function touchTip(text: string, key?: string): { text: string; key?: string } {
  const t = text
    .replace('Move with W A S D. Move the mouse to look around.', 'Drag your left thumb to move. Drag on the right side to look around.')
    .replace('Left click to attack. Chain 3 hits, then right click to launch.', 'Tap ATK to attack. Chain 3 hits, then tap HEAVY to launch.')
    .replace('Press TAB to lock onto a target. SHIFT to dodge.', 'Tap LOCK to target an enemy. Tap DODGE to dodge (hold it to sprint).')
    .replace('with SHIFT', 'with DODGE')
    .replace('Press F near it to DEVOUR it', 'Tap the Predator skill (F) near it to DEVOUR it')
    .replace(/Press ([QERCXV]) to/g, 'Tap the $1 skill to')
    .replace('Analyze it with F.', 'Walk up and tap the prompt to analyze it.')
    .replace(/Press F near (her|him)\./, 'Walk up and tap the prompt.')
    .replace(/and press F\./, 'and tap the prompt.');
  const k = key === 'WASD' ? undefined : key === 'LMB' ? 'ATK' : key === 'TAB' ? 'LOCK' : key === 'SHIFT' ? 'DODGE' : key;
  return { text: t, key: k };
}
