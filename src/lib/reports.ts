import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { statusCor, prioridadeCor, type Status, type Prioridade, type Tarefa } from "./mock-data";
import { calcPrazos, prazoColors, PRAZO_LABELS, type PrazoBucket } from "./productivity";

const STATUS_COLUNA = 4;
const PRIORIDADE_COLUNA = 5;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Desenha um donut (pizza com buraco branco no centro) igual ao card "Prazos" do dashboard. */
function desenharDonutPrazos(
  doc: jsPDF,
  opts: { cx: number; cy: number; outerR: number; innerR: number; segments: { color: string; value: number }[]; total: number },
) {
  const { cx, cy, outerR, innerR, segments, total } = opts;

  if (total > 0) {
    let anguloAtual = -90; // topo, igual ao donut do app (svg rotacionado -90deg)
    const passo = 1.5; // graus por fatia fina, dá a curvatura suave
    for (const seg of segments) {
      if (seg.value <= 0) continue;
      const anguloSeg = (seg.value / total) * 360;
      const fim = anguloAtual + anguloSeg;
      const [r, g, b] = hexToRgb(seg.color);
      doc.setFillColor(r, g, b);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.1);
      let a = anguloAtual;
      while (a < fim) {
        const a2 = Math.min(a + passo, fim);
        const p1x = cx + outerR * Math.cos((a * Math.PI) / 180);
        const p1y = cy + outerR * Math.sin((a * Math.PI) / 180);
        const p2x = cx + outerR * Math.cos((a2 * Math.PI) / 180);
        const p2y = cy + outerR * Math.sin((a2 * Math.PI) / 180);
        // "FD" (fill + contorno na mesma cor) evita frestas finas de
        // anti-aliasing entre triângulos adjacentes que apareciam como
        // "cortes" ao redor do círculo.
        doc.triangle(cx, cy, p1x, p1y, p2x, p2y, "FD");
        a = a2;
      }
      anguloAtual = fim;
    }
  } else {
    doc.setFillColor(229, 231, 235);
    doc.circle(cx, cy, outerR, "F");
  }

  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, innerR, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.text(String(total), cx, cy - 1.5, { align: "center", baseline: "middle" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(120);
  doc.text("TAREFAS", cx, cy + 4, { align: "center", baseline: "middle" });
}

function desenharLegendaPrazos(
  doc: jsPDF,
  x: number,
  yInicial: number,
  rows: { color: string; label: string; count: number; pct: number }[],
) {
  let y = yInicial;
  for (const r of rows) {
    doc.setFillColor(...hexToRgb(r.color));
    doc.circle(x + 1.3, y, 1.3, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(r.label, x + 6, y, { baseline: "middle" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20);
    doc.text(String(r.count), x + 60, y, { align: "right", baseline: "middle" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`${r.pct}%`, x + 72, y, { align: "right", baseline: "middle" });

    y += 8;
  }
}

export interface RelatorioFiltrosLabel {
  periodo: string;
  membro: string;
  cliente: string;
  projeto: string;
}

function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

// Larguras fixas (mm) de cada coluna, na ordem da tabela. Precisam ser
// conhecidas de antemão (em vez de deixar o autoTable calcular sozinho)
// para dar pra medir com precisão quantas linhas o título/responsáveis vão
// quebrar antes de desenhar a tabela de verdade.
const LARGURAS_COLUNAS = [80, 26, 26, 49, 28, 22, 19, 19] as const;

/** Altura total (mm) que a tabela vai ocupar, medindo a quebra de linha real do jsPDF. */
function medirAlturaTabela(doc: jsPDF, tarefas: Tarefa[], fontSize: number, cellPadding: number): number {
  const lineHeightFactor = doc.getLineHeightFactor();
  const lineHeight = (fontSize / doc.internal.scaleFactor) * lineHeightFactor;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);

  const largTitulo = LARGURAS_COLUNAS[0] - cellPadding * 2;
  const largResp = LARGURAS_COLUNAS[3] - cellPadding * 2;

  let altura = lineHeight + cellPadding * 2; // cabeçalho
  for (const t of tarefas) {
    const respTexto = t.responsaveis.map((r) => r.nome).join(", ") || "—";
    const linhasTitulo = doc.splitTextToSize(t.titulo || "", largTitulo).length;
    const linhasResp = doc.splitTextToSize(respTexto, largResp).length;
    const linhas = Math.max(1, linhasTitulo, linhasResp);
    altura += linhas * lineHeight + cellPadding * 2;
  }
  return altura;
}

/** Escolhe o maior fontSize/cellPadding (medindo de verdade, não estimando) que faz a tabela caber em `alturaMax`. */
function ajustarTamanhoTabela(
  doc: jsPDF,
  tarefas: Tarefa[],
  alturaMax: number,
): { fontSize: number; cellPadding: number; coube: boolean } {
  const candidatos = [8, 7.5, 7, 6.5, 6, 5.5, 5];
  for (const fontSize of candidatos) {
    const cellPadding = Math.max(0.8, Math.round(fontSize * 0.3125 * 10) / 10); // mesma proporção do padrão 2.5/8
    if (medirAlturaTabela(doc, tarefas, fontSize, cellPadding) <= alturaMax) {
      return { fontSize, cellPadding, coube: true };
    }
  }
  return { fontSize: 5, cellPadding: 0.8, coube: false };
}

/** Gera e baixa um PDF com a lista de tarefas já filtrada, com os critérios usados no cabeçalho. */
export function gerarRelatorioTarefasPDF(
  tarefas: Tarefa[],
  filtros: RelatorioFiltrosLabel,
  clientesById: Map<string, string>,
  projetosById: Map<string, string>,
) {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(16);
  doc.text("Relatório de Tarefas — Gestão MDE", 14, 16);

  doc.setFontSize(9);
  doc.setTextColor(100);
  const infoLinhas = [
    `Período: ${filtros.periodo}    Membro: ${filtros.membro}    Cliente: ${filtros.cliente}    Projeto: ${filtros.projeto}`,
    `Gerado em: ${new Date().toLocaleString("pt-BR")}    Total de tarefas: ${tarefas.length}`,
  ];
  doc.text(infoLinhas, 14, 24);

  // Reserva espaço fixo para o bloco "Prazos" (título + donut + legenda) no
  // rodapé da mesma página e mede de verdade (não estima) quanto a tabela
  // vai ocupar, encolhendo fonte/padding o quanto for preciso pra caber
  // tudo sem cortar nada, em vez de criar outra página.
  const startY = 24 + infoLinhas.length * 5 + 3;
  const pageHeight = doc.internal.pageSize.getHeight();
  // 14 (respiro após a tabela) + 46 (do título "Prazos" até a base do
  // donut, que é o elemento mais alto do bloco: donutCy = y+26, raio 20).
  // Precisa ser o MESMO valor usado depois na checagem de segurança lá
  // embaixo — os dois já ficaram dessincronizados uma vez e causaram uma
  // quebra de página desnecessária mesmo quando a tabela cabia certinho.
  const RESERVADO_PRAZOS = 14 + 46;
  const MARGEM_INFERIOR = 10;
  const alturaDisponivelTabela = pageHeight - startY - RESERVADO_PRAZOS - MARGEM_INFERIOR;

  const { fontSize, cellPadding, coube } = ajustarTamanhoTabela(doc, tarefas, alturaDisponivelTabela);
  const pillFontSize = Math.max(5, Math.round(fontSize * 0.875 * 10) / 10);
  const pillH = Math.max(3.4, Math.round(fontSize * 0.575 * 10) / 10);
  const pillPadX = Math.max(1.2, Math.round(fontSize * 0.275 * 10) / 10);

  autoTable(doc, {
    startY,
    head: [["Título", "Cliente", "Projeto", "Responsáveis", "Status", "Prioridade", "Prazo", "Concluído em"]],
    body: tarefas.map((t) => [
      t.titulo,
      t.cliente_id ? (clientesById.get(t.cliente_id) ?? "—") : "—",
      t.projeto_id ? (projetosById.get(t.projeto_id) ?? "—") : "—",
      t.responsaveis.map((r) => r.nome).join(", ") || "—",
      t.status,
      t.prioridade,
      formatarData(t.data_vencimento),
      formatarData(t.concluido_em),
    ]),
    styles: { fontSize, cellPadding },
    headStyles: { fillColor: [123, 104, 238] },
    margin: { left: 14, right: 14 },
    // Larguras fixas: além de garantir espaço pros "pills" de Status/
    // Prioridade (cujo texto padrão é escondido, então não entra no cálculo
    // automático de largura), são o que permite medir a quebra de linha com
    // precisão antes de desenhar a tabela de verdade (ver ajustarTamanhoTabela).
    columnStyles: {
      0: { cellWidth: LARGURAS_COLUNAS[0] },
      1: { cellWidth: LARGURAS_COLUNAS[1] },
      2: { cellWidth: LARGURAS_COLUNAS[2] },
      3: { cellWidth: LARGURAS_COLUNAS[3] },
      [STATUS_COLUNA]: { cellWidth: LARGURAS_COLUNAS[4] },
      [PRIORIDADE_COLUNA]: { cellWidth: LARGURAS_COLUNAS[5] },
      6: { cellWidth: LARGURAS_COLUNAS[6] },
      7: { cellWidth: LARGURAS_COLUNAS[7] },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      // Esconde o texto padrão da célula: quem desenha Status/Prioridade é o
      // didDrawCell abaixo, como um "pill" só em volta da palavra.
      if (data.column.index === STATUS_COLUNA || data.column.index === PRIORIDADE_COLUNA) {
        data.cell.text = [];
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "body") return;
      if (data.column.index !== STATUS_COLUNA && data.column.index !== PRIORIDADE_COLUNA) return;

      const valor = String(data.cell.raw ?? "");
      const cor =
        data.column.index === STATUS_COLUNA
          ? statusCor[valor as Status]
          : prioridadeCor[valor as Prioridade];
      if (!cor) return;

      const texto = valor.toUpperCase();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(pillFontSize);
      const larguraTexto = doc.getTextWidth(texto);
      const pillW = larguraTexto + pillPadX * 2;
      const cx = data.cell.x + data.cell.width / 2;
      const cy = data.cell.y + data.cell.height / 2;
      const pillX = cx - pillW / 2;
      const pillY = cy - pillH / 2;

      doc.setDrawColor(cor);
      doc.setLineWidth(0.3);
      doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2, pillH / 2, "S");

      doc.setTextColor(cor);
      doc.text(texto, cx, cy, { align: "center", baseline: "middle" });

      // Reseta o estado global do doc para não vazar nas próximas células.
      doc.setFontSize(fontSize);
      doc.setTextColor(0);
    },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y: number;

  // Rede de segurança: só entra em cena em casos extremos (relatório com
  // tantas tarefas que nem no tamanho mínimo de fonte a tabela deixou
  // espaço) — aí sim o bloco de prazos vai pra próxima página em vez de
  // sair cortado no rodapé da primeira. Usa a MESMA reserva do orçamento
  // acima, então só dispara se a medição real destoou do que foi previsto.
  if (!coube || finalY + RESERVADO_PRAZOS > pageHeight - MARGEM_INFERIOR) {
    doc.addPage();
    y = 20;
  } else {
    y = finalY + 14;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text("Prazos", 14, y);

  const prazos = calcPrazos(tarefas);
  const buckets: PrazoBucket[] = ["no-prazo", "prestes", "expirada"];
  const donutCx = 14 + 22;
  const donutCy = y + 26;

  desenharDonutPrazos(doc, {
    cx: donutCx,
    cy: donutCy,
    outerR: 20,
    innerR: 12,
    total: prazos.total,
    segments: buckets.map((b) => ({ color: prazoColors[b], value: prazos.counts[b] })),
  });

  desenharLegendaPrazos(
    doc,
    donutCx + 34,
    y + 15,
    buckets.map((b) => ({ color: prazoColors[b], label: PRAZO_LABELS[b], count: prazos.counts[b], pct: prazos.pct[b] })),
  );

  const nomeArquivo = `relatorio-tarefas-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(nomeArquivo);
}
