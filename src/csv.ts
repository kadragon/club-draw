import type { DrawRecord, Participant } from "./types.js";

/** Parsed roster row before it becomes a full Participant (no id yet). */
export interface RosterRow {
  name: string;
  cumulativeWins: number;
}

/** Split a single CSV line into fields, honoring double-quoted fields with `""` escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/** Quote a CSV field if it contains a comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const HEADER_RE = /^\s*name\s*(,|$)/i;

/**
 * Parse a pasted roster or imported CSV into rows.
 *
 * Accepts one entry per line as `name` or `name,cumulativeWins`. Blank lines are
 * skipped; a leading `name[,...]` header line is ignored. A missing or non-numeric
 * cumulative value defaults to 0.
 */
export function parseRoster(text: string): RosterRow[] {
  const rows: RosterRow[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    if (i === 0 && HEADER_RE.test(raw)) continue;
    const fields = splitCsvLine(raw);
    const name = (fields[0] ?? "").trim();
    if (name === "") continue;
    const n = Number((fields[1] ?? "").trim());
    rows.push({ name, cumulativeWins: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 });
  }
  return rows;
}

/** Serialize participants to CSV with a header row. */
export function participantsToCSV(participants: readonly Participant[]): string {
  const lines = ["name,cumulativeWins"];
  for (const p of participants) {
    lines.push(`${csvField(p.name)},${p.cumulativeWins}`);
  }
  return lines.join("\n");
}

/** Serialize draw records to CSV with a header row. */
export function recordsToCSV(records: readonly DrawRecord[]): string {
  const lines = ["prize,winner,at"];
  for (const r of records) {
    lines.push(`${csvField(r.prize)},${csvField(r.winner)},${csvField(r.at)}`);
  }
  return lines.join("\n");
}
