import ts from 'typescript';
import { join } from 'node:path';

/**
 * 071 — which production files read each Settings key, resolved through the TypeScript type checker.
 *
 * ══ WHY THE TYPE CHECKER, AND NEVER THE TEXT ══
 *
 * A setting is inert when Preferences renders a control for it and nothing acts on its value (#95's
 * `explorer.openMode`). 019 tried finding readers by searching source text for each key and measured 11 false
 * positives, because settings are read through aliased section objects: `const s = settings.explorer; …
 * s.dragCopyModifier` never spells the key (019 C16). So this module never looks at text. It follows each VALUE
 * from the `AppSettings` root and asks the checker what every expression denotes (research R1, R3):
 *
 *   1. an expression whose type is the root carries the path `''`;
 *   2. `x.name` and `x[k]` extend x's paths by `name`, by each string literal `k`'s type allows, or by `*` for a
 *      key the type does not pin down; a path survives only if it exists in the settings tree;
 *   3. an identifier carries its initializer's paths, and a destructured binding its source's paths plus its name;
 *   4. a call or JSX element outside the configuration layer binds each argument's paths to the callee's parameter
 *      (or destructured prop), repeated to a fixpoint — this is how a section reaches a function typed with a
 *      separately declared mirror interface, a `Pick<>`, or a resolver;
 *   5. otherwise, an expression of an OBJECT type that occurs in the settings tree carries every path of that type.
 *      Never a primitive: letting `number` match every numeric setting attributes reads to unrelated code.
 *
 * A READ is a property access, element access or destructuring element, outside the configuration layer and not
 * the target of an assignment, whose path exists. A key is read when some read path equals it or lies beneath it,
 * with `*` matching any one segment (the providers map, research R4).
 *
 * Contract: `specs/071-inert-settings-guard/contracts/settings-readers-scan.md`.
 */

export interface ScanInput {
  program: ts.Program;
  /** Locates the settings root type in the program. */
  rootType: (checker: ts.TypeChecker, program: ts.Program) => ts.Type;
  /** Descriptor keys to report on. */
  keys: readonly string[];
  /** Repository-relative path of a source file, always with `/` separators. */
  relPath: (sourceFile: ts.SourceFile) => string;
  /** True for a production file that may hold readers; false for tests and declaration files. */
  isProduction: (relPath: string) => boolean;
  /** Path prefixes whose files are never readers, and whose calls bind no parameter. */
  configLayer: readonly string[];
}

export interface KeyReaders {
  key: string;
  readers: string[];
}

type Paths = ReadonlySet<string>;

/** The deepest a settings type is walked. The real tree is five levels deep; this only stops a recursive type. */
const MAX_DEPTH = 12;
/** Argument → parameter binding converges in three passes on the repository; this bounds a pathological cycle. */
const MAX_BINDING_PASSES = 8;

/** Build the scan's report: one entry per key, in input order, readers sorted. */
export function scanSettingReaders(input: ScanInput): KeyReaders[] {
  const { program, keys, relPath, isProduction, configLayer } = input;
  const checker = program.getTypeChecker();
  const tree = settingsTree(checker, input.rootType(checker, program));
  const inLayer = (rel: string): boolean => configLayer.some((prefix) => rel.startsWith(prefix));

  const candidates = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile)
    .map((sf) => ({ sf, rel: relPath(sf) }))
    .filter(({ rel }) => isProduction(rel));
  const resolver = new PathResolver(checker, tree);

  bindArguments(
    resolver,
    candidates.filter(({ rel }) => !inLayer(rel)).map(({ sf }) => sf),
  );

  const readersByPath = new Map<string, Set<string>>();
  const record = (paths: Paths, rel: string): void => {
    for (const path of paths) {
      if (path === '') continue;
      let files = readersByPath.get(path);
      if (!files) readersByPath.set(path, (files = new Set()));
      files.add(rel);
    }
  };
  for (const { sf, rel } of candidates) {
    if (inLayer(rel)) continue;
    const visit = (node: ts.Node): void => {
      const read = resolver.readAt(node);
      if (read) record(read, rel);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return keys.map((key) => {
    const files = new Set<string>();
    for (const [path, readers] of readersByPath) if (pathCovers(path, key)) for (const f of readers) files.add(f);
    return { key, readers: [...files].sort() };
  });
}

/** True when a read of `readPath` reads `key`: same or deeper, `*` in the read matching any one segment. */
export function pathCovers(readPath: string, key: string): boolean {
  const read = readPath.split('.');
  const want = key.split('.');
  if (read.length < want.length) return false;
  return want.every((segment, i) => read[i] === segment || read[i] === '*');
}

// ── The settings tree ────────────────────────────────────────────────────────────────────────────────────────

interface SettingsTree {
  /** Every path in the tree, `''` (the root) included, `*` standing for an index signature's keys. */
  known: Set<string>;
  /** Each object type in the tree → the paths it occurs at. */
  pathsOfType: Map<ts.Type, Set<string>>;
  /** The known paths that contain a `*`, split into segments, for matching a literal map key against them. */
  wildcards: string[][];
}

function settingsTree(checker: ts.TypeChecker, root: ts.Type): SettingsTree {
  const tree: SettingsTree = { known: new Set(['']), pathsOfType: new Map(), wildcards: [] };
  const walk = (raw: ts.Type, path: string, depth: number): void => {
    const type = checker.getNonNullableType(raw);
    if (depth > MAX_DEPTH) return;
    // Rule 5's "never a primitive" is enforced here: only object types enter `pathsOfType`, so a `number` or
    // `string` can never stand for a setting by its type alone.
    if (!(type.flags & ts.TypeFlags.Object) || checker.isArrayType(type)) return;
    let at = tree.pathsOfType.get(type);
    if (!at) tree.pathsOfType.set(type, (at = new Set()));
    if (at.has(path)) return;
    at.add(path);
    for (const info of checker.getIndexInfosOfType(type)) {
      const child = join2(path, '*');
      tree.known.add(child);
      walk(info.type, child, depth + 1);
    }
    for (const property of checker.getPropertiesOfType(type)) {
      const child = join2(path, property.name);
      tree.known.add(child);
      walk(checker.getTypeOfSymbol(property), child, depth + 1);
    }
  };
  walk(root, '', 0);
  tree.wildcards = [...tree.known].filter((k) => k.split('.').includes('*')).map((k) => k.split('.'));
  return tree;
}

const join2 = (base: string, name: string): string => (base ? `${base}.${name}` : name);

/** A path exists in the tree as written, or matches a tree path whose `*` segments stand for map keys. */
function isKnown(tree: SettingsTree, path: string): boolean {
  if (tree.known.has(path)) return true;
  const segments = path.split('.');
  return tree.wildcards.some((pattern) => pattern.length === segments.length && pattern.every((p, i) => p === '*' || p === segments[i]));
}

// ── Path resolution ──────────────────────────────────────────────────────────────────────────────────────────

/** A parameter, or a destructured element of one, that call sites have bound settings paths to. */
type Bindable = ts.ParameterDeclaration | ts.BindingElement;

class PathResolver {
  readonly bound = new Map<Bindable, Set<string>>();

  constructor(
    readonly checker: ts.TypeChecker,
    private readonly tree: SettingsTree,
  ) {}

  /** The read a node makes, if it is one: the paths it reads. */
  readAt(node: ts.Node): Paths | null {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (isAssignmentTarget(node)) return null;
      const base = this.pathsOf(node.expression);
      return base && this.extend(base, this.memberNames(node));
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) return this.bindingPaths(node, new Set());
    return null;
  }

  /** The settings paths an expression carries, or null when it carries none. */
  pathsOf(expression: ts.Expression, seen: Set<ts.Node> = new Set()): Paths | null {
    const expr = unwrap(expression);
    if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      const base = this.pathsOf(expr.expression, seen);
      return (base && this.extend(base, this.memberNames(expr))) ?? this.byType(expr);
    }
    if (ts.isIdentifier(expr)) {
      const declaration = this.checker.getSymbolAtLocation(expr)?.valueDeclaration;
      if (declaration && !seen.has(declaration)) {
        seen.add(declaration);
        const followed = this.followDeclaration(declaration, seen);
        if (followed) return followed;
      }
    }
    return this.byType(expr);
  }

  /** Rule 3 and the parameter half of rule 4. */
  private followDeclaration(declaration: ts.Declaration, seen: Set<ts.Node>): Paths | null {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isIdentifier(declaration.name)) {
      return this.pathsOf(declaration.initializer, seen);
    }
    if (ts.isBindingElement(declaration)) return this.bindingPaths(declaration, seen);
    if (ts.isParameter(declaration)) return this.bound.get(declaration) ?? null;
    return null;
  }

  /** The paths a destructured element carries: its source's paths extended by its property name. */
  bindingPaths(element: ts.BindingElement, seen: Set<ts.Node>): Paths | null {
    const direct = this.bound.get(element);
    if (direct) return direct;
    const pattern = element.parent;
    if (!ts.isObjectBindingPattern(pattern)) return null;
    const name = propertyNameOf(element);
    if (name === null) return null;
    const owner = pattern.parent;
    let source: Paths | null = null;
    if (ts.isVariableDeclaration(owner) && owner.initializer) source = this.pathsOf(owner.initializer, seen);
    else if (ts.isBindingElement(owner)) source = this.bindingPaths(owner, seen);
    else if (ts.isParameter(owner)) source = this.bound.get(owner) ?? null;
    source ??= this.byType(pattern);
    return source && this.extend(source, [name]);
  }

  /** Rule 5: an object type that occurs in the settings tree carries every path it occurs at. */
  private byType(node: ts.Node): Paths | null {
    const type = this.checker.getNonNullableType(this.checker.getTypeAtLocation(node));
    return this.tree.pathsOfType.get(type) ?? null;
  }

  /** The member names an access selects: its name, each literal of its key type, or `*`. */
  private memberNames(access: ts.PropertyAccessExpression | ts.ElementAccessExpression): string[] {
    if (ts.isPropertyAccessExpression(access)) return [access.name.text];
    const keyType = this.checker.getTypeAtLocation(access.argumentExpression);
    const parts = keyType.isUnion() ? keyType.types : [keyType];
    const literals = parts.filter((t): t is ts.StringLiteralType => t.isStringLiteral()).map((t) => t.value);
    return literals.length === parts.length ? literals : ['*'];
  }

  /**
   * Extend each base path by each name and keep the ones that exist. Under a map, a literal name stays literal
   * (`m.providers.markdown`), so reading one entry is not a read of its siblings; `*` reaches every child.
   */
  private extend(bases: Paths, names: readonly string[]): Paths | null {
    const out = new Set<string>();
    for (const base of bases) {
      for (const name of names) {
        const path = join2(base, name);
        if (isKnown(this.tree, path)) out.add(path);
        else if (name === '*') for (const k of this.tree.known) if (isChildOf(k, base)) out.add(k);
      }
    }
    return out.size > 0 ? out : null;
  }
}

/**
 * Rule 4: bind call arguments and JSX attributes to the callee's parameters until nothing changes. Only call sites
 * outside the configuration layer bind — a validator passing a section to a helper proves nothing is read.
 */
function bindArguments(resolver: PathResolver, files: readonly ts.SourceFile[]): void {
  const { checker } = resolver;
  for (let pass = 0; pass < MAX_BINDING_PASSES; pass++) {
    let changed = false;
    const bind = (target: Bindable, paths: Paths | null): void => {
      if (!paths) return;
      let current = resolver.bound.get(target);
      if (!current) resolver.bound.set(target, (current = new Set()));
      for (const p of paths) {
        if (!current.has(p)) {
          current.add(p);
          changed = true;
        }
      }
    };
    const parametersOf = (call: ts.CallLikeExpression): readonly ts.ParameterDeclaration[] | null => {
      const declaration = checker.getResolvedSignature(call)?.declaration;
      return declaration && !ts.isJSDocSignature(declaration) ? declaration.parameters : null;
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const parameters = parametersOf(node);
        if (parameters && parameters.length > 0) {
          (node.arguments ?? []).forEach((argument, i) => {
            const parameter = parameters[Math.min(i, parameters.length - 1)];
            if (parameter) bind(parameter, resolver.pathsOf(argument));
          });
        }
      } else if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const props = parametersOf(node)?.[0];
        if (props && ts.isObjectBindingPattern(props.name)) {
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue;
            if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) continue;
            const name = attribute.name.getText();
            const element = props.name.elements.find((e) => propertyNameOf(e) === name);
            if (element) bind(element, resolver.pathsOf(attribute.initializer.expression));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const sf of files) visit(sf);
    if (!changed) return;
  }
}

// ── Small syntax helpers ─────────────────────────────────────────────────────────────────────────────────────

function unwrap(expression: ts.Expression): ts.Expression {
  let e = expression;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
    e = e.expression;
  }
  return e;
}

function isAssignmentTarget(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    parent !== undefined &&
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

/** The property a destructuring element takes, or null for a computed name the checker cannot pin. */
function propertyNameOf(element: ts.BindingElement): string | null {
  const name = element.propertyName ?? element.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

const isChildOf = (path: string, base: string): boolean =>
  base === '' ? path !== '' && !path.includes('.') : path.startsWith(`${base}.`) && !path.slice(base.length + 1).includes('.');

// ── The repository program ───────────────────────────────────────────────────────────────────────────────────

/** Packages whose `@throng/<name>` import resolves to `packages/<name>/src/index.ts`, as in `vitest.config.ts`. */
const WORKSPACE_PACKAGES = [
  'core',
  'ipc-contract',
  'platform',
  'platform-node',
  'platform-windows',
  'platform-linux',
  'platform-macos',
  'persistence',
];

/**
 * One program over every package's source (research R2). Separate programs per tsconfig see another package
 * only through its `dist` declarations, so a renderer call into a core function never reaches that function's
 * body — 14 false positives, measured. One program sees every body, and checks core once instead of eleven times.
 * The program need not type-check cleanly; only symbols, signatures and types are read.
 */
export function buildRepoProgram(repoRoot: string): ts.Program {
  const configPath = join(repoRoot, 'packages/ui/tsconfig.renderer.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(`cannot read ${configPath}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    },
  });
  if (!parsed) throw new Error(`cannot read ${configPath}`);
  const paths: Record<string, string[]> = Object.fromEntries(
    WORKSPACE_PACKAGES.map((p) => [`@throng/${p}`, [join(repoRoot, 'packages', p, 'src/index.ts')]]),
  );
  paths['@throng/core/testing'] = [join(repoRoot, 'packages/core/src/testing/index.ts')];
  const rootNames = ts.sys.readDirectory(
    join(repoRoot, 'packages'),
    ['.ts', '.tsx'],
    ['**/node_modules/**', '**/dist/**', '**/tests/**'],
    ['*/src/**/*'],
  );
  return ts.createProgram({ rootNames, options: { ...parsed.options, paths, noEmit: true } });
}
