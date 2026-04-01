import type { ReactNode } from "react";

export function EmptyState({
  icon,
  heading,
  description,
  action,
  "data-testid": dataTestId,
}: {
  icon: ReactNode;
  heading: string;
  description: string;
  action?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <div data-testid={dataTestId} className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="rounded-full border border-white/10 bg-white/[0.03] p-4">
        {icon}
      </div>
      <div className="space-y-1.5">
        <h3 className="text-sm font-medium text-zinc-200">{heading}</h3>
        <p className="max-w-sm text-xs text-zinc-500">{description}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
