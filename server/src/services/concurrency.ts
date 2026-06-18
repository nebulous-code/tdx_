// concurrency.ts — minimal per-resource optimistic concurrency. ETag = the row's
// `updated_at`. A mutating request MAY send `If-Match`; if present and stale, the
// write is rejected (PreconditionFailed → 412). Absent If-Match is allowed
// (pragmatic for single-user clients that don't track ETags).

export class PreconditionFailed extends Error {
  constructor() {
    super('stale');
    this.name = 'PreconditionFailed';
  }
}

export const etag = (updatedAt: string): string => `"${updatedAt}"`;

export function checkIfMatch(ifMatch: string | undefined, current: string): void {
  if (ifMatch == null) return; // no precondition supplied
  const provided = ifMatch.replace(/^W\//, '').replace(/^"|"$/g, '');
  if (provided !== current) throw new PreconditionFailed();
}
