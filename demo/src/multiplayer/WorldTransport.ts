import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { SERVER_KEY, SERVER_URL, WORLD_CHANNEL } from './ServerConfig';

export interface WorldLink {
  readonly id: string;
  connected: boolean;
  onStatus: (online: boolean, message: string) => void;
  onPlayers: (ids: string[]) => void;
  onPacket: (from: string, packet: unknown) => void;
  connect(): void;
  send(packet: object, to?: string): void;
  close(): void;
}

/** A server-relayed public world. Presence is low frequency; movement uses Broadcast. */
export class WorldTransport implements WorldLink {
  readonly id = crypto.randomUUID().replaceAll('-', '');
  connected = false;
  onStatus = (_online: boolean, _message: string) => {};
  onPlayers = (_ids: string[]) => {};
  onPacket = (_from: string, _packet: unknown) => {};
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private members = new Set<string>();

  constructor(private topic = WORLD_CHANNEL) {}

  connect() {
    if (this.channel) return;
    this.onStatus(false, 'Joining public world…');
    const client = createClient(SERVER_URL, SERVER_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `tempest-world-${crypto.randomUUID()}` } });
    this.client = client;
    const channel = client.channel(this.topic, { config: { private: false, presence: { key: this.id }, broadcast: { self: false, ack: false } } });
    this.channel = channel;
    channel.on('presence', { event: 'sync' }, () => {
      if (this.channel !== channel) return;
      this.members = new Set(Object.keys(channel.presenceState()).filter(id => /^[a-f0-9]{32}$/.test(id)));
      this.onPlayers([...this.members].filter(id => id !== this.id).sort());
    });
    channel.on('broadcast', { event: 'world' }, ({ payload }) => {
      if (this.channel !== channel || !this.connected || !payload || typeof payload !== 'object') return;
      const { from, to, packet } = payload;
      if (from === this.id || !this.members.has(from) || (to && to !== this.id)) return;
      if (!packet || typeof packet !== 'object' || JSON.stringify(packet).length > 4096) return;
      this.onPacket(from, packet);
    });
    channel.subscribe(async status => {
      if (this.channel !== channel) return;
      this.connected = status === 'SUBSCRIBED';
      if (this.connected) {
        const tracked = await channel.track({ version: 1 });
        if (this.channel !== channel) return;
        if (tracked !== 'ok') { this.onStatus(false, 'Could not join public world. Reconnecting…'); return; }
        this.onStatus(true, 'Public world connected');
      } else {
        this.onStatus(false, status === 'CLOSED' ? 'Public world disconnected. Reconnecting…' : 'Connecting to public world…');
      }
    });
  }
  send(packet: object, to?: string) {
    if (!this.connected || !this.channel) return;
    void this.channel.send({ type: 'broadcast', event: 'world', payload: { from: this.id, to, packet } }).catch(() => {});
  }
  close() {
    const channel = this.channel, client = this.client;
    this.channel = null; this.client = null; this.connected = false; this.members.clear();
    if (channel && client) void client.removeChannel(channel).finally(() => client.realtime.disconnect());
  }
}
