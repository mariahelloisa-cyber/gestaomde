export type Prioridade = "Alta" | "Média" | "Baixa" | "Nenhuma";
export type Status = "Pendente" | "Em Progresso" | "Concluído";
export type TipoItem = "tarefa" | "lembrete";
export type EscopoItem = "geral" | "pessoal";

export interface Cliente {
  id: string;
  nome_empresa: string;
  plano: "Bronze" | "Prata" | "Ouro" | "Diamond";
  cor: string;
  endereco?: string;
  documento?: string;
  email?: string;
  contrato_url?: string | null;
  status?: "ativo" | "inativo";
}

export interface Tarefa {
  id: string;
  cliente_id: string; // vazio quando tipo === "lembrete"
  titulo: string;
  status: Status;
  prioridade: Prioridade;
  responsaveis: { id: string; nome: string; iniciais: string }[];
  data_vencimento: string; // ISO YYYY-MM-DD
  descricao?: string;
  comentarios?: Comentario[];
  tipo?: TipoItem; // default: "tarefa"
  escopo?: EscopoItem; // relevante apenas para lembretes; default "geral"
  criado_por?: string; // iniciais do usuário criador (privado p/ lembretes)
}

export interface Comentario {
  id: string;
  autor: { nome: string; iniciais: string; cor?: string };
  conteudo: string;
  criado_em: string; // ISO timestamp
}

export interface Membro {
  nome: string;
  iniciais: string;
  cor: string;
}

export const membros: Membro[] = [
  { nome: "Helloisa", iniciais: "HK", cor: "#7B68EE" },
  { nome: "Bruno Lima", iniciais: "BL", cor: "#3B82F6" },
  { nome: "Carla Souza", iniciais: "CS", cor: "#22C55E" },
  { nome: "Diego Alves", iniciais: "DA", cor: "#F97316" },
];

export const clientes: Cliente[] = [
  { id: "c1", nome_empresa: "Acme Studio", plano: "Diamond", cor: "#7B68EE" },
  { id: "c2", nome_empresa: "Nova Tech", plano: "Ouro", cor: "#FFB800" },
  { id: "c3", nome_empresa: "Verde Co.", plano: "Prata", cor: "#22C55E" },
  { id: "c4", nome_empresa: "Lumen Lab", plano: "Bronze", cor: "#F97316" },
];

function isoOffset(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const tarefasIniciais: Tarefa[] = [
  { id: "t1", cliente_id: "c1", titulo: "Setup das tarefas em 5 minutos", status: "Pendente", prioridade: "Alta", responsaveis: [{ id: "m1", nome: "Helloisa", iniciais: "HK" }], data_vencimento: isoOffset(0) },
  { id: "t2", cliente_id: "c1", titulo: "Desenhar workflow do cliente", status: "Pendente", prioridade: "Alta", responsaveis: [{ id: "m1", nome: "Helloisa", iniciais: "HK" }], data_vencimento: isoOffset(1) },
  { id: "t3", cliente_id: "c2", titulo: "Onboarding da equipe", status: "Em Progresso", prioridade: "Média", responsaveis: [{ id: "m1", nome: "Helloisa", iniciais: "HK" }], data_vencimento: isoOffset(3) },
  { id: "t4", cliente_id: "c2", titulo: "Integrar ferramentas favoritas", status: "Em Progresso", prioridade: "Alta", responsaveis: [{ id: "m1", nome: "Helloisa", iniciais: "HK" }], data_vencimento: isoOffset(4) },
  { id: "t5", cliente_id: "c3", titulo: "Importar trabalho existente", status: "Concluído", prioridade: "Baixa", responsaveis: [{ id: "m1", nome: "Helloisa", iniciais: "HK" }], data_vencimento: isoOffset(-2) },
  { id: "t6", cliente_id: "c4", titulo: "Trabalhar mais inteligente com IA", status: "Pendente", prioridade: "Nenhuma", responsaveis: [{ id: "m1", nome: "Helloisa", iniciais: "HK" }], data_vencimento: isoOffset(6) },
];

export function rotuloData(iso: string): string {
  if (!iso) return "—";
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Math.round((d.getTime() - hoje.getTime()) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  if (diff > 1 && diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

export function clienteById(id: string): Cliente | undefined {
  return clientes.find((c) => c.id === id);
}

export const prioridadeCor: Record<Prioridade, string> = {
  Alta: "#EF4444",
  "Média": "#F59E0B",
  Baixa: "#3B82F6",
  Nenhuma: "#9CA3AF",
};

export const statusCor: Record<Status, string> = {
  Pendente: "#F59E0B",
  "Em Progresso": "#3B82F6",
  "Concluído": "#22C55E",
};

/** Estilo "pill" colorido (preenchimento sólido + texto branco) para status. */
export function statusPillStyle(s: Status) {
  const c = statusCor[s];
  return { backgroundColor: c, color: "#fff", borderColor: c } as const;
}

/** Estilo "pill" colorido para prioridade. "Nenhuma" usa cinza neutro. */
export function prioridadePillStyle(p: Prioridade) {
  const c = prioridadeCor[p];
  return { backgroundColor: c, color: "#fff", borderColor: c } as const;
}