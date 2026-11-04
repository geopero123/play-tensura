type Handler = (...args: any[]) => void;

class EventBus {
  private map = new Map<string, Set<Handler>>();
  on(name: string, fn: Handler) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name)!.add(fn);
    return () => this.off(name, fn);
  }
  off(name: string, fn: Handler) {
    this.map.get(name)?.delete(fn);
  }
  emit(name: string, ...args: any[]) {
    this.map.get(name)?.forEach((fn) => fn(...args));
  }
}

export const events = new EventBus();
