import { cn } from "cn";

// Placeholder com desfoque (Visual C, ADR-008): uma forma suave e desfocada no lugar do que
// vai chegar. Quem pediu menos animação ao sistema não vê o pulsar (globals.css).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("blur-placeholder animate-pulse rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
