// query.ts — TypeScript port of frontend/js/query.js. Behavior intended identical
// (parity-tested against the Phase 0 goldens); the only changes are window.Q ->
// exports, the bare global `Rec` -> an import, and light types. Grammar unchanged
// — see the original header.

import { Rec } from './rec.js';

export interface Task {
  id?: string;
  title?: string;
  notes?: string;
  projectId?: string;
  parentId?: string | null;
  labels?: string[];
  done?: boolean;
  due?: string | null;
  reminder?: string | null;
  recurrence?: string | null;
  priority?: number;
  size?: number;
  [k: string]: unknown;
}
export interface Project {
  id: string;
  name: string;
  [k: string]: unknown;
}
export interface Label {
  id: string;
  name: string;
  [k: string]: unknown;
}
export interface Ctx {
  tasks?: Task[];
  projects?: Project[];
  labels?: Label[];
  weekStart?: number;
}
export interface Term {
  field: string;
  value: string;
  neg: boolean;
}
export interface ParsedQuery {
  terms: Term[];
  ok: boolean;
}

const today = () => Rec.startOfDay(new Date());

// tokenize respecting quotes
function tokenize(str: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) out.push(m[1] !== undefined ? `"${m[1]}"` : m[2]);
  return out;
}

function parse(str: string | null | undefined): ParsedQuery {
  const terms: Term[] = [];
  if (!str || !str.trim()) return { terms, ok: true };
  for (let tok of tokenize(str)) {
    let neg = false;
    if (tok.startsWith('-') && tok.length > 1 && tok.indexOf(':') > 0) {
      neg = true;
      tok = tok.slice(1);
    }
    const qi = tok.indexOf(':');
    if (qi > 0 && !tok.startsWith('"')) {
      const field = tok.slice(0, qi).toLowerCase();
      const value = tok.slice(qi + 1).toLowerCase();
      terms.push({ field, value, neg });
    } else {
      terms.push({ field: 'text', value: tok.replace(/^"|"$/g, '').toLowerCase(), neg });
    }
  }
  return { terms, ok: true };
}

// resolve a project token (id or slug of name) -> set of matching project ids only
// (exact: subprojects are NOT included, so a parent's view/count shows just its own tasks)
function resolveProjects(value: string, ctx: Ctx): Set<string> {
  const projects = ctx.projects || [];
  const match = projects.filter(
    (p) => p.id === value || slug(p.name) === slug(value) || slug(p.name).includes(slug(value)),
  );
  return new Set(match.map((p) => p.id));
}
function slug(s: string | null | undefined): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function dueDelta(task: Task): number | null {
  // days from today to due (negative = overdue). null if no due.
  if (!task.due) return null;
  return Rec.daysBetween(today(), Rec.parseYMD(task.due) as Date);
}
function remDelta(task: Task): number | null {
  if (!task.reminder) return null;
  // reminder may be a 'YYYY-MM-DDTHH:MM' timestamp; query filters are day-grained.
  return Rec.daysBetween(today(), Rec.parseYMD(task.reminder.slice(0, 10)) as Date);
}

function cmpDate(delta: number | null, op: string): boolean {
  // op like "<7d", "<=3d", ">0d", "=0d"
  const mm = op.match(/^(<=|>=|<|>|=)(-?\d+)d$/);
  if (!mm || delta === null) return false;
  const o = mm[1];
  const n = +mm[2];
  switch (o) {
    case '<':
      return delta < n;
    case '>':
      return delta > n;
    case '<=':
      return delta <= n;
    case '>=':
      return delta >= n;
    case '=':
      return delta === n;
  }
  return false;
}

// ---- weekday window (due:su, due:mwf, …) ----------------------------------
// letter -> JS getDay() (0=Sun … 6=Sat)
const DOW: Record<string, number> = { u: 0, m: 1, t: 2, w: 3, r: 4, f: 5, s: 6 };
function weekdaySet(v: string): Set<number> {
  const s = new Set<number>();
  for (const c of String(v || '')) {
    if (c in DOW) s.add(DOW[c]);
  }
  return s;
}
// The active cycle's dates for the selected weekdays. weekStart: 0=Sun..6=Sat (default Mon).
// Window = this week's selected days, rolling to next week once we're past the last one.
function dueWindow(daySet: Set<number>, weekStart?: number): string[] {
  weekStart = weekStart == null ? 1 : weekStart;
  if (!daySet.size) return [];
  const now = today(); // Rec.startOfDay(new Date())
  const back = (now.getDay() - weekStart + 7) % 7; // days since the week start
  const start = Rec.addDays(now, -back);
  let dates = [...daySet].map((d) => Rec.addDays(start, (d - (weekStart as number) + 7) % 7));
  const last = dates.reduce((a, b) => (a > b ? a : b));
  if (now > last) dates = dates.map((d) => Rec.addDays(d, 7)); // past the window -> next week
  return dates.map(Rec.ymd);
}

function evalTerm(task: Task, t: Term, ctx: Ctx): boolean {
  const labelsOf = task.labels || [];
  let res = false;
  switch (t.field) {
    case 'text':
      res =
        (task.title || '').toLowerCase().includes(t.value) ||
        (task.notes || '').toLowerCase().includes(t.value);
      break;
    case 'project': {
      const ids = resolveProjects(t.value, ctx);
      res = ids.has(task.projectId as string);
      break;
    }
    case 'label': {
      const wants = t.value.split(',').map(slug);
      res = labelsOf.some((lid) => {
        const lab = (ctx.labels || []).find((l) => l.id === lid);
        return lab && wants.includes(slug(lab.name));
      });
      break;
    }
    case 'status': {
      const d = dueDelta(task);
      if (t.value === 'done') res = !!task.done;
      else if (t.value === 'open') res = !task.done;
      else if (t.value === 'overdue') res = !task.done && d !== null && d < 0;
      else if (t.value === 'today') res = !task.done && d === 0;
      break;
    }
    case 'due': {
      const d = dueDelta(task);
      if (t.value === 'none') res = d === null;
      else if (t.value === 'set') res = d !== null;
      else if (t.value === 'today') res = d === 0;
      else if (t.value === 'tomorrow') res = d === 1;
      else if (t.value === 'overdue') res = d !== null && d < 0;
      else if (t.value === 'week') res = d !== null && d >= 0 && d <= 7;
      else if (t.value === 'month') res = d !== null && d >= 0 && d <= 31;
      else if (/^[mtwrfsu]+$/.test(t.value))
        res =
          !!task.due &&
          dueWindow(weekdaySet(t.value), ctx.weekStart).includes(task.due.slice(0, 10));
      else res = cmpDate(d, t.value);
      break;
    }
    case 'reminder': {
      const d = remDelta(task);
      if (t.value === 'none') res = d === null;
      else if (t.value === 'set') res = d !== null;
      else if (t.value === 'today') res = d === 0;
      else if (t.value === 'overdue') res = d !== null && d < 0;
      else res = cmpDate(d, t.value);
      break;
    }
    case 'recurring':
      res = t.value === 'true' ? !!task.recurrence : !task.recurrence;
      break;
    case 'is':
      if (t.value === 'subtask') res = !!task.parentId;
      else if (t.value === 'task') res = !task.parentId;
      else if (t.value === 'recurring') res = !!task.recurrence;
      else if (t.value === 'done') res = !!task.done;
      else if (t.value === 'open') res = !task.done;
      break;
    case 'has':
      if (t.value === 'subtasks') res = (ctx.tasks || []).some((x) => x.parentId === task.id);
      else if (t.value === 'label') res = labelsOf.length > 0;
      else if (t.value === 'no-labels') res = labelsOf.length === 0;
      else if (t.value === 'due') res = !!task.due;
      break;
    default:
      // unknown field -> treat as text match on "field:value"
      res = (task.title || '').toLowerCase().includes(`${t.field}:${t.value}`);
  }
  return t.neg ? !res : res;
}

function evaluate(task: Task, query: string | ParsedQuery, ctx: Ctx): boolean {
  const q = typeof query === 'string' ? parse(query) : query;
  if (!q.terms.length) return true;
  return q.terms.every((t) => evalTerm(task, t, ctx));
}

// run query over the task list -> matching tasks (flat)
function run(query: string | ParsedQuery, ctx: Ctx): Task[] {
  return (ctx.tasks || []).filter((t) => evaluate(t, query, ctx));
}

// ---- builder helpers: structured <-> string ---------------
// We keep builder state as an array of {field,value,neg}; string is the join.
function termToString(t: Term): string {
  const body =
    t.field === 'text' ? (/\s/.test(t.value) ? `"${t.value}"` : t.value) : `${t.field}:${t.value}`;
  return (t.neg ? '-' : '') + body;
}
function build(terms: Term[]): string {
  return terms.map(termToString).join(' ');
}

export const Q = { parse, evaluate, run, build, termToString, tokenize, slug, dueDelta };
export default Q;
export { parse, evaluate, run, build, termToString, tokenize, slug, dueDelta };
