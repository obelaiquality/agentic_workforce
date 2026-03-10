import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import { getQwenCliConfig, resolveQwenProfileHome } from "../providers/qwenCliConfig";
import { ProviderOrchestrator } from "./providerOrchestrator";
import type { QwenAccountAuthSession } from "../../shared/contracts";

const GLOBAL_QWEN_DIR = path.join(os.homedir(), ".qwen");
const PROFILE_SEED_FILES = ["settings.json", "installation_id", "output-language.md", "google_accounts.json"];
const AUTH_FILE = "oauth_creds.json";

interface AuthSessionInternal {
  accountId: string;
  profilePath: string;
  status: QwenAccountAuthSession["status"];
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
  log: string[];
  pid: number | null;
  child?: ChildProcessWithoutNullStreams;
}

function slugifyLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "qwen-account";
}

function qwenDirForProfile(profilePath: string) {
  return path.join(resolveQwenProfileHome(profilePath), ".qwen");
}

async function pathExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function trimLog(log: string[]) {
  return log.slice(-20);
}

export class QwenAccountSetupService {
  private readonly authSessions = new Map<string, AuthSessionInternal>();

  constructor(private readonly providerOrchestrator: ProviderOrchestrator) {}

  private getProfilesRoot() {
    return process.env.QWEN_PROFILE_ROOT || path.join(os.homedir(), ".agentic-workforce", "qwen-cli-profiles");
  }

  private snapshot(session: AuthSessionInternal): QwenAccountAuthSession {
    return {
      accountId: session.accountId,
      profilePath: session.profilePath,
      status: session.status,
      message: session.message,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      log: session.log,
      pid: session.pid,
    };
  }

  private async copySeedFiles(profilePath: string, includeAuth: boolean) {
    const qwenDir = qwenDirForProfile(profilePath);
    await fs.mkdir(qwenDir, { recursive: true });

    for (const name of PROFILE_SEED_FILES) {
      const source = path.join(GLOBAL_QWEN_DIR, name);
      const destination = path.join(qwenDir, name);
      if (await pathExists(source)) {
        await fs.copyFile(source, destination);
      }
    }

    if (includeAuth) {
      const authSource = path.join(GLOBAL_QWEN_DIR, AUTH_FILE);
      const authDestination = path.join(qwenDir, AUTH_FILE);
      if (await pathExists(authSource)) {
        await fs.copyFile(authSource, authDestination);
      }
    }
  }

  async bootstrapAccount(input: { label: string; importCurrentAuth?: boolean }) {
    const profilePath = path.join(this.getProfilesRoot(), `${slugifyLabel(input.label)}-${Date.now()}`);
    await this.copySeedFiles(profilePath, Boolean(input.importCurrentAuth));

    const account = await this.providerOrchestrator.createQwenAccount({
      label: input.label,
      profilePath,
    });

    const hasAuth = await this.accountHasAuth(profilePath);
    if (!hasAuth) {
      await this.providerOrchestrator.updateQwenAccount(account.id, { state: "auth_required" });
    }

    publishEvent("global", "account.bootstrap.completed", {
      accountId: account.id,
      profilePath,
      importedAuth: Boolean(input.importCurrentAuth),
      hasAuth,
    });

    return prisma.providerAccount.findUniqueOrThrow({ where: { id: account.id } });
  }

  async accountHasAuth(profilePath: string) {
    return pathExists(path.join(qwenDirForProfile(profilePath), AUTH_FILE));
  }

  async listAuthSessions(): Promise<QwenAccountAuthSession[]> {
    const accounts = await prisma.providerAccount.findMany({
      where: { providerId: "qwen-cli" },
      orderBy: { createdAt: "asc" },
    });

    return Promise.all(
      accounts.map(async (account) => {
        const existing = this.authSessions.get(account.id);
        if (existing) {
          return this.snapshot(existing);
        }

        const hasAuth = await this.accountHasAuth(account.profilePath);
        return {
          accountId: account.id,
          profilePath: account.profilePath,
          status: "idle",
          message: hasAuth ? "credentials detected" : "authentication required",
          startedAt: account.updatedAt.toISOString(),
          finishedAt: hasAuth ? account.updatedAt.toISOString() : null,
          log: [],
          pid: null,
        };
      })
    );
  }

  async startAuth(accountId: string): Promise<QwenAccountAuthSession> {
    const existing = this.authSessions.get(accountId);
    if (existing?.status === "running") {
      return this.snapshot(existing);
    }

    const account = await prisma.providerAccount.findUniqueOrThrow({ where: { id: accountId } });
    const config = await getQwenCliConfig();
    const profileHome = resolveQwenProfileHome(account.profilePath);
    const session: AuthSessionInternal = {
      accountId,
      profilePath: account.profilePath,
      status: "running",
      message: "starting qwen auth flow",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      log: [],
      pid: null,
    };

    this.authSessions.set(accountId, session);
    await this.providerOrchestrator.updateQwenAccount(accountId, { state: "auth_required" });

    publishEvent("global", "account.auth.started", {
      accountId,
      profilePath: account.profilePath,
    });

    const prompt = "Reply with exactly QWEN_AUTH_FLOW_OK";
    const child = spawn(config.command, [...config.args, prompt], {
      env: {
        ...process.env,
        HOME: profileHome,
        USERPROFILE: profileHome,
      },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    session.child = child;
    session.pid = child.pid ?? null;

    const append = (chunk: string) => {
      const lines = chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-5);
      if (lines.length) {
        session.log = trimLog([...session.log, ...lines]);
      }
    };

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => append(chunk));
    child.stderr.on("data", (chunk: string) => append(chunk));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      session.status = "failed";
      session.message = "authentication timed out";
      session.finishedAt = new Date().toISOString();
      session.log = trimLog([...session.log, "authentication timed out"]);
      void this.providerOrchestrator.updateQwenAccount(accountId, { state: "auth_required" });
      publishEvent("global", "account.auth.failed", {
        accountId,
        profilePath: account.profilePath,
        reason: "timeout",
      });
    }, 15 * 60 * 1000);

    child.on("close", async (code) => {
      clearTimeout(timeout);

      const hasAuth = await this.accountHasAuth(account.profilePath);
      if (code === 0 && hasAuth) {
        session.status = "succeeded";
        session.message = "authentication completed";
        session.finishedAt = new Date().toISOString();
        session.log = trimLog([...session.log, "authentication completed"]);
        await this.providerOrchestrator.markQwenAccountReauthed(accountId);
        publishEvent("global", "account.auth.completed", {
          accountId,
          profilePath: account.profilePath,
        });
        return;
      }

      session.status = "failed";
      session.message = hasAuth ? "verification failed" : "authentication required";
      session.finishedAt = new Date().toISOString();
      session.log = trimLog([...session.log, code === null ? "process exited unexpectedly" : `process exited with code ${code}`]);
      await this.providerOrchestrator.updateQwenAccount(accountId, { state: hasAuth ? "ready" : "auth_required" });
      publishEvent("global", "account.auth.failed", {
        accountId,
        profilePath: account.profilePath,
        reason: session.message,
      });
    });

    return this.snapshot(session);
  }
}
