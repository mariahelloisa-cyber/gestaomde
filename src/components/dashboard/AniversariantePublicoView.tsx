import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Cake, Lock } from "lucide-react";
import { AniversarianteMaterial } from "./AniversarianteMaterial";
import type { AniversarianteCompartilhado } from "@/lib/aniversariantes.functions";

/**
 * Página de um link de aniversariante. Mostra só o material daquela pessoa —
 * nada de equipe, clientes, tarefas ou qualquer outra parte do sistema — e as
 * mesmas ações de envio da versão interna.
 */
export function AniversariantePublicoView({ data }: { data: AniversarianteCompartilhado }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface-1)]">
      <header className="border-b border-border bg-background px-5 py-4">
        <div className="mx-auto flex w-full max-w-lg flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Cake className="h-4 w-4 text-primary" />
            Material de aniversário
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Somente leitura
            </span>
            {data.expira_em && (
              <span>
                · Link válido até {format(new Date(data.expira_em), "dd/MM/yyyy", { locale: ptBR })}
              </span>
            )}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 p-4 sm:p-6">
        <AniversarianteMaterial
          material={{
            nome: data.nome,
            data_comemoracao: data.data_comemoracao,
            mensagem: data.mensagem,
            imagens: data.imagens,
          }}
        />
      </main>
    </div>
  );
}
