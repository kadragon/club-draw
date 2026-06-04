import type { DrawRecord, Participant, Prize } from "./types.js";

// ── Backup / Restore ──────────────────────────────────────────────────────────

/** Participants+prizes snapshot for backup/restore. No ids, session state, or settings. */
export interface BackupData {
  participants: { name: string; cumulativeWins: number }[];
  prizes: { name: string }[];
}

/**
 * Encode participants + prizes to a single-line base64 token.
 * ids, excluded, drawn, winnerId intentionally omitted — restore uses fresh ids.
 * UTF-8 encoded before base64 so Korean/non-Latin names survive btoa().
 */
export function encodeBackup(state: {
  participants: readonly Participant[];
  prizes: readonly Prize[];
}): string {
  const payload: BackupData = {
    participants: state.participants.map(({ name, cumulativeWins }) => ({ name, cumulativeWins })),
    prizes: state.prizes.map(({ name }) => ({ name })),
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  // Build Latin1 string byte-by-byte to avoid stack overflow on large arrays
  let latin1 = "";
  for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]!);
  return btoa(latin1);
}

/**
 * Decode a base64 backup token to BackupData.
 * Throws on any malformed input — callers must try/catch.
 * Trims surrounding whitespace to tolerate paste artefacts.
 */
export function decodeBackup(token: string): BackupData {
  const trimmed = token.trim();
  if (trimmed === "") throw new Error("empty backup token");
  const latin1 = atob(trimmed); // throws on invalid base64
  const bytes = new Uint8Array(latin1.length);
  for (let i = 0; i < latin1.length; i++) bytes[i] = latin1.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  const data = JSON.parse(json) as unknown; // throws on invalid JSON
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("backup root must be an object");
  }
  const obj = data as Record<string, unknown>;
  const participants = Array.isArray(obj.participants) ? obj.participants : [];
  const prizes = Array.isArray(obj.prizes) ? obj.prizes : [];
  return {
    participants: participants
      .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
      .map((p) => {
        const name = String(p.name ?? "").trim();
        const n = Number(p.cumulativeWins);
        return { name, cumulativeWins: Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)) };
      })
      .filter((p) => p.name !== ""),
    prizes: prizes
      .filter((z): z is Record<string, unknown> => typeof z === "object" && z !== null)
      .map((z) => ({ name: String(z.name ?? "").trim() }))
      .filter((z) => z.name !== ""),
  };
}

/**
 * Generate a date-stamped backup filename: club-draw-backup-YYYY-MM-DD.txt.
 * Uses local date parts so the name matches the operator's calendar.
 */
export function backupFilename(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `club-draw-backup-${y}-${m}-${d}.txt`;
}

/** Parsed roster row before it becomes a full Participant (no id yet). */
export interface RosterRow {
  name: string;
  cumulativeWins: number;
}

/** Leading characters Excel/Sheets treat as a formula — neutralized on export. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Parse CSV text into rows of fields. RFC-4180-ish: double-quoted fields may
 * contain commas, quotes (escaped as `""`) and newlines; unquoted newlines end
 * a record. Handling quoted newlines here (vs. naive line-splitting) keeps the
 * export → import roundtrip lossless for any field content.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += c;
      i++;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/** Quote a CSV field if it contains a comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Neutralize CSV formula injection, then quote. The guard is reversed by {@link unguard}. */
function guardField(value: string): string {
  return csvField(FORMULA_LEAD.test(value) ? `'${value}` : value);
}

/** Reverse {@link guardField}: drop a leading apostrophe only when it shields a formula char. */
function unguard(value: string): string {
  if (value[0] === "'" && FORMULA_LEAD.test(value.slice(1))) return value.slice(1);
  return value;
}

const HEADER_RE = /^\s*name\s*$/i;

/**
 * Parse a pasted roster or imported CSV into rows.
 *
 * Accepts one entry per record as `name` or `name,cumulativeWins`. Blank records
 * are skipped; a leading `name[,...]` header is ignored. Missing/non-numeric/negative
 * cumulative values default to 0. A formula-guard apostrophe (see export) is reversed.
 */
export function parseRoster(text: string): RosterRow[] {
  const rows: RosterRow[] = [];
  const records = parseCsv(text);
  for (let r = 0; r < records.length; r++) {
    const fields = records[r]!;
    const rawName = (fields[0] ?? "").trim();
    if (rawName === "" && (fields[1] ?? "").trim() === "") continue; // blank record
    if (r === 0 && HEADER_RE.test(fields[0]?.trim() ?? "")) continue; // header row
    const name = unguard(rawName).trim();
    if (name === "") continue;
    const n = Number((fields[1] ?? "").trim());
    rows.push({ name, cumulativeWins: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 });
  }
  return rows;
}

/** Serialize participants to CSV with a header row (formula-guarded, roundtrip-safe). */
export function participantsToCSV(participants: readonly Participant[]): string {
  const lines = ["name,cumulativeWins"];
  for (const p of participants) {
    lines.push(`${guardField(p.name)},${Math.max(0, p.cumulativeWins)}`);
  }
  return lines.join("\n");
}

/**
 * Merge this session's wins into each participant's carry-over total — returns a
 * NEW array, input untouched. Wins match a participant by stable id (falling back
 * to exact name for legacy records lacking winnerId), so duplicate display names
 * each get only their own wins. Used to produce the next-round roster for display;
 * never persisted (the cumulative invariant: it stays an operator-entered
 * carry-over, not an auto-increment).
 */
export function mergeSessionWins(
  participants: readonly Participant[],
  records: readonly DrawRecord[],
): Participant[] {
  const wins = new Map<string, number>();
  for (const r of records) {
    const key = r.winnerId ?? r.winner;
    wins.set(key, (wins.get(key) ?? 0) + 1);
  }
  return participants.map((p) => ({
    ...p,
    cumulativeWins: Math.max(0, p.cumulativeWins) + (wins.get(p.id) ?? wins.get(p.name) ?? 0),
  }));
}

/** Serialize draw records to CSV with a header row (formula-guarded). */
export function recordsToCSV(records: readonly DrawRecord[]): string {
  const lines = ["prize,winner,at"];
  for (const r of records) {
    lines.push(`${guardField(r.prize)},${guardField(r.winner)},${guardField(r.at)}`);
  }
  return lines.join("\n");
}
