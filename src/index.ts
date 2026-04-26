import http from "http";
import { startWhatsApp, setConnectionErrorCallback } from "./whatsapp.js";
import { handleMessage, handleConnectionError } from "./handler.js";
import { config } from "./config.js";
import { loadWhitelist } from "./whitelist.js";
import { closeBrowser } from "./browser/helpers.js";

loadWhitelist();

console.log("🚀 Avvio WhatsApp ↔ Grok Bridge V3...\n");
if (config.PREVIEW_ONLY) {
  console.log("👁️  MODO PREVIEW_ONLY attivo — nessuna interazione con amcannunci.it\n");
} else if (config.DRY_RUN) {
  console.log("⚠️  MODO DRY_RUN attivo — il modulo NON verrà inviato alla conferma\n");
} else {
  console.log("🔴 MODO PRODUZIONE — i necrologi verranno PUBBLICATI REALMENTE su amcannunci.it\n");
}
console.log(`📌 Modello AI: ${config.AI_MODEL}`);
console.log(`📌 Tags: #necro | #cancella | #conferma | #rifiuta | #elimina\n`);

if (!config.ADMIN_ENABLED) {
  console.warn("⚠️ ADMIN_PASSWORD no configurada — no se levantará el panel admin ni el healthcheck");
}

setConnectionErrorCallback(handleConnectionError);
startWhatsApp(handleMessage);

let adminServer: http.Server | null = null;

if (config.ADMIN_ENABLED) {
  const { startAdminServer } = await import("./admin/server.js");
  adminServer = startAdminServer();
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n🛑 Segnale ${signal} ricevuto — chiusura in corso...`);
  try { await handleConnectionError(); } catch {}
  try { await closeBrowser(); } catch {}
  if (adminServer) {
    adminServer.close(() => {
      console.log("🖥️  Admin server chiuso");
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
