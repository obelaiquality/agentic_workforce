"use client";

import { MainSidebar } from "@/components/layout/MainSidebar";
import { ActiveExecutionPanel } from "@/components/mission-control-v2/ActiveExecutionPanel";
import { ChangeBriefStrip } from "@/components/mission-control-v2/ChangeBriefStrip";
import { CommandDrawer } from "@/components/mission-control-v2/CommandDrawer";
import { MissionHeaderStrip } from "@/components/mission-control-v2/MissionHeaderStrip";
import { OutcomeDebriefDrawer } from "@/components/mission-control-v2/OutcomeDebriefDrawer";
import { RunTimelineRail } from "@/components/mission-control-v2/RunTimelineRail";
import { StreamProgressBoard } from "@/components/mission-control-v2/StreamProgressBoard";
import { SynthesizerPanel } from "@/components/mission-control-v2/SynthesizerPanel";
import { TaskInsightPanel } from "@/components/mission-control-v2/TaskInsightPanel";
import { useMissionControlV2Data } from "@/components/mission-control-v2/useMissionControlV2Data";

export default function MissionControlV2Page() {
  const {
    snapshot,
    timeline,
    changeBriefs,
    selectedTaskId,
    setSelectedTaskId,
    spotlight,
    liveState,
    error,
    actionMessage,
    isActing,
    isRefreshing,
    lastUpdatedAt,
    runConfig,
    setRunConfig,
    resolveModelOptions,
    guidanceCount,
    refreshAll,
    startRun,
    stopRun,
    submitAction,
    applyRecommendation,
  } = useMissionControlV2Data();

  return (
    <div className="mc2-shell min-h-screen" data-testid="mission-control-v2-page">
      <div className="flex min-h-screen">
        <MainSidebar collapsed={false} />

        <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
          <MissionHeaderStrip
            snapshot={snapshot}
            liveState={liveState}
            lastUpdatedAt={lastUpdatedAt}
            isActing={isActing}
            isRefreshing={isRefreshing}
            error={error}
            actionMessage={actionMessage}
            onRefresh={() => void refreshAll({ manual: true, force: true })}
            onStart={() => void startRun()}
            onStop={() => void stopRun()}
          />

          <div className="mt-4 grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
            <div className="min-w-0 space-y-4">
              <ChangeBriefStrip
                briefs={changeBriefs}
                onSelectTask={(taskId) => {
                  setSelectedTaskId(taskId);
                  if (typeof document !== "undefined") {
                    const insight = document.querySelector('[data-testid="mc2-task-insight"]');
                    if (insight instanceof HTMLElement) {
                      insight.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }
                }}
              />

              <RunTimelineRail runPhase={snapshot.run.phase} timeline={timeline} />

              <StreamProgressBoard
                streams={snapshot.streams}
                onSelectTask={(taskId) => {
                  setSelectedTaskId(taskId);
                  if (typeof document !== "undefined") {
                    const insight = document.querySelector('[data-testid="mc2-task-insight"]');
                    if (insight instanceof HTMLElement) {
                      insight.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }
                }}
              />

              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <ActiveExecutionPanel
                  tasks={snapshot.board["In Progress"]}
                  selectedTaskId={selectedTaskId}
                  spotlight={spotlight}
                  guidanceCount={guidanceCount}
                  isActing={isActing}
                  onSelectTask={(taskId) => setSelectedTaskId(taskId)}
                  onTaskAction={submitAction}
                />

                <SynthesizerPanel
                  synthesizer={snapshot.synthesizer}
                  isActing={isActing}
                  onApplyRecommendation={applyRecommendation}
                />
              </div>

              <TaskInsightPanel spotlight={spotlight} />

              <OutcomeDebriefDrawer runPhase={snapshot.run.phase} outcome={snapshot.outcome_brief} />
            </div>

            <div className="min-w-0 2xl:sticky 2xl:top-4 2xl:h-fit">
              <CommandDrawer
                runConfig={runConfig}
                setRunConfig={setRunConfig}
                modelOptionsResolved={resolveModelOptions}
                running={snapshot.run.running}
                isActing={isActing}
                onStart={() => void startRun()}
                onStop={() => void stopRun()}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
