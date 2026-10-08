import { Laptop, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeDevice } from "@/lib/auth/device";
import { formatDateTime } from "@/lib/dates";
import { revokeOtherSessions, revokeSession } from "../server/actions";

export type SessionItem = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Sessões ativas: cada aparelho onde a conta está aberta. Componente de servidor:
// os botões são formulários que chamam Server Actions, e funcionam até sem JavaScript.
export function SessionList({
  sessions,
  currentId,
}: {
  sessions: SessionItem[];
  currentId: string;
}) {
  const others = sessions.filter((s) => s.id !== currentId).length;

  return (
    <div className="flex flex-col gap-4">
      <ul className="bg-card divide-y rounded-lg border">
        {sessions.map((item) => {
          const device = describeDevice(item.userAgent);
          const current = item.id === currentId;
          return (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex min-w-0 items-center gap-2">
                <Laptop aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {device}
                    {current ? (
                      <span className="bg-muted ml-2 rounded px-1.5 py-0.5 text-xs">
                        este aparelho
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    Entrou em {formatDateTime(item.createdAt)}
                    {item.ipAddress ? ` · IP ${item.ipAddress}` : ""}
                  </span>
                </span>
              </span>
              {current ? null : (
                <form action={revokeSession}>
                  <input type="hidden" name="sessionId" value={item.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    aria-label={`Encerrar a sessão de ${device}, de ${formatDateTime(item.createdAt)}`}
                  >
                    Encerrar
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {others > 0 ? (
        <form action={revokeOtherSessions}>
          <Button type="submit" variant="outline">
            <LogOut aria-hidden />
            Encerrar todas as outras ({others})
          </Button>
        </form>
      ) : null}
    </div>
  );
}
