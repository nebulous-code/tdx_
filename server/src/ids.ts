import { randomUUID } from 'node:crypto';

// Global UUID id for every shareable resource (replaces the legacy prefixed `t_N`).
export const newId = (): string => randomUUID();
