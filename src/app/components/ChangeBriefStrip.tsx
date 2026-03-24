import { useState, useCallback, useEffect } from "react";
import useEmblaCarousel from "embla-carousel-react";
import type { MissionChangeBrief } from "../lib/missionTypes";
import { Chip, Panel, PanelHeader } from "./UI";
import { FileCode2, Clock, Cpu, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function ChangeBriefStrip({ briefs, onSelectTask }: { briefs: MissionChangeBrief[]; onSelectTask: (id: string) => void }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: "start",
    slidesToScroll: 1,
    breakpoints: {
      "(min-width: 768px)": { slidesToScroll: 1 },
    },
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  const appliedCount = briefs.filter(b => b.status === "success").length;
  const activeCount = briefs.filter(b => b.status === "active").length;
  const needsFixCount = briefs.filter(b => b.status === "failed").length;

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => { emblaApi.off("select", onSelect); emblaApi.off("reInit", onSelect); };
  }, [emblaApi, onSelect]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);

  return (
    <Panel>
      <PanelHeader title="AI Change Briefs">
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex gap-2">
            <Chip variant="ok">Applied {appliedCount}</Chip>
            <Chip variant="warn">Active {activeCount}</Chip>
            <Chip variant="stop">Fix {needsFixCount}</Chip>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={scrollPrev}
              className="w-7 h-7 flex items-center justify-center rounded-md bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 transition-colors disabled:opacity-30"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={scrollNext}
              className="w-7 h-7 flex items-center justify-center rounded-md bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 transition-colors disabled:opacity-30"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </PanelHeader>

      <div className="p-4">
        {/* Carousel viewport */}
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex gap-3" style={{ backfaceVisibility: "hidden" }}>
            {briefs.map((brief, idx) => (
              <div
                key={brief.task_id}
                className="flex-shrink-0 w-[calc(100%-1rem)] sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-0.75rem)] min-w-0"
              >
                <BriefCard
                  brief={brief}
                  isActive={idx === selectedIndex}
                  onSelectTask={onSelectTask}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Dots */}
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {briefs.map((_, idx) => (
            <button
              key={idx}
              onClick={() => scrollTo(idx)}
              className={`rounded-full transition-all duration-200 ${
                idx === selectedIndex
                  ? "w-5 h-1.5 bg-purple-500"
                  : "w-1.5 h-1.5 bg-zinc-700 hover:bg-zinc-500"
              }`}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function BriefCard({ brief, isActive, onSelectTask }: {
  brief: MissionChangeBrief;
  isActive: boolean;
  onSelectTask: (id: string) => void;
}) {
  const statusVariant = brief.status === "success" ? "ok" : brief.status === "failed" ? "stop" : "warn";
  const statusLabel = brief.status === "success" ? "Applied" : brief.status === "failed" ? "Needs Fix" : "Active";

  return (
    <div className={`bg-[#18181b] border rounded-lg p-4 flex flex-col gap-3 transition-all group h-full ${
      isActive
        ? "border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.08)]"
        : "border-white/5 hover:border-white/10"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {brief.status === "active" && (
              <Zap className="w-3 h-3 text-amber-400 shrink-0" />
            )}
            <span className="text-[10px] font-mono text-purple-400">{brief.task_id}</span>
          </div>
          <h3 className="text-sm font-medium text-zinc-200 truncate">{brief.title}</h3>
        </div>
        <Chip variant={statusVariant} className="shrink-0">{statusLabel}</Chip>
      </div>

      <div className="bg-black/30 rounded-md p-3 border border-white/[0.03] flex-1">
        <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
          {brief.summary.replace(/^\[[A-Z_]+\]\s*/i, "")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] text-zinc-500 font-mono">
        <div className="flex items-center gap-1.5">
          <FileCode2 className="w-3 h-3 text-zinc-500" />
          <span>{brief.patches_applied} patches</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3 h-3 text-zinc-500" />
          <span>{brief.worker_id ? `worker-${brief.worker_id}` : "auto"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 font-bold">T</span>
          <span>{brief.token_total.toLocaleString()} tok</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-zinc-500" />
          <span>{formatDistanceToNow(new Date(brief.generated_at), { addSuffix: true })}</span>
        </div>
      </div>

      {brief.files.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-white/5">
          {brief.files.slice(0, 2).map(f => (
            <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-400 font-mono truncate max-w-[140px] border border-white/5">
              {f.split("/").pop()}
            </span>
          ))}
          {brief.files.length > 2 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/50 text-zinc-500">
              +{brief.files.length - 2}
            </span>
          )}
        </div>
      )}

      <button
        onClick={() => onSelectTask(brief.task_id)}
        className="w-full text-center text-[11px] font-medium py-1.5 rounded-md bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 hover:border-purple-500/40 transition-all"
      >
        Inspect Task →
      </button>
    </div>
  );
}
