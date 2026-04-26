import OpenAI from "openai";
import { config } from "./config.js";

const groq = new OpenAI({
  apiKey: config.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

export async function transcribeAudio(audioBuffer: Buffer, mimetype: string): Promise<string> {
  const ext = mimetype === "audio/ogg; codecs=opus" ? "ogg" : mimetype.split("/")[1] || "ogg";
  const file = new File([new Uint8Array(audioBuffer)], `voice.${ext}`, { type: mimetype });

  const transcription = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3-turbo",
    language: "it",
  });

  return transcription.text;
}
