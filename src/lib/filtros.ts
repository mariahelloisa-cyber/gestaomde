import type { Prioridade, Tarefa } from "./mock-data";

/** Filtros da barra de Minhas Tarefas / Tarefas Gerais (além do status, que já
 * vive no store como meuStatusFilter/geralStatusFilter). Valem para Kanban,
 * Agenda e Mural. */
export interface FiltrosBarra {
  busca: string;
  prioridade: Prioridade | "todas";
  /** Só usado em "Minhas Tarefas" — em Tarefas Gerais a empresa é geralEmpresaFilter. */
  empresa: string | "todas";
  /** id do projeto, "sem" (itens sem projeto) ou "todos". */
  projeto: string | "sem" | "todos";
  dataDe: string; // YYYY-MM-DD ou ""
  dataAte: string; // YYYY-MM-DD ou ""
}

export const FILTROS_VAZIOS: FiltrosBarra = {
  busca: "",
  prioridade: "todas",
  empresa: "todas",
  projeto: "todos",
  dataDe: "",
  dataAte: "",
};

function normalizar(s: string): string {
  // Busca ignora acentos e maiúsculas: "acao" encontra "Ação".
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Prioridade e empresa são atributos só de tarefas: com um desses filtros
 * ativo, lembretes somem (não têm como "bater"). Busca, projeto e data valem
 * para os dois. Com filtro de data, itens sem data somem.
 */
export function passaFiltros(t: Tarefa, f: FiltrosBarra, empresa: string | "todas" = f.empresa) {
  const isLembrete = t.tipo === "lembrete";

  if (f.busca.trim()) {
    const q = normalizar(f.busca.trim());
    const alvo = normalizar(`${t.titulo} ${t.descricao ?? ""}`);
    if (!alvo.includes(q)) return false;
  }

  if (f.prioridade !== "todas" && (isLembrete || t.prioridade !== f.prioridade)) return false;

  if (empresa !== "todas" && (isLembrete || t.cliente_id !== empresa)) return false;

  if (f.projeto === "sem" && t.projeto_id) return false;
  if (f.projeto !== "todos" && f.projeto !== "sem" && t.projeto_id !== f.projeto) return false;

  if (f.dataDe || f.dataAte) {
    if (!t.data_vencimento) return false;
    if (f.dataDe && t.data_vencimento < f.dataDe) return false;
    if (f.dataAte && t.data_vencimento > f.dataAte) return false;
  }

  return true;
}
