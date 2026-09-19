export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Debug mode: ?debug, #debug, or localStorage 'tr-debug' = '1'. Enables the profiler and unlocked mouse input. */
export const DEBUG = (() => {
  try {
    return location.search.includes('debug') || location.hash.includes('debug') || localStorage.getItem('tr-debug') === '1';
  } catch { return false; }
})();

export interface GraphicsPreset {
  pixelRatio: number;
  shadowSize: number;
  grassCount: number;
  particleCap: number;
  bloom: boolean;
  postFX: boolean;
  drawDistance: number;
  waterReflections: boolean;
  treeDetail: number;
}

const dpr = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

export const PRESETS: Record<Quality, GraphicsPreset> = {
  low: { pixelRatio: 0.75, shadowSize: 1024, grassCount: 12000, particleCap: 1500, bloom: false, postFX: true, drawDistance: 180, waterReflections: false, treeDetail: 0.6 },
  medium: { pixelRatio: 1.0, shadowSize: 2048, grassCount: 28000, particleCap: 3000, bloom: true, postFX: true, drawDistance: 240, waterReflections: false, treeDetail: 0.8 },
  high: { pixelRatio: Math.min(1.5, dpr()), shadowSize: 2048, grassCount: 50000, particleCap: 5000, bloom: true, postFX: true, drawDistance: 320, waterReflections: true, treeDetail: 1 },
  ultra: { pixelRatio: Math.min(2, dpr()), shadowSize: 4096, grassCount: 90000, particleCap: 8000, bloom: true, postFX: true, drawDistance: 420, waterReflections: true, treeDetail: 1 },
};

export interface SettingsData {
  quality: Quality;
  mouseSensitivity: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  cameraShake: number;
  invertY: boolean;
  showDamage: boolean;
}

const KEY = 'tempest-rebirth-settings';

export class Settings {
  data: SettingsData = {
    quality: 'high',
    mouseSensitivity: 1,
    masterVolume: 0.8,
    musicVolume: 0.7,
    sfxVolume: 0.9,
    cameraShake: 1,
    invertY: false,
    showDamage: true,
  };
  listeners: ((s: SettingsData, key: keyof SettingsData) => void)[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch {}
  }
  get preset() {
    return PRESETS[this.data.quality];
  }
  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]) {
    this.data[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {}
    this.listeners.forEach((l) => l(this.data, k));
  }
  onChange(fn: (s: SettingsData, key: keyof SettingsData) => void) {
    this.listeners.push(fn);
  }
}
