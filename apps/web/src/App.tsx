import { DrillScreen } from '@/components/drill-screen';

/** Application shell: one landmark per region, and the practice screen. */
export function App() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">British Accent Trainer</h1>
        <p className="text-muted-foreground mt-1">
          Hear a native model, record yourself, and compare the two.
        </p>
      </header>
      <DrillScreen />
    </main>
  );
}
