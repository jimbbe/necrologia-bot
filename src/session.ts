import { config } from "./config.js";
import { bus } from "./events.js";

export type Tipologia =
  | "partecipazione"
  | "annuncio_famiglia"
  | "anniversario"
  | "ringraziamento-trigesimo";

export interface NecrologioData {
  tipologia: Tipologia;

  // Defunto (obligatorios para todos)
  cognome_defunto: string;
  nome_defunto: string;
  nome_visualizzato?: string; // nombre completo en el orden que usó el operador (ej: "Mario Rossi" o "Rossi Mario")

  // Solo annuncio_famiglia (obligatorios en step2)
  comune_nascita?: string; // codice ISTAT (ej: "090064" = Sassari)
  comune_morte?: string; // codice ISTAT
  data_morte?: string; // formato gg/mm/aaaa — step2 para annuncio_famiglia, editor para anniversario

  // Solo anniversario (obligatorios en editor)
  titolo_necrologio?: string; // anche ringraziamento-trigesimo
  data_anniversario?: string; // formato gg/mm/aaaa

  // Editor comunes (opcionales)
  versetto?: string;
  testo_apertura?: string;
  titolo_defunto?: string;
  sottotitolo_defunto?: string;
  testo_chiusura?: string;
  localita?: string;

  // Editor extras: annuncio_famiglia, anniversario, ringraziamento-trigesimo
  testo_centrale?: string;
  onoranze_funebri?: string;

  // Visual (opcionales)
  simbolo?: "croce_cristiana" | "croce_david";

  // Foto (opcionales)
  foto_tipo?: "colore" | "bn";
  foto_colonne?: 1 | 2;
}

// Photo buffer stored separately per session (not in NecrologioData JSON)
const photoBuffers = new Map<string, Buffer>();

export function setPhoto(jid: string, buffer: Buffer): void {
  photoBuffers.set(jid, buffer);
}

export function getPhoto(jid: string): Buffer | undefined {
  return photoBuffers.get(jid);
}

export function deletePhoto(jid: string): void {
  photoBuffers.delete(jid);
}

type SessionState = "collecting" | "confirming";

interface Session {
  state: SessionState;
  data: NecrologioData | null;
  screenshotBuffer: Buffer | null;
  createdAt: number;
}

const sessions = new Map<string, Session>();
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Track last published necrologio per JID (for #elimina)
const lastPublished = new Map<string, { cognome: string; nome: string; timestamp: number }>();

export function getSession(jid: string): Session | undefined {
  return sessions.get(jid);
}

export function hasSession(jid: string): boolean {
  return sessions.has(jid);
}

export function getActiveSessionJids(): string[] {
  return Array.from(sessions.keys());
}

export function startSession(jid: string): void {
  sessions.set(jid, {
    state: "collecting",
    data: null,
    screenshotBuffer: null,
    createdAt: Date.now(),
  });
  bus.emit("session:start", jid);
}

export function setConfirming(jid: string, data: NecrologioData, screenshot: Buffer): void {
  const session = sessions.get(jid);
  if (!session) return;
  session.state = "confirming";
  session.data = data;
  session.screenshotBuffer = screenshot;
  bus.emit("session:confirming", jid, data.tipologia, `${data.cognome_defunto} ${data.nome_defunto}`);
}

export function deleteSession(jid: string, reason = "cleanup"): void {
  clearSessionTimeout(jid);
  sessions.delete(jid);
  photoBuffers.delete(jid);
  bus.emit("session:end", jid, reason);
}

export function startSessionTimeout(jid: string, onExpire: () => void): void {
  clearSessionTimeout(jid);
  const timer = setTimeout(() => {
    timeouts.delete(jid);
    onExpire();
  }, config.SESSION_TIMEOUT_MS);
  timeouts.set(jid, timer);
}

export function clearSessionTimeout(jid: string): void {
  const timer = timeouts.get(jid);
  if (timer) {
    clearTimeout(timer);
    timeouts.delete(jid);
  }
}

export function setLastPublished(jid: string, cognome: string, nome: string): void {
  lastPublished.set(jid, { cognome, nome, timestamp: Date.now() });
}

export function getLastPublished(jid: string): { cognome: string; nome: string } | undefined {
  const entry = lastPublished.get(jid);
  if (!entry) return undefined;
  // Expire after 24 hours
  if (Date.now() - entry.timestamp > 24 * 60 * 60 * 1000) {
    lastPublished.delete(jid);
    return undefined;
  }
  return { cognome: entry.cognome, nome: entry.nome };
}

export function getAllSessionsSnapshot(): Array<{
  jid: string; state: string; tipologia?: string;
  defunto?: string; createdAt: number; hasPhoto: boolean;
}> {
  return Array.from(sessions.entries()).map(([jid, s]) => ({
    jid,
    state: s.state,
    tipologia: s.data?.tipologia,
    defunto: s.data ? `${s.data.cognome_defunto} ${s.data.nome_defunto}` : undefined,
    createdAt: s.createdAt,
    hasPhoto: photoBuffers.has(jid),
  }));
}
