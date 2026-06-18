// rec.ts — TypeScript port of frontend/js/recurrence.js (pure functions).
// Behavior is intended to be byte-for-byte identical (parity-tested against the
// Phase 0 goldens); only the wrapper changed (window.Rec -> exports) plus light
// types. Supported syntax is unchanged — see the original header.

export type RuleType = 'daily' | 'weekly' | 'monthly-day' | 'monthly-weekday' | 'invalid';

export interface Rule {
  type: RuleType;
  interval?: number;
  days?: number[] | null;
  day?: number | null;
  ord?: number;
  weekday?: number;
  raw?: string;
}

export interface OccurrenceOpts {
  anchor?: string | Date;
  from?: string | Date;
  count?: number;
  inclusive?: boolean;
}

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORD: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, last: -1 };
const ORD_NAME: Record<number, string> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
  4: '4th',
  5: '5th',
  '-1': 'last',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseYMD(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function daysBetween(a: Date, b: Date): number {
  return Math.round((+startOfDay(b) - +startOfDay(a)) / 86400000);
}
function sameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

// ---- parse -------------------------------------------------
export function parse(str: string | null | undefined): Rule | null {
  if (!str) return null;
  const s = str.trim().toLowerCase().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;

  if (s === 'daily' || s === 'every day') return { type: 'daily', interval: 1 };

  if ((m = s.match(/^every (\d+) days?$/))) return { type: 'daily', interval: +m[1] };

  // weekly on days / every N weeks on days
  if ((m = s.match(/^weekly on (.+)$/))) return mkWeekly(1, m[1]);
  if ((m = s.match(/^every (\d+) weeks? on (.+)$/))) return mkWeekly(+m[1], m[2]);
  if ((m = s.match(/^every (\d+) weeks?$/))) return { type: 'weekly', interval: +m[1], days: null };

  // monthly on day D
  if ((m = s.match(/^monthly on day (\d+)$/)))
    return { type: 'monthly-day', interval: 1, day: clampDay(+m[1]) };
  if ((m = s.match(/^every (\d+) months? on day (\d+)$/)))
    return { type: 'monthly-day', interval: +m[1], day: clampDay(+m[2]) };

  // monthly on Nth weekday
  if ((m = s.match(/^monthly on (1st|2nd|3rd|4th|5th|last) (mon|tue|wed|thu|fri|sat|sun)$/)))
    return { type: 'monthly-weekday', interval: 1, ord: ORD[m[1]], weekday: WD.indexOf(m[2]) };
  if (
    (m = s.match(
      /^every (\d+) months? on (1st|2nd|3rd|4th|5th|last) (mon|tue|wed|thu|fri|sat|sun)$/,
    ))
  )
    return { type: 'monthly-weekday', interval: +m[1], ord: ORD[m[2]], weekday: WD.indexOf(m[3]) };

  if ((m = s.match(/^every (\d+) months?$/)))
    return { type: 'monthly-day', interval: +m[1], day: null };

  return { type: 'invalid', raw: str };
}

function clampDay(d: number): number {
  return Math.min(31, Math.max(1, d));
}

function mkWeekly(interval: number, daysStr: string): Rule {
  const days = daysStr
    .split(/[ ,]+/)
    .map((x) => WD.indexOf(x.trim()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (!days.length) return { type: 'invalid', raw: `weekly on ${daysStr}` };
  return { type: 'weekly', interval, days };
}

// ---- stringify (canonical) --------------------------------
export function stringify(r: Rule | null): string {
  if (!r || r.type === 'invalid') return '';
  switch (r.type) {
    case 'daily':
      return r.interval === 1 ? 'daily' : `every ${r.interval} days`;
    case 'weekly': {
      const dd = r.days && r.days.length ? r.days.map((i) => WD[i]).join(',') : null;
      if (r.interval === 1) return dd ? `weekly on ${dd}` : 'weekly on mon';
      return dd ? `every ${r.interval} weeks on ${dd}` : `every ${r.interval} weeks`;
    }
    case 'monthly-day': {
      const d = r.day || 1;
      return r.interval === 1 ? `monthly on day ${d}` : `every ${r.interval} months on day ${d}`;
    }
    case 'monthly-weekday': {
      const o = ORD_NAME[r.ord as number];
      const w = WD[r.weekday as number];
      return r.interval === 1 ? `monthly on ${o} ${w}` : `every ${r.interval} months on ${o} ${w}`;
    }
  }
}

// ---- human summary ----------------------------------------
export function summary(strOrObj: string | Rule | null): string {
  const r = typeof strOrObj === 'string' ? parse(strOrObj) : strOrObj;
  if (!r) return '';
  if (r.type === 'invalid') return 'invalid pattern';
  switch (r.type) {
    case 'daily':
      return r.interval === 1 ? 'Every day' : `Every ${r.interval} days`;
    case 'weekly': {
      const names = r.days && r.days.length ? r.days.map((i) => WD_FULL[i]).join(', ') : '—';
      if (r.interval === 1) return `Weekly on ${names}`;
      return r.days && r.days.length
        ? `Every ${r.interval} weeks on ${names}`
        : `Every ${r.interval} weeks`;
    }
    case 'monthly-day': {
      const d = r.day;
      if (!d) return `Every ${r.interval} months`;
      const suf = ordSuffix(d);
      return r.interval === 1
        ? `Monthly on the ${d}${suf}`
        : `Every ${r.interval} months on the ${d}${suf}`;
    }
    case 'monthly-weekday': {
      const ord = r.ord as number;
      const o = ord === -1 ? 'last' : ord + ordSuffix(ord);
      const w = WD_FULL[r.weekday as number];
      return r.interval === 1
        ? `Monthly on the ${o} ${w}`
        : `Every ${r.interval} months on the ${o} ${w}`;
    }
  }
}
export function ordSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// compact one-line label for dense rows
export function compact(strOrObj: string | Rule | null): string {
  const r = typeof strOrObj === 'string' ? parse(strOrObj) : strOrObj;
  if (!r || r.type === 'invalid') return '';
  const A = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  switch (r.type) {
    case 'daily':
      return r.interval === 1 ? 'daily' : `${r.interval}d`;
    case 'weekly': {
      const dd = r.days && r.days.length ? r.days.map((i) => A[i]).join('·') : '—';
      return r.interval === 1 ? dd : `${dd}/${r.interval}w`;
    }
    case 'monthly-day':
      if (!r.day) return `${r.interval}mo`;
      return r.interval === 1 ? `day ${r.day}` : `day ${r.day}/${r.interval}mo`;
    case 'monthly-weekday': {
      const ord = r.ord as number;
      const o = ord === -1 ? 'last' : ord + ordSuffix(ord);
      const w = A[r.weekday as number];
      return r.interval === 1 ? `${o} ${w}` : `${o} ${w}/${r.interval}mo`;
    }
  }
}

// ---- occurrence matching ----------------------------------
function nthWeekdayOfMonth(year: number, month: number, weekday: number, ord: number): Date | null {
  if (ord === -1) {
    const last = new Date(year, month + 1, 0);
    const back = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - back);
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (ord - 1) * 7;
  const dim = new Date(year, month + 1, 0).getDate();
  if (day > dim) return null;
  return new Date(year, month, day);
}

export function matches(date: Date, r: Rule, anchor?: Date): boolean {
  date = startOfDay(date);
  anchor = anchor ? startOfDay(anchor) : date;
  if (date < anchor) return false;
  switch (r.type) {
    case 'daily': {
      const n = r.interval || 1;
      return daysBetween(anchor, date) % n === 0;
    }
    case 'weekly': {
      const n = r.interval || 1;
      const days = r.days && r.days.length ? r.days : [anchor.getDay()];
      if (!days.includes(date.getDay())) return false;
      // week phase: weeks since anchor's Sunday
      const aWeek = weekIndex(anchor);
      const dWeek = weekIndex(date);
      return (dWeek - aWeek) % n === 0;
    }
    case 'monthly-day': {
      const n = r.interval || 1;
      if (monthsBetween(anchor, date) % n !== 0) return false;
      const dim = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      const target = r.day ? Math.min(r.day, dim) : Math.min(anchor.getDate(), dim);
      return date.getDate() === target;
    }
    case 'monthly-weekday': {
      const n = r.interval || 1;
      if (monthsBetween(anchor, date) % n !== 0) return false;
      const occ = nthWeekdayOfMonth(
        date.getFullYear(),
        date.getMonth(),
        r.weekday as number,
        r.ord as number,
      );
      return !!occ && sameDay(occ, date);
    }
  }
  return false;
}
function weekIndex(d: Date): number {
  return Math.floor(daysBetween(new Date(1970, 0, 4), d) / 7); // 1970-01-04 = Sunday
}
function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// ---- next N occurrences from a date (exclusive of `from` by default)
export function nextOccurrences(strOrObj: string | Rule | null, opts?: OccurrenceOpts): Date[] {
  opts = opts || {};
  const r = typeof strOrObj === 'string' ? parse(strOrObj) : strOrObj;
  if (!r || r.type === 'invalid') return [];
  const anchorD = opts.anchor
    ? typeof opts.anchor === 'string'
      ? parseYMD(opts.anchor)
      : opts.anchor
    : new Date();
  const fromD = opts.from
    ? typeof opts.from === 'string'
      ? parseYMD(opts.from)
      : opts.from
    : new Date();
  const count = opts.count || 3;
  const inclusive = !!opts.inclusive;
  const out: Date[] = [];
  let cur = startOfDay(fromD as Date);
  if (!inclusive) cur = addDays(cur, 1);
  let guard = 0;
  const cap = 366 * 6;
  while (out.length < count && guard < cap) {
    if (matches(cur, r, anchorD as Date)) out.push(new Date(cur));
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

// next single occurrence strictly after `from`
export function next(
  strOrObj: string | Rule | null,
  from?: string | Date,
  anchor?: string | Date,
): Date | null {
  const r = nextOccurrences(strOrObj, { from, anchor: anchor || from, count: 1 });
  return r[0] || null;
}

export const Rec = {
  parse,
  stringify,
  summary,
  compact,
  matches,
  nextOccurrences,
  next,
  ymd,
  parseYMD,
  addDays,
  startOfDay,
  daysBetween,
  ordSuffix,
  WD,
  WD_FULL,
  ORD_NAME,
};
export default Rec;
