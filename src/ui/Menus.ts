import { Settings, Quality } from '../core/Settings';
import { ICONS, PORTRAIT_SVG } from './Icons';
import { SKILLS, TRAITS, SKILL_ORDER } from '../progression/Data';
import type { Progression } from '../progression/Progression';
import { sfx } from '../audio/Audio';

function h(cls: string, html = '') { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; return e; }

export type MenuScreen = 'none' | 'title' | 'characters' | 'settings' | 'skills' | 'pause' | 'death';

export class Menus {
  root: HTMLElement;
  screen: MenuScreen = 'none';
  private title: HTMLElement;
  private panelHost: HTMLElement;
  private pause: HTMLElement;
  private death: HTMLElement;
  private loading: HTMLElement;
  private loadingBar: HTMLElement;
  private fade: HTMLElement;
  private clickHint: HTMLElement;
  private settings: Settings;
  private from: MenuScreen = 'title';
  onPlay: () => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onRetry: () => void = () => {};
  getProgression: () => Progression | null = () => null;
  inGame = false;

  constructor(root: HTMLElement, settings: Settings) {
    this.root = root;
    this.settings = settings;
    this.loading = h('loading', `<div class="loading-inner"><div class="loading-orb"></div><div class="loading-text">AWAKENING</div><div class="loading-bar"><div></div></div></div>`);
    root.appendChild(this.loading);
    this.loadingBar = this.loading.querySelector('.loading-bar div')!;
    this.fade = h('fade'); root.appendChild(this.fade);

    // title
    this.title = h('menu title-screen');
    this.title.innerHTML = `<div class="title-bg"></div><div class="title-vignette"></div>
      <div class="logo"><div class="logo-kicker">A TENSURA-INSPIRED ACTION RPG</div><div class="logo-title">TEMPEST<br>REBIRTH</div><div class="logo-orn"></div><div class="logo-sub">FROM SLIME TO SOVEREIGN</div></div>
      <div class="menu-list"><button class="menu-btn" data-a="play">PLAY</button><button class="menu-btn" data-a="characters">CHARACTERS</button><button class="menu-btn" data-a="settings">SETTINGS</button></div>
      <div class="menu-hint"><span><span class="key">W A S D</span> MOVE</span><span><span class="key">MOUSE</span> LOOK / ATTACK</span><span><span class="key">SHIFT</span> DODGE</span><span><span class="key">Q E R C F X</span> MAGIC</span></div>
      <div class="version">VERTICAL SLICE · v0.1</div>`;
    root.appendChild(this.title);
    this.title.querySelectorAll('.menu-btn').forEach((b) => {
      b.addEventListener('mouseenter', () => sfx('uiHover'));
      b.addEventListener('click', () => { sfx('uiConfirm'); this.action((b as HTMLElement).dataset.a!); });
    });
    this.panelHost = h('menu panel-host');
    root.appendChild(this.panelHost);

    // pause
    this.pause = h('menu pause');
    this.pause.innerHTML = `<div class="title-bg"></div><div class="pause-title">PAUSED</div>
      <div class="menu-list"><button class="menu-btn" data-a="resume">RESUME</button><button class="menu-btn" data-a="skills">SKILLS</button><button class="menu-btn" data-a="settings">SETTINGS</button><button class="menu-btn danger" data-a="quit">TITLE SCREEN</button></div>
      <div class="panel glass" style="width:min(720px,80vw);margin-top:26px;padding:18px 26px;"><div class="controls">
        <div><span>Move</span><b>W A S D</b></div><div><span>Camera</span><b>MOUSE</b></div>
        <div><span>Attack combo</span><b>LEFT CLICK</b></div><div><span>Heavy / launcher</span><b>RIGHT CLICK</b></div>
        <div><span>Dodge (hold: sprint)</span><b>SHIFT</b></div><div><span>Jump</span><b>SPACE</b></div>
        <div><span>Water Blade</span><b>Q</b></div><div><span>Black Flame</span><b>E</b></div>
        <div><span>Wind Cutter</span><b>R</b></div><div><span>Lightning Judgment</span><b>C</b></div>
        <div><span>Predator (devour)</span><b>F</b></div><div><span>Meteor (ultimate)</span><b>X</b></div>
        <div><span>Megiddo Ray (ultimate)</span><b>V</b></div><div><span>Minimap zoom</span><b>M</b></div>
        <div><span>Lock target</span><b>TAB / MIDDLE MOUSE</b></div><div><span>Interact</span><b>F</b></div>
        <div><span>Skills screen</span><b>K</b></div><div><span>Pause</span><b>ESC</b></div>
      </div></div>`;
    root.appendChild(this.pause);
    this.pause.querySelectorAll('.menu-btn').forEach((b) => {
      b.addEventListener('mouseenter', () => sfx('uiHover'));
      b.addEventListener('click', () => { sfx('uiConfirm'); this.action((b as HTMLElement).dataset.a!); });
    });

    this.death = h('death');
    this.death.innerHTML = `<div><div class="death-title">DEFEATED</div><div class="death-sub">THE SLIME DISSOLVES... BUT SLIMES DO NOT DIE SO EASILY.</div><div class="menu-list"><button class="menu-btn" data-a="retry">RISE AGAIN</button><button class="menu-btn small danger" data-a="quit">TITLE SCREEN</button></div></div>`;
    root.appendChild(this.death);
    this.death.querySelectorAll('.menu-btn').forEach((b) => b.addEventListener('click', () => { sfx('uiConfirm'); this.action((b as HTMLElement).dataset.a!); }));

    this.clickHint = h('click-hint', 'CLICK TO FOCUS');
    root.appendChild(this.clickHint);
  }

  setLoading(p: number, text?: string) {
    this.loadingBar.style.width = `${Math.round(p * 100)}%`;
    if (text) (this.loading.querySelector('.loading-text') as HTMLElement).textContent = text;
    if (p >= 1) setTimeout(() => this.loading.classList.add('hide'), 300);
  }

  fadeTo(on: boolean) { this.fade.classList.toggle('on', on); }
  showClickHint(v: boolean) { this.clickHint.classList.toggle('visible', v); }

  private action(a: string) {
    switch (a) {
      case 'play': this.show('none'); this.onPlay(); break;
      case 'characters': this.from = 'title'; this.show('characters'); break;
      case 'settings': this.from = this.screen === 'pause' ? 'pause' : 'title'; this.show('settings'); break;
      case 'skills': this.from = 'pause'; this.show('skills'); break;
      case 'resume': this.show('none'); this.onResume(); break;
      case 'quit': this.show('title'); this.onQuit(); break;
      case 'retry': this.show('none'); this.onRetry(); break;
      case 'back': this.show(this.from); break;
    }
  }

  show(s: MenuScreen) {
    this.screen = s;
    this.title.classList.toggle('visible', s === 'title');
    this.pause.classList.toggle('visible', s === 'pause');
    this.death.classList.toggle('visible', s === 'death');
    this.panelHost.classList.toggle('visible', s === 'characters' || s === 'settings' || s === 'skills');
    this.panelHost.innerHTML = '';
    if (s === 'settings') this.panelHost.appendChild(this.buildSettings());
    if (s === 'characters') this.panelHost.appendChild(this.buildCharacters());
    if (s === 'skills') this.panelHost.appendChild(this.buildSkills());
  }

  /** ESC / back handling; returns true if consumed */
  back(): boolean {
    if (this.screen === 'settings' || this.screen === 'characters' || this.screen === 'skills') { sfx('uiBack'); this.show(this.from); return true; }
    if (this.screen === 'pause') { sfx('uiBack'); this.show('none'); this.onResume(); return true; }
    return false;
  }

  openPause() { this.from = 'pause'; this.show('pause'); }
  openSkills() { this.from = 'pause'; this.show('skills'); }

  private panel(title: string, sub: string, body: HTMLElement) {
    const p = h('panel glass');
    p.innerHTML = `<button class="panel-close">BACK</button><h2>${title}</h2><div class="sub">${sub}</div>`;
    p.appendChild(body);
    p.querySelector('.panel-close')!.addEventListener('click', () => this.action('back'));
    const bg = h('title-bg');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;';
    wrap.appendChild(bg); wrap.appendChild(p);
    return wrap;
  }

  private buildSettings() {
    const s = this.settings;
    const body = h('settings-grid');
    const seg = (label: string, key: 'quality', opts: string[], desc: string) => {
      const d = h('setting');
      d.innerHTML = `<label>${label}</label>`;
      const sg = h('seg');
      opts.forEach((o) => {
        const b = document.createElement('button');
        b.textContent = o.toUpperCase();
        b.classList.toggle('on', s.data[key] === o);
        b.onclick = () => { sfx('ui'); s.set(key, o as Quality); sg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
        sg.appendChild(b);
      });
      d.appendChild(sg);
      d.appendChild(h('setting-desc', desc));
      return d;
    };
    const slider = (label: string, key: 'mouseSensitivity' | 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'cameraShake', min: number, max: number, step: number, fmt: (v: number) => string) => {
      const d = h('setting');
      d.innerHTML = `<label>${label}<span></span></label>`;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(s.data[key]);
      const span = d.querySelector('span')!;
      span.textContent = fmt(s.data[key]);
      inp.oninput = () => { s.set(key, parseFloat(inp.value)); span.textContent = fmt(parseFloat(inp.value)); };
      d.appendChild(inp);
      return d;
    };
    const toggle = (label: string, key: 'invertY' | 'showDamage') => {
      const d = h('setting');
      d.innerHTML = `<label>${label}</label>`;
      const sg = h('seg');
      ['off', 'on'].forEach((o, i) => {
        const b = document.createElement('button'); b.textContent = o.toUpperCase();
        b.classList.toggle('on', s.data[key] === (i === 1));
        b.onclick = () => { sfx('ui'); s.set(key, i === 1); sg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
        sg.appendChild(b);
      });
      d.appendChild(sg);
      return d;
    };
    body.appendChild(seg('GRAPHICS QUALITY', 'quality', ['low', 'medium', 'high', 'ultra'], 'Controls render resolution, shadow resolution, grass density, particle count, bloom and draw distance.'));
    body.appendChild(slider('MOUSE SENSITIVITY', 'mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)));
    body.appendChild(slider('MASTER VOLUME', 'masterVolume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'));
    body.appendChild(slider('MUSIC VOLUME', 'musicVolume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'));
    body.appendChild(slider('SFX VOLUME', 'sfxVolume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'));
    body.appendChild(slider('CAMERA SHAKE', 'cameraShake', 0, 1.5, 0.05, (v) => Math.round(v * 100) + '%'));
    body.appendChild(toggle('INVERT Y AXIS', 'invertY'));
    body.appendChild(toggle('DAMAGE NUMBERS', 'showDamage'));
    return this.panel('SETTINGS', 'GRAPHICS · CONTROLS · AUDIO', body);
  }

  private buildCharacters() {
    const prog = this.getProgression();
    const body = h('char-grid');
    const card = h('char-card glass');
    card.innerHTML = `<div class="portrait">${PORTRAIT_SVG}</div><div class="char-name">RIMURA</div><div class="char-title">SLIME · MIMIC · ADAPTIVE MAGIC</div><div class="char-desc">Reborn as a slime in the Great Jura Forest. Weak at first, but every creature devoured with <b>Predator</b> becomes new power. Fast, bouncy, and impossibly versatile.</div>`;
    body.appendChild(card);
    const right = document.createElement('div');
    const stats = [['LEVEL', prog ? prog.level : 1], ['HEALTH', prog ? prog.maxHp : 100], ['MAGIC', prog ? prog.maxMp : 60], ['ATTACK', prog ? Math.round(prog.atk) : 10], ['CRIT CHANCE', prog ? Math.round(prog.critChance * 100) + '%' : '8%'], ['SKILLS KNOWN', prog ? prog.skills.size : 1], ['TRAITS', prog ? prog.traits.size : 0]];
    right.innerHTML = `<div class="section-title">STATS</div>` + stats.map((s) => `<div class="stat-row"><span>${s[0]}</span><span>${s[1]}</span></div>`).join('') +
      `<div class="section-title">PLAYSTYLE</div><div class="char-desc">Chain light attacks into a launcher, juggle enemies in the air, and finish with magic. Devour weakened enemies to acquire their abilities. Abilities evolve with use.</div>
       <div class="hint-row">Additional forms and playstyles unlock as the slime evolves. This vertical slice contains the Slime form only, fully playable.</div>`;
    body.appendChild(right);
    return this.panel('CHARACTERS', 'CHOOSE YOUR FORM', body);
  }

  private buildSkills() {
    const prog = this.getProgression();
    const body = document.createElement('div');
    const list = h('skill-list');
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      const st = prog?.skill(id);
      const row = h('skill-row' + (st ? '' : ' locked'));
      const tier = st ? def.tiers[st.level - 1] : def.tiers[0];
      const next = st && st.level < def.tiers.length ? def.tiers[st.level] : null;
      row.innerHTML = `<div class="ico">${ICONS[def.icon]}</div><div><b>${st ? tier.name : '??? (' + def.name + ')'} <small style="display:inline;color:var(--gold-2)">[${def.key}]</small></b><small>${st ? tier.desc : 'Not yet acquired. Devour the right creature with Predator.'}</small>
        <div class="evo-tree">${def.tiers.map((t, i) => `<span class="node${st && st.level >= i + 1 ? ' on' : ''}">${t.name}</span>${i < def.tiers.length - 1 ? '<span class="arr">&#9656;</span>' : ''}`).join('')}</div></div>
        <div class="lv">${st ? 'Lv ' + st.level : ''}${next ? `<div class="xpbar"><div style="width:${Math.round((st!.xp / next.xp) * 100)}%"></div></div><small>${st!.xp}/${next.xp} uses</small>` : st ? '<small>MAX</small>' : ''}</div>`;
      list.appendChild(row);
    }
    body.appendChild(h('section-title', 'ABILITIES'));
    body.appendChild(list);
    body.appendChild(h('section-title', 'TRAITS'));
    const tl = h('skill-list');
    if (prog && prog.traits.size) {
      for (const t of prog.traits) {
        const def = TRAITS[t];
        const stacks = prog.traitStacks.get(t) ?? 0;
        const row = h('skill-row');
        row.innerHTML = `<div class="ico">${ICONS[def.icon]}</div><div><b>${def.name}</b><small>${def.desc}</small>${def.evolvesTo ? `<div class="evo-tree"><span class="node on">${def.name}</span><span class="arr">&#9656;</span><span class="node">${TRAITS[def.evolvesTo].name}</span><small style="display:inline;margin-left:6px">absorb ${2 - stacks} more</small></div>` : ''}</div>`;
        tl.appendChild(row);
      }
    } else tl.appendChild(h('hint-row', 'No traits yet. Devour creatures with Predator (F) when they are weakened.'));
    body.appendChild(tl);
    return this.panel('SKILLS & TRAITS', 'GROWTH THROUGH PREDATION', body);
  }
}
