"use client";

import { ErrorState } from "@/components/feedback/error-state";

// Mostrado quando uma página do grupo lança um erro. "reset" tenta renderizar de novo.
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState onRetry={reset} />;
}
