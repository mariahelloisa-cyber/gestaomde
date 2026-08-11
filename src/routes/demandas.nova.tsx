import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createDemandaExterna } from "@/lib/demandas.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Building2,
  Calendar,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Lock,
  Mail,
  Mic,
  Plus,
  Send,
  Square,
  Trash2,
  UploadCloud,
  User,
  Video,
  X,
} from "lucide-react";

const AUDIO_MIME_CANDIDATOS = ["audio/webm", "audio/mp4", "audio/ogg"];
const AUDIO_DURACAO_MAX_SEG = 180;
const DESCRICAO_MAX = 5000;
const ANEXO_TAMANHO_MAX_MB = 10;
const VIDEO_TAMANHO_MAX_MB = 50;

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

function FieldRow({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}

function NovaDemandaPage() {
  const createFn = useServerFn(createDemandaExterna);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [setor, setSetor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prazo, setPrazo] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

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
      videoUrl && URL.revokeObjectURL(videoUrl);
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
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mime || "audio/webm",
        });
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
      if (f.type !== "application/pdf" && !f.type.startsWith("image/")) {
        toast.error(`"${f.name}" não é PDF nem imagem.`);
        continue;
      }
      if (f.size > ANEXO_TAMANHO_MAX_MB * 1024 * 1024) {
        toast.error(`"${f.name}" passa de ${ANEXO_TAMANHO_MAX_MB} MB.`);
        continue;
      }
      novos.push(f);
    }
    setArquivos((prev) => [...prev, ...novos].slice(0, 10));
  };

  const remover = (idx: number) => setArquivos((prev) => prev.filter((_, i) => i !== idx));

  const onVideo = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error(`"${f.name}" não é um vídeo.`);
      return;
    }
    if (f.size > VIDEO_TAMANHO_MAX_MB * 1024 * 1024) {
      toast.error(`"${f.name}" passa de ${VIDEO_TAMANHO_MAX_MB} MB.`);
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(f);
    setVideoUrl(URL.createObjectURL(f));
  };

  const removerVideo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl(null);
  };

  const enviar = async () => {
    if (!nome.trim() || !descricao.trim()) {
      toast.error("Preencha seu nome e a descrição.");
      return;
    }
    setEnviando(true);
    try {
      const anexos: Array<{ path: string; nome_arquivo: string }> = [];
      for (const file of arquivos) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${crypto.randomUUID()}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("demandas-anexos")
          .upload(path, file, { contentType: file.type, upsert: false });
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

      let video: { path: string; nome_arquivo: string } | undefined;
      if (videoFile) {
        const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${crypto.randomUUID()}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("demandas-anexos")
          .upload(path, videoFile, { contentType: videoFile.type || "video/mp4", upsert: false });
        if (upErr) throw new Error(`Falha no upload do vídeo: ${upErr.message}`);
        video = { path, nome_arquivo: videoFile.name };
      }

      await createFn({
        data: {
          solicitante_nome: nome.trim(),
          solicitante_email: email.trim() || undefined,
          setor: setor.trim() || undefined,
          descricao: descricao.trim(),
          prazo_sugerido: prazo || undefined,
          anexos,
          audio,
          video,
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
      <div className="flex min-h-screen items-center justify-center bg-white px-4 py-16">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
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
              setSetor("");
              setDescricao("");
              setPrazo("");
              setArquivos([]);
              removerAudio();
              removerVideo();
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
    <div className="min-h-screen bg-white py-10">
      <div className="mx-auto max-w-2xl px-4">
        <header className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Plus className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Nova Demanda</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Preencha os campos abaixo e envie sua solicitação para a equipe.
            </p>
          </div>
        </header>

        <div className="space-y-6 rounded-2xl border border-border bg-white p-6 shadow-sm sm:p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <FieldRow icon={User}>
              <Label htmlFor="nome" className="font-semibold">
                Seu nome *
              </Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={200}
                placeholder="Digite seu nome completo"
              />
            </FieldRow>

            <FieldRow icon={Mail}>
              <Label htmlFor="email" className="font-semibold">
                E-mail (opcional)
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={255}
                placeholder="Digite seu e-mail"
              />
            </FieldRow>
          </div>

          <FieldRow icon={Building2}>
            <Label htmlFor="setor" className="font-semibold">
              Qual é o seu setor?
            </Label>
            <Input
              id="setor"
              value={setor}
              onChange={(e) => setSetor(e.target.value)}
              maxLength={100}
              placeholder="Ex: secretaria, comercial"
            />
          </FieldRow>

          <FieldRow icon={FileText}>
            <Label htmlFor="descricao" className="font-semibold">
              Descrição *
            </Label>
            <Textarea
              id="descricao"
              rows={6}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={DESCRICAO_MAX}
              placeholder="Detalhe a demanda, contexto, objetivos…"
            />
            <div className="text-right text-xs text-muted-foreground">
              {descricao.length}/{DESCRICAO_MAX}
            </div>
          </FieldRow>

          <FieldRow icon={Calendar}>
            <Label htmlFor="prazo" className="font-semibold">
              Prazo sugerido
            </Label>
            <Input
              id="prazo"
              type="date"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
            />
          </FieldRow>

          <FieldRow icon={FileText}>
            <Label className="font-semibold">Anexos (PDF ou imagem — até 10 arquivos)</Label>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setArrastandoArquivo(true);
              }}
              onDragLeave={() => setArrastandoArquivo(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastandoArquivo(false);
                onFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-background px-4 py-8 text-center transition-colors hover:bg-muted",
                arrastandoArquivo && "border-primary bg-primary/5",
              )}
            >
              <UploadCloud className="mb-1 h-6 w-6 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                Clique para selecionar PDFs ou fotos
              </span>
              <span className="text-xs text-muted-foreground">
                Ou arraste e solte os arquivos aqui
              </span>
              <input
                type="file"
                accept="application/pdf,image/*"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Máximo de 10 arquivos • Formatos: PDF ou imagem • Tamanho máximo por arquivo:{" "}
              {ANEXO_TAMANHO_MAX_MB}MB
            </p>
            {arquivos.length > 0 && (
              <ul className="space-y-1">
                {arquivos.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{f.name}</span>
                    </span>
                    <button
                      onClick={() => remover(i)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FieldRow>

          <hr className="border-border" />

          <FieldRow icon={Mic}>
            <Label className="font-semibold">
              Áudio (opcional — até {formatarDuracao(AUDIO_DURACAO_MAX_SEG)})
            </Label>
            {!audioUrl && !gravando && (
              <button
                type="button"
                onClick={iniciarGravacao}
                className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-background px-4 py-8 text-center transition-colors hover:bg-muted"
              >
                <Mic className="mb-1 h-6 w-6 text-primary" />
                <span className="text-sm font-semibold text-foreground">Gravar um áudio</span>
                <span className="text-xs text-muted-foreground">
                  Clique para iniciar a gravação
                </span>
              </button>
            )}
            {gravando && (
              <div className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3">
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
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <audio controls src={audioUrl} className="h-9 flex-1" />
                <button
                  onClick={removerAudio}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  title="Remover áudio"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Duração máxima: {formatarDuracao(AUDIO_DURACAO_MAX_SEG)}
            </p>
          </FieldRow>

          <FieldRow icon={Video}>
            <Label className="font-semibold">Vídeo (opcional)</Label>
            {!videoUrl && (
              <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-background px-4 py-8 text-center transition-colors hover:bg-muted">
                <Video className="mb-1 h-6 w-6 text-primary" />
                <span className="text-sm font-semibold text-foreground">
                  Clique para selecionar um vídeo
                </span>
                <span className="text-xs text-muted-foreground">
                  Até {VIDEO_TAMANHO_MAX_MB}MB
                </span>
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => onVideo(e.target.files)}
                />
              </label>
            )}
            {videoUrl && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <video controls src={videoUrl} className="max-h-64 w-full flex-1 rounded-lg" />
                <button
                  onClick={removerVideo}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  title="Remover vídeo"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Tamanho máximo: {VIDEO_TAMANHO_MAX_MB}MB
            </p>
          </FieldRow>

          <Button onClick={enviar} disabled={enviando} className="h-12 w-full rounded-xl text-base">
            {enviando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {enviando ? "Enviando…" : "Enviar demanda"}
          </Button>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Suas informações estão seguras e serão utilizadas apenas para atendimento da sua
          solicitação.
        </p>
      </div>
    </div>
  );
}
