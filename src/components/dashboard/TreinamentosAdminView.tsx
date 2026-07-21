import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listTreinamentos,
  createTreinamento,
  updateTreinamento,
  deleteTreinamento,
} from "@/lib/treinamentos.functions";

const PLANOS = ["Todos", "Bronze", "Prata", "Ouro", "Diamond"] as const;
type Plano = typeof PLANOS[number];
type Tipo = "video" | "pdf";

type Treinamento = Awaited<ReturnType<typeof listTreinamentos>>[number];

export function TreinamentosAdminView() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTreinamentos);
  const createFn = useServerFn(createTreinamento);
  const updateFn = useServerFn(updateTreinamento);
  const deleteFn = useServerFn(deleteTreinamento);

  const { data = [], isLoading } = useQuery({ queryKey: ["treinamentos"], queryFn: () => listFn() });

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [url, setUrl] = useState("");
  const [planos, setPlanos] = useState<Plano[]>(["Todos"]);
  const [tipo, setTipo] = useState<Tipo>("video");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [capaFile, setCapaFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [editing, setEditing] = useState<Treinamento | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["treinamentos"] });

  const createMut = useMutation({
    mutationFn: async () => {
      let finalUrl = url;
      let capaUrl: string | null = null;
      if (tipo === "pdf" && pdfFile) {
        setUploading(true);
        const path = `${Date.now()}-${pdfFile.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("treinamentos-pdfs").upload(path, pdfFile, { contentType: "application/pdf" });
        setUploading(false);
        if (upErr) throw new Error(upErr.message);
        finalUrl = `supabase://treinamentos-pdfs/${path}`;
      }
      if (tipo === "pdf" && capaFile) {
        setUploading(true);
        const ext = capaFile.name.split(".").pop() || "jpg";
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("treinamentos-capas").upload(path, capaFile, { contentType: capaFile.type || "image/jpeg" });
        setUploading(false);
        if (upErr) throw new Error(upErr.message);
        capaUrl = `supabase://treinamentos-capas/${path}`;
      }
      return createFn({ data: { titulo, descricao: descricao || undefined, url_video: finalUrl, plano_destino: planos, tipo, capa_url: capaUrl } });
    },
    onSuccess: () => {
      toast.success("Treinamento cadastrado");
      setTitulo(""); setDescricao(""); setUrl(""); setPlanos(["Todos"]); setTipo("video"); setPdfFile(null); setCapaFile(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao cadastrar"),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; patch: { titulo: string; descricao: string; url_video: string; plano_destino: Plano[]; tipo: Tipo; capa_url: string | null } }) =>
      updateFn({ data: vars }),
    onSuccess: () => { toast.success("Atualizado"); setEditing(null); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Excluído"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir"),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8 text-black">
      <header>
        <h1 className="text-2xl font-semibold text-black">Gerenciar Treinamentos</h1>
        <p className="text-sm text-black/70">Cadastre vídeos do YouTube ou Vimeo e defina quais planos terão acesso.</p>
      </header>

      <section className="rounded-lg border border-border bg-white p-5 text-black">
        <h2 className="mb-4 text-sm font-semibold text-black">Novo treinamento</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-black">Título</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Como criar campanhas no Meta Ads" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-black">Tipo de conteúdo</Label>
            <Select value={tipo} onValueChange={(v) => { setTipo(v as Tipo); setUrl(""); setPdfFile(null); }}>
              <SelectTrigger className="text-black"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Vídeo (YouTube/Vimeo)</SelectItem>
                <SelectItem value="pdf">PDF (upload)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            {tipo === "video" ? (
              <>
                <Label className="text-black">URL do vídeo (YouTube/Vimeo)</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
              </>
            ) : (
              <>
                <Label className="text-black">Arquivo PDF</Label>
                <Input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} />
                {pdfFile && <p className="text-xs text-black/70">Selecionado: {pdfFile.name}</p>}
                <div className="pt-2">
                  <Label className="text-black">Imagem de capa (opcional)</Label>
                  <Input type="file" accept="image/*" onChange={(e) => setCapaFile(e.target.files?.[0] ?? null)} />
                  {capaFile && <p className="text-xs text-black/70">Selecionada: {capaFile.name}</p>}
                </div>
              </>
            )}
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-black">Descrição</Label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-black">Planos com acesso</Label>
            <PlanosPicker value={planos} onChange={setPlanos} />
          </div>
          <div className="sm:col-span-2 flex items-end">
            <Button
              onClick={() => createMut.mutate()}
              disabled={
                createMut.isPending || uploading || !titulo || planos.length === 0 ||
                (tipo === "video" ? !url : !pdfFile)
              }
            >
              {uploading ? "Enviando PDF..." : createMut.isPending ? "Salvando..." : "Cadastrar"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-white text-black">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-black">Título</TableHead>
              <TableHead className="text-black">Tipo</TableHead>
              <TableHead className="text-black">Plano</TableHead>
              <TableHead className="text-black">URL</TableHead>
              <TableHead className="w-24 text-right text-black">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-black/70">Carregando...</TableCell></TableRow>
            )}
            {!isLoading && data.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-black/70">Nenhum treinamento cadastrado.</TableCell></TableRow>
            )}
            {data.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium text-black">{t.titulo}</TableCell>
                <TableCell><Badge variant="outline">{t.tipo === "pdf" ? "PDF" : "Vídeo"}</Badge></TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {t.plano_destino.map((p) => (
                      <Badge key={p} variant="secondary">{p}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="max-w-[280px] truncate text-xs text-black/70">
                  <span className="truncate">{t.url_video}</span>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => setEditing(t)} aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Excluir este treinamento?")) deleteMut.mutate(t.id); }} aria-label="Excluir">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <EditDialog editing={editing} onClose={() => setEditing(null)} onSave={(patch) => editing && updateMut.mutate({ id: editing.id, patch })} saving={updateMut.isPending} />
    </div>
  );
}

function EditDialog({ editing, onClose, onSave, saving }: {
  editing: Treinamento | null;
  onClose: () => void;
  onSave: (patch: { titulo: string; descricao: string; url_video: string; plano_destino: Plano[]; tipo: Tipo; capa_url: string | null }) => void;
  saving: boolean;
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [url, setUrl] = useState("");
  const [planos, setPlanos] = useState<Plano[]>(["Todos"]);
  const [tipo, setTipo] = useState<Tipo>("video");
  const [capaUrl, setCapaUrl] = useState<string | null>(null);
  const [capaUploading, setCapaUploading] = useState(false);

  useEffect(() => {
    if (editing) {
      setTitulo(editing.titulo);
      setDescricao(editing.descricao ?? "");
      setUrl(editing.url_video);
      setPlanos((editing.plano_destino as Plano[]) ?? ["Todos"]);
      setTipo((editing.tipo as Tipo) ?? "video");
      setCapaUrl(editing.capa_url ?? null);
    }
  }, [editing]);

  async function onPickCapa(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCapaUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("treinamentos-capas").upload(path, file, { contentType: file.type || "image/jpeg" });
      if (error) { toast.error(error.message); return; }
      setCapaUrl(`supabase://treinamentos-capas/${path}`);
    } finally { setCapaUploading(false); }
  }

  return (
    <Dialog open={!!editing} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-white text-black">
        <DialogHeader><DialogTitle className="text-black">Editar treinamento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-black">Título</Label><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label className="text-black">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as Tipo)}>
              <SelectTrigger className="text-black"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Vídeo</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-black">{tipo === "pdf" ? "Caminho do PDF" : "URL"}</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            {tipo === "pdf" && <p className="text-xs text-black/70">Para substituir o arquivo, exclua e cadastre novamente.</p>}
          </div>
          <div className="space-y-1.5"><Label className="text-black">Descrição</Label><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} /></div>
          {tipo === "pdf" && (
            <div className="space-y-1.5">
              <Label className="text-black">Imagem de capa</Label>
              <Input type="file" accept="image/*" onChange={onPickCapa} disabled={capaUploading} />
              {capaUploading && <p className="text-xs text-black/70">Enviando...</p>}
              {capaUrl && !capaUploading && (
                <div className="flex items-center gap-2 text-xs text-black/70">
                  <span className="truncate">{capaUrl}</span>
                  <Button size="sm" variant="ghost" onClick={() => setCapaUrl(null)}>Remover</Button>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-black">Planos com acesso</Label>
            <PlanosPicker value={planos} onChange={setPlanos} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave({ titulo, descricao, url_video: url, plano_destino: planos, tipo, capa_url: tipo === "pdf" ? capaUrl : null })} disabled={saving || planos.length === 0 || capaUploading}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanosPicker({ value, onChange }: { value: Plano[]; onChange: (v: Plano[]) => void }) {
  const toggle = (p: Plano) => {
    if (p === "Todos") {
      onChange(value.includes("Todos") ? [] : ["Todos"]);
      return;
    }
    const next = value.includes(p) ? value.filter((x) => x !== p) : [...value.filter((x) => x !== "Todos"), p];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-3 rounded-md border border-border bg-white p-3 text-black">
      {PLANOS.map((p) => (
        <label key={p} className="flex cursor-pointer items-center gap-2 text-sm text-black">
          <Checkbox checked={value.includes(p)} onCheckedChange={() => toggle(p)} />
          <span>{p}</span>
        </label>
      ))}
    </div>
  );
}