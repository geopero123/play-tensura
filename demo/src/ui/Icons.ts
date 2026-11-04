/** Original inline SVG icons for abilities and HUD. */
const wrap = (inner: string, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS: Record<string, string> = {
  waterBlade: wrap(`<path d="M10 46 C 20 18, 40 10, 56 12 C 40 20, 30 34, 24 52 Z" fill="url(#gw)" stroke="#dff6ff" stroke-width="2"/><path d="M18 40 C 26 28, 36 20, 48 16" stroke="#fff" stroke-width="2" opacity=".8"/><defs><linearGradient id="gw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fd3ff"/><stop offset="1" stop-color="#1f7fe0"/></linearGradient></defs>`),
  blackFlame: wrap(`<path d="M32 6 C 40 18, 50 24, 48 38 C 47 48, 40 56, 32 58 C 22 56, 16 48, 16 38 C 16 30, 22 26, 24 18 C 26 26, 30 28, 32 30 C 34 24, 30 14, 32 6 Z" fill="url(#gb)" stroke="#c07aff" stroke-width="2"/><path d="M32 34 C 36 40, 38 44, 36 50 C 34 54, 30 54, 28 50 C 26 44, 30 40, 32 34Z" fill="#7a2cff"/><defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a1b8a"/><stop offset="1" stop-color="#120520"/></linearGradient></defs>`),
  windCutter: wrap(`<path d="M8 22 C 24 14, 40 14, 56 22" stroke="#c8ffe8" stroke-width="3"/><path d="M6 34 C 24 26, 42 26, 58 34" stroke="#8fffd0" stroke-width="3.5"/><path d="M10 46 C 24 38, 40 38, 54 46" stroke="#c8ffe8" stroke-width="3"/><path d="M50 18 l 8 4 l -6 5" stroke="#fff" stroke-width="2"/>`),
  lightning: wrap(`<path d="M36 4 L 16 36 L 30 36 L 24 60 L 50 26 L 36 26 Z" fill="url(#gl)" stroke="#fff6c0" stroke-width="2"/><defs><linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffd23f"/></linearGradient></defs>`),
  predator: wrap(`<circle cx="32" cy="32" r="24" fill="url(#gp)" stroke="#c39bff" stroke-width="2"/><path d="M32 12 C 20 16, 14 26, 18 38 C 22 46, 32 48, 38 44 C 30 44, 24 38, 26 30 C 28 22, 36 20, 44 22 C 40 16, 36 12, 32 12Z" fill="#1a0630" opacity=".9"/><circle cx="36" cy="34" r="3" fill="#ffffff"/><defs><radialGradient id="gp"><stop offset="0" stop-color="#6a2cff"/><stop offset="1" stop-color="#14041f"/></radialGradient></defs>`),
  meteor: wrap(`<path d="M6 8 L 34 30" stroke="#ffd9a0" stroke-width="3"/><path d="M10 20 L 30 36" stroke="#ff9b5a" stroke-width="2"/><circle cx="42" cy="42" r="14" fill="url(#gm)" stroke="#fff0d0" stroke-width="2"/><circle cx="38" cy="38" r="3" fill="#ffe6b0"/><circle cx="47" cy="45" r="2" fill="#ffd090"/><defs><radialGradient id="gm"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#b8301f"/></radialGradient></defs>`),
  megiddo: wrap(`<circle cx="32" cy="16" r="9" fill="url(#gmg)" stroke="#fff8e0" stroke-width="2"/><path d="M32 2 V 6 M32 26 V 30 M18 16 H 22 M42 16 H 46 M22 6 L 25 9 M42 6 L 39 9" stroke="#ffe9a8" stroke-width="2"/><ellipse cx="32" cy="34" rx="16" ry="4" fill="#9fe6ff" opacity=".85" stroke="#fff" stroke-width="1.5"/><path d="M32 38 L 32 60" stroke="#fff" stroke-width="5"/><path d="M32 38 L 32 60" stroke="#ffe9a8" stroke-width="10" opacity=".45"/><path d="M22 58 L 42 58" stroke="#ffe9a8" stroke-width="3" opacity=".8"/><defs><radialGradient id="gmg"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffc24a"/></radialGradient></defs>`),
  sun: wrap(`<circle cx="32" cy="32" r="13" fill="url(#gsun)" stroke="#fff8e0" stroke-width="2"/><g stroke="#ffe9a8" stroke-width="3" stroke-linecap="round"><path d="M32 6 V 13 M32 51 V 58 M6 32 H 13 M51 32 H 58 M13.6 13.6 L 18.5 18.5 M45.5 45.5 L 50.4 50.4 M13.6 50.4 L 18.5 45.5 M45.5 18.5 L 50.4 13.6"/></g><defs><radialGradient id="gsun"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ff9a3c"/></radialGradient></defs>`),
  basic: wrap(`<path d="M14 50 L 44 14 L 52 12 L 50 20 L 20 56 Z" fill="#dfe8ff" stroke="#ffffff" stroke-width="2"/><path d="M14 44 L 22 52" stroke="#8a6a3a" stroke-width="4"/>`),
  heavy: wrap(`<path d="M10 44 L 30 12 L 40 10 L 40 20 L 22 52 Z" fill="#cfd8ff" stroke="#fff" stroke-width="2"/><path d="M28 44 L 48 24 L 56 26 L 44 50 Z" fill="#cfd8ff" stroke="#fff" stroke-width="2"/>`),
  dodge: wrap(`<path d="M10 36 C 20 26, 34 26, 44 36" stroke="#bfffff" stroke-width="3"/><path d="M16 46 C 26 38, 38 38, 50 46" stroke="#bfffff" stroke-width="2" opacity=".7"/><circle cx="48" cy="22" r="6" fill="#fff"/>`),
  regen: wrap(`<path d="M32 54 C 12 42, 10 24, 20 16 C 26 12, 30 16, 32 20 C 34 16, 38 12, 44 16 C 54 24, 52 42, 32 54 Z" fill="#7fffa8" stroke="#fff" stroke-width="2"/>`),
  strength: wrap(`<path d="M12 30 L 12 40 L 24 40 L 24 30 Z M40 30 L 40 40 L 52 40 L 52 30 Z" fill="#ffb060" stroke="#fff" stroke-width="2"/><path d="M24 35 L 40 35" stroke="#fff" stroke-width="4"/><path d="M8 32 L 8 38 M56 32 L 56 38" stroke="#fff" stroke-width="3"/>`),
  resist: wrap(`<path d="M32 6 L 52 14 L 52 32 C 52 44, 42 54, 32 58 C 22 54, 12 44, 12 32 L 12 14 Z" fill="#7fb8ff" stroke="#fff" stroke-width="2"/><path d="M32 18 L 32 46" stroke="#fff" stroke-width="3"/>`),
  sense: wrap(`<ellipse cx="32" cy="32" rx="24" ry="14" stroke="#c8f0ff" stroke-width="2"/><circle cx="32" cy="32" r="8" fill="#5fd3ff"/><circle cx="32" cy="32" r="3" fill="#fff"/>`),
  storm: wrap(`<path d="M12 28 C 12 18, 22 12, 30 16 C 34 8, 48 8, 50 20 C 58 20, 58 34, 48 34 L 16 34 C 8 34, 8 28, 12 28Z" fill="#9fb8ff" stroke="#fff" stroke-width="2"/><path d="M34 34 L 26 48 L 34 48 L 30 60" stroke="#ffe680" stroke-width="3"/>`),
  crit: wrap(`<path d="M32 6 L 38 24 L 58 26 L 42 38 L 48 58 L 32 46 L 16 58 L 22 38 L 6 26 L 26 24 Z" fill="#ffd23f" stroke="#fff" stroke-width="2"/>`),
  lock: wrap(`<rect x="18" y="28" width="28" height="24" rx="4" fill="#5a5a70" stroke="#aaa" stroke-width="2"/><path d="M24 28 V 20 a 8 8 0 0 1 16 0 V 28" stroke="#aaa" stroke-width="3"/>`),
  evolve: wrap(`<path d="M32 8 L 40 24 L 56 26 L 44 38 L 48 56 L 32 46 L 16 56 L 20 38 L 8 26 L 24 24 Z" fill="url(#ge)" stroke="#fff" stroke-width="2"/><defs><linearGradient id="ge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c39bff"/></linearGradient></defs>`),
  mp: wrap(`<circle cx="32" cy="32" r="20" fill="#5fd3ff" stroke="#fff" stroke-width="2"/>`),
  quest: wrap(`<path d="M16 8 H 48 V 56 L 32 46 L 16 56 Z" fill="#ffd27f" stroke="#fff" stroke-width="2"/>`),
  slimeSense: wrap(`<circle cx="32" cy="34" r="20" fill="#86d3ff" stroke="#fff" stroke-width="2"/><circle cx="24" cy="32" r="4" fill="#ffb020"/><circle cx="40" cy="32" r="4" fill="#ffb020"/><path d="M26 42 Q 32 46 38 42" stroke="#1e2a5a" stroke-width="2"/>`),
};

/** Slime portrait (bigger, with frame) */
export const PORTRAIT_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="pg" cx="40%" cy="35%"><stop offset="0" stop-color="#c8f0ff"/><stop offset="1" stop-color="#4fb0f0"/></radialGradient></defs>
<path d="M50 14 C 78 14, 90 40, 86 62 C 84 78, 70 88, 50 88 C 30 88, 16 78, 14 62 C 10 40, 22 14, 50 14 Z" fill="url(#pg)" stroke="#1e2a5a" stroke-width="3"/>
<ellipse cx="34" cy="50" rx="7" ry="10" fill="#fff"/><ellipse cx="66" cy="50" rx="7" ry="10" fill="#fff"/>
<ellipse cx="35" cy="51" rx="4.5" ry="7" fill="#ffb020"/><ellipse cx="65" cy="51" rx="4.5" ry="7" fill="#ffb020"/>
<ellipse cx="35" cy="53" rx="2.2" ry="3.5" fill="#1a0a20"/><ellipse cx="65" cy="53" rx="2.2" ry="3.5" fill="#1a0a20"/>
<circle cx="32.5" cy="47" r="1.8" fill="#fff"/><circle cx="62.5" cy="47" r="1.8" fill="#fff"/>
<path d="M44 66 Q 50 71 56 66" stroke="#1e2a5a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="30" cy="28" rx="9" ry="4" fill="#fff" opacity=".85" transform="rotate(-25 30 28)"/>
</svg>`;
