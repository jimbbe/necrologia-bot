import "dotenv/config";

interface Config {
  XAI_API_KEY: string;
  GROQ_API_KEY: string;
  AI_MODEL: string;
  MAX_HISTORY: number;
  AMC_USERNAME: string;
  AMC_PASSWORD: string;
  AMC_BASE_URL: string;
  SESSION_TIMEOUT_MS: number;
  DRY_RUN: boolean;
  PREVIEW_ONLY: boolean;
  ADMIN_ENABLED: boolean;
  ADMIN_PASSWORD: string;
  ADMIN_HOST: string;
  ADMIN_PORT: number;
  FRONTEND_URL: string;
  BACKEND_URL: string;
}

const apiKey = process.env.XAI_API_KEY;
if (!apiKey) {
  throw new Error("XAI_API_KEY is required in .env");
}

const groqApiKey = process.env.GROQ_API_KEY || "";
if (!groqApiKey) {
  console.warn("⚠️ GROQ_API_KEY no configurada — transcripción de audio no disponible");
}

const previewOnly = process.env.PREVIEW_ONLY !== "false";

const amcUsername = process.env.AMC_USERNAME || "";
const amcPassword = process.env.AMC_PASSWORD || "";
if (!previewOnly && (!amcUsername || !amcPassword)) {
  throw new Error("AMC_USERNAME and AMC_PASSWORD are required in .env when PREVIEW_ONLY is not active");
}

export const config: Config = {
  XAI_API_KEY: apiKey,
  GROQ_API_KEY: groqApiKey,
  AI_MODEL: process.env.AI_MODEL || "grok-4-1-fast",
  MAX_HISTORY: parseInt(process.env.MAX_HISTORY || "30", 10),
  AMC_USERNAME: amcUsername,
  AMC_PASSWORD: amcPassword,
  AMC_BASE_URL: process.env.AMC_BASE_URL || "https://www.amcannunci.it",
  SESSION_TIMEOUT_MS: parseInt(process.env.SESSION_TIMEOUT_MS || "1800000", 10),
  DRY_RUN: process.env.DRY_RUN !== "false",
  PREVIEW_ONLY: previewOnly,
  ADMIN_ENABLED: !!process.env.ADMIN_PASSWORD,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",
  ADMIN_HOST: process.env.ADMIN_HOST || "0.0.0.0",
  ADMIN_PORT: parseInt(process.env.ADMIN_PORT || "3000", 10),
  FRONTEND_URL: process.env.FRONTEND_URL || "",
  BACKEND_URL: process.env.BACKEND_URL || "",
};
