import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createDemandaExterna } from "@/lib/demandas.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, X, FileText, CheckCircle2, Mic, Square, Trash2 } from "lucide-react";

const AUDIO_MIME_CANDIDATOS = ["audio/webm", "audio/mp4", "audio/ogg"];
const AUDIO_DURACAO_MAX_SEG = 180;

function mimeSuportado(): string {
  for (const mime of AUDIO_MIME_CANDIDATOS) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

function extensaoParaMime(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function formatarDuracao(seg: number): string {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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

  const [gravando, setGravando] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duracaoSeg, setDuracaoSeg] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      timerRef.current && clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioUrl && URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pararGravacao = () => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setGravando(false);
  };

  const iniciarGravacao = async () => {
    const mime = mimeSuportado();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      setDuracaoSeg(0);
      recorder.start();
      setGravando(true);
      timerRef.current = setInterval(() => {
        setDuracaoSeg((s) => {
          const next = s + 1;
          if (next >= AUDIO_DURACAO_MAX_SEG) pararGravacao();
          return next;
        });
      }, 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  };

  const removerAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setDuracaoSeg(0);
  };

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

      let audio: { path: string; nome_arquivo: string; duracao_seg: number } | undefined;
      if (audioBlob) {
        const ext = extensaoParaMime(audioBlob.type);
        const path = `${crypto.randomUUID()}/${Date.now()}-audio.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("demandas-anexos")
          .upload(path, audioBlob, { contentType: audioBlob.type || "audio/webm", upsert: false });
        if (upErr) throw new Error(`Falha no upload do áudio: ${upErr.message}`);
        audio = { path, nome_arquivo: `audio.${ext}`, duracao_seg: duracaoSeg };
      }

      await createFn({
        data: {
          solicitante_nome: nome.trim(),
          solicitante_email: email.trim() || undefined,
          descricao: descricao.trim(),
          prazo_sugerido: prazo || undefined,
          anexos,
          audio,
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
              removerAudio();
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

          <div className="grid gap-2">
            <Label>Áudio (opcional — até {formatarDuracao(AUDIO_DURACAO_MAX_SEG)})</Label>
            {!audioUrl && !gravando && (
              <button
                type="button"
                onClick={iniciarGravacao}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground hover:bg-muted"
              >
                <Mic className="h-4 w-4" />
                Gravar um áudio
              </button>
            )}
            {gravando && (
              <div className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-destructive">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
                  Gravando… {formatarDuracao(duracaoSeg)}
                </span>
                <Button size="sm" variant="destructive" onClick={pararGravacao}>
                  <Square className="mr-1 h-3.5 w-3.5" /> Parar
                </Button>
              </div>
            )}
            {audioUrl && !gravando && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <audio controls src={audioUrl} className="h-9 flex-1" />
                <button onClick={removerAudio} className="text-muted-foreground hover:text-destructive" title="Remover áudio">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
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