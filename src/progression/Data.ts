/** Static game data: skills, traits, evolutions, enemy stats, XP curve. */

export type SkillId = 'waterBlade' | 'blackFlame' | 'windCutter' | 'lightning' | 'predator' | 'meteor';
export type TraitId = 'regen' | 'regen2' | 'strength' | 'strength2' | 'fireRes' | 'heatRes' | 'thermalNull' | 'keenSenses' | 'stormSense' | 'ironBody' | 'magicSense' | 'stormFang' | 'advancedPerception' | 'moonBlessing';

export interface SkillDef {
  id: SkillId;
  name: string;
  key: string;
  keyCode: string;
  icon: string;
  desc: string;
  mp: number;
  cooldown: number;
  element: 'water' | 'fire' | 'wind' | 'lightning' | 'dark' | 'meteor';
  /** names per evolution level 1..3 */
  tiers: { name: string; desc: string; xp: number }[];
  ultimate?: boolean;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  waterBlade: {
    id: 'waterBlade', name: 'Water Blade', key: 'Q', keyCode: 'KeyQ', icon: 'waterBlade', element: 'water', mp: 12, cooldown: 1.2,
    desc: 'Compress water into an impossibly thin blade and hurl it forward. Pierces through enemies.',
    tiers: [
      { name: 'Water Blade', desc: 'A single crescent of high-pressure water.', xp: 0 },
      { name: 'Twin Water Blade', desc: 'Two blades in a scissor arc. Wider, faster.', xp: 8 },
      { name: 'Aqua Guillotine', desc: 'Three enormous blades that slice everything in their path.', xp: 22 },
    ],
  },
  blackFlame: {
    id: 'blackFlame', name: 'Black Flame', key: 'E', keyCode: 'KeyE', icon: 'blackFlame', element: 'fire', mp: 20, cooldown: 4,
    desc: 'Supernatural dark fire that burns without fuel. Leaves a lingering inferno.',
    tiers: [
      { name: 'Black Flame', desc: 'A burst of dark fire that ignites the ground.', xp: 0 },
      { name: 'Black Flame Prison', desc: 'Larger burst; flames chase nearby enemies.', xp: 6 },
      { name: 'Hell Flare', desc: 'A towering pillar of black fire that detonates.', xp: 16 },
    ],
  },
  windCutter: {
    id: 'windCutter', name: 'Wind Cutter', key: 'R', keyCode: 'KeyR', icon: 'windCutter', element: 'wind', mp: 14, cooldown: 2.2,
    desc: 'Compressed-air slashes, nearly invisible, rip toward enemies at incredible speed.',
    tiers: [
      { name: 'Wind Cutter', desc: 'Three homing air blades.', xp: 0 },
      { name: 'Gale Shredder', desc: 'Six blades that shred and stagger.', xp: 8 },
      { name: 'Tempest Cutter', desc: 'A storm of twelve blades that launches enemies.', xp: 20 },
    ],
  },
  lightning: {
    id: 'lightning', name: 'Lightning Judgment', key: 'C', keyCode: 'KeyC', icon: 'lightning', element: 'lightning', mp: 30, cooldown: 7,
    desc: 'Mark the ground. The sky darkens, a formation forms, and judgment falls.',
    tiers: [
      { name: 'Lightning Judgment', desc: 'A single massive strike.', xp: 0 },
      { name: 'Twin Judgment', desc: 'Two strikes and a larger shockwave.', xp: 5 },
      { name: 'Divine Thunder', desc: 'A ring of strikes ending in a cataclysmic bolt.', xp: 14 },
    ],
  },
  predator: {
    id: 'predator', name: 'Predator', key: 'F', keyCode: 'KeyF', icon: 'predator', element: 'dark', mp: 10, cooldown: 3,
    desc: 'A dark vortex drags enemies inward. Weakened foes are devoured and analyzed, granting their abilities.',
    tiers: [
      { name: 'Predator', desc: 'Devour enemies below 35% health.', xp: 0 },
      { name: 'Predator: Gluttony', desc: 'Devour below 50% health; wider vortex.', xp: 6 },
      { name: 'Predator: Beelzebub', desc: 'Devour below 65%; devouring restores health and magic.', xp: 15 },
    ],
  },
  meteor: {
    id: 'meteor', name: 'Meteor', key: 'X', keyCode: 'KeyX', icon: 'meteor', element: 'meteor', mp: 60, cooldown: 30, ultimate: true,
    desc: 'ULTIMATE. Call a star down from beyond the sky. Everything nearby is annihilated.',
    tiers: [
      { name: 'Meteor', desc: 'A single falling star.', xp: 0 },
      { name: 'Meteor Rain', desc: 'Three smaller meteors precede the main impact.', xp: 3 },
      { name: 'Calamity Fall', desc: 'A world-shaking impact with a lingering firestorm.', xp: 8 },
    ],
  },
};

export const SKILL_ORDER: SkillId[] = ['waterBlade', 'blackFlame', 'windCutter', 'lightning', 'predator', 'meteor'];

export interface TraitDef {
  id: TraitId;
  name: string;
  icon: string;
  desc: string;
  /** stat modifiers */
  mods: Partial<{ atk: number; def: number; regen: number; mpRegen: number; crit: number; maxHp: number; maxMp: number; fireRes: number; speed: number }>;
  evolvesTo?: TraitId;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  regen: { id: 'regen', name: 'Regeneration', icon: 'regen', desc: 'Slowly restores health over time.', mods: { regen: 1.2 }, evolvesTo: 'regen2' },
  regen2: { id: 'regen2', name: 'Ultra Regeneration', icon: 'regen', desc: 'Rapidly restores health, even in combat.', mods: { regen: 3.5, maxHp: 25 } },
  strength: { id: 'strength', name: 'Goblin Might', icon: 'strength', desc: 'Physical attacks hit harder.', mods: { atk: 0.12 }, evolvesTo: 'strength2' },
  strength2: { id: 'strength2', name: "Warlord's Might", icon: 'strength', desc: 'Massively increased attack power.', mods: { atk: 0.3, maxHp: 20 } },
  fireRes: { id: 'fireRes', name: 'Fire Resistance', icon: 'resist', desc: 'Reduces fire damage taken.', mods: { fireRes: 0.4 }, evolvesTo: 'heatRes' },
  heatRes: { id: 'heatRes', name: 'Heat Resistance', icon: 'resist', desc: 'Greatly reduces fire damage.', mods: { fireRes: 0.7 }, evolvesTo: 'thermalNull' },
  thermalNull: { id: 'thermalNull', name: 'Thermal Nullification', icon: 'resist', desc: 'Immune to fire. Black Flame costs less magic.', mods: { fireRes: 1, maxMp: 20 } },
  keenSenses: { id: 'keenSenses', name: 'Keen Senses', icon: 'crit', desc: 'Higher critical hit chance.', mods: { crit: 0.12 } },
  stormSense: { id: 'stormSense', name: 'Storm Sense', icon: 'storm', desc: 'Sense lightning before it falls. Perfect dodge window widened.', mods: { crit: 0.05, speed: 0.05 } },
  ironBody: { id: 'ironBody', name: 'Iron Body', icon: 'resist', desc: 'Reduces all damage taken.', mods: { def: 0.2, maxHp: 30 } },
  magicSense: { id: 'magicSense', name: 'Magic Sense', icon: 'sense', desc: 'Perceive magic. Magic regenerates faster.', mods: { mpRegen: 2.5, maxMp: 30 } },
  stormFang: { id: 'stormFang', name: 'Storm Fang', icon: 'storm', desc: 'Your attacks carry lightning. Every hit crackles.', mods: { atk: 0.15, crit: 0.1 } },
  advancedPerception: { id: 'advancedPerception', name: 'Advanced Perception', icon: 'sense', desc: 'Magic Sense + Keen Senses + Storm Sense fused. Time slows on perfect dodges for longer.', mods: { crit: 0.2, mpRegen: 4, maxMp: 40, speed: 0.08 } },
  moonBlessing: { id: 'moonBlessing', name: "Moonwell's Blessing", icon: 'evolve', desc: 'Maximum magic greatly increased.', mods: { maxMp: 50, mpRegen: 1.5 } },
};

/** trait combinations that fuse into a new trait */
export const TRAIT_FUSIONS: { needs: TraitId[]; result: TraitId }[] = [
  { needs: ['magicSense', 'keenSenses', 'stormSense'], result: 'advancedPerception' },
];

export type EnemyKind = 'slime' | 'goblin' | 'wolf' | 'wisp' | 'stormWolf' | 'warlord' | 'boss' | 'dummy';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  atk: number;
  speed: number;
  xp: number;
  /** what Predator grants */
  grants: { skill?: SkillId; trait?: TraitId; label: string }[];
  radius: number;
  aggroRange: number;
  attackRange: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  slime: { kind: 'slime', name: 'Forest Slime', hp: 40, atk: 6, speed: 3.2, xp: 12, grants: [{ trait: 'regen', label: 'Regeneration' }], radius: 0.5, aggroRange: 12, attackRange: 1.6 },
  goblin: { kind: 'goblin', name: 'Goblin Raider', hp: 90, atk: 11, speed: 4.2, xp: 22, grants: [{ trait: 'strength', label: 'Goblin Might' }], radius: 0.45, aggroRange: 16, attackRange: 1.9 },
  wolf: { kind: 'wolf', name: 'Forest Wolf', hp: 120, atk: 14, speed: 7.5, xp: 30, grants: [{ skill: 'windCutter', label: 'Wind Cutter' }, { trait: 'keenSenses', label: 'Keen Senses' }], radius: 0.55, aggroRange: 20, attackRange: 2.2 },
  wisp: { kind: 'wisp', name: 'Hellfire Wisp', hp: 70, atk: 12, speed: 4.5, xp: 28, grants: [{ skill: 'blackFlame', label: 'Black Flame' }, { trait: 'fireRes', label: 'Fire Resistance' }], radius: 0.5, aggroRange: 22, attackRange: 12 },
  stormWolf: { kind: 'stormWolf', name: 'Corrupted Storm Wolf', hp: 220, atk: 20, speed: 8.5, xp: 60, grants: [{ skill: 'lightning', label: 'Lightning Judgment' }, { trait: 'stormSense', label: 'Storm Sense' }], radius: 0.6, aggroRange: 24, attackRange: 2.4 },
  warlord: { kind: 'warlord', name: 'Goblin Warlord', hp: 650, atk: 26, speed: 4.0, xp: 160, grants: [{ trait: 'ironBody', label: 'Iron Body' }, { trait: 'strength', label: 'Goblin Might' }], radius: 0.8, aggroRange: 22, attackRange: 2.8 },
  boss: { kind: 'boss', name: 'Ancient Tempest Wolf', hp: 3200, atk: 30, speed: 10, xp: 800, grants: [{ trait: 'stormFang', label: 'Storm Fang' }], radius: 1.6, aggroRange: 80, attackRange: 3.8 },
  dummy: { kind: 'dummy', name: 'Training Dummy', hp: 999999, atk: 0, speed: 0, xp: 0, grants: [], radius: 0.45, aggroRange: 0, attackRange: 0 },
};

export const xpForLevel = (lv: number) => Math.round(60 * Math.pow(lv, 1.55));

export interface QuestStep { id: string; text: string; count?: number }
export const STORM_QUEST: QuestStep[] = [
  { id: 'talk', text: 'Speak with Mira in Hollow Pine Village' },
  { id: 'investigate', text: 'Investigate the wolf territory to the north-east' },
  { id: 'wolves', text: 'Defeat the corrupted storm wolves', count: 3 },
  { id: 'source', text: 'Find the source of the storm' },
  { id: 'boss', text: 'Defeat the Ancient Tempest Wolf' },
  { id: 'return', text: 'Return to Mira in Hollow Pine Village' },
];
