export interface StartupBootstrapServiceDeps {
  ensureActiveProjectScopeInitialized: () => void;
  hasRuntimeOpenAtStartup: () => boolean;
  withReindexProgress: (title: string, operation: () => Promise<void>) => Promise<void>;
  queueBootstrapReindex: (includeRuntimeForBootstrap: boolean) => Promise<void>;
  scheduleDeferredFullReindex: () => void;
}

export class StartupBootstrapService {
  public constructor(private readonly deps: StartupBootstrapServiceDeps) {}

  public start(): void {
    void (async () => {
      this.deps.ensureActiveProjectScopeInitialized();
      const includeRuntimeForBootstrap = this.deps.hasRuntimeOpenAtStartup();
      await this.deps.withReindexProgress("SFP XML Linter: Initial Bootstrap Indexing", async () => {
        await this.deps.queueBootstrapReindex(includeRuntimeForBootstrap);
      });
      this.deps.scheduleDeferredFullReindex();
    })();
  }
}

