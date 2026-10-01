import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cake, ChevronRight, Gift, PartyPopper } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import {
  getAniversariantesDeHoje,
  marcarAniversariantesVistos,
  type Aniversariante,
} from "@/lib/aniversariantes.functions";
import {
  dataPorExtenso,
  diaEMes,
  fraseAniversarioDoDia,
  tituloAniversariantes,
} from "@/lib/aniversariantes";
import {
  AniversarianteMaterialDialog,
  type MaterialAniversariante,
} from "./AniversarianteMaterial";

export const CHAVE_ANIVERSARIANTES_HOJE = ["aniversariantes-hoje"] as const;

/** Hook único de leitura dos aniversariantes de hoje, compartilhado pelo pop-up
 * automático e pelo botão de reabrir da área Aniversariantes. */
export function useAniversariantesDeHoje() {
  const { session, loading } = useAuth();
  const fetchFn = useServerFn(getAniversariantesDeHoje);
  return useQuery({
    queryKey: CHAVE_ANIVERSARIANTES_HOJE,
    queryFn: () => fetchFn(),
    // Só depois que a sessão carregou: sem token a server function recusa.
    enabled: !loading && !!session,
    // Uma verificação periódica cobre dois casos: a virada da data à meia-noite
    // de Brasília com a aba aberta, e um aniversariante cadastrado depois de
    // alguém já ter visto o pop-up.
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}

/** Modal em si — controlado, usado tanto na abertura automática quanto na manual. */
export function AniversariantesHojeModal({
  open,
  onOpenChange,
  aniversariantes,
  data,
  onVerTodos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aniversariantes: Aniversariante[];
  /** "YYYY-MM-DD" da data considerada. */
  data: string;
  /** Quando existe, mostra o botão "Ver aniversariantes". */
  onVerTodos?: () => void;
}) {
  const [material, setMaterial] = useState<MaterialAniversariante | null>(null);

  if (aniversariantes.length === 0) return null;

  const titulo = tituloAniversariantes(aniversariantes.length);
  const chamada = fraseAniversarioDoDia(aniversariantes.map((a) => a.nome));
  // Até três miniaturas sobrepostas no topo, como a referência faz com uma só.
  const destaques = aniversariantes.slice(0, 3);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-md sm:rounded-2xl">
          <DialogTitle className="sr-only">{titulo}</DialogTitle>

          {/* Faixa comemorativa no roxo da identidade: o --primary do tema é o
              meio do degradê, com violetas mais claro e mais escuro nas pontas
              só para dar profundidade — sem sair da família de cor do sistema. */}
          <div className="relative overflow-hidden bg-gradient-to-br from-violet-500 via-primary to-violet-900 px-6 pb-8 pt-7 text-center text-white">
            <div
              aria-hidden
              className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-12 -right-8 h-36 w-36 rounded-full bg-white/10 blur-2xl"
            />
            <div className="relative">
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ring-white/25"
                title={dataPorExtenso(data)}
              >
                <Gift className="h-3.5 w-3.5" />
                {aniversariantes.length === 1 ? "Aniversário do dia" : "Aniversários do dia"}
              </span>

              <div className="mt-4 flex items-center justify-center -space-x-4">
                {destaques.map((a) =>
                  a.imagens[0]?.url ? (
                    <img
                      key={a.id}
                      src={a.imagens[0].url!}
                      alt=""
                      className="h-20 w-20 rounded-full border-4 border-white/90 object-cover shadow-lg"
                    />
                  ) : (
                    <div
                      key={a.id}
                      className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/90 bg-white/20 shadow-lg"
                    >
                      <PartyPopper className="h-7 w-7" />
                    </div>
                  ),
                )}
              </div>

              <h2 className="mt-4 text-balance text-xl font-bold leading-tight">{chamada}</h2>
              <p className="mx-auto mt-2 max-w-[18rem] text-sm leading-snug text-white/85">
                Reserve um momento para publicar a arte e a mensagem no grupo e reforçar esse
                reconhecimento hoje.
              </p>
            </div>
          </div>

          <div className="max-h-[38vh] space-y-2 overflow-y-auto px-4 py-4">
            {aniversariantes.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setMaterial(a)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-2.5 text-left shadow-sm transition-colors hover:bg-accent"
              >
                {a.imagens[0]?.url ? (
                  <img
                    src={a.imagens[0].url}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-full border border-border object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                    <Cake className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{a.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Aniversário em {diaEMes(a.data_comemoracao)}
                    {a.imagens.length > 1 ? ` · ${a.imagens.length} artes` : ""}
                    {a.publicado_em ? " · já publicado" : ""}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            {onVerTodos && (
              // Botão primário padrão do sistema — mesma cor de todas as ações
              // principais do app, sem degradê próprio.
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onVerTodos();
                }}
              >
                <Cake className="h-4 w-4" />
                Ver aniversariantes
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AniversarianteMaterialDialog
        material={material}
        open={!!material}
        onOpenChange={(v) => !v && setMaterial(null)}
      />
    </>
  );
}

/**
 * Abertura automática: aparece no primeiro acesso de cada membro naquele dia,
 * depois que a sessão carregou. A visualização é registrada por usuário, então
 * fechar aqui não dispensa o pop-up de ninguém mais — e um aniversariante
 * cadastrado depois volta a abrir o modal na próxima verificação.
 */
export function AniversariantesPopupAutomatico({ onVerTodos }: { onVerTodos?: () => void }) {
  const { data } = useAniversariantesDeHoje();
  const [aberto, setAberto] = useState(false);
  // Ids que esta aba já dispensou: evita o modal reabrir no intervalo entre o
  // fechamento e a confirmação do registro no servidor.
  const dispensados = useRef<Set<string>>(new Set());

  const qc = useQueryClient();
  const marcarFn = useServerFn(marcarAniversariantesVistos);
  const marcarMut = useMutation({
    mutationFn: (ids: string[]) => marcarFn({ data: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_ANIVERSARIANTES_HOJE }),
    // Falhar aqui só faz o pop-up aparecer de novo depois — nada a avisar.
    onError: () => undefined,
  });

  const naoVistos = data?.nao_vistos ?? [];
  const pendentes = naoVistos.filter((id) => !dispensados.current.has(id));

  useEffect(() => {
    if (pendentes.length > 0) setAberto(true);
  }, [pendentes.length]);

  const fechar = useCallback(
    (proximo: boolean) => {
      setAberto(proximo);
      if (proximo) return;
      // Registra TODOS os de hoje, não só os pendentes: a pessoa viu a lista inteira.
      const ids = (data?.aniversariantes ?? []).map((a) => a.id);
      if (ids.length === 0) return;
      for (const id of ids) dispensados.current.add(id);
      marcarMut.mutate(ids);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.aniversariantes],
  );

  if (!data || data.aniversariantes.length === 0) return null;

  return (
    <AniversariantesHojeModal
      open={aberto}
      onOpenChange={fechar}
      aniversariantes={data.aniversariantes}
      data={data.hoje}
      onVerTodos={onVerTodos}
    />
  );
}
