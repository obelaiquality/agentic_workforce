import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Chip({ 
  children, 
  variant = "subtle", 
  className,
  as: Component = "span",
  ...props 
}: { 
  children: React.ReactNode; 
  variant?: "ok" | "stop" | "warn" | "subtle";
  className?: string;
  as?: any;
  [key: string]: any;
}) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono tracking-wide";
  const variants = {
    ok: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    stop: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    warn: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    subtle: "bg-zinc-800 text-zinc-400 border-zinc-700",
  };

  return (
    <Component className={cn(base, variants[variant], className)} {...props}>
      {children}
    </Component>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("bg-[#121214] border border-white/10 rounded-xl overflow-hidden shadow-2xl shadow-black/50 flex flex-col", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, children, className }: { title: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-5 py-3 border-b border-white/5 bg-white/[0.02] flex items-center justify-between", className)}>
      <div className="text-sm font-semibold tracking-tight text-zinc-200">{title}</div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Button({ 
  children, 
  variant = "subtle", 
  className, 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "subtle" }) {
  const base = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20",
    subtle: "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/50",
  };
  return (
    <button className={cn(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
}
