import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Home, GraduationCap, LogOut, Menu, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { listTreinamentos, getMyPortalContext } from "@/lib/treinamentos.functions";
import logoMde from "@/assets/logo-mde.png.asset.json";

type Tab = "inicio" | "treinamentos";

export function ClientPortal() {
  const [tab, setTab] = useState<Tab>("inicio");
  const [expanded, setExpanded] = useState(true);

  const ctxFn = useServerFn(getMyPortalContext);
  const { data: ctx } = useQuery({ queryKey: ["portal-ctx"], queryFn: () => ctxFn() });

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside
        className={cn(
          "flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          expanded ? "w-60" : "w-14",
        )}
      >
        <div className={cn("flex items-center border-b border-sidebar-border py-2.5", expanded ? "gap-2 px-3" : "justify-center px-2")}>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent"
            aria-label="Menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          {expanded && (
            <>
              <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md bg-white">
                <img src={logoMde.url} alt="Logo" className="h-6 w-6 object-contain" />
              </div>
              <div className="flex-1 truncate text-sm font-medium">Portal Cliente</div>
            </>
          )}
        </div>

        <nav className="flex-1 px-2 pt-3">
          <PortalNav icon={Home} label="Início" expanded={expanded} active={tab === "inicio"} onClick={() => setTab("inicio")} />
          <PortalNav icon={GraduationCap} label="Treinamentos" expanded={expanded} active={tab === "treinamentos"} onClick={() => setTab("treinamentos")} />
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <PortalNav icon={LogOut} label="Sair" expanded={expanded} active={false} onClick={() => { supabase.auth.signOut(); }} />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        {tab === "inicio" ? (
          <PortalHome nome={ctx?.nome ?? ""} cliente={ctx?.cliente_nome ?? null} plano={ctx?.plano ?? null} />
        ) : (
          <PortalTreinamentos />
        )}
      </main>
    </div>
  );
}

function PortalNav({ icon: Icon, label, expanded, active, onClick }: { icon: typeof Home; label: string; expanded: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "mt-1 flex w-full items-center rounded-md text-sm transition-colors",
        expanded ? "gap-2.5 px-2.5 py-1.5" : "justify-center px-0 py-2",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/90 hover:bg-sidebar-accent/60",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
    </button>
  );
}

function PortalHome({ nome, cliente, plano }: { nome: string; cliente: string | null; plano: string | null }) {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold text-foreground">Olá, {nome || "Cliente"}!</h1>
      <p className="mt-2 text-muted-foreground">Bem-vindo ao seu espaço MDE</p>
      {cliente && (
        <div className="mt-6 rounded-lg border border-border bg-card p-5">
          <div className="text-sm text-muted-foreground">Sua empresa</div>
          <div className="mt-1 text-lg font-medium text-foreground">{cliente}</div>
          {plano && <div className="mt-1 text-xs text-muted-foreground">Plano: {plano}</div>}
        </div>
      )}
    </div>
  );
}

function toEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
    return null;
  } catch { return null; }
}

function PortalTreinamentos() {
  const listFn = useServerFn(listTreinamentos);
  const { data = [], isLoading } = useQuery({ queryKey: ["treinamentos"], queryFn: () => listFn() });

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-foreground">Treinamentos</h1>
      <p className="mt-1 text-sm text-muted-foreground">Conteúdos disponíveis para o seu plano.</p>

      {isLoading ? (
        <div className="mt-8 text-sm text-muted-foreground">Carregando...</div>
      ) : data.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum treinamento disponível no momento.
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => <TreinamentoCard key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

function TreinamentoCard({ t }: { t: { id: string; titulo: string; descricao: string | null; url_video: string; tipo: "video" | "pdf"; capa_url: string | null } }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [capaUrl, setCapaUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!t.capa_url) { setCapaUrl(null); return; }
    const m = t.capa_url.match(/^supabase:\/\/([^/]+)\/(.+)$/);
    if (!m) { setCapaUrl(t.capa_url); return; }
    const [, bucket, path] = m;
    supabase.storage.from(bucket).createSignedUrl(path, 60 * 60).then(({ data }) => {
      if (data?.signedUrl) setCapaUrl(data.signedUrl);
    });
  }, [t.capa_url]);

  async function abrirPdf() {
    if (loading) return;
    setLoading(true);
    try {
      const m = t.url_video.match(/^supabase:\/\/([^/]+)\/(.+)$/);
      let downloadUrl = t.url_video;
      if (m) {
        const [, bucket, path] = m;
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
        if (error || !data?.signedUrl) throw error ?? new Error("Falha ao gerar link");
        downloadUrl = data.signedUrl;
      }
      // Baixa via fetch e cria blob URL — evita bloqueio por extensões (ERR_BLOCKED_BY_CLIENT em *.supabase.co)
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error("Falha ao baixar PDF");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      setPdfUrl(objectUrl);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error(e);
      alert("Não foi possível abrir o PDF. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  if (t.tipo === "pdf") {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
          {capaUrl ? (
            <img src={capaUrl} alt={t.titulo} className="h-full w-full object-cover" />
          ) : (
            <FileText className="h-16 w-16 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-1 flex-col bg-white p-4">
          <h3 className="font-medium text-black">{t.titulo}</h3>
          {t.descricao && <p className="mt-1 text-sm text-black/70 line-clamp-3">{t.descricao}</p>}
          <div className="mt-auto flex gap-2 pt-3">
          <button
            type="button"
            onClick={abrirPdf}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground",
              loading && "opacity-50",
            )}
          >
            <FileText className="h-3.5 w-3.5" /> {loading ? "Carregando..." : "Abrir PDF"}
          </button>
          </div>
        </div>
      </div>
    );
  }

  const embed = toEmbedUrl(t.url_video);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="aspect-video bg-black">
        {embed ? (
          <iframe src={embed} className="h-full w-full" allowFullScreen title={t.titulo} />
        ) : (
          <a href={t.url_video} target="_blank" rel="noreferrer" className="flex h-full items-center justify-center text-sm text-white/80 underline">
            Abrir vídeo
          </a>
        )}
      </div>
      <div className="flex flex-1 flex-col bg-white p-4">
        <h3 className="font-medium text-black">{t.titulo}</h3>
        {t.descricao && <p className="mt-1 text-sm text-black/70 line-clamp-3">{t.descricao}</p>}
      </div>
    </div>
  );
}