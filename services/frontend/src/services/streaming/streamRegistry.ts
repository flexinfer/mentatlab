export type Disconnectable = { disconnect?: () => void; close?: () => void };

class StreamRegistry {
  private clients = new Map<string, Disconnectable>();

  register(id: string, client: Disconnectable) {
    try { this.clients.set(id, client); } catch {}
  }

  get(id: string): Disconnectable | undefined {
    return this.clients.get(id);
  }

  stop(id: string): void {
    const c = this.clients.get(id);
    try { c?.disconnect?.(); } catch {}
    try { c?.close?.(); } catch {}
    this.clients.delete(id);
  }

  stopAll(): void {
    for (const id of Array.from(this.clients.keys())) {
      this.stop(id);
    }
  }
}

export const streamRegistry = new StreamRegistry();

