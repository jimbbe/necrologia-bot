import OpenAI from "openai";
import { config } from "../config.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { NecrologioData } from "../session.js";
import { getSystemPrompt, NECROLOGIO_COMPLETE_TAG } from "./prompt.js";

const client = new OpenAI({
  apiKey: config.XAI_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

type ChatMessage = ChatCompletionMessageParam & { role: "user" | "assistant" };

const history = new Map<string, ChatMessage[]>();

function trimHistory(jid: string): void {
  const messages = history.get(jid);
  if (!messages) return;
  while (messages.length > config.MAX_HISTORY) {
    messages.shift();
  }
}

export function clearChatHistory(jid: string): void {
  history.delete(jid);
}

function extractJson(text: string): string {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (start === -1) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.substring(start, i + 1);
      }
    }
  }
  return text;
}

async function callWithRetry(
  messages: ChatCompletionMessageParam[],
  retries = 3,
  baseDelay = 1000,
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: config.AI_MODEL,
        messages,
      });
      const content = response.choices[0]?.message?.content ?? "Non sono riuscito a generare una risposta.";
      const usage = response.usage;
      if (usage) {
        console.log(`   AI tokens: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`);
      }
      return content;
    } catch (error) {
      if (attempt === retries) throw error;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(
        `⚠️ Errore API xAI (tentativo ${attempt}/${retries}), retry in ${delay}ms...`,
        error instanceof Error ? error.message : error,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

// Re-query the AI when validation detects missing fields
async function askAiForMissing(jid: string, messages: ChatMessage[], instruction: string): Promise<string> {
  console.log(`🔄 Re-query AI por campos faltantes: ${instruction.substring(0, 100)}`);

  // Add a system-like correction as a user message so the AI knows what to ask
  messages.push({ role: "user", content: `[SISTEMA: ${instruction}]` });
  trimHistory(jid);

  const fullMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: getSystemPrompt() },
    ...messages,
  ];

  const reply = await callWithRetry(fullMessages);
  console.log(`🔄 AI re-query response: ${reply.length} chars`);

  messages.push({ role: "assistant", content: reply });
  trimHistory(jid);

  // Return as string (text response to user), session stays in "collecting"
  return reply;
}

export async function chat(jid: string, message: string): Promise<string | NecrologioData> {
  if (!history.has(jid)) {
    history.set(jid, []);
  }
  const messages = history.get(jid)!;

  messages.push({ role: "user", content: message });
  trimHistory(jid);

  // System prompt sent with every request for consistency
  const fullMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: getSystemPrompt() },
    ...messages,
  ];

  console.log(`🤖 AI request: modelo=${config.AI_MODEL}, historial=${messages.length} msgs, jid=${jid}`);
  const reply = await callWithRetry(fullMessages);
  console.log(`🤖 AI response: ${reply.length} chars, contiene_tag=${reply.includes(NECROLOGIO_COMPLETE_TAG)}`);

  messages.push({ role: "assistant", content: reply });
  trimHistory(jid);

  if (reply.includes(NECROLOGIO_COMPLETE_TAG)) {
    const afterTag = reply.substring(reply.indexOf(NECROLOGIO_COMPLETE_TAG) + NECROLOGIO_COMPLETE_TAG.length).trim();
    const jsonStr = extractJson(afterTag);
    try {
      const data: NecrologioData = JSON.parse(jsonStr);

      if (!data.cognome_defunto || !data.nome_defunto || !data.tipologia) {
        console.error("⚠️ Dati incompleti nel JSON:", JSON.stringify(data));
        return await askAiForMissing(jid, messages, "Mancano dati fondamentali: cognome, nome o tipologia. Chiedi all'operatore.");
      }

      // Validar campos obligatorios por tipología
      const missing: string[] = [];
      if (data.tipologia === "annuncio_famiglia") {
        if (!data.comune_nascita) missing.push("comune di nascita");
        if (!data.comune_morte) missing.push("comune di morte");
        if (!data.data_morte) missing.push("data di morte");
      }
      if (data.tipologia === "anniversario") {
        if (!data.data_morte) missing.push("data di morte");
        if (!data.data_anniversario) missing.push("data dell'anniversario");
        if (!data.titolo_necrologio) missing.push("titolo del necrologio");
      }
      if (data.tipologia === "ringraziamento-trigesimo") {
        if (!data.titolo_necrologio) missing.push("titolo del necrologio");
      }
      if (missing.length > 0) {
        console.error(`⚠️ Campi obbligatori mancanti per ${data.tipologia}: ${missing.join(", ")}`);
        return await askAiForMissing(jid, messages, `Il JSON che hai generato è incompleto per ${data.tipologia}. Mancano: ${missing.join(", ")}. Chiedi questi dati all'operatore in modo naturale, senza menzionare JSON o campi tecnici.`);
      }

      // Sanitize: solo primera letra mayúscula por palabra, nunca TODO MAYÚSCULAS
      const capitalizeName = (s: string) =>
        s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

      data.cognome_defunto = capitalizeName(data.cognome_defunto);
      data.nome_defunto = capitalizeName(data.nome_defunto);
      if (data.nome_visualizzato) {
        data.nome_visualizzato = capitalizeName(data.nome_visualizzato);
      }

      console.log("\n📋 NECROLOGIO COMPLETO:");
      console.log(JSON.stringify(data, null, 2));
      console.log("");
      history.delete(jid);
      return data;
    } catch {
      console.error("⚠️ Error parseando JSON del necrologio:", jsonStr.substring(0, 200));
      return await askAiForMissing(jid, messages, "Il JSON che hai generato non è valido (errore di parsing). Mostra di nuovo il riepilogo all'operatore e chiedi conferma. Quando conferma, genera il JSON correttamente.");
    }
  }

  return reply;
}
