/**
 * Application shell.
 *
 * Deliberately empty of features at this stage: the drill screen arrives in the next task.
 * It exists so the toolchain — Vite, React, Tailwind, shadcn, tests — is proven end to end
 * before any screen depends on it.
 */
export function App() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">British Accent Trainer</h1>
      <p className="text-muted-foreground mt-2">
        Hear a native model, record yourself, and compare the two.
      </p>
    </main>
  );
}
