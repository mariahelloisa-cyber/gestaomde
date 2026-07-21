import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Calendar as CalendarIcon, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface JourneyItem {
  id: string;
  texto: string;
  data?: string; // ISO date
}

interface JourneyColumn {
  id: string;
  titulo: string;
  itens: JourneyItem[];
}

const STORAGE_KEY = "caminho-cliente-v1";

const uid = () => Math.random().toString(36).slice(2, 10);

function defaultColumns(): JourneyColumn[] {
  return Array.from({ length: 5 }).map((_, i) => ({
    id: uid(),
    titulo: `Dia ${i + 1}`,
    itens: [],
  }));
}

function load(): JourneyColumn[] {
  if (typeof window === "undefined") return defaultColumns();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultColumns();
    const parsed = JSON.parse(raw) as JourneyColumn[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultColumns();
    return parsed;
  } catch {
    return defaultColumns();
  }
}

export function ClientJourneyView() {
  const [columns, setColumns] = useState<JourneyColumn[]>(() => load());
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
    } catch {
      /* ignore */
    }
  }, [columns]);

  const updateColumn = (id: string, patch: Partial<JourneyColumn>) => {
    setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeColumn = (id: string) => {
    setColumns((cols) => cols.filter((c) => c.id !== id));
  };

  const addColumn = () => {
    setColumns((cols) => [
      ...cols,
      { id: uid(), titulo: `Dia ${cols.length + 1}`, itens: [] },
    ]);
  };

  const addItem = (colId: string) => {
    setColumns((cols) =>
      cols.map((c) =>
        c.id === colId
          ? { ...c, itens: [...c.itens, { id: uid(), texto: "" }] }
          : c,
      ),
    );
  };

  const updateItem = (colId: string, itemId: string, patch: Partial<JourneyItem>) => {
    setColumns((cols) =>
      cols.map((c) =>
        c.id === colId
          ? {
              ...c,
              itens: c.itens.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
            }
          : c,
      ),
    );
  };

  const removeItem = (colId: string, itemId: string) => {
    setColumns((cols) =>
      cols.map((c) =>
        c.id === colId ? { ...c, itens: c.itens.filter((it) => it.id !== itemId) } : c,
      ),
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Caminho percorrido pelo cliente da MDE</h1>
          <p className="text-xs text-muted-foreground">Defina cada etapa da jornada e adicione datas aos passos.</p>
        </div>
        <button
          onClick={addColumn}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova etapa
        </button>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto p-6">
        <div className="flex min-w-full gap-4">
          {columns.map((col) => (
            <JourneyColumnCard
              key={col.id}
              column={col}
              onTituloChange={(v) => updateColumn(col.id, { titulo: v })}
              onRemove={() => removeColumn(col.id)}
              onAddItem={() => addItem(col.id)}
              onItemChange={(itemId, patch) => updateItem(col.id, itemId, patch)}
              onItemRemove={(itemId) => removeItem(col.id, itemId)}
            />
          ))}

          <button
            onClick={addColumn}
            className="flex h-12 w-72 shrink-0 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar etapa
          </button>
        </div>
      </div>
    </div>
  );
}

function JourneyColumnCard({
  column,
  onTituloChange,
  onRemove,
  onAddItem,
  onItemChange,
  onItemRemove,
}: {
  column: JourneyColumn;
  onTituloChange: (v: string) => void;
  onRemove: () => void;
  onAddItem: () => void;
  onItemChange: (itemId: string, patch: Partial<JourneyItem>) => void;
  onItemRemove: (itemId: string) => void;
}) {
  return (
    <div className="group flex w-72 shrink-0 flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <input
          value={column.titulo}
          onChange={(e) => onTituloChange(e.target.value)}
          className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none focus:ring-0"
          placeholder="Título da etapa"
        />
        <button
          onClick={onRemove}
          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
          aria-label="Remover etapa"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {column.itens.map((item) => (
          <JourneyItemRow
            key={item.id}
            item={item}
            onChange={(patch) => onItemChange(item.id, patch)}
            onRemove={() => onItemRemove(item.id)}
          />
        ))}

        <button
          onClick={onAddItem}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Adicionar passo
        </button>
      </div>
    </div>
  );
}

function JourneyItemRow({
  item,
  onChange,
  onRemove,
}: {
  item: JourneyItem;
  onChange: (patch: Partial<JourneyItem>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dataObj = item.data ? new Date(item.data) : undefined;
  const dataLabel = dataObj
    ? dataObj.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : null;

  return (
    <div className="group/item rounded-md border border-border bg-white p-2 transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-1">
        <input
          value={item.texto}
          onChange={(e) => onChange({ texto: e.target.value })}
          placeholder="Descreva o passo..."
          className="flex-1 bg-transparent text-sm text-black outline-none placeholder:text-muted-foreground/60"
        />
        <button
          onClick={onRemove}
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/item:opacity-100"
          aria-label="Remover passo"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
                dataLabel
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <CalendarIcon className="h-3 w-3" />
              {dataLabel ?? "Adicionar data"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dataObj}
              onSelect={(d) => {
                onChange({ data: d ? d.toISOString() : undefined });
                setOpen(false);
              }}
              initialFocus
            />
            {item.data && (
              <div className="border-t border-border p-2">
                <button
                  onClick={() => {
                    onChange({ data: undefined });
                    setOpen(false);
                  }}
                  className="w-full rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Remover data
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}