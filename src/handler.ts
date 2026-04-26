import { sendMessage, sendImage } from "./whatsapp.js";
import { chat, clearChatHistory } from "./ai/chat.js";
import {
  getSession,
  hasSession,
  startSession,
  setConfirming,
  deleteSession,
  startSessionTimeout,
  setLastPublished,
  getLastPublished,
  setPhoto,
  getPhoto,
  getActiveSessionJids,
} from "./session.js";
import type { NecrologioData } from "./session.js";
import { fillFormAndScreenshot, submitForm } from "./browser/form.js";
import { cancelNecrologio } from "./browser/cancel.js";
import { closeBrowser } from "./browser/helpers.js";
import { generateTextPreview } from "./preview.js";
import { config } from "./config.js";
import { bus } from "./events.js";

const TAG_NECRO = "#necro";
const TAG_CANCELLA = "#cancella";
const TAG_CONFERMA = "#conferma";
const TAG_RIFIUTA = "#rifiuta";
const TAG_ELIMINA = "#elimina";

// Track if browser is busy (singleton: one confirming at a time)
let browserBusyJid: string | null = null;

// Per-JID message processing lock to prevent concurrent handling
const processingLock = new Map<string, Promise<void>>();

// Restart the form fill flow from scratch when user requests a change while in confirming state.
// Clears chat history so the AI works from verified data, not hallucinated updates.
async function restartWithChange(jid: string, currentData: NecrologioData, changeRequest: string): Promise<void> {
  if (browserBusyJid === jid) {
    await closeBrowser();
    browserBusyJid = null;
    bus.emit("browser:busy", null);
  }
  clearChatHistory(jid);
  startSession(jid);
  startSessionTimeout(jid, makeTimeoutCallback(jid));

  const dataFields = (Object.entries(currentData) as [string, unknown][])
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const contextMessage = `Stavo inserendo questo necrologio con i seguenti dati:\n${dataFields}\n\n${changeRequest}\n\nApplica la modifica, verifica che tutti i dati siano corretti, mostra il riepilogo aggiornato come verrà pubblicato e chiedi conferma all'operatore.`;

  const response = await chat(jid, contextMessage);
  await handleAiResponse(jid, response);
}

async function cleanupSession(jid: string, reason = "cleanup"): Promise<void> {
  clearChatHistory(jid);
  deleteSession(jid, reason);
  if (browserBusyJid === jid) {
    await closeBrowser();
    browserBusyJid = null;
    bus.emit("browser:busy", null);
  }
}

function makeTimeoutCallback(jid: string): () => void {
  return async () => {
    console.log(`⏰ Sessione scaduta per timeout per ${jid}`);
    await cleanupSession(jid);
    await sendMessage(
      jid,
      "⏰ La sessione è scaduta per inattività (30 min). Nessun necrologio è stato pubblicato. Invia #necro per ricominciare."
    );
  };
}

async function handleConfirm(jid: string): Promise<void> {
  const session = getSession(jid);
  if (!session || session.state !== "confirming") return;

  const cognome = session.data!.cognome_defunto;
  const nome = session.data!.nome_defunto;
  const tipologia = session.data!.tipologia;
  console.log(`📋 handleConfirm: ${cognome} ${nome} (${tipologia}) — modo: ${config.PREVIEW_ONLY ? "PREVIEW_ONLY" : config.DRY_RUN ? "DRY_RUN" : "PRODUZIONE"}`);

  if (config.PREVIEW_ONLY) {
    console.log(`👁️ PREVIEW_ONLY: necrologio di ${cognome} ${nome} — solo anteprima`);
    await cleanupSession(jid);
    await sendMessage(
      jid,
      `👁️ [PREVIEW] Necrologio di ${cognome} ${nome} — modo anteprima, nessuna pubblicazione. Invia #necro per un'altra prova.`
    );
  } else if (config.DRY_RUN) {
    console.log(`🧪 DRY_RUN: si sarebbe pubblicato il necrologio di ${cognome} ${nome}`);
    await cleanupSession(jid);
    await sendMessage(
      jid,
      `🧪 [DRY_RUN] Necrologio di ${cognome} ${nome} NON pubblicato (modo prova). Invia #necro per un'altra prova.`
    );
  } else {
    try {
      console.log(`🔴 PUBBLICAZIONE REALE: ${cognome} ${nome} (${tipologia}) — invio del modulo...`);
      await sendMessage(jid, "⏳ Sto pubblicando il necrologio, un momento...");
      await submitForm();
      console.log(`✅ PUBBLICATO: ${cognome} ${nome} (${tipologia}) per ${jid}`);
      setLastPublished(jid, cognome, nome);
      await cleanupSession(jid);
      await sendMessage(
        jid,
        `✅ Necrologio di ${cognome} ${nome} pubblicato correttamente su amcannunci.it\n\n💡 Se vuoi cancellarlo, invia #elimina entro 24 ore.`
      );
    } catch (error) {
      console.error(`❌ PUBBLICAZIONE FALLITA: ${cognome} ${nome} (${tipologia}):`, error);
      await cleanupSession(jid);
      await sendMessage(jid, "❌ Errore durante la pubblicazione del necrologio. Riprova con #necro.");
    }
  }
}

async function handleAiResponse(jid: string, response: string | NecrologioData): Promise<void> {
  if (typeof response === "string") {
    console.log(`✅ Risposta da Grok (${response.length} chars)`);
    await sendMessage(jid, response);
    return;
  }

  // NecrologioData received
  console.log(`📋 Dati completi ricevuti (${response.tipologia})`);

  // Always send the text preview first so the operator sees how it looks
  const preview = generateTextPreview(response);
  await sendMessage(jid, preview);

  if (config.PREVIEW_ONLY) {
    // Preview mode: no browser
    setConfirming(jid, response, Buffer.alloc(0));
    startSessionTimeout(jid, makeTimeoutCallback(jid));

    await sendMessage(
      jid,
      "Controlla l'anteprima qui sopra 👆\n\n✅ #conferma — tutto ok\n✏️ Scrivi cosa cambiare\n🚫 #rifiuta — scarta tutto"
    );
    return;
  }

  // Browser mode: fill form and send screenshot
  console.log(`🌐 Compilando il modulo (${response.tipologia})...`);

  if (browserBusyJid && browserBusyJid !== jid) {
    await sendMessage(
      jid,
      "⏳ C'è un altro necrologio in fase di conferma. Riprova tra qualche minuto."
    );
    deleteSession(jid);
    return;
  }

  await sendMessage(jid, "⏳ Sto compilando il modulo sul sito, aspetta qualche secondo...");

  try {
    browserBusyJid = jid;
    bus.emit("browser:busy", jid);
    const photoBuffer = getPhoto(jid);
    const screenshot = await fillFormAndScreenshot(response, photoBuffer);
    setConfirming(jid, response, screenshot);
    startSessionTimeout(jid, makeTimeoutCallback(jid));

    const imgSent = await sendImage(
      jid,
      screenshot,
      "👆 Anteprima dal sito\n\n✅ #conferma — pubblica\n✏️ Scrivi cosa cambiare\n🚫 #rifiuta — scarta tutto"
    );
    if (!imgSent) {
      console.error(`❌ No se pudo enviar screenshot a ${jid} — el usuario NO vio la anteprima`);
      await sendMessage(jid, "⚠️ Non sono riuscito a inviare l'anteprima. Prova con #conferma per pubblicare o #rifiuta per scartare.");
    } else {
      console.log(`✅ Screenshot enviado a ${jid} (${screenshot.length} bytes)`);
    }
  } catch (error) {
    console.error("❌ Errore con Puppeteer:", error);
    browserBusyJid = null;
    bus.emit("browser:busy", null);
    await closeBrowser();
    deleteSession(jid);
    await sendMessage(jid, "❌ Errore durante la compilazione del modulo. Riprova con #necro.");
  }
}

async function handleMessageInternal(jid: string, text: string, imageBuffer?: Buffer): Promise<void> {
  // If an image is received during an active session, store it
  if (imageBuffer && hasSession(jid)) {
    setPhoto(jid, imageBuffer);
    console.log(`📷 Foto guardada para sesión de ${jid} (${imageBuffer.length} bytes)`);
    if (text === "[foto]") {
      // Photo without caption — notify and let AI know
      const session = getSession(jid);
      if (session?.state === "collecting") {
        startSessionTimeout(jid, makeTimeoutCallback(jid));
        try {
          const response = await chat(jid, "[L'operatore ha mandato una foto per il necrologio]");
          await handleAiResponse(jid, response);
        } catch (error) {
          console.error("❌ Errore nell'elaborazione:", error);
          await sendMessage(jid, "📷 Foto ricevuta! La userò per il necrologio.");
        }
      } else if (session?.state === "confirming") {
        // Photo added while confirming: restart from scratch with updated data
        await sendMessage(jid, "📷 Foto ricevuta! Aggiorno il modulo con la foto...");
        try {
          await restartWithChange(jid, session.data!, "L'operatore ha aggiunto una foto al necrologio. Aggiungila e aggiorna il riepilogo.");
        } catch (error) {
          console.error("❌ Errore nel riavvio con foto:", error);
          await sendMessage(jid, "Si è verificato un errore. Riprova o invia #cancella per annullare.");
        }
      } else {
        await sendMessage(jid, "📷 Foto ricevuta! La userò per il necrologio.");
      }
      return;
    }
    // If there's a caption with the image, prepend photo context
    text = `[L'operatore ha mandato una foto] ${text}`;
  }

  const lower = text.toLowerCase().trim();

  // --- #elimina: cancel a published necrologio ---
  if (lower === TAG_ELIMINA || lower.startsWith(TAG_ELIMINA + " ")) {
    if (config.PREVIEW_ONLY) {
      await sendMessage(jid, "👁️ Modo anteprima attivo — cancellazione non disponibile.");
      return;
    }

    const lastPub = getLastPublished(jid);
    if (!lastPub) {
      await sendMessage(
        jid,
        "Non c'è nessun necrologio recente da eliminare. Puoi cancellare solo necrologi pubblicati nelle ultime 24 ore."
      );
      return;
    }

    if (browserBusyJid && browserBusyJid !== jid) {
      await sendMessage(jid, "⏳ Il browser è occupato. Riprova tra qualche minuto.");
      return;
    }

    try {
      browserBusyJid = jid;
      bus.emit("browser:busy", jid);
      await sendMessage(jid, `🔍 Cerco il necrologio di ${lastPub.cognome} ${lastPub.nome} per cancellarlo...`);
      const result = await cancelNecrologio(lastPub.cognome, lastPub.nome);

      if (result.success) {
        await sendMessage(jid, `✅ ${result.message}`);
      } else {
        await sendMessage(jid, `❌ ${result.message}`);
      }
    } catch (error) {
      console.error("❌ Errore nella cancellazione:", error);
      await sendMessage(jid, "❌ Errore durante la cancellazione del necrologio. Riprova.");
    } finally {
      await closeBrowser();
      browserBusyJid = null;
      bus.emit("browser:busy", null);
    }
    return;
  }

  // --- #cancella: cancel from any state ---
  if (lower === TAG_CANCELLA && hasSession(jid)) {
    console.log(`🛑 Sessione cancellata dall'utente per ${jid}`);
    await cleanupSession(jid);
    await sendMessage(jid, "🚫 Sessione cancellata. Nessun necrologio è stato pubblicato.");
    return;
  }

  // --- #conferma ---
  if (lower === TAG_CONFERMA) {
    const session = getSession(jid);
    if (session?.state === "confirming") {
      await handleConfirm(jid);
      return;
    }
    // If in collecting state, tell user to wait — AI is still processing
    if (session?.state === "collecting") {
      console.log(`⏳ #conferma durante collecting — IA ancora in elaborazione`);
      await sendMessage(jid, "⏳ Sto ancora elaborando i dati... un attimo e ti mostro l'anteprima.");
      return;
    }
    return;
  }

  // --- #rifiuta: only in confirming state ---
  if (lower === TAG_RIFIUTA) {
    const session = getSession(jid);
    if (!session || session.state !== "confirming") {
      return;
    }

    console.log(`🚫 Necrologio rifiutato da ${jid}`);
    await cleanupSession(jid);
    await sendMessage(jid, "🚫 Sessione cancellata. Nessun necrologio è stato pubblicato.");
    return;
  }

  // --- #necro: start new session ---
  const isNewSession = lower.startsWith(TAG_NECRO);
  const sessionExists = hasSession(jid);

  if (!isNewSession && !sessionExists) return;

  // If in confirming state and user sends something other than tags, treat as a modification request
  if (sessionExists) {
    const session = getSession(jid);
    if (session?.state === "confirming" && !isNewSession) {
      console.log(`✏️ Richiesta di modifica da ${jid} in stato confirming`);
      try {
        await restartWithChange(jid, session.data!, `L'operatore chiede questa modifica: "${text}"`);
      } catch (error) {
        console.error("❌ Errore nella modifica:", error);
        await sendMessage(jid, "Si è verificato un errore. Riprova o invia #cancella per annullare.");
      }
      return;
    }
  }

  if (isNewSession) {
    // Clean up any previous session
    if (sessionExists) {
      await cleanupSession(jid);
    }

    // Check browser availability (only if not PREVIEW_ONLY)
    if (!config.PREVIEW_ONLY && browserBusyJid && browserBusyJid !== jid) {
      await sendMessage(
        jid,
        "⏳ C'è un altro necrologio in fase di conferma. Riprova tra qualche minuto."
      );
      return;
    }

    startSession(jid);
    startSessionTimeout(jid, makeTimeoutCallback(jid));

    const message = text.slice(TAG_NECRO.length).trim();
    if (!message) {
      // Session opened, AI is listening — just greet
      await sendMessage(
        jid,
        "📝 Sessione aperta. Dimmi i dati del necrologio.\n\nPuoi scrivermi tutto insieme o poco alla volta. Invia #cancella per chiudere."
      );
      return;
    }

    try {
      console.log(`🤖 Invio a Grok...`);
      const response = await chat(jid, message);
      await handleAiResponse(jid, response);
    } catch (error) {
      console.error("❌ Errore nell'elaborazione del messaggio:", error);
      await cleanupSession(jid);
      await sendMessage(jid, "Si è verificato un errore nell'elaborazione del messaggio. Riprova.");
    }
    return;
  }

  // --- Continuing collecting session ---
  const session = getSession(jid);
  if (!session || session.state !== "collecting") return;

  // Reset timeout on each message
  startSessionTimeout(jid, makeTimeoutCallback(jid));

  try {
    console.log(`🤖 Invio a Grok...`);
    const response = await chat(jid, text);
    await handleAiResponse(jid, response);
  } catch (error) {
    console.error("❌ Errore nell'elaborazione del messaggio:", error);
    await sendMessage(jid, "Si è verificato un errore nell'elaborazione del messaggio. Riprova.");
  }
}

// Exported wrapper that serializes message processing per JID
export async function handleMessage(jid: string, text: string, imageBuffer?: Buffer): Promise<void> {
  const prev = processingLock.get(jid) ?? Promise.resolve();
  const current = prev.then(() => handleMessageInternal(jid, text, imageBuffer).catch((e) => {
    console.error(`❌ Error no manejado para ${jid}:`, e);
  }));
  processingLock.set(jid, current);
  await current;
}

export async function cancelSessionFromAdmin(jid: string): Promise<boolean> {
  if (!hasSession(jid)) return false;
  await cleanupSession(jid, "admin_cancel");
  await sendMessage(jid, "⚠️ La sessione è stata annullata dall'amministratore.");
  return true;
}

export async function handleConnectionError(): Promise<void> {
  const activeJids = getActiveSessionJids();
  console.log(`🔴 Notificando ${activeJids.length} sesiones activas sobre error de conexión...`);

  for (const jid of activeJids) {
    try {
      await sendMessage(
        jid,
        "⚠️ C'è stato un problema di connessione. La sessione è stata persa.\nInvia #necro per ricominciare. Ci scusiamo per l'inconveniente."
      );
    } catch {
      // Can't send — connection is down
    }
    await cleanupSession(jid);
  }

  // Clean up browser if active
  if (browserBusyJid) {
    try { await closeBrowser(); } catch {}
    browserBusyJid = null;
    bus.emit("browser:busy", null);
  }
}
