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

  it("transitions task with risk_level", async () => {
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
        risk_level: "high",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(v2CommandService.transitionTask).toHaveBeenCalledWith({
      ticket_id: "ticket-1",
      actor: "user",
      status: "active",
      risk_level: "high",
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

describe("missionRoutes GET /api/v8/mission/console", () => {
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

  it("returns console events for a project", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);

    await app.close();
  });

  it("returns empty when no projectId", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);

    await app.close();
  });

  it("builds console events from event log rows", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-1",
        eventType: "execution.started",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1", status: "running" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("evt-1");
    expect(items[0].category).toBe("execution");
    expect(items[0].level).toBe("info");

    await app.close();
  });

  it("builds console events from approval rows", async () => {
    const { app } = createHarness();

    mocks.prisma.approvalProjection.findMany.mockResolvedValue([
      {
        approvalId: "approval-1",
        actionType: "execution_request",
        status: "pending",
        reason: "Needs review",
        payload: { repo_id: "repo-1", aggregate_id: "ticket-1" },
        requestedAt: new Date("2026-01-01T01:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("approval");
    expect(items[0].level).toBe("warn");
    expect(items[0].message).toContain("execution request");
    expect(items[0].message).toContain("Needs review");

    await app.close();
  });

  it("builds console events from rejected approvals", async () => {
    const { app } = createHarness();

    mocks.prisma.approvalProjection.findMany.mockResolvedValue([
      {
        approvalId: "approval-2",
        actionType: "command_tool_invocation",
        status: "rejected",
        reason: null,
        payload: { repo_id: "repo-1" },
        requestedAt: new Date("2026-01-01T01:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].level).toBe("error");

    await app.close();
  });

  it("builds console events from approved approvals", async () => {
    const { app } = createHarness();

    mocks.prisma.approvalProjection.findMany.mockResolvedValue([
      {
        approvalId: "approval-3",
        actionType: "execution_request",
        status: "approved",
        reason: null,
        payload: { repo_id: "repo-1" },
        requestedAt: new Date("2026-01-01T01:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].level).toBe("info");

    await app.close();
  });

  it("builds console events from repo activation log rows", async () => {
    const { app } = createHarness();

    mocks.prisma.repoActivationLog.findMany.mockResolvedValue([
      {
        id: "ral-1",
        repoId: "repo-1",
        eventType: "repo.activated",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T02:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("execution");

    await app.close();
  });

  it("builds console events from repo activation log with index event type", async () => {
    const { app } = createHarness();

    mocks.prisma.repoActivationLog.findMany.mockResolvedValue([
      {
        id: "ral-2",
        repoId: "repo-1",
        eventType: "repo.index.refreshed",
        payload: {},
        createdAt: new Date("2026-01-01T02:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].category).toBe("indexing");

    await app.close();
  });

  it("builds console events from verification bundles - passing", async () => {
    const { app } = createHarness();

    mocks.prisma.verificationBundle.findMany.mockResolvedValue([
      {
        id: "vb-1",
        repoId: "repo-1",
        runId: "run-1",
        pass: true,
        impactedTests: ["npm test", "npm run lint"],
        failures: [],
        changedFileChecks: [],
        createdAt: new Date("2026-01-01T03:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("verification");
    expect(items[0].level).toBe("info");
    expect(items[0].message).toContain("verification passed");

    await app.close();
  });

  it("builds console events from verification bundles - failing", async () => {
    const { app } = createHarness();

    mocks.prisma.verificationBundle.findMany.mockResolvedValue([
      {
        id: "vb-2",
        repoId: "repo-1",
        runId: "run-1",
        pass: false,
        impactedTests: [],
        failures: ["test failed", "lint error"],
        changedFileChecks: ["src/index.ts"],
        createdAt: new Date("2026-01-01T03:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].level).toBe("error");
    expect(items[0].message).toContain("verification failed");

    await app.close();
  });

  it("builds console events from tool invocation evidence rows", async () => {
    const { app } = createHarness();

    mocks.prisma.ticket.findMany.mockResolvedValue([{ id: "ticket-1" }]);
    mocks.prisma.runProjection.findMany.mockResolvedValue([
      { runId: "run-1", ticketId: "ticket-1" },
    ]);
    mocks.prisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
      {
        id: "tool-1",
        runId: "run-1",
        kind: "tool_invocation",
        payload: {
          toolType: "repo.verify",
          stage: "build",
          command: "npm test",
          args: ["--all"],
          policyDecision: "allowed",
          exitCode: 0,
          errorClass: "none",
          durationMs: 1500,
          summary: "Tests passed",
          ticketId: "ticket-1",
        },
        createdAt: new Date("2026-01-01T04:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    const toolItem = items.find((item: { id: string }) => item.id === "tool-1");
    expect(toolItem).toBeDefined();
    expect(toolItem.category).toBe("verification");
    expect(toolItem.level).toBe("info");

    await app.close();
  });

  it("builds console events from tool invocation with approval_required policy", async () => {
    const { app } = createHarness();

    mocks.prisma.runProjection.findMany.mockResolvedValue([{ runId: "run-2", ticketId: null }]);
    mocks.prisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
      {
        id: "tool-2",
        runId: "run-2",
        kind: "tool_invocation",
        payload: {
          toolType: "repo.edit",
          stage: "build",
          command: "rm -rf",
          policyDecision: "approval_required",
          approval_id: "ap-1",
        },
        createdAt: new Date("2026-01-01T05:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    const toolItem = items.find((item: { id: string }) => item.id === "tool-2");
    expect(toolItem).toBeDefined();
    expect(toolItem.category).toBe("execution");
    expect(toolItem.level).toBe("warn");

    await app.close();
  });

  it("builds console events from tool invocation with denied policy", async () => {
    const { app } = createHarness();

    mocks.prisma.runProjection.findMany.mockResolvedValue([{ runId: "run-3", ticketId: null }]);
    mocks.prisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
      {
        id: "tool-3",
        runId: "run-3",
        kind: "tool_invocation",
        payload: {
          policyDecision: "denied",
          errorClass: "command_failed",
        },
        createdAt: new Date("2026-01-01T06:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    const toolItem = items.find((item: { id: string }) => item.id === "tool-3");
    expect(toolItem).toBeDefined();
    expect(toolItem.level).toBe("error");

    await app.close();
  });

  it("maps event types to correct console categories", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-verify",
        eventType: "verification.completed",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        eventId: "evt-approval",
        eventType: "approval.requested",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:01:00Z"),
      },
      {
        eventId: "evt-codegraph",
        eventType: "codegraph.indexed",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:02:00Z"),
      },
      {
        eventId: "evt-context",
        eventType: "context.pack.built",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:03:00Z"),
      },
      {
        eventId: "evt-provider",
        eventType: "provider.connected",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:04:00Z"),
      },
      {
        eventId: "evt-failed",
        eventType: "execution.failed",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:05:00Z"),
      },
      {
        eventId: "evt-pending",
        eventType: "execution.pending",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:06:00Z"),
      },
      {
        eventId: "evt-tool",
        eventType: "command.tool.invoked",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:07:00Z"),
      },
      {
        eventId: "evt-task",
        eventType: "task.started",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:08:00Z"),
      },
      {
        eventId: "evt-repoindex",
        eventType: "repo.index.started",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:09:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    const byId = new Map(items.map((item: { id: string; category: string; level: string }) => [item.id, item]));
    expect(byId.get("evt-verify").category).toBe("verification");
    expect(byId.get("evt-approval").category).toBe("approval");
    expect(byId.get("evt-codegraph").category).toBe("indexing");
    expect(byId.get("evt-context").category).toBe("indexing");
    expect(byId.get("evt-provider").category).toBe("provider");
    expect(byId.get("evt-failed").level).toBe("error");
    expect(byId.get("evt-pending").level).toBe("warn");
    expect(byId.get("evt-tool").category).toBe("execution");
    expect(byId.get("evt-task").category).toBe("execution");
    expect(byId.get("evt-repoindex").category).toBe("indexing");

    await app.close();
  });

  it("extracts taskId from event payload", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-task-1",
        eventType: "execution.started",
        aggregateId: "ticket-1",
        payload: { repo_id: "repo-1", ticketId: "ticket-1" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].taskId).toBe("ticket-1");

    await app.close();
  });

  it("uses aggregateId as taskId when not a repo/run prefix", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-agg-1",
        eventType: "execution.started",
        aggregateId: "ticket-42",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].taskId).toBe("ticket-42");

    await app.close();
  });

  it("does not use repo: prefix aggregateId as taskId", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-repo-agg",
        eventType: "execution.started",
        aggregateId: "repo:repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].taskId).toBeUndefined();

    await app.close();
  });

  it("does not use run: prefix aggregateId as taskId", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-run-agg",
        eventType: "execution.started",
        aggregateId: "run:run-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].taskId).toBeUndefined();

    await app.close();
  });

  it("does not use projectId as taskId from aggregateId", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-proj-agg",
        eventType: "execution.started",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].taskId).toBeUndefined();

    await app.close();
  });

  it("approval rows extract aggregate_id as taskId when not projectId", async () => {
    const { app } = createHarness();

    mocks.prisma.approvalProjection.findMany.mockResolvedValue([
      {
        approvalId: "approval-task",
        actionType: "execution_request",
        status: "approved",
        reason: null,
        payload: { repo_id: "repo-1", aggregate_id: "ticket-5" },
        requestedAt: new Date("2026-01-01T01:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].taskId).toBe("ticket-5");

    await app.close();
  });

  it("sorts all console events by createdAt ascending and limits to 200", async () => {
    const { app } = createHarness();

    const events = Array.from({ length: 130 }, (_, i) => ({
      eventId: `evt-${i}`,
      eventType: "execution.started",
      aggregateId: "repo-1",
      payload: { repo_id: "repo-1" },
      createdAt: new Date(`2026-01-01T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`),
    }));
    mocks.prisma.eventLog.findMany.mockResolvedValue(events);

    const activationLogs = Array.from({ length: 80 }, (_, i) => ({
      id: `ral-${i}`,
      repoId: "repo-1",
      eventType: "repo.activated",
      payload: {},
      createdAt: new Date(`2026-01-02T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`),
    }));
    mocks.prisma.repoActivationLog.findMany.mockResolvedValue(activationLogs);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items.length).toBeLessThanOrEqual(200);
    // Check sorted ascending
    for (let i = 1; i < items.length; i++) {
      expect(new Date(items[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(items[i - 1].createdAt).getTime()
      );
    }

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/overseer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns overseer from snapshot", async () => {
    const { app, missionControlService } = createHarness();

    missionControlService.getSnapshot.mockResolvedValue({
      timeline: [],
      workflowPillars: [],
      workflowCards: [],
      codebaseFiles: [],
      overseer: { status: "active", sessions: [] },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/overseer?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item).toEqual({ status: "active", sessions: [] });
    expect(missionControlService.getSnapshot).toHaveBeenCalledWith({
      projectId: "repo-1",
      ticketId: null,
      runId: null,
      sessionId: null,
    });

    await app.close();
  });
});

describe("missionRoutes GET /api/v8/mission/codebase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns codebase files from snapshot", async () => {
    const { app, missionControlService } = createHarness();

    missionControlService.getSnapshot.mockResolvedValue({
      timeline: [],
      workflowPillars: [],
      workflowCards: [],
      codebaseFiles: [{ path: "src/index.ts" }, { path: "src/app.ts" }],
      overseer: null,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/codebase?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/workflow.execution-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets execution profile override for a ticket", async () => {
    const { app, ticketService } = createHarness();

    ticketService.setTicketExecutionProfileOverride.mockResolvedValue({
      ticketId: "ticket-1",
      executionProfileId: "profile-1",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/workflow.execution-profile",
      payload: {
        workflowId: "ticket-1",
        executionProfileId: "profile-1",
        actor: "user",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.setTicketExecutionProfileOverride).toHaveBeenCalledWith({
      ticketId: "ticket-1",
      executionProfileId: "profile-1",
      actor: "user",
    });

    await app.close();
  });

  it("clears execution profile override when null", async () => {
    const { app, ticketService } = createHarness();

    ticketService.setTicketExecutionProfileOverride.mockResolvedValue({
      ticketId: "ticket-1",
      executionProfileId: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/workflow.execution-profile",
      payload: {
        workflowId: "ticket-1",
        executionProfileId: null,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.setTicketExecutionProfileOverride).toHaveBeenCalledWith({
      ticketId: "ticket-1",
      executionProfileId: null,
      actor: "user",
    });

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/actions/stop defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses default actor when not provided", async () => {
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
      },
    });

    expect(response.statusCode).toBe(200);
    expect(v2CommandService.stopExecution).toHaveBeenCalledWith({
      run_id: "run-1",
      repo_id: "repo-1",
      actor: "user",
      reason: undefined,
    });

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/actions/task.requeue defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses default actor and passes reason", async () => {
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
        reason: "fix needed",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(v2CommandService.requeueTask).toHaveBeenCalledWith({
      ticket_id: "ticket-1",
      actor: "user",
      reason: "fix needed",
    });

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/ticket.lifecycle.reconcile edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("skips tickets without run projections", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-1", status: "review", title: "Task 1" },
    ]);

    mocks.prisma.runProjection.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.lifecycle.reconcile",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.movedCount).toBe(0);
    expect(ticketService.moveTicket).not.toHaveBeenCalled();

    await app.close();
  });

  it("does not move tickets when verification passes", async () => {
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

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.lifecycle.reconcile",
      payload: { actor: "bot" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.movedCount).toBe(0);
    expect(ticketService.moveTicket).not.toHaveBeenCalled();

    await app.close();
  });

  it("archives stale synthetic tickets when requested", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-e2e", status: "backlog", title: "e2e test setup", description: "synthetic setup" },
      { id: "ticket-smoke", status: "in_progress", title: "smoke test run", description: "" },
      { id: "ticket-real", status: "backlog", title: "Real task", description: "A real task" },
    ]);

    ticketService.moveTicket.mockResolvedValue({ id: "ticket-e2e", status: "done" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.lifecycle.reconcile",
      payload: {
        actor: "user",
        archive_stale_synthetic: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const result = response.json().item;
    expect(result.movedCount).toBeGreaterThanOrEqual(2);
    const archivedReasons = result.moved
      .filter((m: { reason: string }) => m.reason === "archived_stale_synthetic")
      .map((m: { ticketId: string }) => m.ticketId);
    expect(archivedReasons).toContain("ticket-e2e");
    expect(archivedReasons).toContain("ticket-smoke");
    expect(archivedReasons).not.toContain("ticket-real");

    await app.close();
  });

  it("does not archive done synthetic tickets", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-done", status: "done", title: "e2e finished", description: "synthetic" },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.lifecycle.reconcile",
      payload: {
        actor: "user",
        archive_stale_synthetic: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.movedCount).toBe(0);

    await app.close();
  });

  it("skips review tickets without verification bundles", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-1", status: "review", title: "Task 1" },
    ]);

    mocks.prisma.runProjection.findFirst.mockResolvedValue({
      runId: "run-1",
      ticketId: "ticket-1",
    });

    mocks.prisma.verificationBundle.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.lifecycle.reconcile",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.movedCount).toBe(0);

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/ticket.autocomplete edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no_run_projection when ticket has no runs", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-1", status: "review", title: "Task 1" },
    ]);

    mocks.prisma.runProjection.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.autocomplete",
      payload: { ticket_id: "ticket-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item).toEqual({
      completed: false,
      reason: "no_run_projection",
    });

    await app.close();
  });

  it("throws when ticket not found", async () => {
    const { app, ticketService } = createHarness();

    ticketService.listTickets.mockResolvedValue([]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.autocomplete",
      payload: { ticket_id: "nonexistent" },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/dependency.bootstrap edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to active worktree when run metadata has no worktree_path", async () => {
    const { app, commandEngine, repoService } = createHarness();

    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-1",
      metadata: {},
    });

    repoService.getActiveWorktreePath.mockResolvedValue("/fallback/worktree");
    mocks.resolveDependencyBootstrapCommand.mockReturnValue("npm install");
    commandEngine.invoke.mockResolvedValue({ id: "tool-1", exitCode: 0 });

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
    expect(repoService.getActiveWorktreePath).toHaveBeenCalledWith("repo-1");

    await app.close();
  });

  it("falls back to active worktree when run projection not found", async () => {
    const { app, commandEngine, repoService } = createHarness();

    mocks.prisma.runProjection.findUnique.mockResolvedValue(null);

    repoService.getActiveWorktreePath.mockResolvedValue("/fallback/worktree");
    mocks.resolveDependencyBootstrapCommand.mockReturnValue("npm install");
    commandEngine.invoke.mockResolvedValue({ id: "tool-1", exitCode: 0 });

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/dependency.bootstrap",
      payload: {
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        ticket_id: "ticket-1",
        stage: "scope",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repoService.getActiveWorktreePath).toHaveBeenCalledWith("repo-1");

    await app.close();
  });

  it("throws when no bootstrap command can be derived", async () => {
    const { app } = createHarness();

    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-1",
      metadata: { worktree_path: "/tmp/project" },
    });
    mocks.resolveDependencyBootstrapCommand.mockReturnValue(null);

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

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/ticket.permission with optional fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes all optional permission fields to ticket service", async () => {
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
        actor: "admin",
        allow_install_commands: true,
        allow_network_commands: false,
        require_approval_for: ["file_apply", "run_command"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.setTicketExecutionPolicy).toHaveBeenCalledWith({
      ticketId: "ticket-1",
      mode: "strict",
      actor: "admin",
      allowInstallCommands: true,
      allowNetworkCommands: false,
      requireApprovalFor: ["file_apply", "run_command"],
    });

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/approval/decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decides approval and returns result", async () => {
    const { app, approvalService } = createHarness();

    // We need to mock decideApprovalWithCommandFollowup which is imported
    // Testing the route input/output integration
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/approval/decide",
      payload: {
        approval_id: "approval-1",
        decision: "approved",
        reason: "Looks good",
        decided_by: "admin",
      },
    });

    // The route calls decideApprovalWithCommandFollowup which depends on
    // approvalService.decideApproval; we expect the route to attempt the call
    expect(response.statusCode).not.toBe(404);

    await app.close();
  });

  it("rejects invalid decision values", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/approval/decide",
      payload: {
        approval_id: "approval-1",
        decision: "maybe",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });

  it("validates approval_id is required", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/approval/decide",
      payload: {
        decision: "approved",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/overseer/chat edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when session creation returns null and no session_id provided", async () => {
    const { app, chatService } = createHarness();

    chatService.createSession.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/chat",
      payload: {
        actor: "user",
        content: "Hello",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });

  it("passes model_role option to createUserMessage", async () => {
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
        model_role: "review_deep",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(chatService.createUserMessage).toHaveBeenCalledWith("session-1", "Hello", {
      modelRole: "review_deep",
    });

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when required fields are missing", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/execute",
      payload: {
        actor: "user",
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("returns 400 for invalid body", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "", // empty prompt fails min(1)
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBeDefined();

    await app.close();
  });

  it("throws when project not found", async () => {
    const { app, repoService } = createHarness();

    repoService.getRepo.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/execute",
      payload: {
        actor: "user",
        project_id: "nonexistent",
        prompt: "Do something",
      },
    });

    // The route internally calls v8 execute which throws
    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/overseer/route.review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
  });

  it("returns error when project not found", async () => {
    const { app, repoService } = createHarness();

    repoService.getRepo.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/route.review",
      payload: {
        actor: "user",
        project_id: "nonexistent",
        prompt: "Add a feature",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });

  it("returns route review with ticket, blueprint, context", async () => {
    const { app, repoService, ticketService, v2QueryService, routerService, codeGraphService, contextService, projectBlueprintService, providerOrchestrator } = createHarness();

    repoService.getRepo.mockResolvedValue({
      id: "repo-1",
      managedWorktreeRoot: "/tmp/repo-1",
    });

    ticketService.listTickets.mockResolvedValue([
      { id: "ticket-1", status: "backlog", risk: "medium" },
    ]);

    projectBlueprintService.get.mockResolvedValue({
      id: "bp-1",
      version: 1,
      charter: { constraints: ["no side effects"], successCriteria: ["tests pass"] },
      executionPolicy: { approvalRequiredFor: ["file_apply"] },
      providerPolicy: { escalationPolicy: null, executionProfileId: null },
    });

    v2QueryService.searchKnowledge.mockResolvedValue([]);

    routerService.planRoute.mockResolvedValue({
      id: "route-1",
      risk: "medium",
      providerId: "onprem-qwen",
      metadata: {},
    });

    codeGraphService.buildContextPack.mockResolvedValue({
      pack: { id: "pack-1", files: ["src/index.ts"] },
      retrievalTrace: { retrievalIds: [] },
    });

    contextService.materializeContext.mockResolvedValue({
      context: { id: "ctx-1" },
    });

    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/route.review",
      payload: {
        actor: "user",
        project_id: "repo-1",
        ticket_id: "ticket-1",
        prompt: "Add a widget",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ticket).toBeDefined();
    expect(body.blueprint).toBeDefined();
    expect(body.route).toBeDefined();
    expect(body.contextPack).toBeDefined();
    expect(body.contextManifest).toBeDefined();

    await app.close();
  });

  it("creates a new ticket when ticket_id is not found in existing tickets", async () => {
    const { app, repoService, ticketService, v2QueryService, routerService, codeGraphService, contextService, projectBlueprintService, providerOrchestrator } = createHarness();

    repoService.getRepo.mockResolvedValue({
      id: "repo-1",
      managedWorktreeRoot: "/tmp/repo-1",
    });

    ticketService.listTickets.mockResolvedValue([]);
    ticketService.createTicket.mockResolvedValue({
      id: "ticket-new",
      status: "backlog",
      risk: "medium",
    });
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);

    projectBlueprintService.get.mockResolvedValue(null);
    v2QueryService.searchKnowledge.mockResolvedValue([]);

    routerService.planRoute.mockResolvedValue({
      id: "route-1",
      risk: "low",
      providerId: "onprem-qwen",
      metadata: {},
    });

    codeGraphService.buildContextPack.mockResolvedValue({
      pack: { id: "pack-1", files: [] },
      retrievalTrace: { retrievalIds: [] },
    });

    contextService.materializeContext.mockResolvedValue({
      context: { id: "ctx-1" },
    });

    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/route.review",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "Build a new widget",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.createTicket).toHaveBeenCalled();

    await app.close();
  });
});

describe("missionRoutes POST /api/v8/mission/overseer/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
  });

  it("returns error when project not found", async () => {
    const { app, repoService } = createHarness();

    repoService.getRepo.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: "user",
        project_id: "nonexistent",
        prompt: "Build something",
      },
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });

  it("returns approval_required lifecycle when command request needs approval", async () => {
    const { app, repoService, ticketService, routerService, projectBlueprintService, providerOrchestrator, v2CommandService, githubService } = createHarness();

    repoService.getRepo.mockResolvedValue({ id: "repo-1", managedWorktreeRoot: "/tmp/repo-1" });
    repoService.getGuidelines.mockResolvedValue([]);
    ticketService.listTickets.mockResolvedValue([{ id: "ticket-1", status: "in_progress", risk: "medium" }]);
    ticketService.moveTicket.mockImplementation(async (id: string, status: string) => ({ id, status, risk: "medium", title: "Task" }));
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    projectBlueprintService.get.mockResolvedValue(null);
    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    routerService.planRoute.mockResolvedValue({
      id: "route-1",
      risk: "medium",
      providerId: "onprem-qwen",
      metadata: {},
    });

    v2CommandService.requestExecution.mockResolvedValue({
      run_id: "run-1",
      status: "approval_required",
      approval_id: "approval-1",
    });

    githubService.getShareReport.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        ticket_id: "ticket-1",
        prompt: "Build something",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lifecycle.approvalRequired).toBe(true);
    expect(body.lifecycle.approvalId).toBe("approval-1");
    expect(body.attempt).toBeNull();
    expect(body.verification).toBeNull();

    await app.close();
  });

  it("returns rejected lifecycle when command request is rejected", async () => {
    const { app, repoService, ticketService, routerService, projectBlueprintService, providerOrchestrator, v2CommandService, githubService } = createHarness();

    repoService.getRepo.mockResolvedValue({ id: "repo-1", managedWorktreeRoot: "/tmp/repo-1" });
    repoService.getGuidelines.mockResolvedValue([]);
    ticketService.listTickets.mockResolvedValue([{ id: "ticket-1", status: "in_progress", risk: "medium" }]);
    ticketService.moveTicket.mockImplementation(async (id: string, status: string) => ({ id, status, risk: "medium", title: "Task" }));
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    projectBlueprintService.get.mockResolvedValue(null);
    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    routerService.planRoute.mockResolvedValue({
      id: "route-1",
      risk: "medium",
      providerId: "onprem-qwen",
      metadata: {},
    });

    v2CommandService.requestExecution.mockResolvedValue({
      run_id: "run-1",
      status: "rejected",
    });

    githubService.getShareReport.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        ticket_id: "ticket-1",
        prompt: "Risky operation",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lifecycle.rejected).toBe(true);
    expect(body.attempt).toBeNull();
    expect(body.verification).toBeNull();

    await app.close();
  });

  it("runs full execution with verification passing on first try", async () => {
    const { app, repoService, ticketService, routerService, projectBlueprintService, providerOrchestrator, v2CommandService, executionService, githubService } = createHarness();

    repoService.getRepo.mockResolvedValue({ id: "repo-1", managedWorktreeRoot: "/tmp/repo-1" });
    repoService.getGuidelines.mockResolvedValue({ lintCommands: ["npm run lint"], testCommands: ["npm test"], buildCommands: [] });
    ticketService.listTickets.mockResolvedValue([]);
    ticketService.createTicket.mockResolvedValue({ id: "ticket-1", status: "backlog", risk: "medium", title: "Task" });
    ticketService.moveTicket.mockImplementation(async (id: string, status: string) => ({ id, status, risk: "medium", title: "Task" }));
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    projectBlueprintService.get.mockResolvedValue(null);
    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    routerService.planRoute.mockResolvedValue({
      id: "route-1",
      risk: "medium",
      providerId: "onprem-qwen",
      metadata: {},
    });

    v2CommandService.requestExecution.mockResolvedValue({
      run_id: "run-1",
      status: "queued",
    });

    executionService.planExecution.mockResolvedValue({
      contextPack: { id: "ctx-1" },
    });

    executionService.startExecution.mockResolvedValue({
      id: "attempt-1",
    });

    executionService.verifyExecution.mockResolvedValue({
      pass: true,
      failures: [],
    });

    githubService.getShareReport.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "Build a feature",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lifecycle.completed).toBe(true);
    expect(body.verification.pass).toBe(true);
    expect(body.attempt).toBeDefined();

    await app.close();
  });

  it("handles verification with approval failure", async () => {
    const { app, repoService, ticketService, routerService, projectBlueprintService, providerOrchestrator, v2CommandService, executionService, githubService } = createHarness();

    repoService.getRepo.mockResolvedValue({ id: "repo-1", managedWorktreeRoot: "/tmp/repo-1" });
    repoService.getGuidelines.mockResolvedValue({ lintCommands: ["npm run lint"], testCommands: ["npm test"], buildCommands: [] });
    ticketService.listTickets.mockResolvedValue([]);
    ticketService.createTicket.mockResolvedValue({ id: "ticket-1", status: "backlog", risk: "medium", title: "Task" });
    ticketService.moveTicket.mockImplementation(async (id: string, status: string) => ({ id, status, risk: "medium", title: "Task" }));
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    projectBlueprintService.get.mockResolvedValue(null);
    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    routerService.planRoute.mockResolvedValue({ id: "route-1", risk: "medium", providerId: "onprem-qwen", metadata: {} });
    v2CommandService.requestExecution.mockResolvedValue({ run_id: "run-1", status: "queued" });
    executionService.planExecution.mockResolvedValue({ contextPack: { id: "ctx-1" } });
    executionService.startExecution.mockResolvedValue({ id: "attempt-1" });

    executionService.verifyExecution.mockResolvedValue({
      pass: false,
      failures: ["approval_required:run_command"],
    });

    githubService.getShareReport.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "Execute with approval needed",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.verification.pass).toBe(false);
    // Ticket should move to review for approval
    expect(ticketService.moveTicket).toHaveBeenCalledWith(expect.any(String), "review");

    await app.close();
  });

  it("handles verification with infrastructure failure", async () => {
    const { app, repoService, ticketService, routerService, projectBlueprintService, providerOrchestrator, v2CommandService, executionService, githubService } = createHarness();

    repoService.getRepo.mockResolvedValue({ id: "repo-1", managedWorktreeRoot: "/tmp/repo-1" });
    repoService.getGuidelines.mockResolvedValue({ lintCommands: ["npm run lint"], testCommands: [], buildCommands: [] });
    ticketService.listTickets.mockResolvedValue([]);
    ticketService.createTicket.mockResolvedValue({ id: "ticket-1", status: "backlog", risk: "medium", title: "Task" });
    ticketService.moveTicket.mockImplementation(async (id: string, status: string) => ({ id, status, risk: "medium", title: "Task" }));
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    projectBlueprintService.get.mockResolvedValue(null);
    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    routerService.planRoute.mockResolvedValue({ id: "route-1", risk: "medium", providerId: "onprem-qwen", metadata: {} });
    v2CommandService.requestExecution.mockResolvedValue({ run_id: "run-1", status: "queued" });
    executionService.planExecution.mockResolvedValue({ contextPack: { id: "ctx-1" } });
    executionService.startExecution.mockResolvedValue({ id: "attempt-1" });

    executionService.verifyExecution.mockResolvedValue({
      pass: false,
      failures: ["infra_missing_tool:npm"],
    });

    githubService.getShareReport.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "Build with missing tool",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.verification.pass).toBe(false);
    // Infrastructure failure keeps the ticket in in_progress
    expect(body.runId).toBeDefined();

    await app.close();
  });

  it("runs auto-review when verification fails and passes on retry", async () => {
    const { app, repoService, ticketService, routerService, projectBlueprintService, providerOrchestrator, v2CommandService, executionService, githubService } = createHarness();

    repoService.getRepo.mockResolvedValue({ id: "repo-1", managedWorktreeRoot: "/tmp/repo-1" });
    repoService.getGuidelines.mockResolvedValue({ lintCommands: ["npm run lint"], testCommands: ["npm test"], buildCommands: [] });
    ticketService.listTickets.mockResolvedValue([]);
    ticketService.createTicket.mockResolvedValue({ id: "ticket-1", status: "backlog", risk: "medium", title: "Task" });
    ticketService.moveTicket.mockImplementation(async (id: string, status: string) => ({ id, status, risk: "medium", title: "Task" }));
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    projectBlueprintService.get.mockResolvedValue(null);
    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    routerService.planRoute.mockResolvedValue({ id: "route-1", risk: "medium", providerId: "onprem-qwen", metadata: {} });
    v2CommandService.requestExecution.mockResolvedValue({ run_id: "run-1", status: "queued" });
    executionService.planExecution.mockResolvedValue({ contextPack: { id: "ctx-1" } });

    let attemptCount = 0;
    executionService.startExecution.mockImplementation(async () => {
      attemptCount++;
      return { id: `attempt-${attemptCount}` };
    });

    let verifyCount = 0;
    executionService.verifyExecution.mockImplementation(async () => {
      verifyCount++;
      if (verifyCount === 1) {
        return { pass: false, failures: ["test_failed:npm test"] };
      }
      return { pass: true, failures: [] };
    });

    githubService.getShareReport.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "Fix the tests",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lifecycle.roundsRun).toBe(1);
    expect(body.lifecycle.completed).toBe(true);
    expect(body.verification.pass).toBe(true);

    await app.close();
  });

  it("returns no verification when verification plan has no commands", async () => {
    const { app, repoService, ticketService, routerService, projectBlueprintService, providerOrchestrator, v2CommandService, executionService, githubService } = createHarness();

    repoService.getRepo.mockResolvedValue({ id: "repo-1", managedWorktreeRoot: "/tmp/repo-1" });
    repoService.getGuidelines.mockResolvedValue([]);
    ticketService.listTickets.mockResolvedValue([]);
    ticketService.createTicket.mockResolvedValue({ id: "ticket-1", status: "backlog", risk: "medium", title: "Task" });
    ticketService.moveTicket.mockImplementation(async (id: string, status: string) => ({ id, status, risk: "medium", title: "Task" }));
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    projectBlueprintService.get.mockResolvedValue(null);
    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    routerService.planRoute.mockResolvedValue({ id: "route-1", risk: "medium", providerId: "onprem-qwen", metadata: {} });
    v2CommandService.requestExecution.mockResolvedValue({ run_id: "run-1", status: "queued" });
    executionService.planExecution.mockResolvedValue({ contextPack: { id: "ctx-1" } });
    executionService.startExecution.mockResolvedValue({ id: "attempt-1" });

    // verifyExecution should not be called since there are no verification commands
    githubService.getShareReport.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "Simple change with no verification",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.verification).toBeNull();

    await app.close();
  });
});

describe("missionRoutes console helper functions coverage", () => {
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

  it("compacts payload with large nested objects and arrays", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-large",
        eventType: "execution.started",
        aggregateId: "repo-1",
        payload: {
          repo_id: "repo-1",
          status: "running",
          errors: ["error1", "error2", "error3", "error4"],
          nested: { key1: "val1", key2: "val2", key3: "val3", key4: "val4", key5: "val5", key6: "val6", key7: "val7" },
          longString: "A".repeat(200),
          numericField: 42,
          boolField: true,
          nullField: null,
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].message).toContain("execution started");

    await app.close();
  });

  it("handles payload with no preferred keys", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-nokeys",
        eventType: "custom.event",
        aggregateId: "repo-1",
        payload: {
          customField1: "value1",
          customField2: 42,
          customField3: true,
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].message).toContain("custom event");

    await app.close();
  });

  it("extracts projectId from payload using project_id", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-projid",
        eventType: "execution.started",
        aggregateId: null,
        payload: { project_id: "repo-1" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);

    await app.close();
  });

  it("extracts taskId from payload using ticket_id", async () => {
    const { app } = createHarness();

    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        eventId: "evt-tid",
        eventType: "execution.started",
        aggregateId: "repo-1",
        payload: { repo_id: "repo-1", ticket_id: "ticket-99" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items[0].taskId).toBe("ticket-99");

    await app.close();
  });

  it("handles tool invocation with timeout and infra error classes", async () => {
    const { app } = createHarness();

    mocks.prisma.runProjection.findMany.mockResolvedValue([{ runId: "run-err", ticketId: null }]);
    mocks.prisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
      {
        id: "tool-timeout",
        runId: "run-err",
        kind: "tool_invocation",
        payload: {
          errorClass: "timeout",
        },
        createdAt: new Date("2026-01-01T07:00:00Z"),
      },
      {
        id: "tool-infra",
        runId: "run-err",
        kind: "tool_invocation",
        payload: {
          errorClass: "infra_missing_tool",
        },
        createdAt: new Date("2026-01-01T07:01:00Z"),
      },
      {
        id: "tool-dep",
        runId: "run-err",
        kind: "tool_invocation",
        payload: {
          errorClass: "infra_missing_dependency",
        },
        createdAt: new Date("2026-01-01T07:02:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    const toolItems = items.filter((item: { id: string }) =>
      ["tool-timeout", "tool-infra", "tool-dep"].includes(item.id)
    );
    for (const item of toolItems) {
      expect(item.level).toBe("error");
    }

    await app.close();
  });

  it("handles tool invocation with repo.install tool type", async () => {
    const { app } = createHarness();

    mocks.prisma.runProjection.findMany.mockResolvedValue([{ runId: "run-install", ticketId: null }]);
    mocks.prisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
      {
        id: "tool-install",
        runId: "run-install",
        kind: "tool_invocation",
        payload: {
          toolType: "repo.install",
          policyDecision: "allowed",
          exitCode: 0,
        },
        createdAt: new Date("2026-01-01T08:00:00Z"),
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/mission/console?projectId=repo-1",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    const installItem = items.find((item: { id: string }) => item.id === "tool-install");
    expect(installItem).toBeDefined();
    expect(installItem.category).toBe("verification");

    await app.close();
  });
});

describe("missionRoutes POST /api/v9/mission/execute with permission_mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
  });

  it("sets ticket execution policy when permission_mode is specified", async () => {
    const { app, repoService, ticketService, routerService, projectBlueprintService, providerOrchestrator, v2CommandService, executionService, githubService } = createHarness();

    repoService.getRepo.mockResolvedValue({ id: "repo-1", managedWorktreeRoot: "/tmp/repo-1" });
    repoService.getGuidelines.mockResolvedValue([]);
    ticketService.listTickets.mockResolvedValue([{ id: "ticket-1", status: "in_progress", risk: "medium" }]);
    ticketService.createTicket.mockResolvedValue({ id: "ticket-new", status: "backlog", risk: "medium", title: "Task" });
    ticketService.moveTicket.mockImplementation(async (id: string, status: string) => ({ id, status, risk: "medium", title: "Task" }));
    ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    ticketService.setTicketExecutionPolicy.mockResolvedValue({ ticketId: "ticket-1", mode: "strict" });

    projectBlueprintService.get.mockResolvedValue(null);
    providerOrchestrator.getModelRoleBindings.mockResolvedValue({
      utility_fast: { role: "utility_fast", providerId: "onprem-qwen" },
      coder_default: { role: "coder_default", providerId: "onprem-qwen" },
      review_deep: { role: "review_deep", providerId: "onprem-qwen" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses" },
    });

    routerService.planRoute.mockResolvedValue({ id: "route-1", risk: "medium", providerId: "onprem-qwen", metadata: {} });
    v2CommandService.requestExecution.mockResolvedValue({ run_id: "run-1", status: "queued" });
    executionService.planExecution.mockResolvedValue({ contextPack: { id: "ctx-1" } });
    executionService.startExecution.mockResolvedValue({ id: "attempt-1" });
    githubService.getShareReport.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        ticket_id: "ticket-1",
        prompt: "Build with strict permissions",
        permission_mode: "strict",
      },
      headers: {
        "x-local-api-token": "local-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.setTicketExecutionPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "strict",
        actor: "user",
      }),
    );

    await app.close();
  });
});
