import { DrillScreen } from '@/components/drill-screen';

/**
 * Application shell. The header sits outside `<main>` so it is exposed as the page's
 * banner landmark; nested inside `<main>` it would be just another region of content.
 */
export function App() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">British Accent Trainer</h1>
        <p className="text-muted-foreground mt-1">
          Hear a native model, record yourself, and compare the two.
        </p>
      </header>
      <main>
        <DrillScreen />
      </main>
    </div>
  );
}
