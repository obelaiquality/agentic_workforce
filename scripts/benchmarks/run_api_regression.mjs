import "dotenv/config";

const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:8787";

async function api(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  const projectKey = process.argv[2] || "react-dashboard-lite";
  const projects = await api("/api/v4/benchmarks/projects");
  const project = projects.items.find((item) => item.projectKey === projectKey);
  if (!project) {
    throw new Error(`Project not found: ${projectKey}`);
  }

  const projectDetail = await api(`/api/v4/benchmarks/projects/${project.id}`);
  const task = projectDetail.tasks[0];
  if (!task) {
    throw new Error(`No tasks found for project: ${projectKey}`);
  }

  const repoResponse = await api("/api/v4/commands/repo.register", {
    method: "POST",
    body: JSON.stringify({
      actor: "script",
      project_key: projectKey,
    }),
  });

  const activateResponse = await api("/api/v4/commands/repo.activate", {
    method: "POST",
    body: JSON.stringify({
      actor: "script",
      repo_id: repoResponse.repo.id,
    }),
  });

  const runResponse = await api("/api/v4/commands/benchmark.run.start", {
    method: "POST",
    body: JSON.stringify({
      actor: "script",
      project_id: project.id,
      task_id: task.id,
      mode: "api_regression",
      repo_id: repoResponse.repo.id,
    }),
  });

  const executeResponse = await api("/api/v5/commands/benchmark.run.execute", {
    method: "POST",
    body: JSON.stringify({
      actor: "script",
      run_id: runResponse.run.id,
    }),
  });

  console.log(
    JSON.stringify(
      {
        baseUrl,
        project: project.projectKey,
        repoId: repoResponse.repo.id,
        activeRepo: activateResponse.repo.id,
        runId: runResponse.run.id,
        chatSessionId: executeResponse.chatSession?.id || null,
        route: executeResponse.routingDecision.executionMode,
        provider: executeResponse.routingDecision.providerId,
        score: executeResponse.scorecard.totalScore,
        pass: executeResponse.scorecard.pass,
        hardFailures: executeResponse.scorecard.hardFailures,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
