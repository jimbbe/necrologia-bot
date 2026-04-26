import { config } from "../config.js";
import { ensureBrowser, login } from "./helpers.js";

export async function cancelNecrologio(cognome: string, nome: string): Promise<{ success: boolean; message: string }> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🗑️ CANCELLAZIONE: ${cognome} ${nome}`);
  console.log(`${"=".repeat(60)}`);

  const pg = await ensureBrowser();

  // Check if we're already logged in by looking at the URL
  if (!pg.url().includes("amcannunci.it") || pg.url() === "about:blank") {
    await login(pg);
  }

  // Navigate to visualizza (search page)
  const today = new Date();
  const gg = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const aa = String(today.getFullYear());
  console.log(`🔍 Buscando necrologio de ${cognome} ${nome} en fecha ${gg}/${mm}/${aa}...`);

  const params = new URLSearchParams({
    giorno: gg,
    mese: mm,
    anno: aa,
    giorno_d: gg,
    mese_d: mm,
    anno_d: aa,
    testata: "41",
    edizione: "41",
    partecipazioni_rosse: "",
    defunto: `${cognome} ${nome}`.toUpperCase(),
    cliente: "",
  });

  const searchUrl = `${config.AMC_BASE_URL}/necro4/agenzia/visualizza_001_new.asp?${params}`;
  console.log(`   URL búsqueda: ${searchUrl}`);
  await pg.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });

  // Find the cancella link for this defunto
  const cancellaLink = await pg.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    const link = links.find((a) => a.href && a.href.includes("cancella.asp"));
    return link ? link.href : null;
  });

  if (!cancellaLink) {
    console.log(`   ❌ No se encontró link cancella.asp en la página de búsqueda`);
    return { success: false, message: "Nessun necrologio trovato con quel nome nella data odierna" };
  }

  // Navigate to cancella confirmation page
  console.log(`   Navegando a cancella: ${cancellaLink}`);
  await pg.goto(cancellaLink, { waitUntil: "networkidle2", timeout: 30000 });

  // Click the confirm cancellation button
  const confirmBtn = await pg.$('input[type="submit"], input[value*="ancella"], input[value*="onferm"], button');
  if (!confirmBtn) {
    console.log(`   ❌ No se encontró botón de confirmación en: ${pg.url()}`);
    return { success: false, message: "Non è stato possibile trovare il pulsante di conferma cancellazione" };
  }
  console.log(`   Clickeando botón de confirmación...`);

  await Promise.all([
    pg.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
    confirmBtn.click(),
  ]);

  const content = await pg.content();
  if (content.toLowerCase().includes("cancellat") || content.toLowerCase().includes("eliminat")) {
    console.log("✅ Necrologio cancelado correctamente");
    return { success: true, message: `Necrologio di ${cognome} ${nome} cancellato correttamente` };
  }

  return { success: true, message: `Operazione di cancellazione completata per ${cognome} ${nome}` };
}
