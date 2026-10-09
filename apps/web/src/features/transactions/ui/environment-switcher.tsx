import { Eye, House, User } from "lucide-react";
import { SegmentedNav } from "@/components/visual/segmented-nav";
import type { Environment } from "../environments";

// O seletor de ambiente (M07.4, canvas C.2): "Tudo que vejo" e um botão por ambiente que a
// pessoa vê. Só os dela: o ambiente pessoal de outra pessoa nunca aparece (nem existe no escopo).
// Com um ambiente só, não há o que escolher, e o seletor não aparece.
export function EnvironmentSwitcher({
  environments,
  current,
  hrefFor,
}: {
  environments: readonly Environment[];
  /** O ambiente escolhido (id) ou null para "Tudo que vejo" */
  current: string | null;
  /** O endereço da mesma página com o ambiente trocado (null = todos) */
  hrefFor: (walletId: string | null) => string;
}) {
  if (environments.length < 2) return null;
  return (
    <SegmentedNav
      label="Ambiente"
      items={[
        { href: hrefFor(null), label: "Tudo que vejo", icon: Eye, active: current === null },
        ...environments.map((e) => ({
          href: hrefFor(e.id),
          label: e.name,
          icon: e.kind === "SHARED" ? House : User,
          active: current === e.id,
        })),
      ]}
    />
  );
}
