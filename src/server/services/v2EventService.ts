import { randomUUID } from "node:crypto";
import { publishEvent } from "../eventBus";
import { SidecarClient } from "../sidecar/client";

export interface AppendEventInput {
  type: string;
  aggregateId: string;
  actor: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  schemaVersion?: number;
}

export class V2EventService {
  constructor(private readonly sidecar: SidecarClient) {}

  async appendEvent(input: AppendEventInput) {
    const eventId = randomUUID();
    const now = new Date().toISOString();

    const ack = await this.sidecar.appendEvent({
      event_id: eventId,
      aggregate_id: input.aggregateId,
      causation_id: input.causationId || "",
      correlation_id: input.correlationId || eventId,
      actor: input.actor,
      timestamp: now,
      type: input.type,
      payload_json: JSON.stringify(input.payload),
      schema_version: input.schemaVersion || 1,
    });

    publishEvent("global", "v2.event", {
      event_id: ack.event_id,
      type: input.type,
      aggregate_id: input.aggregateId,
      actor: input.actor,
      payload: input.payload,
      timestamp: now,
    });

    return ack;
  }
}
