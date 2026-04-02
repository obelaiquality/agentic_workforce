import { EventEmitter } from "node:events";

export interface StreamEvent {
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class LocalEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(channel: string, event: StreamEvent) {
    this.emitter.emit(channel, event);
    this.emitter.emit("global", {
      ...event,
      payload: {
        ...event.payload,
        channel,
      },
    });
  }

  subscribe(channel: string, handler: (event: StreamEvent) => void) {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  listenerCount(channel: string): number {
    return this.emitter.listenerCount(channel);
  }

  removeAllListeners(channel?: string): void {
    if (channel) {
      this.emitter.removeAllListeners(channel);
    } else {
      this.emitter.removeAllListeners();
    }
  }
}

export const eventBus = new LocalEventBus();

export function publishEvent(channel: string, type: string, payload: Record<string, unknown>) {
  eventBus.emit(channel, {
    type,
    payload,
    createdAt: new Date().toISOString(),
  });
}
