# Tempest Rebirth

A browser-based 3D anime action RPG vertical slice inspired by the fantasy of *That Time I Got Reincarnated as a Slime*: start as a weak slime, devour creatures with **Predator**, acquire and evolve their abilities, and grow into a magical calamity.

Built with **Vite + TypeScript + Three.js**, custom GLSL cel-shading, a procedural world, procedural creatures, and a fully synthesized WebAudio soundtrack. There are no downloaded assets: every model, texture, particle, magic circle and sound is generated in code, so the project is entirely original and license-free (Three.js is MIT; the UI fonts are loaded from Google Fonts under the SIL Open Font License).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5180 and click **PLAY**. Click the game once to capture the mouse (Esc releases it and pauses).

`npm run build` type-checks and produces a static `dist/` folder that can be hosted anywhere (Vercel, Cloudflare Pages, GitHub Pages).

## Controls

| Action | Key |
| --- | --- |
| Move | W A S D |
| Camera | Mouse (wheel zooms) |
| Attack combo (3 hits) | Left click |
| Heavy attack / launcher (after 2+ hits) | Right click |
| Aerial attacks / dive finisher | Jump, then Left click ×3 or Right click |
| Dodge (hold after the dodge to sprint) | Shift |
| Jump | Space |
| Water Blade / Black Flame / Wind Cutter / Lightning Judgment | Q / E / R / C |
| Predator (devour weakened enemies) | F |
| Ultimate: Meteor | X |
| Lock target | Tab / middle mouse |
| Interact / talk | F (when a prompt is shown) |
| Megiddo Ray (ultimate) | V |
| Minimap zoom | M |
| Skills screen / Pause | K / Esc |

Dodging through an attack at the last moment triggers a **Perfect Dodge** (slow motion, magic refund).

## What is in the vertical slice

- **One dense region**: Awakening Glade, Hollow Pine Village, the training field, the Ancient Ruins, Whisper Cave, Sky Falls, the hidden Moonwell, Wolf Territory and the Storm Crater boss arena, ringed by painterly mountains.
- **Rimura**, the slime protagonist: jelly deformation, expressive eyes and moods, a water blade for melee, an aura that visibly grows with power.
- **Combat**: 4-hit ground combo with launcher, aerial juggle and dive finisher, hit-stop, camera punch, damage numbers, criticals, combo counter, perfect dodge, target lock.
- **Seven spells with layered anime presentation**: Water Blade, Black Flame, Wind Cutter, Lightning Judgment, Predator, the Meteor ultimate (formation buildup, sky darkening, speed lines, impact frame, firestorm) and the **Megiddo Ray** ultimate, staged as an anime set piece: the world drops to night, a front-facing hero shot with a kaleidoscopic rosette mandala behind the slime, two wing-arcs of light with flare tips and lightning crackling through the outstretched arms, a formation of water lenses blooming in the dark sky, slow motion as the technique name card slams on screen, then a hard cut to the wide shot as needle-thin beams rake down from every lens onto the nearest enemies (tier 5 ends with a sweeping pillar of light, "Solar Judgment"). Every spell has **five evolution tiers** unlocked through use, each adding a new mechanic: ricocheting geysers, orbiting cinders and a double-detonating eclipse, piercing blades and a vacuum cyclone, chain judgment and a stunning pillar, a crushing abyss that refreshes cooldowns, meteor showers with aftershocks, and a sweeping solar pillar.
- **Predator progression**: devour weakened enemies to acquire their skills and traits; traits stack and evolve (Fire Resistance → Heat Resistance → Thermal Nullification) and fuse (Magic Sense + Keen Senses + Storm Sense → Advanced Perception).
- **Enemies with distinct behaviour**: Forest Slime, Goblin Raider, Forest Wolf (circle-strafe and lunge), Hellfire Wisp (ranged, blinks away), Corrupted Storm Wolf, the Goblin Warlord elite (super armor, slam, spin, charge, enrage) and training dummies.
- **Boss: Ancient Tempest Wolf** with a cinematic intro and three phases (claws, charge, wind blades, leap; then tornado, lightning zones, triple wind blade, teleport dash; then a faster storm-unleashed phase with a telegraphed howl ultimate).
- **Story**: an awakening monologue, two questlines ("Storm in the Forest", then "The Lens of the Sun": a hidden relic inscription, devouring lost light, an offering at the Moonwell, and a three-wave Sun Trial in the crater), a Great Sage voice that comments on discoveries, NPC dialogue that changes with your progress. Area titles, contextual tips instead of tutorial walls, day-time forest ambience with butterflies, birds, fireflies, petals, campfires and chimney smoke.
- **Anime UI**: portrait, HP/MP/XP, a rotating circular **minimap** (terrain rasterized from the real world mesh, enemies, NPCs, quest markers, landmarks, M to zoom), radial cooldowns, boss bar with phase markers, quest tracker, prompts, notifications for ANALYZING → ABILITY ACQUIRED and full-screen SKILL EVOLUTION events, title screen, characters, settings (Low/Medium/High/Ultra), skills screen, pause and defeat screens.
- **Sound**: synthesized footsteps, impacts, spells, creature calls, UI, ambience (wind, water, storm) and a sequencer that crossfades exploration / combat / boss / victory music.

## Project layout

- `src/core` – game loop, input, time (hit-stop/slow-mo), camera, settings, event bus, the `Game` orchestrator.
- `src/render` – renderer, cel-shading materials (`ToonMaterial.ts`), sky/clouds/mountains, post-processing (bloom, grading, vignette, radial blur, speed lines, impact frames).
- `src/world` – terrain heightfield and zones, vegetation (instanced grass/trees/flora), water and waterfall, props (village, ruins, cave, arena), ambient life.
- `src/entities` – player controller and slime model, procedural creature rigs, enemy AI and boss, NPCs.
- `src/combat` – hit resolution and the seven spells.
- `src/progression` – data tables (skills, traits, enemies, quest) and player progression.
- `src/vfx` – pooled GPU particle system, magic circles, effect library.
- `src/ui` – HUD, menus, notifications, dialogue, stylesheet, icons.
- `src/audio` – procedural audio engine.

## Debug helpers

Hidden console commands (open DevTools with F12 once the title screen is up): `comet()` grants Meteor, `ray()` grants Megiddo Ray, and `max()` unlocks every skill at its final tier, staged as an in-game Awakening cinematic.

Set `localStorage['tr-debug'] = '1'` (or add `?debug` to the URL) to enable mouse input without pointer lock and a per-system profiler at `window.__game.profile`.
# play-tensura
