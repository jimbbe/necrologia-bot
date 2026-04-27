import fs from "fs";
import path from "path";

interface AllowedNumber {
  number: string;
  label?: string;
  addedAt: number;
}

export interface AllowDecision {
  allowed: boolean;
  incomingNumber: string;
  matchedNumber?: string;
  matchType?: "exact" | "last6";
  reason?: "empty_whitelist" | "no_match";
}

const DATA_FILE = path.join(process.cwd(), "data", "allowed-numbers.json");
const LAST_DIGITS_MATCH_LENGTH = 6;

let numbers: AllowedNumber[] = [];

function normalizeNumber(value: string): string {
  return value.replace(/\D/g, "");
}

function numberFromJid(jid: string): string {
  return normalizeNumber(jid.replace(/@.*$/, ""));
}

export function loadWhitelist(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      numbers = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    } else {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, "[]", "utf-8");
      numbers = [];
    }
  } catch {
    numbers = [];
  }
}

function saveWhitelist(): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(numbers, null, 2), "utf-8");
}

export function checkAllowed(jid: string): AllowDecision {
  const incomingNumber = numberFromJid(jid);

  if (numbers.length === 0) {
    return { allowed: false, incomingNumber, reason: "empty_whitelist" };
  }

  const exactMatch = numbers.find((n) => normalizeNumber(n.number) === incomingNumber);
  if (exactMatch) {
    return {
      allowed: true,
      incomingNumber,
      matchedNumber: exactMatch.number,
      matchType: "exact",
    };
  }

  const lastDigitsMatch = numbers.find((n) => {
    const allowedNumber = normalizeNumber(n.number);
    if (allowedNumber.length < LAST_DIGITS_MATCH_LENGTH) return false;
    return incomingNumber.endsWith(allowedNumber.slice(-LAST_DIGITS_MATCH_LENGTH));
  });

  if (lastDigitsMatch) {
    return {
      allowed: true,
      incomingNumber,
      matchedNumber: lastDigitsMatch.number,
      matchType: "last6",
    };
  }

  return { allowed: false, incomingNumber, reason: "no_match" };
}

export function isAllowed(jid: string): boolean {
  return checkAllowed(jid).allowed;
}

export function addNumber(number: string, label?: string): boolean {
  const clean = normalizeNumber(number);
  if (numbers.some((n) => normalizeNumber(n.number) === clean)) return false;
  numbers.push({ number: clean, label, addedAt: Date.now() });
  saveWhitelist();
  return true;
}

export function removeNumber(number: string): boolean {
  const idx = numbers.findIndex((n) => n.number === number);
  if (idx === -1) return false;
  numbers.splice(idx, 1);
  saveWhitelist();
  return true;
}

export function getAllNumbers(): AllowedNumber[] {
  return [...numbers];
}
