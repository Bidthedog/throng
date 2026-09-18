/**
 * US1 scenarios 1 and 5 resolve `src/foo.ts` and `src/foo.ts:42:7` here.
 *
 * This file is deliberately more than 100 lines long, so that line 42 column 7 is a real
 * position inside it and a test can assert the caret landed there rather than being clamped
 * to the end of a short file.
 *
 * Nothing imports it and nothing runs it. It is read as text.
 */

export interface FooOptions {
  readonly name: string;
  readonly count: number;
  readonly enabled: boolean;
}

export const DEFAULT_FOO_OPTIONS: FooOptions = {
  name: 'foo',
  count: 1,
  enabled: true,
};

export class Foo {
  private readonly options: FooOptions;
  private calls = 0;

  constructor(options: Partial<FooOptions> = {}) {
    this.options = { ...DEFAULT_FOO_OPTIONS, ...options };
  }

  get name(): string {
    return this.options.name;
  }

  get count(): number {
    return this.options.count;
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  // Line 42 lands in the middle of this method, well inside the file.
  describe(): string {
    this.calls += 1;
    return `${this.options.name} x${this.options.count}`;
  }

  timesDescribed(): number {
    return this.calls;
  }

  withName(name: string): Foo {
    return new Foo({ ...this.options, name });
  }

  withCount(count: number): Foo {
    return new Foo({ ...this.options, count });
  }

  disabled(): Foo {
    return new Foo({ ...this.options, enabled: false });
  }
}

export function makeFoo(name: string): Foo {
  return new Foo({ name });
}

export function makeFoos(names: readonly string[]): Foo[] {
  return names.map((name) => makeFoo(name));
}

export function describeAll(foos: readonly Foo[]): string[] {
  return foos.map((foo) => foo.describe());
}

export function totalCount(foos: readonly Foo[]): number {
  return foos.reduce((sum, foo) => sum + foo.count, 0);
}

export function enabledOnly(foos: readonly Foo[]): Foo[] {
  return foos.filter((foo) => foo.enabled);
}

export function byName(foos: readonly Foo[]): Map<string, Foo> {
  const map = new Map<string, Foo>();
  for (const foo of foos) {
    map.set(foo.name, foo);
  }
  return map;
}

export function firstEnabled(foos: readonly Foo[]): Foo | undefined {
  return foos.find((foo) => foo.enabled);
}

export function renameAll(foos: readonly Foo[], suffix: string): Foo[] {
  return foos.map((foo) => foo.withName(`${foo.name}${suffix}`));
}

export function scaleAll(foos: readonly Foo[], factor: number): Foo[] {
  return foos.map((foo) => foo.withCount(foo.count * factor));
}

export function disableAll(foos: readonly Foo[]): Foo[] {
  return foos.map((foo) => foo.disabled());
}

export function isFoo(value: unknown): value is Foo {
  return value instanceof Foo;
}

export function sortByName(foos: readonly Foo[]): Foo[] {
  return [...foos].sort((a, b) => a.name.localeCompare(b.name));
}

export function sortByCount(foos: readonly Foo[]): Foo[] {
  return [...foos].sort((a, b) => a.count - b.count);
}

export function summarise(foos: readonly Foo[]): string {
  const enabled = enabledOnly(foos).length;
  return `${foos.length} foos, ${enabled} enabled, ${totalCount(foos)} in total`;
}
