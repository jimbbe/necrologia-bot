import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage,
  WASocket,
  proto,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { Boom } from "@hapi/boom";
import path from "path";
import fs from "fs";
import { transcribeAudio } from "./transcribe.js";
import { bus } from "./events.js";
import { checkAllowed } from "./whitelist.js";

const AUTH_DIR = path.join(process.cwd(), "data", "auth");

// --- Error tracking ---
let decryptErrorCount = 0;
const DECRYPT_ERROR_THRESHOLD = 10; // consecutive relevant errors before alerting
let lastDecryptErrorTime = 0;
const DECRYPT_ERROR_WINDOW_MS = 60_000; // reset counter if no error for 1 min
let lastDecryptThresholdAlertTime = 0;
const DECRYPT_THRESHOLD_ALERT_COOLDOWN_MS = 5 * 60_000;

// Callback for notifying active sessions about connection issues
let onConnectionError: (() => Promise<void>) | null = null;

export function setConnectionErrorCallback(cb: () => Promise<void>): void {
  onConnectionError = cb;
}

// Logger that intercepts errors while keeping Baileys quiet
const errorInterceptLogger = {
  info: () => {},
  debug: () => {},
  trace: () => {},
  fatal: (...args: any[]) => {
    console.error("🔴 Baileys FATAL:", ...args);
  },
  level: "silent" as const,
  child: () => errorInterceptLogger,
  // Intercept warn/error to detect decryption failures
  warn: (...args: any[]) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    if (msg.includes("Bad MAC") || msg.includes("decrypt") || msg.includes("Failed to decrypt")) {
      handleDecryptError(msg);
    }
  },
  error: (...args: any[]) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    if (msg.includes("Bad MAC") || msg.includes("decrypt") || msg.includes("Failed to decrypt")) {
      handleDecryptError(msg);
    } else {
      console.error("🔴 Baileys error:", msg.substring(0, 200));
    }
  },
};

function getIgnoredDecryptErrorReason(msg: string): "fromMe" | "lid" | null {
  if (msg.includes('"fromMe":true')) return "fromMe";
  if (msg.includes("@lid")) return "lid";
  return null;
}

function handleDecryptError(msg: string): void {
  const now = Date.now();

  const ignoredReason = getIgnoredDecryptErrorReason(msg);
  if (ignoredReason) {
    console.warn(
      `⚠️ Error de decriptación ignorado (${ignoredReason}): ${msg.substring(0, 100)}`
    );
    return;
  }

  // Reset counter if enough time passed since last error
  if (now - lastDecryptErrorTime > DECRYPT_ERROR_WINDOW_MS) {
    decryptErrorCount = 0;
  }

  decryptErrorCount++;
  lastDecryptErrorTime = now;

  console.warn(`⚠️ Error de decriptación (${decryptErrorCount}/${DECRYPT_ERROR_THRESHOLD}): ${msg.substring(0, 100)}`);

  if (
    decryptErrorCount >= DECRYPT_ERROR_THRESHOLD &&
    now - lastDecryptThresholdAlertTime > DECRYPT_THRESHOLD_ALERT_COOLDOWN_MS
  ) {
    lastDecryptThresholdAlertTime = now;
    console.error(
      `🔴 Demasiados errores de decriptación relevantes (${decryptErrorCount}/${DECRYPT_ERROR_THRESHOLD}). ` +
      "No se borrará la sesión automáticamente. Si el bot deja de funcionar, usá Reconectar o Nuevo QR manualmente."
    );
  }
}

// Track sent message IDs with timestamps for TTL-based cleanup
const sentMessageIds = new Map<string, number>();

// Clean entries older than 10 minutes every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, ts] of sentMessageIds) {
    if (ts < cutoff) sentMessageIds.delete(id);
  }
}, 5 * 60_000);

let sock: WASocket | null = null;
let currentOnMessage: OnMessageCallback | null = null;
let isReconnecting = false;

export type OnMessageCallback = (
  jid: string,
  text: string,
  imageBuffer?: Buffer
) => void | Promise<void>;

export async function startWhatsApp(onMessage: OnMessageCallback): Promise<void> {
  isReconnecting = false;
  currentOnMessage = onMessage;

  // Ensure auth directory exists
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  console.log(`📌 Usando WA version: ${version.join(".")}`);

  sock = makeWASocket({
    auth: state,
    version,
    logger: errorInterceptLogger as any,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 Escaneá este QR con WhatsApp:\n");
      qrcode.generate(qr, { small: true });
      bus.emit("wa:qr", qr);
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const errorMsg = (lastDisconnect?.error as Boom)?.message || "unknown";
      console.log(`⚠️ Conexión cerrada (código: ${statusCode}, error: ${errorMsg})`);
      bus.emit("wa:status", "close", `code=${statusCode} ${errorMsg}`);

      if (isReconnecting) {
        console.log("⏳ Reconexión ya en curso, ignorando cierre duplicado");
        return;
      }
      isReconnecting = true;
      bus.emit("wa:status", "reconnecting");

      if (statusCode === DisconnectReason.loggedOut) {
        console.log("❌ Sesión cerrada por WhatsApp.");

        // Notify active sessions
        if (onConnectionError) {
          try { await onConnectionError(); } catch {}
        }

        // Auto-cleanup auth and reconnect for QR
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch {}
        console.log("🔄 Auth limpiado. Reconectando para nuevo QR en 5 segundos...");
        setTimeout(() => startWhatsApp(onMessage), 5000);

      } else if (statusCode === 440) {
        // 440 = conflict (replaced by another session) — wait longer to avoid loop
        console.log("⚠️ Conflicto: otra sesión activa. Reconectando en 10 segundos...");
        setTimeout(() => startWhatsApp(onMessage), 10_000);
      } else if (statusCode === 515 || statusCode === 408) {
        // 515 = restart required, 408 = timeout — reconnect immediately
        console.log("🔄 Reconectando inmediatamente...");
        startWhatsApp(onMessage);
      } else {
        console.log("🔄 Reconectando en 3 segundos...");
        setTimeout(() => startWhatsApp(onMessage), 3000);
      }
    }

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp");
      decryptErrorCount = 0;
      isReconnecting = false;
      bus.emit("wa:status", "open");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      // Skip messages we sent ourselves
      if (msg.key.fromMe) continue;

      // Skip messages we already processed (echo loop protection)
      const msgId = msg.key.id;
      if (msgId && sentMessageIds.has(msgId)) continue;

      // Skip broadcast and group messages
      if (msg.key.remoteJid === "status@broadcast") continue;
      if (msg.key.remoteJid?.endsWith("@g.us")) continue;

      if (!msg.key.remoteJid) continue;

      const allowDecision = checkAllowed(msg.key.remoteJid);
      if (!allowDecision.allowed) {
        console.warn(
          `🚫 Mensaje bloqueado de ${allowDecision.incomingNumber || msg.key.remoteJid}: ${allowDecision.reason}`
        );
        continue;
      }

      if (allowDecision.matchType === "last6") {
        console.log(
          `✅ Whitelist: ${allowDecision.incomingNumber} autorizado por últimos 6 dígitos de ${allowDecision.matchedNumber}`
        );
      } else {
        console.log(`✅ Whitelist: ${allowDecision.incomingNumber} autorizado por match exacto`);
      }

      // Extract text from regular messages
      let text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text;

      let imageBuffer: Buffer | undefined;

      // Handle image messages
      if (msg.message?.imageMessage) {
        try {
          console.log(`📷 Imagen recibida de ${msg.key.remoteJid}`);
          imageBuffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
          text = msg.message.imageMessage.caption || "[foto]";
        } catch (error) {
          console.error("❌ Error descargando imagen:", error);
          continue;
        }
      }

      // Handle voice/audio messages
      if (!text && msg.message?.audioMessage) {
        try {
          console.log(`🎤 Audio recibido de ${msg.key.remoteJid}, transcribiendo...`);
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          const mimetype = msg.message.audioMessage.mimetype || "audio/ogg; codecs=opus";
          text = await transcribeAudio(buffer as Buffer, mimetype);
          console.log(`📝 Transcripción: ${text.substring(0, 80)}...`);
        } catch (error) {
          console.error("❌ Error transcribiendo audio:", error);
          continue;
        }
      }

      if (!text) continue;

      // Reset decrypt error counter on successful message receipt
      decryptErrorCount = 0;

      console.log(`📩 Mensaje de ${msg.key.remoteJid}: ${text.substring(0, 80)}...`);
      bus.emit("msg:received", msg.key.remoteJid, text.substring(0, 100));

      try {
        await onMessage(msg.key.remoteJid, text, imageBuffer);
      } catch (error) {
        console.error(`❌ Error procesando mensaje de ${msg.key.remoteJid}:`, error);
      }
    }
  });
}

export async function sendMessage(jid: string, text: string): Promise<boolean> {
  if (!sock) {
    console.error("❌ WhatsApp no está conectado");
    return false;
  }

  try {
    const sent = await sock.sendMessage(jid, { text });
    if (sent?.key?.id) {
      sentMessageIds.set(sent.key.id, Date.now());
    }
    bus.emit("msg:sent", jid, text.substring(0, 100));
    return true;
  } catch (error) {
    console.error(`❌ Error enviando mensaje a ${jid}:`, error);
    return false;
  }
}

export async function forceReconnect(): Promise<void> {
  // Set flag BEFORE closing so connection.update handler ignores the close
  isReconnecting = true;
  if (sock) {
    try { sock.end(undefined); } catch {}
    sock = null;
  }
  if (currentOnMessage) {
    await startWhatsApp(currentOnMessage);
  }
}

export async function forceNewQR(): Promise<void> {
  isReconnecting = true;
  if (sock) {
    try { sock.end(undefined); } catch {}
    sock = null;
  }
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  } catch {}
  if (currentOnMessage) {
    await startWhatsApp(currentOnMessage);
  }
}

export async function sendImage(jid: string, imageBuffer: Buffer, caption?: string): Promise<boolean> {
  if (!sock) {
    console.error("❌ WhatsApp no está conectado");
    return false;
  }

  try {
    const sent = await sock.sendMessage(jid, {
      image: imageBuffer,
      caption,
      mimetype: "image/png",
    });
    if (sent?.key?.id) {
      sentMessageIds.set(sent.key.id, Date.now());
    }
    bus.emit("msg:sent", jid, (caption || "[image]").substring(0, 100));
    return true;
  } catch (error) {
    console.error(`❌ Error enviando imagen a ${jid}:`, error);
    return false;
  }
}
