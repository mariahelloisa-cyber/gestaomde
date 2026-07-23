import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PERIODO_PRESETS, type PeriodoPreset } from "@/lib/productivity";

export function PeriodFilter({
  preset,
  onPresetChange,
  customDe,
  customAte,
  onCustomChange,
}: {
  preset: PeriodoPreset;
  onPresetChange: (p: PeriodoPreset) => void;
  customDe: string;
  customAte: string;
  onCustomChange: (de: string, ate: string) => void;
}) {
  const label = PERIODO_PRESETS.find((p) => p.value === preset)?.label ?? "Período";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-[var(--surface-2)] px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {PERIODO_PRESETS.map((p) => (
            <DropdownMenuItem key={p.value} onClick={() => onPresetChange(p.value)} className="text-sm">
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {preset === "personalizado" && (
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-[var(--surface-2)] px-2 py-1.5 text-xs">
          <input
            type="date"
            value={customDe}
            onChange={(e) => onCustomChange(e.target.value, customAte)}
            className="w-[112px] bg-transparent text-xs outline-none"
          />
          <span className="text-muted-foreground">até</span>
          <input
            type="date"
            value={customAte}
            onChange={(e) => onCustomChange(customDe, e.target.value)}
            className="w-[112px] bg-transparent text-xs outline-none"
          />
        </div>
      )}
    </div>
  );
}
