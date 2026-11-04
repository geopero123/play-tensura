export function enterGameFullscreen() {
  const el = document.documentElement as HTMLElement & {webkitRequestFullscreen?:()=>Promise<void>};
  if (document.fullscreenElement) return;
  const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  if (request) {
    try { Promise.resolve(request()).catch(()=>{}); } catch {}
  }
}
