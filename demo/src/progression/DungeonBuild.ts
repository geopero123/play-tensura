export const vocations = ['Guardian', 'Arcanist', 'Striker'] as const;
export type Vocation = typeof vocations[number];

export class DungeonBuild {
  vocation: Vocation = 'Guardian';
  skin = 0;
  accessory = 0;
  coins = 0;
  bestWave = 0;
  weapon = 0;
  armor = 0;
  get evolved() { return this.bestWave >= 15; }
  get title() { return this.bestWave === 30 ? 'Depths Conqueror' : this.evolved ? 'Depths Veteran' : 'Delver'; }
  get classBonus() { return this.evolved ? 5 : 2; }
  get price() { return 10 + 5 * (this.weapon + this.armor); }
  buy(slot: 'weapon' | 'armor') {
    if (this.coins < this.price) return false;
    this.coins -= this.price;
    this[slot]++;
    return true;
  }
  reward(wave: number) {
    this.bestWave = Math.max(this.bestWave, wave);
    this.coins += wave + 3;
    if (wave % 3 !== 0) return '';
    const slot = wave % 2 ? 'weapon' : 'armor';
    this[slot]++;
    return slot === 'weapon' ? ' · FORGED BLADE +1' : ' · RUNEGUARD +1';
  }
}
