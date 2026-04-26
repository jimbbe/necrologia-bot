import { Page } from "puppeteer";
import { config } from "../config.js";

// Step 3b: select simbolo (optional)
// Discovery from testing: inserisci_002.asp is an intermediate page (1694 bytes) that
// stores the symbol server-side for the transaction, NOT the editor.
// In the normal browser flow, the user goes back to the editor via bfcache after GoBack.
//
// Our approach: fetch inserisci_002.asp from the editor (stores symbol server-side)
// + inject a hidden input CENTER_1_86_simbolo into the editor form (for form submission).
export async function step_simbolo(pg: Page, simbolo: "croce_cristiana" | "croce_david"): Promise<void> {
  console.log(`✝️ Seleccionando simbolo: ${simbolo}...`);

  const simboloId = simbolo === "croce_cristiana" ? "1" : "33";
  const simboloDesc = simbolo === "croce_cristiana" ? "croce cristiana" : "croce david";
  const nomevariabile = "CENTER_1_86_simbolo";

  // Extract id_transazione from current editor URL
  const currentUrl = pg.url();
  const transMatch = currentUrl.match(/id_transazione=(\d+)/);

  if (!transMatch) {
    console.warn(`⚠️ No se encontró id_transazione en URL, saltando simbolo...`);
    console.warn(`   URL actual: ${currentUrl}`);
    return;
  }

  const transId = transMatch[1];
  const baseUrl = config.AMC_BASE_URL.replace(/\/+$/, "") + "/necro4/agenzia/new_insert";

  // Build the inserisci_002.asp URL (same URL that GoBack() uses in the popup)
  const url002 = `${baseUrl}/inserisci_002.asp?id_simbolo=${simboloId}&descrizione=${encodeURIComponent(simboloDesc)}&nomevariabile=${nomevariabile}&id_transazione=${transId}`;

  // Strategy 1: Fetch inserisci_002.asp from editor context (no navigation, no page state loss)
  // This tells the server to store the symbol for this transaction
  console.log(`✝️ Fetching inserisci_002.asp desde el editor (sin navegar)...`);
  console.log(`   URL: ${url002}`);

  const fetchResult = await pg.evaluate(async (fetchUrl: string) => {
    try {
      const resp = await fetch(fetchUrl, { credentials: "include" });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, body: text.substring(0, 500) };
    } catch (e) {
      return { ok: false, status: 0, body: String(e) };
    }
  }, url002);

  console.log(`✝️ Fetch result: status=${fetchResult.status}, ok=${fetchResult.ok}`);
  console.log(`✝️ Response body: ${fetchResult.body.substring(0, 200)}`);

  // Strategy 2: Also inject a hidden input into the editor form
  // In case the server reads the symbol from form data instead of (or in addition to) server-side state
  const injected = await pg.evaluate((varName: string, value: string) => {
    // Try to find the main form
    const form = document.querySelector("form") || document.querySelector("#form1");

    // Also try to add/update the hidden input regardless of form
    const existing = document.querySelector(`input[name="${varName}"]`) as HTMLInputElement | null;
    if (existing) {
      existing.value = value;
      return { method: "updated existing input", formFound: !!form };
    }

    // Create and inject hidden input
    if (form) {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = varName;
      hidden.value = value;
      form.appendChild(hidden);
      return { method: "injected into form", formFound: true };
    }

    // No form found — inject into body (some editors have orphaned fields)
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = varName;
    hidden.value = value;
    document.body.appendChild(hidden);
    return { method: "injected into body (no form)", formFound: false };
  }, nomevariabile, simboloId);

  console.log(`✝️ Hidden input: ${JSON.stringify(injected)}`);

  // Strategy 3: Also try fetching the page via window.open → popup → GoBack flow
  // as a belt-and-suspenders approach (server might only honor the symbol from this flow)
  const browser = pg.browser();
  try {
    const simboloUrl = `${baseUrl}/ins_simbolo.asp?colonne=&nomevariabile=${nomevariabile}&id_transazione=${transId}`;

    const popupPromise = new Promise<Page | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 8000);
      browser.once("targetcreated", async (target) => {
        clearTimeout(timeout);
        const p = await target.page();
        resolve(p);
      });
    });

    await pg.evaluate((url: string) => {
      window.open(url, "simbolo_popup", "width=600,height=400");
    }, simboloUrl);

    const popup = await popupPromise;
    if (popup) {
      console.log(`✝️ Popup abierto para GoBack flow: ${popup.url()}`);
      try {
        await popup.waitForSelector("a", { timeout: 8000 });

        // Instead of letting GoBack navigate the editor, we intercept:
        // Execute GoBack logic ourselves — fetch the URL it would navigate to
        const goBackUrl = await popup.evaluate((targetId: string) => {
          const links = Array.from(document.querySelectorAll("a"));
          const link = links.find((a) => {
            const href = a.getAttribute("href") || "";
            return href.includes(`id_simbolo=${targetId}`);
          });
          if (!link) return null;
          // Extract the URL from the javascript:GoBack('...') href
          const href = link.getAttribute("href") || "";
          const match = href.match(/GoBack\('([^']+)'\)/);
          return match ? match[1] : null;
        }, simboloId);

        if (goBackUrl) {
          console.log(`✝️ GoBack URL extraída del popup: ${goBackUrl}`);
          // Resolve relative URL and fetch it (same as what GoBack would do, but via fetch)
          const fullGoBackUrl = `${baseUrl}/${goBackUrl}`;
          const goBackResult = await pg.evaluate(async (url: string) => {
            try {
              const resp = await fetch(url, { credentials: "include" });
              return { ok: resp.ok, status: resp.status };
            } catch (e) {
              return { ok: false, status: 0 };
            }
          }, fullGoBackUrl);
          console.log(`✝️ GoBack fetch result: status=${goBackResult.status}, ok=${goBackResult.ok}`);
        }
      } catch (e) {
        console.warn(`⚠️ Error en popup: ${e}`);
      }
      if (!popup.isClosed()) try { await popup.close(); } catch {}
    } else {
      console.log(`✝️ Popup no se abrió (OK, tenemos fetch como respaldo)`);
    }
  } catch (e) {
    console.warn(`⚠️ Error en flujo popup (no crítico): ${e}`);
  }

  // Verify we're still on the editor
  const finalUrl = pg.url();
  console.log(`✝️ URL final del editor: ${finalUrl}`);

  // Verify the hidden input is still there
  const verify = await pg.evaluate((varName: string) => {
    const el = document.querySelector(`input[name="${varName}"]`) as HTMLInputElement | null;
    return el ? { found: true, value: el.value } : { found: false, value: "" };
  }, nomevariabile);
  console.log(`✝️ Verificación hidden input: ${JSON.stringify(verify)}`);

  console.log(`✅ Simbolo "${simbolo}" configurado (fetch + hidden input + popup)`);
}

// Step 3c: upload foto (optional)
// ins_foto.asp shows 4 forms (1col BN, 1col Color, 2col BN, 2col Color).
// Each form POSTs to Upload.asp with the file (input name="FILE1").
// The ALLEGA button is type="button" with a JS handler — must click it, NOT form.submit().
export async function step_foto(pg: Page, photoBuffer: Buffer, fotoTipo: string, fotoColonne: number): Promise<void> {
  console.log(`📷 Subiendo foto (tipo=${fotoTipo}, colonne=${fotoColonne}, ${photoBuffer.length} bytes)...`);

  // Extract id_transazione from the current editor URL
  const currentUrl = pg.url();
  const transMatch = currentUrl.match(/id_transazione=(\d+)/);

  if (!transMatch) {
    console.warn(`⚠️ No se encontró id_transazione en URL, saltando foto...`);
    console.warn(`   URL actual: ${currentUrl}`);
    return;
  }

  const transId = transMatch[1];
  const baseUrl = config.AMC_BASE_URL.replace(/\/+$/, "") + "/necro4/agenzia/new_insert";

  // Try to extract ins_foto URL from the editor page (might be in a link, imagemap, or script)
  const extractedFotoUrl = await pg.evaluate(() => {
    const allEls = document.querySelectorAll("a, area, [onclick], [href]");
    for (const el of allEls) {
      const href = el.getAttribute("href") || "";
      const onclick = el.getAttribute("onclick") || "";
      if (href.includes("ins_foto")) return href;
      if (onclick.includes("ins_foto")) {
        const m = onclick.match(/ins_foto\.asp[^'")\s]*/);
        if (m) return m[0];
      }
    }
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const m = s.textContent?.match(/ins_foto\.asp[^'")\s]*/);
      if (m) return m[0];
    }
    return null;
  });

  let fotoPageUrl: string;
  if (extractedFotoUrl) {
    fotoPageUrl = extractedFotoUrl.startsWith("http")
      ? extractedFotoUrl
      : `${baseUrl}/${extractedFotoUrl.replace(/^\/+/, "")}`;
    console.log(`📷 URL de ins_foto extraída del editor: ${fotoPageUrl}`);
  } else {
    fotoPageUrl = `${baseUrl}/ins_foto.asp?sequenza=5&id_foto=32,383&ID_TIP0=155,155&nomevariabile=CENTER_1_77_foto&id_transazione=${transId}`;
    console.log(`📷 URL de ins_foto (default): ${fotoPageUrl}`);
  }

  await pg.goto(fotoPageUrl, { waitUntil: "networkidle2", timeout: 15000 });
  console.log(`📷 ins_foto.asp cargada. URL: ${pg.url()}`);

  // Write photo to temp file for Puppeteer file input
  const fsModule = await import("fs");
  const osModule = await import("os");
  const pathModule = await import("path");
  const tempPath = pathModule.join(osModule.default.tmpdir(), `necro-foto-${Date.now()}.jpg`);
  fsModule.writeFileSync(tempPath, photoBuffer);

  try {
    // Find ALL forms on the page — each corresponds to a photo option
    const allForms = await pg.$$("form");
    console.log(`📷 Encontrados ${allForms.length} formularios de foto`);

    // Log each form's action URL for diagnostics
    for (let i = 0; i < allForms.length; i++) {
      const info = await allForms[i].evaluate((f: HTMLFormElement) => {
        // Get surrounding text to identify what this form is for
        const row = f.closest("tr");
        const prevRow = row?.previousElementSibling;
        const label = prevRow?.textContent?.trim()?.substring(0, 80) || "";
        return { action: f.action, label };
      });
      console.log(`📷   Form[${i}]: ${info.label} → ${info.action.substring(info.action.indexOf("?") + 1, info.action.indexOf("?") + 120)}`);
    }

    // Determine which form to use based on tipo and colonne
    // Order from capture: 1col BN, 1col Color, 2col BN, 2col Color
    let formIndex: number;
    if (fotoColonne === 1 && fotoTipo === "bn") formIndex = 0;
    else if (fotoColonne === 1 && fotoTipo === "colore") formIndex = 1;
    else if (fotoColonne === 2 && fotoTipo === "bn") formIndex = 2;
    else formIndex = 3; // 2 col colore

    console.log(`📷 Usando form index ${formIndex} (${fotoColonne}col ${fotoTipo})`);

    if (formIndex >= allForms.length) {
      console.warn(`⚠️ Form index ${formIndex} fuera de rango (${allForms.length} forms), usando el primero`);
      formIndex = 0;
    }

    if (allForms.length === 0) {
      console.warn("⚠️ No se encontraron formularios de foto, saltando...");
      return;
    }

    const targetForm = allForms[formIndex];
    const formAction = await targetForm.evaluate((f: HTMLFormElement) => f.action);
    console.log(`📷 Form seleccionado action: ${formAction}`);

    // Find file input within this form (name="FILE1")
    const fileInput = await targetForm.$('input[type="file"]');
    if (!fileInput) {
      console.warn("⚠️ File input no encontrado en el formulario, saltando foto...");
      return;
    }

    // Upload the file to the input
    await (fileInput as any).uploadFile(tempPath);

    // Verify the file was set (check within the target form, not globally)
    const fileCheck = await fileInput.evaluate((el) => {
      const fi = el as HTMLInputElement;
      return { value: fi.value, files: fi.files?.length ?? 0 };
    });
    console.log(`📷 Archivo seleccionado: ${JSON.stringify(fileCheck)}`);

    await new Promise((r) => setTimeout(r, 500));

    // Ensure enctype is set for multipart file upload
    await targetForm.evaluate((form: HTMLFormElement) => {
      form.enctype = "multipart/form-data";
      form.encoding = "multipart/form-data";
    });

    // Log the ALLEGA button's onclick for diagnostics
    const allegaBtn = await targetForm.$('input[name="button1"]');
    if (allegaBtn) {
      const allegaOnclick = await allegaBtn.evaluate((el) => el.getAttribute("onclick") || "(no inline onclick)");
      console.log(`📷 ALLEGA button onclick: ${allegaOnclick}`);
    }

    // Submit the form: prefer clicking ALLEGA (JS handler), fallback to form.submit()
    const submitted = await (async () => {
      if (allegaBtn) {
        console.log("📷 Clickeando botón ALLEGA...");
        try {
          await Promise.all([
            pg.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
            allegaBtn.click(),
          ]);
          return "allega-click";
        } catch (clickErr) {
          console.warn(`⚠️ waitForNavigation tras ALLEGA falló (${clickErr}) — intentando form.submit()...`);
        }
      } else {
        console.warn("⚠️ Botón ALLEGA no encontrado — usando form.submit() directo...");
      }
      // Fallback: submit the form directly
      await targetForm.evaluate((form: HTMLFormElement) => form.submit());
      await pg.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
      return "form-submit";
    })();
    console.log(`📷 Submit completado via: ${submitted}`);

    // Log where we ended up after the upload
    const postUploadUrl = pg.url();
    const postUploadHtmlSnippet = await pg.evaluate(() => document.documentElement?.innerHTML?.substring(0, 800) || "");
    console.log(`📷 Post-upload URL: ${postUploadUrl}`);
    console.log(`📷 Post-upload HTML (800 chars): ${postUploadHtmlSnippet}`);

    // CRITICAL: We need to reach inserisci_002.asp to persist the photo server-side.
    //
    // Two possible scenarios after clicking ALLEGA:
    //
    // A) Upload.asp stays on screen (GoBack uses window.opener which is null → no-op):
    //    postUploadUrl = Upload.asp → we must extract GoBack URL and navigate to inserisci_002.asp
    //
    // B) GoBack uses window.location (fallback when no opener) → navigates current page:
    //    postUploadUrl = inserisci_002.asp → we're already there, skip navigation
    //
    // inserisci_002.asp runs server-side code that persists the photo for this transaction.
    // Its JS also sets parent.form_foto.* and parent.form1.* assignments (which fail since
    // there's no parent). We extract those assignments manually and apply them to the editor.

    let arrivedOnInserisci002 = postUploadUrl.includes("inserisci_002");

    if (!arrivedOnInserisci002) {
      // Scenario A or unknown — try to extract GoBack URL from current page
      // Handle both single-quote and double-quote variants: GoBack('...') or GoBack("...")
      const goBackUrl = await pg.evaluate(() => {
        const html = document.documentElement?.innerHTML || "";
        const regex = /GoBack\(["']([^"']+)["']\)/g;
        let m;
        while ((m = regex.exec(html)) !== null) {
          if (m[1].includes("inserisci_002")) return m[1];
        }
        return null;
      });

      if (goBackUrl) {
        console.log(`📷 GoBack URL extraída de Upload.asp: ${goBackUrl}`);
        const fullGoBackUrl = goBackUrl.startsWith("http") ? goBackUrl : `${baseUrl}/${goBackUrl}`;
        console.log(`📷 Navegando a inserisci_002.asp para persistir foto...`);
        await pg.goto(fullGoBackUrl, { waitUntil: "networkidle2", timeout: 15000 });
        arrivedOnInserisci002 = true;
      } else {
        console.warn(`⚠️ GoBack URL no encontrada en la página post-upload (URL: ${postUploadUrl})`);
        // Fallback: construct inserisci_002.asp URL from the form action params we already have.
        // The form action (Upload.asp?sequenza=X&id_foto=Y&nomevariabile=Z&id_transazione=T)
        // contains the params needed to build a valid inserisci_002.asp request.
        try {
          const actionUrl = new URL(formAction);
          const sequenza = actionUrl.searchParams.get("sequenza");
          const idFoto = actionUrl.searchParams.get("id_foto");
          const nomevariabile = actionUrl.searchParams.get("nomevariabile");
          if (sequenza && idFoto && nomevariabile) {
            const fallbackInserisci002 = `${baseUrl}/inserisci_002.asp?sequenza=${sequenza}&id_foto=${idFoto}&nomevariabile=${encodeURIComponent(nomevariabile)}&id_transazione=${transId}`;
            console.log(`📷 Fallback inserisci_002.asp construido desde formAction: ${fallbackInserisci002}`);
            await pg.goto(fallbackInserisci002, { waitUntil: "networkidle2", timeout: 15000 });
            arrivedOnInserisci002 = true;
          } else {
            console.warn("⚠️ Parámetros insuficientes en formAction para construir fallback URL");
          }
        } catch (fallbackErr) {
          console.warn(`⚠️ Error construyendo fallback URL: ${fallbackErr}`);
        }
      }
    } else {
      // Scenario B: GoBack navigated us directly to inserisci_002.asp
      console.log(`📷 GoBack navegó directo a inserisci_002.asp (Escenario B) — foto persistida server-side`);
    }

    if (arrivedOnInserisci002 || pg.url().includes("inserisci_002")) {
      console.log(`📷 En inserisci_002.asp (${pg.url()}) — extrayendo assignments...`);

      // inserisci_002.asp scripts set parent.form_foto.FIELD.value and parent.form1.FIELD.value
      // These fail silently (no parent). Extract them from HTML and apply manually to editor.
      const parentAssignments = await pg.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const assignments: Record<string, string> = {};
        const regex = /parent\.\w+\.(\w+)\.value\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^;<\n]+)/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
          const field = match[1];
          let value = match[2].trim();
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1).replace(/\\"/g, '"');
          } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1).replace(/\\'/g, "'");
          }
          assignments[field] = value;
        }
        return assignments;
      });
      console.log(`📷 Parent assignments extraídos: ${JSON.stringify(parentAssignments)}`);

      // Navigate back to editor
      console.log("📷 Navegando de vuelta al editor...");
      const editorUrl = `${baseUrl}/inserisci_006.asp?id_transazione=${transId}`;
      await pg.goto(editorUrl, { waitUntil: "networkidle2", timeout: 15000 });
      console.log(`📷 De vuelta en editor. URL: ${pg.url()}`);

      // Apply the assignments to the editor's hidden inputs
      const applied: string[] = [];
      for (const [field, value] of Object.entries(parentAssignments)) {
        if (field.startsWith("__")) continue;
        const result = await pg.evaluate((f: string, v: string) => {
          const input = document.querySelector(`input[name="${f}"]`) as HTMLInputElement | null;
          if (input) {
            input.value = v;
            return { found: true, oldValue: input.defaultValue };
          }
          const form = document.forms.namedItem("form_foto");
          if (form) {
            const formInput = form.elements.namedItem(f) as HTMLInputElement | null;
            if (formInput) {
              formInput.value = v;
              return { found: true, oldValue: formInput.defaultValue };
            }
          }
          return { found: false, oldValue: null };
        }, field, value);
        console.log(`📷 Set ${field} = ${value} → ${result.found ? "OK" : "NOT FOUND"} (era: ${result.oldValue})`);
        if (result.found) applied.push(field);
      }
      console.log(`📷 Campos aplicados en editor: ${applied.join(", ") || "NINGUNO"}`);
    }

  } finally {
    // Cleanup temp file
    try { fsModule.unlinkSync(tempPath); } catch {}
  }

  // If we haven't navigated to editor yet (no goBackUrl path), do it now
  if (!pg.url().includes("inserisci_006")) {
    console.log("📷 Navegando de vuelta al editor...");
    const editorUrl = `${baseUrl}/inserisci_006.asp?id_transazione=${transId}`;
    await pg.goto(editorUrl, { waitUntil: "networkidle2", timeout: 15000 });
    console.log(`📷 De vuelta en editor. URL: ${pg.url()}`);
  }

  // Final verification: check foto-related inputs in editor
  const fotoEvidence = await pg.evaluate(() => {
    const fotoInputs = Array.from(document.querySelectorAll("input")).filter((i) =>
      i.name.toLowerCase().includes("foto") || i.name === "id_foto"
    ).map((i) => ({ name: i.name, value: i.value, type: i.type }));
    const imgs = Array.from(document.querySelectorAll("img")).filter((i) =>
      i.src.includes("foto")
    ).map((i) => i.src);
    return { fotoInputs, fotoImages: imgs.slice(0, 5) };
  });
  console.log(`📷 Foto inputs en editor post-fix: ${JSON.stringify(fotoEvidence)}`);
}
