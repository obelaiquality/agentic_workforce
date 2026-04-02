import { LSPClient } from "./lspClient";

let sharedLspClient: LSPClient | null = null;

export function getSharedLspClient(): LSPClient {
  if (!sharedLspClient) {
    sharedLspClient = new LSPClient();
  }
  return sharedLspClient;
}

export async function shutdownSharedLspClient(): Promise<void> {
  if (!sharedLspClient) {
    return;
  }
  await sharedLspClient.stopAll();
  sharedLspClient = null;
}
