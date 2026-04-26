import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { URL } from "url";
import QRCode from "qrcode";
import { validateToken } from "./auth.js";
import { setWaStatus } from "./routes.js";
import { bus } from "../events.js";
import { getAllSessionsSnapshot } from "../session.js";

const clients = new Set<WebSocket>();

function broadcast(type: string, data: any): void {
  if (clients.size === 0) return;
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    // Validate token from query string
    try {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      if (!token || !validateToken(token)) {
        ws.close(4001, "Unauthorized");
        return;
      }
    } catch {
      ws.close(4001, "Unauthorized");
      return;
    }

    clients.add(ws);

    // Send current sessions snapshot on connect
    broadcast("session:update", getAllSessionsSnapshot());

    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  // Heartbeat
  setInterval(() => {
    broadcast("ping", {});
  }, 30_000);

  // Wire event bus to WS broadcasts
  bus.on("wa:qr", async (qr) => {
    try {
      const dataUrl = await QRCode.toDataURL(qr, { width: 256 });
      broadcast("wa:qr", { qr, dataUrl });
    } catch {
      broadcast("wa:qr", { qr, dataUrl: null });
    }
  });

  bus.on("wa:status", (status, detail) => {
    setWaStatus(status);
    broadcast("wa:status", { status, detail });
  });

  bus.on("msg:received", (jid, preview) => {
    broadcast("msg:activity", { direction: "in", jid, preview });
  });

  bus.on("msg:sent", (jid, preview) => {
    broadcast("msg:activity", { direction: "out", jid, preview });
  });

  bus.on("session:start", () => {
    broadcast("session:update", getAllSessionsSnapshot());
  });

  bus.on("session:confirming", () => {
    broadcast("session:update", getAllSessionsSnapshot());
  });

  bus.on("session:end", () => {
    broadcast("session:update", getAllSessionsSnapshot());
  });

  bus.on("browser:busy", (jid) => {
    broadcast("browser:busy", { jid });
  });

  bus.on("log", (level, source, message) => {
    broadcast("log", { level, source, message });
  });
}
