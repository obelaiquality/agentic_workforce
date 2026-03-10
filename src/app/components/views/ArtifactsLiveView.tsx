import { useQuery } from "@tanstack/react-query";
import { listAuditEvents } from "../../lib/apiClient";
import { Panel, PanelHeader } from "../UI";

export function ArtifactsLiveView() {
  const auditQuery = useQuery({
    queryKey: ["artifacts-audit"],
    queryFn: listAuditEvents,
    refetchInterval: 8000,
  });

  const artifactEvents = (auditQuery.data?.items ?? []).filter((event) => {
    return (
      event.eventType.includes("ticket") ||
      event.eventType.includes("chat") ||
      event.eventType.includes("provider")
    );
  });

  return (
    <Panel>
      <PanelHeader title="Artifact Vault (Live)" />
      <div className="p-3 max-h-[720px] overflow-y-auto custom-scrollbar space-y-2">
        {artifactEvents.map((event) => (
          <article key={event.id} className="rounded-md border border-white/10 bg-zinc-900/40 p-2.5">
            <div className="text-xs text-zinc-200">{event.eventType}</div>
            <pre className="text-[10px] text-zinc-400 mt-1 overflow-x-auto">{JSON.stringify(event.payload, null, 2)}</pre>
          </article>
        ))}
      </div>
    </Panel>
  );
}
