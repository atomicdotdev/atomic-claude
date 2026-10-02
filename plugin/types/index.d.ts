declare module 'claude-code' {
  interface PluginState {
    atomic: {
      workspace: { cwd: string; root: string; repository: string; selectionError: string; view: string; parent: string | null; status: string; intents: string; inventory: { id: string; title: string; status: string }[]; intentError: string; error: string };
      runtime: { session: Record<string, unknown> | null; turnId: string; steps: Record<string, unknown>[]; completed: string; recording: string; pendingCompletion: Record<string, unknown> | null };
      review: string;
      activeIntent: { root: string; sessionId: string; generation: string; id: string | null; label: string; error: string };
    };
  }
}
