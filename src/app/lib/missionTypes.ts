import type { MissionControlSnapshot } from "../../shared/contracts";

export type MissionRunPhase = MissionControlSnapshot["runPhase"];
export type MissionChangeBrief = MissionControlSnapshot["changeBriefs"][number];
export type MissionStream = MissionControlSnapshot["streams"][number];
export type MissionTaskCard = MissionControlSnapshot["tasks"][number];
export type TaskSpotlight = NonNullable<MissionControlSnapshot["spotlight"]>;
export type MissionTimelineEvent = MissionControlSnapshot["timeline"][number];
export type CodebaseFile = MissionControlSnapshot["codebaseFiles"][number];
export type ConsoleLog = MissionControlSnapshot["consoleLogs"][number];
