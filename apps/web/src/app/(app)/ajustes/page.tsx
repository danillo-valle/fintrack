import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export const metadata: Metadata = { title: "Ajustes" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Ajustes" />
      <section aria-labelledby="aparencia" className="max-w-md rounded-xl border p-5">
        <h2 id="aparencia" className="font-semibold">
          Aparência
        </h2>
        <p className="text-muted-foreground mt-1 mb-4 text-sm">
          &quot;Sistema&quot; segue o modo claro ou escuro do seu aparelho.
        </p>
        <ThemeToggle />
      </section>
    </>
  );
}
