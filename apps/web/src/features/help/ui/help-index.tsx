// O índice da Ajuda (M12.3a, prancha J-Ajuda): a busca e os tópicos. A busca é um formulário GET
// (?q=), respondida no servidor: funciona antes do React e o endereço guarda o que se buscou.
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  Landmark,
  MessageCircle,
  PieChart,
  ReceiptText,
  Search,
  ShieldCheck,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTile, type Tone } from "@/components/visual/icon-tile";
import { HELP_ARTICLES, HELP_TOPICS, type HelpTopicIcon } from "../content";
import { HELP_QUERY_MAX, type HelpResult } from "../search";

const ICONS: Record<HelpTopicIcon, LucideIcon> = {
  book: BookOpen,
  receipt: ReceiptText,
  landmark: Landmark,
  pie: PieChart,
  tags: Tags,
  chat: MessageCircle,
  shield: ShieldCheck,
};
const TONES: readonly Tone[] = [1, 4, 5, 1, 4, 5, 1];

export function HelpSearch({ query }: { query: string }) {
  return (
    <form role="search" action="/ajuda" method="get" className="flex flex-col gap-2">
      <label htmlFor="ajuda-busca" className="text-sm font-bold">
        Buscar na ajuda
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
          />
          <Input
            id="ajuda-busca"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={HELP_QUERY_MAX}
            placeholder="Ex.: fatura, parcelada, 2FA"
            autoComplete="off"
            className="h-12 rounded-xl pl-11 text-base"
          />
        </div>
        <Button type="submit" className="h-12 rounded-xl px-5 font-bold">
          Buscar
        </Button>
      </div>
    </form>
  );
}

export function HelpResults({ query, results }: { query: string; results: HelpResult[] }) {
  return (
    <section aria-labelledby="ajuda-resultados" className="bg-card rounded-2xl border p-4 md:p-5">
      <h2 id="ajuda-resultados" role="status" className="text-muted-foreground text-sm">
        {results.length === 0
          ? `Nada encontrado para “${query}”. Tente outra palavra, ou veja os tópicos.`
          : `${results.length} ${results.length === 1 ? "resultado" : "resultados"} para “${query}”`}
      </h2>
      {results.length > 0 ? (
        <ul className="mt-2 flex flex-col" data-testid="ajuda-resultados">
          {results.map((r) => (
            <li key={r.slug} className="border-t py-3 first:border-t-0">
              <Link
                href={`/ajuda/${r.slug}`}
                className="focus-visible:ring-ring group flex flex-col gap-1 rounded-lg outline-none focus-visible:ring-3"
              >
                <span className="text-muted-foreground text-[0.8125rem] font-bold">{r.topic}</span>
                <span className="text-[1.0625rem] font-bold underline decoration-dotted underline-offset-4 group-hover:decoration-solid">
                  {r.title}
                </span>
                <span className="text-sm leading-relaxed">
                  {r.snippet.map((part, i) =>
                    part.mark ? (
                      <mark key={i} className="bg-chart-4/20 text-foreground rounded px-0.5">
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function HelpTopics() {
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {HELP_TOPICS.map((topic, i) => (
        <section
          key={topic.id}
          aria-labelledby={`topico-${topic.id}`}
          className="bg-card flex flex-col gap-3 rounded-2xl border p-4 md:p-5"
        >
          <div className="flex items-center gap-3">
            <IconTile tone={TONES[i] ?? 1} icon={ICONS[topic.icon]} size="sm" />
            <h2 id={`topico-${topic.id}`} className="text-lg font-extrabold">
              {topic.title}
            </h2>
          </div>
          <ul className="flex flex-col">
            {HELP_ARTICLES.filter((a) => a.topic === topic.id).map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/ajuda/${a.slug}`}
                  className="hover:bg-muted focus-visible:ring-ring -mx-2 flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-[0.9375rem] outline-none focus-visible:ring-3"
                >
                  {a.title}
                  <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
