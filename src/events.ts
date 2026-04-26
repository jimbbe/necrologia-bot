import { EventEmitter } from "events";

interface EventMap {
  "wa:qr": [qr: string];
  "wa:status": [status: "connecting" | "open" | "close" | "reconnecting", detail?: string];
  "msg:received": [jid: string, preview: string];
  "msg:sent": [jid: string, preview: string];
  "session:start": [jid: string];
  "session:confirming": [jid: string, tipologia: string, defunto: string];
  "session:end": [jid: string, reason: string];
  "browser:busy": [jid: string | null];
  log: [level: "info" | "warn" | "error", source: string, message: string];
}

class TypedEmitter extends EventEmitter {
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): boolean {
    return super.emit(event, ...args);
  }
  on<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.on(event, listener as any);
  }
}

export const bus = new TypedEmitter();
bus.setMaxListeners(30);
