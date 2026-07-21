import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createDemandaExterna } from "@/lib/demandas.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, X, FileText, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/demandas/nova")({
  head: () => ({
    meta: [
      { title: "Nova Demanda — Portal Externo" },
      { name: "description", content: "Envie uma nova solicitação para a equipe." },
    ],
  }),
  component: NovaDemandaPage,
});

function NovaDemandaPage() {
  const createFn = useServerFn(createDemandaExterna);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prazo, setPrazo] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const novos: File[] = [];
    for (const f of Array.from(files)) {
      if (f.type !== "application/pdf") {
        toast.error(`"${f.name}" não é PDF.`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`"${f.name}" passa de 10 MB.`);
        continue;
      }
      novos.push(f);
    }
    setArquivos((prev) => [...prev, ...novos].slice(0, 10));
  };

  const remover = (idx: number) => setArquivos((prev) => prev.filter((_, i) => i !== idx));

  const enviar = async () => {
    if (!nome.trim() || !descricao.trim()) {
      toast.error("Preencha seu nome e a descrição.");
      return;
    }
    setEnviando(true);
    try {
      const anexos: Array<{ path: string; nome_arquivo: string }> = [];
      for (const file of arquivos) {
        const ext = file.name.split(".").pop() ?? "pdf";
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${crypto.randomUUID()}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("demandas-anexos")
          .upload(path, file, { contentType: "application/pdf", upsert: false });
        if (upErr) throw new Error(`Falha no upload de "${file.name}": ${upErr.message}`);
        anexos.push({ path, nome_arquivo: file.name });
      }

      await createFn({
        data: {
          solicitante_nome: nome.trim(),
          solicitante_email: email.trim() || undefined,
          descricao: descricao.trim(),
          prazo_sugerido: prazo || undefined,
          anexos,
        },
      });
      setEnviado(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar demanda.");
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="min-h-screen bg-[var(--surface-1)] py-16">
        <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-10 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-4 text-xl font-semibold">Demanda enviada!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Nossa equipe receberá a solicitação e dará retorno em breve.
          </p>
          <Button
            className="mt-6"
            onClick={() => {
              setNome("");
              setEmail("");
              setDescricao("");
              setPrazo("");
              setArquivos([]);
              setEnviado(false);
            }}
          >
            Enviar outra demanda
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--surface-1)] py-10">
      <div className="mx-auto max-w-2xl px-4">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold">Nova Demanda</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Preencha os campos abaixo e envie sua solicitação para a equipe.
          </p>
        </header>

        <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="grid gap-2">
            <Label htmlFor="nome">Seu nome *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={200} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">E-mail (opcional)</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="descricao">Descrição *</Label>
            <Textarea
              id="descricao"
              rows={6}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={5000}
              placeholder="Detalhe a demanda, contexto, objetivos…"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prazo">Prazo sugerido</Label>
            <Input id="prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label>Anexos (PDF — até 10 arquivos)</Label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground hover:bg-muted">
              <Upload className="h-4 w-4" />
              Clique para selecionar PDFs
              <input
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            {arquivos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {arquivos.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 truncate">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{f.name}</span>
                    </span>
                    <button onClick={() => remover(i)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button onClick={enviar} disabled={enviando} className="w-full">
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {enviando ? "Enviando…" : "Enviar demanda"}
          </Button>
        </div>
      </div>
    </div>
  );
}