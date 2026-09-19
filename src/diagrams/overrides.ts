import type { DiagramDefinition, DiagramOverrides } from '../config/schema.js';

/** Helpers to apply user overrides uniformly across generators. */
export class OverrideHelper {
  readonly overrides: DiagramOverrides;
  private readonly aliasMap: Map<string, string>;

  constructor(definition: DiagramDefinition) {
    this.overrides = definition.overrides ?? {};
    this.aliasMap = new Map(Object.entries(this.overrides.aliases ?? {}));
  }

  /** Canonical id after alias merging. */
  canonical(id: string): string {
    return this.aliasMap.get(id) ?? id;
  }

  label(id: string, fallback: string): string {
    return this.overrides.labels?.[id] ?? this.overrides.labels?.[this.canonical(id)] ?? fallback;
  }

  isExcluded(id: string, name?: string): boolean {
    const ex = this.overrides.exclude ?? [];
    return ex.includes(id) || (name !== undefined && ex.includes(name)) || ex.includes(this.canonical(id));
  }

  actorFor(operationId: string, useCaseId: string, componentId: string): string | undefined {
    const a = this.overrides.actors;
    if (!a) return undefined;
    return a[operationId] ?? a[useCaseId] ?? a[componentId];
  }

  groupOf(id: string): string | undefined {
    for (const [group, members] of Object.entries(this.overrides.groups ?? {})) {
      if (members.includes(id) || members.includes(this.canonical(id))) return group;
    }
    return undefined;
  }

  get relationships() {
    return this.overrides.relationships ?? [];
  }

  get rawLines(): string[] {
    return this.overrides.raw ?? [];
  }

  get styleLines(): string[] {
    return this.overrides.style ?? [];
  }
}
