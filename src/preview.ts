import type { NecrologioData } from "./session.js";

const TIPOLOGIA_LABELS: Record<string, string> = {
  partecipazione: "Partecipazione",
  annuncio_famiglia: "Annuncio Famiglia",
  anniversario: "Anniversario",
  "ringraziamento-trigesimo": "Ringraziamento/Trigesimo",
};

export function generateTextPreview(data: NecrologioData): string {
  const lines: string[] = [];
  const label = TIPOLOGIA_LABELS[data.tipologia] || data.tipologia;

  lines.push(`📋 *ANTEPRIMA — ${label.toUpperCase()}*`);
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  // Anniversario: date e titolo necrologio in cima
  if (data.tipologia === "anniversario") {
    if (data.data_morte) lines.push(`  ${data.data_morte}`);
    if (data.titolo_necrologio) lines.push(`  *${data.titolo_necrologio}*`);
    if (data.data_anniversario) lines.push(`  ${data.data_anniversario}`);
    lines.push("");
  }

  // Ringraziamento: titolo necrologio in cima
  if (data.tipologia === "ringraziamento-trigesimo") {
    if (data.titolo_necrologio) lines.push(`  *${data.titolo_necrologio}*`);
    lines.push("");
  }

  // Simbolo o Foto
  if (data.foto_tipo) {
    const tipo = data.foto_tipo === "colore" ? "colori" : "B/N";
    const col = data.foto_colonne || 1;
    lines.push(`  📷 [FOTO ${col} col. ${tipo}]`);
    lines.push("");
  } else if (data.simbolo) {
    const simboloText = data.simbolo === "croce_cristiana" ? "  ✝️" : "  ✡️";
    lines.push(simboloText);
    lines.push("");
  }

  // Versetto
  if (data.versetto) {
    lines.push(`  _${data.versetto}_`);
    lines.push("");
  }

  // Testo apertura
  if (data.testo_apertura) {
    lines.push(`  ${data.testo_apertura}`);
  }

  // Titolo defunto (raro)
  if (data.titolo_defunto) {
    lines.push(`  ${data.titolo_defunto}`);
  }

  // Nome defunto (sempre presente, centrato e in grassetto) — orden del operador
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const nomeVisualizzato = data.nome_visualizzato
    || `${capitalize(data.cognome_defunto)} ${capitalize(data.nome_defunto)}`;
  lines.push(`  *${nomeVisualizzato}*`);

  // Sottotitolo (età)
  if (data.sottotitolo_defunto) {
    lines.push(`  ${data.sottotitolo_defunto}`);
  }

  // Separazione visiva prima del corpo
  if (data.testo_centrale || data.testo_chiusura) {
    lines.push("");
  }

  // Testo centrale (chi annuncia)
  if (data.testo_centrale) {
    lines.push(`  ${data.testo_centrale}`);
  }

  // Testo chiusura (funerali)
  if (data.testo_chiusura) {
    lines.push(`  ${data.testo_chiusura}`);
  }

  // Località
  if (data.localita) {
    lines.push("");
    lines.push(`  ${data.localita}`);
  }

  // Onoranze funebri
  if (data.onoranze_funebri) {
    lines.push(`  ${data.onoranze_funebri}`);
  }

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Info tecnica sotto (solo per il sito, non visiva nel necrologio)
  if (data.tipologia === "annuncio_famiglia") {
    const info: string[] = [];
    if (data.comune_nascita) info.push(`Nascita: ${data.comune_nascita}`);
    if (data.comune_morte) info.push(`Morte: ${data.comune_morte}`);
    if (data.data_morte) info.push(`Data: ${data.data_morte}`);
    if (info.length > 0) {
      lines.push(`📎 _${info.join(" · ")}_`);
    }
  }

  return lines.join("\n");
}
