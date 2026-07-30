import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Mail, Loader2, Send, Link2, Copy, RefreshCw, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTasks } from "@/lib/tasks-store";
import {
  getEmailConfig,
  saveEmailConfig,
  sendEmailTest,
  getPainelPublicoLink,
  gerarPainelPublicoLink,
  revogarPainelPublicoLink,
} from "@/lib/system-settings.functions";

export function SystemSettingsView() {
  const { myCargo } = useTasks();
  const getCfg = useServerFn(getEmailConfig);
  const saveCfg = useServerFn(saveEmailConfig);
  const sendTest = useServerFn(sendEmailTest);
  const getLinkFn = useServerFn(getPainelPublicoLink);
  const gerarLinkFn = useServerFn(gerarPainelPublicoLink);
  const revogarLinkFn = useServerFn(revogarPainelPublicoLink);

  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [webhookConfigurado, setWebhookConfigurado] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [testTo, setTestTo] = useState("");
  const [testSubject, setTestSubject] = useState("Teste de envio do painel");
  const [testMsg, setTestMsg] = useState("Olá! Esta é uma mensagem de teste enviada pelo painel.");
  const [testing, setTesting] = useState(false);

  const [painelToken, setPainelToken] = useState<string | null>(null);
  const [painelLoading, setPainelLoading] = useState(true);
  const [painelBusy, setPainelBusy] = useState(false);

  useEffect(() => {
    if (myCargo !== "Admin" && myCargo !== "Supervisor") {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const cfg = await getCfg();
        setApiKey(cfg.apiKey);
        setFromEmail(cfg.fromEmail);
        setFromName(cfg.fromName);
        setWebhookConfigurado(cfg.webhookConfigurado);
        setUpdatedAt(cfg.atualizado_em);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao carregar configurações.");
      } finally {
        setLoading(false);
      }
    })();
  }, [getCfg, myCargo]);

  useEffect(() => {
    if (myCargo !== "Admin" && myCargo !== "Supervisor") {
      setPainelLoading(false);
      return;
    }
    (async () => {
      try {
        const r = await getLinkFn();
        setPainelToken(r.token);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao carregar o painel público.");
      } finally {
        setPainelLoading(false);
      }
    })();
  }, [getLinkFn, myCargo]);

  if (myCargo !== "Admin" && myCargo !== "Supervisor") {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-muted-foreground">
          Apenas Admins e Supervisores podem acessar as configurações do sistema.
        </p>
      </div>
    );
  }

  const painelUrl =
    painelToken && typeof window !== "undefined"
      ? `${window.location.origin}/painel-publico/${painelToken}`
      : "";

  const copiarPainelLink = async () => {
    if (!painelUrl) return;
    try {
      await navigator.clipboard.writeText(painelUrl);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente.");
    }
  };

  const gerarNovoLink = async () => {
    setPainelBusy(true);
    try {
      const r = await gerarLinkFn();
      setPainelToken(r.token);
      toast.success("Novo link gerado. O link anterior parou de funcionar.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar o link.");
    } finally {
      setPainelBusy(false);
    }
  };

  const desativarLink = async () => {
    setPainelBusy(true);
    try {
      await revogarLinkFn();
      setPainelToken(null);
      toast.success("Painel público desativado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao desativar o link.");
    } finally {
      setPainelBusy(false);
    }
  };

  const onSave = async () => {
    if (!apiKey.trim() || !fromEmail.trim()) {
      toast.error("API Key e e-mail remetente são obrigatórios.");
      return;
    }
    setSaving(true);
    try {
      await saveCfg({
        data: { apiKey: apiKey.trim(), fromEmail: fromEmail.trim(), fromName: fromName.trim() },
      });
      toast.success("Configurações salvas.");
      setWebhookConfigurado(true);
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    if (!testTo.includes("@")) {
      toast.error("E-mail de destino inválido.");
      return;
    }
    setTesting(true);
    try {
      const r = await sendTest({
        data: { destinatario: testTo.trim(), assunto: testSubject, mensagem: testMsg },
      });
      if (r.ok) toast.success(`Enviado (HTTP ${r.status}).`);
      else toast.error(`Falha (HTTP ${r.status}): ${r.response.slice(0, 200)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no teste.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Configurações do sistema</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Credenciais usadas para enviar avisos automáticos por e-mail.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <h2 className="text-base font-medium">Integração Resend</h2>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="rs-key">Chave da API (Resend)</Label>
              <Input
                id="rs-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <p className="text-xs text-muted-foreground">Gere em resend.com → API Keys.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rs-from">E-mail remetente</Label>
              <Input
                id="rs-from"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="avisos@seudominio.com"
              />
              <p className="text-xs text-muted-foreground">
                Use um endereço de um domínio verificado na Resend.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rs-name">Nome do remetente (opcional)</Label>
              <Input
                id="rs-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Painel da Agência"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {updatedAt
                  ? `Atualizado em ${new Date(updatedAt).toLocaleString("pt-BR")}`
                  : "Ainda não configurado."}
              </span>
              <Button onClick={onSave} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Salvar
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {webhookConfigurado
                ? "✅ Webhook de designação de tarefa está ativo."
                : "⚠️ O webhook de designação será ativado automaticamente ao salvar."}
            </p>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          <h2 className="text-base font-medium">Enviar e-mail de teste</h2>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-to">Para</Label>
          <Input
            id="t-to"
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="voce@exemplo.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-subject">Assunto</Label>
          <Input
            id="t-subject"
            value={testSubject}
            onChange={(e) => setTestSubject(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-msg">Mensagem</Label>
          <Input id="t-msg" value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
        </div>
        <Button onClick={onTest} disabled={testing} variant="secondary">
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Enviar teste
        </Button>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-primary" />
          <h2 className="text-base font-medium">Painel público</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Link sem login para gestores acompanharem o dashboard (visão geral, tarefas por projeto e
          produtividade) em tempo quase real. Quem tiver o link não precisa de conta e não vê mais
          nenhuma outra página do sistema.
        </p>

        {painelLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : painelUrl ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={painelUrl} className="font-mono text-xs" />
              <Button type="button" variant="secondary" onClick={copiarPainelLink}>
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="secondary" disabled={painelBusy}>
                    <RefreshCw className="h-4 w-4" />
                    Gerar novo link
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Gerar um novo link?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O link atual para de funcionar imediatamente. Quem já tiver o link antigo
                      perde o acesso ao painel.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={gerarNovoLink}>Gerar novo link</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={painelBusy}
                  >
                    <Ban className="h-4 w-4" />
                    Desativar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desativar o painel público?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O link atual para de funcionar. Você pode gerar um novo depois, quando quiser.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={desativarLink}
                    >
                      Desativar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          <Button type="button" onClick={gerarNovoLink} disabled={painelBusy}>
            {painelBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            Gerar link do painel público
          </Button>
        )}
      </section>

    </div>
  );
}
