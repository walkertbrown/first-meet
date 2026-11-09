// When the web service starts. The import sits inside the NEXT_RUNTIME check so the edge bundle
// leaves the Node-only code (Postgres, the dispatcher) out.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { start } = await import('./instrumentation-node');
    start();
  }
}
