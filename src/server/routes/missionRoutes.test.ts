import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    ticket: {
      findMany: vi.fn(),
    },
    eventLog: {
      findMany: vi.fn(),
    },
    approvalProjection: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    repoActivationLog: {
      findMany: vi.fn(),
    },
    verificationBundle: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    runProjection: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    benchmarkOutcomeEvidence: {
      findMany: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    appSetting: {
      findUnique: vi.fn(),
    },
  },
  eventBus: {
    subscribe: vi.fn(),
  },
  resolveDependencyBootstrapCommand: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../eventBus", () => ({
  eventBus: mocks.eventBus,
}));

vi.mock("../services/executionService", async () => {
  const actual = await vi.importActual("../services/executionService");
  return {
    ...actual,
    resolveDependencyBootstrapCommand: mocks.resolveDependencyBootstrapCommand,
  };
});

import { registerMissionRoutes } from "./missionRoutes";

function createHarness() {
  const app = Fastify();

  const missionControlService = {
    getSnapshot: vi.fn(),
    getTaskDetail: vi.fn(),
  };

  const repoService = {
    getRepo: vi.fn(),
    listCodebaseTree: vi.fn(),
    readCodebaseFile: vi.fn(),
    readCodebaseDiff: vi.fn(),
    getGuidelines: vi.fn(),
    getActiveWorktreePath: vi.fn(),
  };

  const ticketService = {
    listTickets: vi.fn(),
    createTicket: vi.fn(),
    moveTicket: vi.fn(),
    moveWorkflow: vi.fn(),
    setTicketExecutionProfileOverride: vi.fn(),
    getTicketExecutionProfileOverride: vi.fn(),
    setTicketExecutionPolicy: vi.fn(),
    getTicketExecutionPolicy: vi.fn(),
  };

  const chatService = {
    createSession: vi.fn(),
    createUserMessage: vi.fn(),
  };

  const routerService = {
    planRoute: vi.fn(),
  };

  const codeGraphService = {
    buildContextPack: vi.fn(),
  };

  const contextService = {
    materializeContext: vi.fn(),
  };

  const providerOrchestrator = {
    getModelRoleBindings: vi.fn(),
  };

  const projectBlueprintService = {
    get: vi.fn(),
  };

  const executionService = {
    planExecution: vi.fn(),
    startExecution: vi.fn(),
    verifyExecution: vi.fn(),
  };

  const githubService = {
    getShareReport: vi.fn(),
  };

  const v2CommandService = {
    requestExecution: vi.fn(),
    stopExecution: vi.fn(),
    requeueTask: vi.fn(),
    transitionTask: vi.fn(),
  };

  const v2QueryService = {
    searchKnowledge: vi.fn(),
  };

  const commandEngine = {
    invoke: vi.fn(),
    listRunToolEvents: vi.fn(),
  };

  const approvalService = {
    decide: vi.fn(),
  };

  const v2EventService = {
    emit: vi.fn(),
  };

  registerMissionRoutes({
    app,
    apiToken: "local-token",
    approvalService: approvalService as never,
    chatService: chatService as never,
    codeGraphService: codeGraphService as never,
    commandEngine: commandEngine as never,
    contextService: contextService as never,
    executionService: executionService as never,
    githubService: githubService as never,
    missionControlService: missionControlService as never,
    projectBlueprintService: projectBlueprintService as never,
    providerOrchestrator: providerOrchestrator as never,
    repoService: repoService as never,
    routerService: routerService as never,
    ticketService: ticketService as never,
    v2CommandService: v2CommandService as never,
    v2EventService: v2EventService as never,
    v2QueryService: v2QueryService as never,
  });

  return {
    app,
    missionControlService,
    repoService,
    ticketService,
    chatService,
    routerService,
    codeGraphService,
    contextService,
    providerOrchestrator,
    projectBlueprintService,
    executionService,
    githubService,
    v2CommandService,
    v2QueryService,
    commandEngine,
    approvalService,
    v2EventService,
  };
}

describe("missionRoutes command bootstrap surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not expose the deprecated raw tool invoke route", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/tool.invoke",
      payload: {},
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("registers the dependency bootstrap route instead", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/dependency.bootstrap",
      payload: {},
    });

    expect(response.statusCode).not.toBe(404);

    await app.close();
  });

  it("rejects full_access writes on the public ticket permission route", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.permission",
      payload: {
        ticket_id: "ticket-1",
        mode: "full_access",
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejects full_access as an execute-time permission mode", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "Verify the build",
        permission_mode: "full_access",
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticket.findMany.mockResolvedValue([]);
    mocks.prisma.eventLog.findMany.mockResolvedValue([]);
    mocks.prisma.approvalProjection.findMany.mockResolvedValue([]);
    mocks.prisma.repoActivationLog.findMany.mockResolvedValue([]);
    mocks.prisma.verificationBundle.findMany.mockResolvedValue([]);
    mocks.prisma.runProjection.findMany.mockResolvedValue([]);
    mocks.prisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([]);
  });

  it("returns snapshot with console events for a project", async () => {
    const { app, missionControlService } = createHarness();

    missionControlService.getSnapshot.mockResolvedValue({
      timeline: [],
      workflowPillars: [],
      workflowCards: [],
      codebaseFiles: [],
      overseer: null,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/snapshot?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item).toBeDefined();
    expect(payload.item.consoleEvents).toBeDefined();
    expect(Array.isArray(payload.item.consoleEvents)).toBe(true);

    await app.close();
  });

  it("accepts optional ticketId, runId, and sessionId query params", async () => {
    const { app, missionControlService } = createHarness();

    missionControlService.getSnapshot.mockResolvedValue({
      timeline: [],
      workflowPillars: [],
      workflowCards: [],
      codebaseFiles: [],
      overseer: null,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/snapshot?ticketId=ticket-1&runId=run-1&sessionId=session-1",
    });

    expect(response.statusCode).toBe(200);
    expect(missionControlService.getSnapshot).toHaveBeenCalledWith({
      projectId: null,
      ticketId: "ticket-1",
      runId: "run-1",
      sessionId: "session-1",
    });

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns timeline items from snapshot", async () => {
    const { app, missionControlService } = createHarness();

    missionControlService.getSnapshot.mockResolvedValue({
      timeline: [
        { id: "timeline-1", type: "execution", createdAt: "2026-04-01T08:00:00.000Z" },
      ],
      workflowPillars: [],
      workflowCards: [],
      codebaseFiles: [],
      overseer: null,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/timeline?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].id).toBe("timeline-1");

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/backlog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workflow pillars and cards from snapshot", async () => {
    const { app, missionControlService } = createHarness();

    missionControlService.getSnapshot.mockResolvedValue({
      timeline: [],
      workflowPillars: [{ id: "pillar-1", title: "Backlog" }],
      workflowCards: [{ id: "card-1", title: "Task 1", status: "backlog" }],
      codebaseFiles: [],
      overseer: null,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/backlog?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.pillars).toHaveLength(1);
    expect(payload.items).toHaveLength(1);

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/task-detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns task detail for valid taskId", async () => {
    const { app, missionControlService } = createHarness();

    missionControlService.getTaskDetail.mockResolvedValue({
      id: "task-1",
      title: "Task 1",
      status: "in_progress",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/task-detail?taskId=task-1",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.id).toBe("task-1");
    expect(missionControlService.getTaskDetail).toHaveBeenCalledWith({
      projectId: null,
      taskId: "task-1",
    });

    await app.close();
  });

  it("returns error when taskId query param is missing", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/task-detail",
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/workflow.move", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("moves workflow to allowed status transition", async () => {
    const { app, ticketService } = createHarness();

    ticketService.moveWorkflow.mockResolvedValue({
      id: "ticket-1",
      status: "in_progress",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/workflow.move",
      payload: {
        workflowId: "ticket-1",
        fromStatus: "backlog",
        toStatus: "in_progress",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.moved).toBe(true);
    expect(ticketService.moveWorkflow).toHaveBeenCalledWith("ticket-1", "in_progress", null);

    await app.close();
  });

  it("rejects invalid status transitions", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/workflow.move",
      payload: {
        workflowId: "ticket-1",
        fromStatus: "backlog",
        toStatus: "completed",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });

  it("allows reordering within same status", async () => {
    const { app, ticketService } = createHarness();

    ticketService.moveWorkflow.mockResolvedValue({
      id: "ticket-1",
      status: "backlog",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/workflow.move",
      payload: {
        workflowId: "ticket-1",
        fromStatus: "backlog",
        toStatus: "backlog",
        beforeWorkflowId: "ticket-2",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.moveWorkflow).toHaveBeenCalledWith("ticket-1", "backlog", "ticket-2");

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/codebase/tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns codebase tree for valid projectId", async () => {
    const { app, repoService } = createHarness();

    repoService.listCodebaseTree.mockResolvedValue([
      { path: "src/index.ts", type: "file" },
      { path: "src/utils", type: "directory" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/codebase/tree?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items).toHaveLength(2);
    expect(repoService.listCodebaseTree).toHaveBeenCalledWith("repo-1");

    await app.close();
  });

  it("returns empty array when projectId is missing", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/codebase/tree",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items).toEqual([]);

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/codebase/file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads codebase file for valid projectId and path", async () => {
    const { app, repoService } = createHarness();

    repoService.readCodebaseFile.mockResolvedValue({
      path: "src/index.ts",
      content: "console.log('hello');",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/codebase/file?projectId=repo-1&path=src/index.ts",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.path).toBe("src/index.ts");
    expect(repoService.readCodebaseFile).toHaveBeenCalledWith("repo-1", "src/index.ts");

    await app.close();
  });

  it("returns error when path query param is missing", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/codebase/file?projectId=repo-1",
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/codebase/diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads codebase diff for valid projectId and path", async () => {
    const { app, repoService } = createHarness();

    repoService.readCodebaseDiff.mockResolvedValue({
      path: "src/index.ts",
      diff: "+console.log('hello');",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/codebase/diff?projectId=repo-1&path=src/index.ts",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.path).toBe("src/index.ts");

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/overseer/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates user message in existing session", async () => {
    const { app, chatService } = createHarness();

    chatService.createUserMessage.mockResolvedValue({
      id: "msg-1",
      content: "Hello",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/chat",
      payload: {
        actor: "user",
        session_id: "session-1",
        content: "Hello",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.sessionId).toBe("session-1");
    expect(payload.item.id).toBe("msg-1");
    expect(chatService.createSession).not.toHaveBeenCalled();

    await app.close();
  });

  it("creates new session when session_id is not provided", async () => {
    const { app, chatService } = createHarness();

    chatService.createSession.mockResolvedValue({
      id: "session-new",
      title: "Overseer Session",
    });

    chatService.createUserMessage.mockResolvedValue({
      id: "msg-1",
      content: "Hello",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/chat",
      payload: {
        actor: "user",
        project_id: "repo-1",
        content: "Hello",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.sessionId).toBe("session-new");
    expect(chatService.createSession).toHaveBeenCalledWith("Overseer Session", "repo-1");

    await app.close();
  });

  it("returns error when content is missing in request body", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/chat",
      payload: {
        actor: "user",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/ticket.permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets ticket execution policy with balanced mode", async () => {
    const { app, ticketService } = createHarness();

    ticketService.setTicketExecutionPolicy.mockResolvedValue({
      ticketId: "ticket-1",
      mode: "balanced",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.permission",
      payload: {
        ticket_id: "ticket-1",
        mode: "balanced",
        actor: "user",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.ticketId).toBe("ticket-1");
    expect(ticketService.setTicketExecutionPolicy).toHaveBeenCalledWith({
      ticketId: "ticket-1",
      mode: "balanced",
      actor: "user",
      allowInstallCommands: undefined,
      allowNetworkCommands: undefined,
      requireApprovalFor: undefined,
    });

    await app.close();
  });

  it("sets ticket execution policy with strict mode", async () => {
    const { app, ticketService } = createHarness();

    ticketService.setTicketExecutionPolicy.mockResolvedValue({
      ticketId: "ticket-1",
      mode: "strict",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.permission",
      payload: {
        ticket_id: "ticket-1",
        mode: "strict",
      },
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it("requires ticket_id and mode in request body", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.permission",
      payload: {
        ticket_id: "ticket-1",
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe("missionRoutes GET /api/v9/mission/ticket.permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gets ticket execution policy for valid ticketId", async () => {
    const { app, ticketService } = createHarness();

    ticketService.getTicketExecutionPolicy.mockResolvedValue({
      ticketId: "ticket-1",
      mode: "balanced",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v9/mission/ticket.permission?ticketId=ticket-1",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.ticketId).toBe("ticket-1");

    await app.close();
  });

  it("returns error when ticketId query param is missing", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v9/mission/ticket.permission",
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/dependency.bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes bootstrap command for valid run", async () => {
    const { app, commandEngine } = createHarness();

    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-1",
      metadata: { worktree_path: "/tmp/project" },
    });

    mocks.resolveDependencyBootstrapCommand.mockReturnValue("npm install");

    commandEngine.invoke.mockResolvedValue({
      id: "tool-1",
      exitCode: 0,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/dependency.bootstrap",
      payload: {
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        ticket_id: "ticket-1",
        stage: "build",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(commandEngine.invoke).toHaveBeenCalled();

    await app.close();
  });

  it("returns error when required fields are missing", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/dependency.bootstrap",
      payload: {
        actor: "user",
        run_id: "run-1",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes GET /api/v9/mission/run/:id/tool-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists tool events for a run", async () => {
    const { app, commandEngine } = createHarness();

    commandEngine.listRunToolEvents.mockResolvedValue([
      { id: "tool-1", toolType: "repo.verify", exitCode: 0 },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v9/mission/run/run-1/tool-events",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items).toHaveLength(1);
    expect(commandEngine.listRunToolEvents).toHaveBeenCalledWith("run-1");

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/ticket.lifecycle.reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("reconciles review tickets with failed verifications", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-1", status: "review", title: "Task 1" },
    ]);

    mocks.prisma.runProjection.findFirst.mockResolvedValue({
      runId: "run-1",
      ticketId: "ticket-1",
    });

    mocks.prisma.verificationBundle.findFirst.mockResolvedValue({
      id: "bundle-1",
      runId: "run-1",
      pass: false,
    });

    ticketService.moveTicket.mockResolvedValue({
      id: "ticket-1",
      status: "in_progress",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.lifecycle.reconcile",
      payload: {
        actor: "user",
        project_id: "repo-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.movedCount).toBe(1);
    expect(ticketService.moveTicket).toHaveBeenCalledWith("ticket-1", "in_progress");

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/ticket.autocomplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes ticket when verification passes and no pending approval", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-1", status: "review", title: "Task 1" },
    ]);

    mocks.prisma.runProjection.findFirst.mockResolvedValue({
      runId: "run-1",
      ticketId: "ticket-1",
    });

    mocks.prisma.verificationBundle.findFirst.mockResolvedValue({
      id: "bundle-1",
      runId: "run-1",
      pass: true,
    });

    mocks.prisma.approvalProjection.findFirst.mockResolvedValue(null);

    ticketService.moveTicket.mockResolvedValue({
      id: "ticket-1",
      status: "done",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.autocomplete",
      payload: {
        actor: "user",
        ticket_id: "ticket-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.completed).toBe(true);
    expect(ticketService.moveTicket).toHaveBeenCalledWith("ticket-1", "done");

    await app.close();
  });

  it("does not complete ticket when verification fails", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-1", status: "review", title: "Task 1" },
    ]);

    mocks.prisma.runProjection.findFirst.mockResolvedValue({
      runId: "run-1",
      ticketId: "ticket-1",
    });

    mocks.prisma.verificationBundle.findFirst.mockResolvedValue({
      id: "bundle-1",
      runId: "run-1",
      pass: false,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.autocomplete",
      payload: {
        ticket_id: "ticket-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.completed).toBe(false);
    expect(payload.item.reason).toBe("verification_not_passed");

    await app.close();
  });

  it("does not complete ticket when approval is pending", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-1", status: "review", title: "Task 1" },
    ]);

    mocks.prisma.runProjection.findFirst.mockResolvedValue({
      runId: "run-1",
      ticketId: "ticket-1",
    });

    mocks.prisma.verificationBundle.findFirst.mockResolvedValue({
      id: "bundle-1",
      runId: "run-1",
      pass: true,
    });

    mocks.prisma.approvalProjection.findFirst.mockResolvedValue({
      approvalId: "approval-1",
      status: "pending",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.autocomplete",
      payload: {
        ticket_id: "ticket-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.completed).toBe(false);
    expect(payload.item.reason).toBe("approval_pending");

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/actions/stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops execution for valid run_id and repo_id", async () => {
    const { app, v2CommandService } = createHarness();

    v2CommandService.stopExecution.mockResolvedValue({
      runId: "run-1",
      stopped: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/actions/stop",
      payload: {
        run_id: "run-1",
        repo_id: "repo-1",
        actor: "user",
        reason: "User requested stop",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.item.stopped).toBe(true);
    expect(v2CommandService.stopExecution).toHaveBeenCalledWith({
      run_id: "run-1",
      repo_id: "repo-1",
      actor: "user",
      reason: "User requested stop",
    });

    await app.close();
  });

  it("returns error when repo_id is missing in request body", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/actions/stop",
      payload: {
        run_id: "run-1",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/actions/task.requeue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requeues task for valid ticket_id", async () => {
    const { app, v2CommandService } = createHarness();

    v2CommandService.requeueTask.mockResolvedValue({
      ticketId: "ticket-1",
      requeued: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/actions/task.requeue",
      payload: {
        ticket_id: "ticket-1",
        actor: "user",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(v2CommandService.requeueTask).toHaveBeenCalledWith({
      ticket_id: "ticket-1",
      actor: "user",
      reason: undefined,
    });

    await app.close();
  });

  it("returns error when ticket_id is missing in request body", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/actions/task.requeue",
      payload: {},
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/actions/task.transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions task to valid status", async () => {
    const { app, v2CommandService } = createHarness();

    v2CommandService.transitionTask.mockResolvedValue({
      ticketId: "ticket-1",
      status: "active",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/actions/task.transition",
      payload: {
        ticket_id: "ticket-1",
        status: "active",
        actor: "user",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(v2CommandService.transitionTask).toHaveBeenCalledWith({
      ticket_id: "ticket-1",
      actor: "user",
      status: "active",
      risk_level: undefined,
    });

    await app.close();
  });

  it("returns error when status is missing in request body", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/actions/task.transition",
      payload: {
        ticket_id: "ticket-1",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});
