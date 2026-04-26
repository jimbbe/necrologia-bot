import { Page } from "puppeteer";
import type { NecrologioData } from "../session.js";
import { ensureBrowser, getBrowser, getPage, fillTextarea, fillInput, login } from "./helpers.js";
import { step_simbolo } from "./media.js";
import { step_foto } from "./media.js";

async function navigateToInserisci(pg: Page): Promise<void> {
  console.log("📝 Navegando a inserisci...");
  const inserisciLink = await pg.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    const link = links.find((a) => a.href && a.href.includes("inserisci"));
    return link ? link.href : null;
  });
  if (!inserisciLink) {
    throw new Error("No se encontró el link de inserisci en el dashboard");
  }
  await pg.goto(inserisciLink, { waitUntil: "networkidle2", timeout: 30000 });
}

// Step 1: select testata + tipologia
async function step1_testata(pg: Page, data: NecrologioData): Promise<void> {
  console.log(`📋 Paso 1: Seleccionando testata y tipologia (${data.tipologia})...`);
  await pg.waitForSelector('select[name="testata"]', { timeout: 10000 });

  await pg.select('select[name="testata"]', "41");
  await new Promise((r) => setTimeout(r, 1500));

  const tipValue = data.tipologia;
  await pg.evaluate((val: string) => {
    const sel = document.querySelector('select[name="tipologia"]') as HTMLSelectElement | null;
    if (!sel) return;
    const normalizedVal = val.replace(/[_-]/g, " ").toLowerCase();
    const opts = Array.from(sel.options);
    const opt = opts.find((o) => {
      const normalizedText = o.text.replace(/[_-]/g, " ").toLowerCase();
      return normalizedText.includes(normalizedVal) || normalizedVal.includes(normalizedText);
    });
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, tipValue);

  await Promise.all([
    pg.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
    pg.click('input[name="bottone"]'),
  ]);
}

// Step 2: cognome, nome, parentela + extras for annuncio_famiglia
async function step2_defunto(pg: Page, data: NecrologioData): Promise<void> {
  console.log("📋 Paso 2: Datos del difunto...");
  await pg.waitForSelector('input[name="cognome_defunto"]', { timeout: 10000 });

  console.log(`   cognome_defunto: "${data.cognome_defunto}"`);
  console.log(`   nome_defunto: "${data.nome_defunto}"`);
  await pg.type('input[name="cognome_defunto"]', data.cognome_defunto);
  await pg.type('input[name="nome_defunto"]', data.nome_defunto);

  if (data.tipologia === "annuncio_famiglia") {
    console.log(`   annuncio_famiglia extras: comune_nascita=${data.comune_nascita || "N/A"}, comune_morte=${data.comune_morte || "N/A"}, data_morte=${data.data_morte || "N/A"}`);
    if (data.comune_nascita) {
      await pg.evaluate((val: string) => {
        const sel = document.querySelector('select[name="comune_nascita"]') as HTMLSelectElement | null;
        if (sel) {
          sel.value = val;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, data.comune_nascita);
    }
    if (data.comune_morte) {
      await pg.evaluate((val: string) => {
        const sel = document.querySelector('select[name="comune_morte"]') as HTMLSelectElement | null;
        if (sel) {
          sel.value = val;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, data.comune_morte);
    }
    if (data.data_morte) {
      await pg.type('input[name="data_morte"]', data.data_morte);
    }
  }

  await pg.select('select[name="parentela"]', "146");

  console.log(`   URL pre-btnContinua: ${pg.url()}`);
  try {
    await Promise.all([
      pg.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
      pg.click("#btnContinua"),
    ]);
    console.log(`   URL post-btnContinua: ${pg.url()}`);
  } catch (error) {
    // Diagnóstico: qué hay en la página cuando falla
    const url = pg.url();
    const pageInfo = await pg.evaluate(() => {
      const alerts = document.querySelectorAll(".alert, .error, .errore, [class*='error']");
      const alertTexts = Array.from(alerts).map((a) => a.textContent?.trim()).filter(Boolean);
      const bodySnippet = document.body?.innerText?.substring(0, 400) || "";
      return { alertTexts, bodySnippet };
    });
    console.error(`❌ Step 2 navigation failed — URL: ${url}`);
    console.error(`   Alertas en página: ${pageInfo.alertTexts.join(" | ") || "ninguna"}`);
    console.error(`   Body snippet: ${pageInfo.bodySnippet.substring(0, 300)}`);
    throw error;
  }
}

// Step 3: click "qui" link (skip similarity)
async function step3_skipSimilar(pg: Page): Promise<void> {
  console.log("📋 Paso 3: Saltando página de similaridad...");
  const clicked = await pg.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    const link = links.find(
      (a) => a.textContent && a.textContent.trim().toLowerCase() === "qui"
    );
    if (link) {
      link.click();
      return true;
    }
    return false;
  });
  if (!clicked) {
    throw new Error("No se encontró el link 'qui' en la página de similaridad");
  }
  await pg.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
}

// Wait for the editor's main textarea, with diagnostic logging on failure
async function waitForEditor(pg: Page, context: string): Promise<void> {
  // First wait for body to have some content (page might be loading via JS)
  try {
    await pg.waitForFunction(
      () => (document.body?.children?.length ?? 0) > 0,
      { timeout: 10000 },
    );
  } catch {
    console.warn(`⚠️ Body vacío después de 10s (${context}), intentando de todas formas...`);
  }

  try {
    await pg.waitForSelector('textarea[name="CENTER_1_82_nome-defunto-obbligatorio"]', { timeout: 20000 });
  } catch {
    // Diagnostics: log URL, frames, and what exists on the page
    const url = pg.url();
    const frames = pg.frames();
    const pageInfo = await pg.evaluate(() => {
      const textareas = Array.from(document.querySelectorAll("textarea")).map((t) => t.name).filter(Boolean);
      const inputs = Array.from(document.querySelectorAll("input")).map((i) => i.name).filter(Boolean);
      const bodySnippet = document.body?.innerText?.substring(0, 300) || "";
      const htmlLength = document.documentElement?.outerHTML?.length ?? 0;
      const frameElements = document.querySelectorAll("frame, iframe");
      const frameInfo = Array.from(frameElements).map((f) => (f as HTMLFrameElement).src || (f as HTMLIFrameElement).src || "no-src");
      return { textareas, inputs: inputs.slice(0, 20), bodySnippet, htmlLength, frameInfo };
    });
    console.error(`❌ Editor textarea no encontrado (${context})`);
    console.error(`   URL: ${url}`);
    console.error(`   Frames totales: ${frames.length} (${frames.map((f) => f.url()).join(", ")})`);
    console.error(`   Frame/iframe elements: ${pageInfo.frameInfo.join(", ") || "ninguno"}`);
    console.error(`   HTML length: ${pageInfo.htmlLength} bytes`);
    console.error(`   Textareas en página: ${pageInfo.textareas.join(", ") || "NINGUNO"}`);
    console.error(`   Inputs en página: ${pageInfo.inputs.join(", ") || "NINGUNO"}`);
    console.error(`   Body snippet: ${pageInfo.bodySnippet.substring(0, 200)}`);
    throw new Error(`Editor textarea no encontrado después de ${context}. URL: ${url}`);
  }
}

// Step 4: fill editor fields + Anteprima
async function step4_editor(pg: Page, data: NecrologioData, photoBuffer?: Buffer): Promise<Buffer> {
  console.log("📋 Paso 4: Llenando editor...");
  await waitForEditor(pg, "carga inicial del editor");

  // If simbolo requested, handle it BEFORE filling fields (navigation might reload the page)
  if (data.simbolo) {
    await step_simbolo(pg, data.simbolo);
    await waitForEditor(pg, "vuelta de ins_simbolo");
  }

  // If photo provided, upload it
  if (photoBuffer && data.foto_tipo) {
    await step_foto(pg, photoBuffer, data.foto_tipo, data.foto_colonne || 1);
    await waitForEditor(pg, "vuelta de ins_foto");
  }

  // nome_defunto_obbligatorio: usa nome_visualizzato (orden del operador) o fallback cognome+nome
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const nomeObbligatorio = data.nome_visualizzato
    || `${capitalize(data.cognome_defunto)} ${capitalize(data.nome_defunto)}`;
  console.log(`   nome_defunto_obbligatorio: "${nomeObbligatorio}"`);
  await fillTextarea(pg, 'textarea[name="CENTER_1_82_nome-defunto-obbligatorio"]', nomeObbligatorio);

  // Helper to fill or clear a textarea — ensures draft values from previous sessions don't persist
  const fillOrClear = async (selector: string, value: string | undefined, fieldName: string) => {
    await fillTextarea(pg, selector, value || "");
    if (value) filledFields.push(fieldName);
  };

  // Common fields (all tipologie)
  const filledFields: string[] = ["nome_defunto_obbligatorio"];
  await fillOrClear('textarea[name="RIGHT_1_76_ver"]', data.versetto, "versetto");
  await fillOrClear('textarea[name="LEFT_1_90_tes"]', data.testo_apertura, "testo_apertura");
  await fillOrClear('textarea[name="CENTER_1_79_tit"]', data.titolo_defunto, "titolo_defunto");
  await fillOrClear('textarea[name="LEFT_1_87_tes"]', data.testo_chiusura, "testo_chiusura");
  await fillOrClear('textarea[name="LEFT_1_88_loc"]', data.localita, "localita");

  if (data.sottotitolo_defunto) {
    await fillInput(pg, 'input[name="CENTER_1_437_sot"]', data.sottotitolo_defunto);
    filledFields.push("sottotitolo_defunto");
  } else {
    await fillInput(pg, 'input[name="CENTER_1_437_sot"]', "");
  }

  // Fields for annuncio_famiglia, anniversario, ringraziamento-trigesimo
  await fillOrClear('textarea[name="LEFT_1_89_tes"]', data.testo_centrale, "testo_centrale");
  await fillOrClear('textarea[name="LEFT_1_84_ono-funebri"]', data.onoranze_funebri, "onoranze_funebri");

  // Anniversario-specific editor fields
  if (data.tipologia === "anniversario") {
    const val = data.titolo_necrologio || "";
    const filled = await fillTextarea(pg, 'textarea[name="CENTER_2_78_titolo-necrologio-obbligatorio"]', val);
    if (!filled) {
      await fillTextarea(pg, 'textarea[name="CENTER_1_78_titolo-necrologio-obbligatorio"]', val);
    }
    await fillTextarea(pg, 'textarea[name="LEFT_3_81_dat"]', data.data_morte || "");
    await fillTextarea(pg, 'textarea[name="RIGHT_1_502_dat"]', data.data_anniversario || "");
  }

  // Ringraziamento-trigesimo specific editor fields
  if (data.tipologia === "ringraziamento-trigesimo") {
    const val = data.titolo_necrologio || "";
    const filled = await fillTextarea(pg, 'textarea[name="CENTER_1_78_titolo-necrologio-obbligatorio"]', val);
    if (!filled) {
      await fillTextarea(pg, 'textarea[name="CENTER_2_78_titolo-necrologio-obbligatorio"]', val);
    }
  }

  // ord_geo = 1 (Sassari)
  const ordGeoSel = await pg.$('select[name="ord_geo"]');
  if (ordGeoSel) {
    await pg.select('select[name="ord_geo"]', "1");
  }

  console.log(`   Campos llenados en editor: ${filledFields.join(", ")}`);

  // Click Anteprima and capture the preview
  console.log("📸 Haciendo click en Anteprima...");

  const popupPromise = new Promise<Page>((resolve) => {
    getBrowser()!.once("targetcreated", async (target) => {
      const newPage = await target.page();
      if (newPage) resolve(newPage);
    });
  });

  await pg.click('input[value="Anteprima"]');

  let screenshotBuffer: Buffer;
  try {
    const popup = await Promise.race([
      popupPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);

    if (popup) {
      await popup.waitForSelector("body", { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 2000));
      const raw = await popup.screenshot({ fullPage: true });
      screenshotBuffer = Buffer.from(raw);
      await popup.close();
    } else {
      await new Promise((r) => setTimeout(r, 3000));
      const raw = await pg.screenshot({ fullPage: true });
      screenshotBuffer = Buffer.from(raw);

      if (pg.url().includes("anteprima")) {
        const chiudiBtn = await pg.$('input[value="Chiudi"]');
        if (chiudiBtn) {
          await Promise.all([
            pg.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }),
            chiudiBtn.click(),
          ]);
        } else {
          await pg.goBack({ waitUntil: "networkidle2" });
        }
      }
    }
  } catch {
    console.warn("⚠️ No se pudo capturar Anteprima, screenshot de la página actual");
    const raw = await pg.screenshot({ fullPage: true });
    screenshotBuffer = Buffer.from(raw);
  }

  console.log("✅ Screenshot de Anteprima capturado");
  return screenshotBuffer;
}

export async function fillFormAndScreenshot(data: NecrologioData, photoBuffer?: Buffer): Promise<Buffer> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🌐 INICIO FORMULARIO: ${data.cognome_defunto} ${data.nome_defunto}`);
  console.log(`   Tipologia: ${data.tipologia}`);
  console.log(`   Campos: ${Object.entries(data).filter(([_, v]) => v != null).map(([k]) => k).join(", ")}`);
  if (photoBuffer) console.log(`   Foto: ${photoBuffer.length} bytes`);
  console.log(`${"=".repeat(60)}`);

  const pg = await ensureBrowser();

  await login(pg);
  await navigateToInserisci(pg);
  await step1_testata(pg, data);
  await step2_defunto(pg, data);
  await step3_skipSimilar(pg);
  const screenshot = await step4_editor(pg, data, photoBuffer);

  console.log(`✅ FORMULARIO COMPLETO — esperando confirmación del operador\n`);
  return screenshot;
}

export async function submitForm(): Promise<void> {
  const page = getPage();
  if (!page || page.isClosed()) {
    throw new Error("No hay formulario abierto para enviar");
  }

  // Step 5: Conferma
  console.log("🚀 Paso 5: Haciendo click en Conferma...");
  console.log(`   URL pre-conferma: ${page.url()}`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
    page.click('input[value="Conferma"]'),
  ]);
  console.log(`   URL post-conferma: ${page.url()}`);

  // Step 6: riferimento (cliente)
  console.log("📋 Paso 6: Seleccionando riferimento (cliente=472096)...");
  await page.waitForSelector('select[name="riferimento_s"]', { timeout: 10000 });
  await page.select('select[name="riferimento_s"]', "472096");
  await new Promise((r) => setTimeout(r, 1000));
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
    page.click("#Button1"),
  ]);
  console.log(`   URL post-riferimento: ${page.url()}`);

  // Step 7: Salva Necrologio
  console.log("💾 Paso 7: Salvando necrologio...");
  await page.waitForSelector("#idBtnSalva", { timeout: 10000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
    page.click("#idBtnSalva"),
  ]);

  const finalUrl = page.url();
  const pageContent = await page.content();
  console.log(`   URL post-salva: ${finalUrl}`);

  if (pageContent.includes("INSERITA CORRETTAMENTE")) {
    console.log("✅ Necrologio inserido correctamente!");
  } else {
    // Log snippet of page for debugging
    const textContent = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.error(`❌ Pagina post-submit no contiene 'INSERITA CORRETTAMENTE'. Contenido:\n${textContent}`);
    throw new Error("Pubblicazione non confermata dal sito — il necrologio potrebbe non essere stato salvato");
  }
}
