import fs from "fs";
import path from "path";

interface AllowedNumber {
  number: string;
  label?: string;
  addedAt: number;
}

const DATA_FILE = path.join(process.cwd(), "data", "allowed-numbers.json");

let numbers: AllowedNumber[] = [];

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

export function isAllowed(jid: string): boolean {
  if (numbers.length === 0) return false;
  const num = jid.replace(/@.*$/, "");
  return numbers.some((n) => n.number === num);
}

export function addNumber(number: string, label?: string): boolean {
  if (numbers.some((n) => n.number === number)) return false;
  numbers.push({ number, label, addedAt: Date.now() });
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
