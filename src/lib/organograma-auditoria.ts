/**
 * Regras de data da auditoria periódica dos nós do organograma que têm link
 * (redes sociais, site, etc). Compartilhado entre a UI (mostra o check verde/
 * vermelho) e o hook de cron (dispara os avisos no Telegram) para as duas
 * pontas nunca divergirem sobre o que conta como "em dia".
 */

/** Dias fixos do mês em que a auditoria precisa ter sido feita. */
export const AUDITORIA_DIAS_FIXOS = [1, 10, 20, 30];

function checkpointsProximos(referencia: Date): Date[] {
  const candidatos: Date[] = [];
  for (const deltaMes of [-1, 0, 1]) {
    for (const dia of AUDITORIA_DIAS_FIXOS) {
      candidatos.push(new Date(referencia.getFullYear(), referencia.getMonth() + deltaMes, dia));
    }
  }
  return candidatos.sort((a, b) => a.getTime() - b.getTime());
}

/** Checkpoint mais recente, incluindo o de hoje — início do período de auditoria em vigor. */
export function inicioPeriodoAuditoria(referencia: Date): Date {
  const passados = checkpointsProximos(referencia).filter((d) => d.getTime() <= referencia.getTime());
  return passados[passados.length - 1];
}

/** Último checkpoint estritamente antes de hoje — início do período que acabou de fechar. */
export function checkpointAnterior(referencia: Date): Date {
  const passados = checkpointsProximos(referencia).filter((d) => d.getTime() < referencia.getTime());
  return passados[passados.length - 1];
}

/** Próximo checkpoint que ainda não chegou. */
export function proximoCheckpoint(referencia: Date): Date {
  const futuros = checkpointsProximos(referencia).filter((d) => d.getTime() > referencia.getTime());
  return futuros[0];
}

export function auditoriaEmDia(marcadaEm: string | null, referencia: Date = new Date()): boolean {
  if (!marcadaEm) return false;
  return new Date(marcadaEm).getTime() >= inicioPeriodoAuditoria(referencia).getTime();
}

export function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Agora" no fuso de Brasília, com hora zerada — para o cron comparar datas por dia. */
export function hojeBrasil(): Date {
  const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  agora.setHours(0, 0, 0, 0);
  return agora;
}
