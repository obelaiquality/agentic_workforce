import { ChevronDown } from "lucide-react";

export function AdvancedSection({
  id,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.01] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-white">{title}</span>
          {subtitle ? <span className="text-[10px] text-zinc-500 truncate">{subtitle}</span> : null}
        </div>
        <ChevronDown className={`h-4 w-4 text-zinc-500 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="border-t border-white/5 p-4">{children}</div> : null}
    </div>
  );
}

export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="space-y-1 block">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
      />
    </label>
  );
}
