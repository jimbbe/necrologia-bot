import puppeteer, { Browser, Page } from "puppeteer";
import { config } from "../config.js";

let browser: Browser | null = null;
let page: Page | null = null;

export function getBrowser(): Browser | null {
  return browser;
}

export function getPage(): Page | null {
  return page;
}

export async function ensureBrowser(): Promise<Page> {
  if (!browser || !browser.connected) {
    console.log("🌐 Lanzando browser (headless)...");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    console.log(`🌐 Browser lanzado (PID: ${browser.process()?.pid})`);
  }
  if (!page || page.isClosed()) {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on("dialog", async (dialog) => {
      console.log(`💬 Dialog auto-dismissed: "${dialog.message().substring(0, 80)}..."`);
      await dialog.accept();
    });
  }
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (page && !page.isClosed()) {
    await page.close();
    page = null;
  }
  if (browser && browser.connected) {
    await browser.close();
    browser = null;
  }
  console.log("🔒 Browser cerrado");
}

export async function login(pg: Page): Promise<void> {
  console.log(`🔐 Logging in to ${config.AMC_BASE_URL}...`);
  await pg.goto(config.AMC_BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });

  await pg.waitForSelector('input[name="user"]', { timeout: 10000 });
  await pg.type('input[name="user"]', config.AMC_USERNAME);
  await pg.type('input[name="pass"]', config.AMC_PASSWORD);

  // Promise.all para no perder la navegación si el click la dispara inmediatamente
  await Promise.all([
    pg.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 }),
    pg.click('input[name="invia"]'),
  ]);

  // Esperar a que la página termine de cargar recursos
  try {
    await pg.waitForNetworkIdle({ timeout: 10000 });
  } catch {
    console.warn("⚠️ Network idle timeout post-login, continuando de todas formas...");
  }

  const postLoginUrl = pg.url();
  const hasLoginForm = await pg.$('input[name="user"]');
  if (hasLoginForm) {
    console.error(`❌ Login fallido — todavía en página de login: ${postLoginUrl}`);
    throw new Error("Login fallito su amcannunci.it — credenziali errate?");
  }
  console.log(`✅ Login exitoso — URL: ${postLoginUrl}`);
}

export async function fillTextarea(pg: Page, selector: string, value: string): Promise<boolean> {
  const el = await pg.$(selector);
  if (!el) {
    console.warn(`⚠️ Textarea "${selector}" no encontrado, saltando...`);
    return false;
  }
  await el.click();
  await el.evaluate((e, v) => {
    const ta = e as HTMLTextAreaElement;
    ta.value = v;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  return true;
}

export async function fillInput(pg: Page, selector: string, value: string): Promise<boolean> {
  const el = await pg.$(selector);
  if (!el) {
    console.warn(`⚠️ Input "${selector}" no encontrado, saltando...`);
    return false;
  }
  await el.click({ clickCount: 3 });
  await el.type(value);
  return true;
}
