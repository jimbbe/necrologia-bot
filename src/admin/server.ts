import http from "http";
import express from "express";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { createRouter } from "./routes.js";
import { setupWebSocket } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve public dir: works both in src/ (tsx dev) and dist/ (compiled)
function resolvePublicDir(): string {
  const local = path.join(__dirname, "public");
  if (fs.existsSync(path.join(local, "index.html"))) return local;
  // Fallback: src/admin/public from project root
  return path.join(process.cwd(), "src", "admin", "public");
}

export function startAdminServer(): http.Server {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
  }));

  app.use(express.json());
  app.use("/api", createRouter());

  const publicDir = resolvePublicDir();
  app.use(express.static(publicDir));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  const server = app.listen(config.ADMIN_PORT, () => {
    console.log(`🖥️  Admin panel: http://localhost:${config.ADMIN_PORT}`);
  });

  setupWebSocket(server);
  return server;
}
