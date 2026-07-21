import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Cliente, Comentario, Status, Tarefa } from "./mock-data";
import {
  addComentario as addComentarioFn,
  createTarefa as createTarefaFn,
  createCliente as createClienteFn,
  deleteTarefa as deleteTarefaFn,
  getDashboardData,
  updateTarefa as updateTarefaFn,
  setClienteStatus as setClienteStatusFn,
  deleteCliente as deleteClienteFn,
  updateCliente as updateClienteFn,
  updatePlano as updatePlanoFn,
  addServicoAvulso as addServicoAvulsoFn,
  deleteTransacao as deleteTransacaoFn,
} from "./data.functions";

export interface Membro {
  id: string;
  nome: string;
  iniciais: string;
  cor: string;
  email?: string;
  avatar_url?: string | null;
  cargo?: "Admin" | "Supervisor" | "Membro";
  status?: "ativo" | "inativo";
  criado_em?: string;
}

export type WorkspaceView =
  | { tipo: "tarefas" }
  | { tipo: "tarefas-gerais" }
  | { tipo: "dashboard" }
  | { tipo: "todos-clientes" }
  | { tipo: "calendario-geral" }
  | { tipo: "membros" }
  | { tipo: "financeiro" }
  | { tipo: "planos" }
  | { tipo: "clientes-inativos" }
  | { tipo: "configuracoes" }
  | { tipo: "demandas" }
  | { tipo: "links" }
  | { tipo: "cliente"; clienteId: string };

export type MainView = "Quadro" | "Calendário";
// Backwards-compat: components still import this constant; it is overwritten
// from the live profile at runtime by TasksProvider.
export let USUARIO_LOGADO_INICIAIS = "EU";

export interface Plano {
  id: string;
  nome_plano: "Bronze" | "Prata" | "Ouro" | "Diamond";
  valor_mensal: number;
  servicos_inclusos: string[];
}

export interface Transacao {
  id: string;
  cliente_id: string | null;
  tipo: "mensalidade_plano" | "servico_avulso";
  descricao: string;
  valor: number;
  data_pagamento: string;
}

interface TasksCtx {
  tarefas: Tarefa[];
  clientes: Cliente[];
  membros: Membro[];
  planos: Plano[];
  transacoes: Transacao[];
  myCargo: "Admin" | "Supervisor" | "Membro";
  myIniciais: string;
  myId: string;
  myNome: string;
  myEmail: string;
  myAvatar: string | null;
  loading: boolean;
  addTarefa: (t: Omit<Tarefa, "id">) => void;
  updateTarefa: (id: string, patch: Partial<Tarefa>) => void;
  removerTarefa: (id: string) => void;
  addCliente: (c: {
    nome_empresa: string;
    plano: "Bronze" | "Prata" | "Ouro" | "Diamond";
    endereco?: string;
    documento?: string;
    email?: string;
    contrato_url?: string;
  }) => Promise<{ id: string }>;
  setClienteStatus: (id: string, status: "ativo" | "inativo") => void;
  removerCliente: (id: string) => void;
  updateCliente: (vars: {
    id: string;
    patch: {
      nome_empresa?: string;
      plano?: "Bronze" | "Prata" | "Ouro" | "Diamond";
      endereco?: string | null;
      documento?: string | null;
      email?: string | null;
      contrato_url?: string | null;
    };
  }) => Promise<void>;
  updatePlano: (vars: { id: string; valor_mensal?: number; servicos_inclusos?: string[] }) => Promise<void>;
  addServicoAvulso: (vars: { cliente_id: string; descricao: string; valor: number; data_pagamento?: string }) => Promise<void>;
  removerTransacao: (id: string) => void;
  contarPorStatus: (s: Status) => number;
  contarMinhasPorStatus: (s: Status) => number;
  contarGeraisPorStatus: (s: Status) => number;
  clientesAtivos: () => Cliente[];
  selectedTaskId: string | null;
  openTask: (id: string) => void;
  closeTask: () => void;
  addComentario: (taskId: string, c: Omit<Comentario, "id" | "criado_em">) => void;
  workspace: WorkspaceView;
  setWorkspace: (v: WorkspaceView) => void;
  contarTarefasCliente: (clienteId: string) => number;
  mainView: MainView;
  setMainView: (v: MainView) => void;
  clientesComMinhasTarefas: () => Cliente[];
  meuStatusFilter: Status | null;
  setMeuStatusFilter: (s: Status | null) => void;
  geralStatusFilter: Status | null;
  setGeralStatusFilter: (s: Status | null) => void;
  geralEmpresaFilter: string | "todas";
  setGeralEmpresaFilter: (id: string | "todas") => void;
}

const Ctx = createContext<TasksCtx | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceView>({ tipo: "dashboard" });
  const [mainView, setMainView] = useState<MainView>("Quadro");
  const [meuStatusFilter, setMeuStatusFilter] = useState<Status | null>(null);
  const [geralStatusFilter, setGeralStatusFilter] = useState<Status | null>(null);
  const [geralEmpresaFilter, setGeralEmpresaFilter] = useState<string | "todas">("todas");

  const queryClient = useQueryClient();
  const fetchDashboard = useServerFn(getDashboardData);
  const createFn = useServerFn(createTarefaFn);
  const updateFn = useServerFn(updateTarefaFn);
  const commentFn = useServerFn(addComentarioFn);
  const deleteFn = useServerFn(deleteTarefaFn);
  const createClienteServerFn = useServerFn(createClienteFn);
  const setStatusFn = useServerFn(setClienteStatusFn);
  const deleteClienteServerFn = useServerFn(deleteClienteFn);
  const updateClienteServerFn = useServerFn(updateClienteFn);
  const updatePlanoServerFn = useServerFn(updatePlanoFn);
  const addAvulsoFn = useServerFn(addServicoAvulsoFn);
  const deleteTransFn = useServerFn(deleteTransacaoFn);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetchDashboard(),
  });

  const tarefas = (data?.tarefas ?? []) as Tarefa[];
  const clientes = (data?.clientes ?? []) as Cliente[];
  const membros = data?.membros ?? [];
  const planos = (data?.planos ?? []) as Plano[];
  const transacoes = (data?.transacoes ?? []) as Transacao[];
  const myCargo: "Admin" | "Supervisor" | "Membro" =
    (membros.find((m) => m.id === data?.me?.id)?.cargo as "Admin" | "Supervisor" | "Membro") ?? "Membro";
  if (data?.me?.iniciais) USUARIO_LOGADO_INICIAIS = data.me.iniciais;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["dashboard"] });

  const createMut = useMutation({
    mutationFn: (vars: Omit<Tarefa, "id">) =>
      createFn({
        data: {
          cliente_id: vars.cliente_id || null,
          titulo: vars.titulo,
          status: vars.status,
          prioridade: vars.prioridade,
          data_vencimento: vars.data_vencimento || undefined,
          descricao: vars.descricao,
          tipo: (vars.tipo ?? "tarefa") as "tarefa" | "lembrete",
          escopo: (vars.escopo ?? "geral") as "geral" | "pessoal",
          responsavel_ids: vars.responsaveis.map((r) => r.id),
        },
      }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar"),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; patch: Partial<Tarefa> }) =>
      updateFn({
        data: {
          id: vars.id,
          patch: {
            titulo: vars.patch.titulo,
            status: vars.patch.status,
            prioridade: vars.patch.prioridade,
            descricao: vars.patch.descricao,
            data_vencimento: vars.patch.data_vencimento,
            responsavel_ids: vars.patch.responsaveis?.map((r) => r.id),
          },
        },
      }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar"),
  });

  const commentMut = useMutation({
    mutationFn: (vars: { tarefa_id: string; conteudo: string }) =>
      commentFn({ data: vars }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao comentar"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Excluído com sucesso");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir"),
  });

  const createClienteMut = useMutation({
    mutationFn: (vars: {
      nome_empresa: string;
      plano: "Bronze" | "Prata" | "Ouro" | "Diamond";
      endereco?: string;
      documento?: string;
      email?: string;
      contrato_url?: string;
    }) => createClienteServerFn({ data: vars }),
    onSuccess: () => {
      toast.success("Cliente cadastrado");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao cadastrar cliente"),
  });

  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: "ativo" | "inativo" }) => setStatusFn({ data: vars }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar status"),
  });

  const deleteClienteMut = useMutation({
    mutationFn: (id: string) => deleteClienteServerFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Cliente excluído");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir cliente"),
  });

  const updateClienteMut = useMutation({
    mutationFn: (vars: Parameters<TasksCtx["updateCliente"]>[0]) =>
      updateClienteServerFn({ data: vars }),
    onSuccess: () => {
      toast.success("Cliente atualizado");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar cliente"),
  });

  const planoMut = useMutation({
    mutationFn: (vars: { id: string; valor_mensal?: number; servicos_inclusos?: string[] }) =>
      updatePlanoServerFn({ data: vars }),
    onSuccess: () => {
      toast.success("Plano atualizado");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar plano"),
  });

  const avulsoMut = useMutation({
    mutationFn: (vars: { cliente_id: string; descricao: string; valor: number; data_pagamento?: string }) =>
      addAvulsoFn({ data: vars }),
    onSuccess: () => {
      toast.success("Lançamento registrado");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao lançar serviço"),
  });

  const deleteTransMut = useMutation({
    mutationFn: (id: string) => deleteTransFn({ data: { id } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir"),
  });

  const addTarefa = useCallback((t: Omit<Tarefa, "id">) => {
    createMut.mutate(t);
  }, [createMut]);

  const updateTarefa = useCallback((id: string, patch: Partial<Tarefa>) => {
    updateMut.mutate({ id, patch });
  }, [updateMut]);

  const removerTarefa = useCallback((id: string) => {
    deleteMut.mutate(id);
  }, [deleteMut]);

  const addCliente = useCallback(
    (c: {
      nome_empresa: string;
      plano: "Bronze" | "Prata" | "Ouro" | "Diamond";
      endereco?: string;
      documento?: string;
      email?: string;
      contrato_url?: string;
    }) => createClienteMut.mutateAsync(c),
    [createClienteMut],
  );

  const setClienteStatus = useCallback(
    (id: string, status: "ativo" | "inativo") => statusMut.mutate({ id, status }),
    [statusMut],
  );
  const removerCliente = useCallback((id: string) => deleteClienteMut.mutate(id), [deleteClienteMut]);
  const updateCliente = useCallback(
    (vars: Parameters<TasksCtx["updateCliente"]>[0]) => updateClienteMut.mutateAsync(vars).then(() => undefined),
    [updateClienteMut],
  );
  const updatePlano = useCallback(
    (vars: { id: string; valor_mensal?: number; servicos_inclusos?: string[] }) => planoMut.mutateAsync(vars).then(() => undefined),
    [planoMut],
  );
  const addServicoAvulso = useCallback(
    (vars: { cliente_id: string; descricao: string; valor: number; data_pagamento?: string }) =>
      avulsoMut.mutateAsync(vars).then(() => undefined),
    [avulsoMut],
  );
  const removerTransacao = useCallback((id: string) => deleteTransMut.mutate(id), [deleteTransMut]);

  const openTask = useCallback((id: string) => setSelectedTaskId(id), []);
  const closeTask = useCallback(() => setSelectedTaskId(null), []);

  const addComentario = useCallback(
    (taskId: string, c: Omit<Comentario, "id" | "criado_em">) => {
      commentMut.mutate({ tarefa_id: taskId, conteudo: c.conteudo });
    },
    [commentMut],
  );

  const contarTarefasCliente = useCallback(
    (clienteId: string) => tarefas.filter((t) => (t.tipo ?? "tarefa") === "tarefa" && t.cliente_id === clienteId && t.status !== "Concluído").length,
    [tarefas],
  );

  const contarPorStatus = useCallback(
    (s: Status) => tarefas.filter((t) => (t.tipo ?? "tarefa") === "tarefa" && t.status === s).length,
    [tarefas],
  );

  const contarMinhasPorStatus = useCallback(
    (s: Status) => {
      const meId = data?.me?.id;
      return tarefas.filter(
        (t) =>
          (t.tipo ?? "tarefa") === "tarefa" &&
          t.status === s &&
          (!!meId && t.responsaveis.some((r) => r.id === meId)),
      ).length;
    },
    [tarefas, data?.me?.id],
  );

  const contarGeraisPorStatus = useCallback(
    (s: Status) =>
      tarefas.filter(
        (t) =>
          (t.tipo ?? "tarefa") === "tarefa" &&
          t.status === s &&
          (geralEmpresaFilter === "todas" || t.cliente_id === geralEmpresaFilter),
      ).length,
    [tarefas, geralEmpresaFilter],
  );

  const clientesAtivos = useCallback(() => {
    const ids = new Set(tarefas.map((t) => t.cliente_id));
    return clientes.filter((c) => ids.has(c.id));
  }, [tarefas, clientes]);

  const clientesComMinhasTarefas = useCallback(() => {
    const meId = data?.me?.id;
    if (!meId) return [];
    const ids = new Set(
      tarefas
        .filter((t) => (t.tipo ?? "tarefa") === "tarefa" && t.responsaveis.some((r) => r.id === meId))
        .map((t) => t.cliente_id),
    );
    return clientes.filter((c) => ids.has(c.id));
  }, [tarefas, clientes, data?.me?.id]);

  const value = useMemo(
    () => ({
      tarefas,
      clientes,
      membros,
      planos,
      transacoes,
      myCargo,
      myIniciais: data?.me?.iniciais ?? USUARIO_LOGADO_INICIAIS,
      myId: data?.me?.id ?? "",
      myNome: (data?.me as { nome?: string } | undefined)?.nome ?? "",
      myEmail: (data?.me as { email?: string } | undefined)?.email ?? "",
      myAvatar: (data?.me as { avatar_url?: string | null } | undefined)?.avatar_url ?? null,
      loading: isLoading,
      addTarefa,
      updateTarefa,
      removerTarefa,
      addCliente,
      setClienteStatus,
      removerCliente,
      updateCliente,
      updatePlano,
      addServicoAvulso,
      removerTransacao,
      contarPorStatus,
      contarMinhasPorStatus,
      contarGeraisPorStatus,
      clientesAtivos,
      selectedTaskId,
      openTask,
      closeTask,
      addComentario,
      workspace,
      setWorkspace,
      contarTarefasCliente,
      mainView,
      setMainView,
      clientesComMinhasTarefas,
      meuStatusFilter,
      setMeuStatusFilter,
      geralStatusFilter,
      setGeralStatusFilter,
      geralEmpresaFilter,
      setGeralEmpresaFilter,
    }),
    [tarefas, clientes, membros, planos, transacoes, myCargo, data?.me?.iniciais, data?.me?.id, isLoading, addTarefa, updateTarefa, removerTarefa, addCliente, setClienteStatus, removerCliente, updateCliente, updatePlano, addServicoAvulso, removerTransacao, contarPorStatus, contarMinhasPorStatus, contarGeraisPorStatus, clientesAtivos, selectedTaskId, openTask, closeTask, addComentario, workspace, contarTarefasCliente, mainView, clientesComMinhasTarefas, meuStatusFilter, geralStatusFilter, geralEmpresaFilter],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTasks(): TasksCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTasks deve estar dentro de TasksProvider");
  return v;
}