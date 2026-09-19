import './ui/styles.css';
import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

const game = new Game(canvas, ui);
(window as any).__game = game;
game.init().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#06081a;color:#ffb0b0;font:600 16px system-ui;padding:40px;text-align:center;z-index:100;';
  el.textContent = 'Failed to start: ' + (err && err.message ? err.message : String(err));
  document.body.appendChild(el);
});
