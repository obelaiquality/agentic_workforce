import type { LlmProviderAdapter, ProviderId } from "../../shared/contracts";
import { wrapWithToolEmulation } from "./toolEmulationAdapter";

export class ProviderFactory {
  private readonly adapters = new Map<ProviderId, LlmProviderAdapter>();

  register(adapter: LlmProviderAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  resolve(providerId: ProviderId) {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`Provider '${providerId}' is not registered`);
    }
    return adapter;
  }

  list() {
    return Array.from(this.adapters.values());
  }
}

export { wrapWithToolEmulation };
