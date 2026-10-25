"use client";

import { ErrorState } from "@/components/feedback/error-state";

// Mostrado quando uma página do grupo lança um erro. "reset" tenta renderizar de novo. O código
// (digest) é o mesmo que o instrumentation.ts grava no log (M12.1, OWASP A10).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-xl">
      <ErrorState
        onRetry={reset}
        code={error.digest}
        home={{ href: "/", label: "Voltar ao início" }}
      />
    </div>
  );
}
