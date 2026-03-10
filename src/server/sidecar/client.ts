import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const protoPath = path.resolve(process.cwd(), "proto/agentic/v1/control_plane.proto");

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const loaded = grpc.loadPackageDefinition(packageDefinition) as unknown as {
  agentic: {
    v1: {
      ControlPlane: grpc.ServiceClientConstructor;
    };
  };
};

export type PolicyDecisionResult = {
  decision: "allow" | "deny";
  requires_approval: boolean;
  reasons: string[];
  required_scopes: string[];
  policy_version: string;
};

export type TaskAllocationResult = {
  found: boolean;
  ticket_id: string;
  strategy: string;
  score: number;
  reservation_expires_at: string;
  message: string;
};

export type RoutingDecisionResult = {
  execution_mode: "single_agent" | "centralized_parallel" | "research_swarm";
  model_role: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
  provider_id: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses";
  max_lanes: number;
  risk: "low" | "medium" | "high";
  verification_depth: "light" | "standard" | "deep";
  decomposition_score: number;
  estimated_file_overlap: number;
  rationale: string[];
};

export type ReplayEventResult = {
  event_id: string;
  aggregate_id: string;
  causation_id: string;
  correlation_id: string;
  actor: string;
  timestamp: string;
  type: string;
  payload_json: string;
  schema_version: number;
};

function makeClient(address: string) {
  const ClientCtor = loaded.agentic.v1.ControlPlane;
  return new ClientCtor(address, grpc.credentials.createInsecure()) as grpc.Client;
}

export class SidecarClient {
  private client: grpc.Client;

  constructor(address: string) {
    this.client = makeClient(address);
  }

  close() {
    this.client.close();
  }

  async appendEvent(input: {
    event_id?: string;
    aggregate_id: string;
    causation_id?: string;
    correlation_id?: string;
    actor: string;
    timestamp: string;
    type: string;
    payload_json: string;
    schema_version?: number;
  }) {
    return new Promise<{ ok: boolean; event_id: string; message: string }>((resolve, reject) => {
      (this.client as any).appendEvent(
        {
          event_id: input.event_id || "",
          aggregate_id: input.aggregate_id,
          causation_id: input.causation_id || "",
          correlation_id: input.correlation_id || "",
          actor: input.actor,
          timestamp: input.timestamp,
          type: input.type,
          payload_json: input.payload_json,
          schema_version: input.schema_version || 1,
        },
        (error: grpc.ServiceError | null, response: { ok: boolean; event_id: string; message: string }) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        }
      );
    });
  }

  async evaluatePolicy(input: {
    action_type: string;
    actor: string;
    risk_level: string;
    workspace_path: string;
    payload_json: string;
    dry_run?: boolean;
  }): Promise<PolicyDecisionResult> {
    return new Promise((resolve, reject) => {
      (this.client as any).evaluatePolicy(
        {
          ...input,
          dry_run: Boolean(input.dry_run),
        },
        (error: grpc.ServiceError | null, response: PolicyDecisionResult) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        }
      );
    });
  }

  async allocateTask(input: {
    strategy: string;
    seed?: string;
    actor: string;
    reservation_ttl_seconds?: number;
  }): Promise<TaskAllocationResult> {
    return new Promise((resolve, reject) => {
      (this.client as any).allocateTask(
        {
          strategy: input.strategy,
          seed: input.seed || "",
          actor: input.actor,
          reservation_ttl_seconds: input.reservation_ttl_seconds || 0,
        },
        (error: grpc.ServiceError | null, response: TaskAllocationResult) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        }
      );
    });
  }

  async planRoute(input: {
    ticket_id?: string;
    run_id?: string;
    actor: string;
    prompt: string;
    risk_level: string;
    workspace_path: string;
    retrieval_context_count?: number;
    active_files_count?: number;
  }): Promise<RoutingDecisionResult> {
    return new Promise((resolve, reject) => {
      (this.client as any).planRoute(
        {
          ticket_id: input.ticket_id || "",
          run_id: input.run_id || "",
          actor: input.actor,
          prompt: input.prompt,
          risk_level: input.risk_level,
          workspace_path: input.workspace_path,
          retrieval_context_count: input.retrieval_context_count || 0,
          active_files_count: input.active_files_count || 0,
        },
        (error: grpc.ServiceError | null, response: RoutingDecisionResult) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        }
      );
    });
  }

  async heartbeat(input: { agent_id: string; status: string; summary?: string; metadata_json?: string }) {
    return new Promise<{ ok: boolean; message: string }>((resolve, reject) => {
      (this.client as any).heartbeat(
        {
          agent_id: input.agent_id,
          status: input.status,
          summary: input.summary || "",
          metadata_json: input.metadata_json || "{}",
        },
        (error: grpc.ServiceError | null, response: { ok: boolean; message: string }) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        }
      );
    });
  }

  async replay(input: { aggregate_id?: string; from_timestamp?: string; to_timestamp?: string; limit?: number }) {
    return new Promise<ReplayEventResult[]>((resolve, reject) => {
      const stream = (this.client as any).replay({
        aggregate_id: input.aggregate_id || "",
        from_timestamp: input.from_timestamp || "",
        to_timestamp: input.to_timestamp || "",
        limit: input.limit || 500,
      }) as grpc.ClientReadableStream<ReplayEventResult>;

      const events: ReplayEventResult[] = [];
      stream.on("data", (event) => events.push(event));
      stream.on("error", (error) => reject(error));
      stream.on("end", () => resolve(events));
    });
  }
}
