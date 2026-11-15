import { execFile } from 'node:child_process';
import process from 'node:process';
import type {
  FileManagerRegistration,
  IExecutableExtensions,
  IFileManagerRegistration,
  IFontEnumeration,
  IOsPropertiesDialog,
  IPlatformInfo,
  IRefusedUriSchemes,
  OsName,
  ShellActionResult,
} from '@throng/core';
import { logCaught } from '@throng/core';
import { logChildFailure, posixStartupRefusal } from '@throng/platform-node';

export class MacosPlatformInfo implements IPlatformInfo {
  osName(): OsName {
    return 'macos';
  }

  pathSeparator(): string {
    return '/';
  }
}

/**
 * What Finder would run or install rather than show (045 FR-015's question, asked of macOS; 070 R13). The execute bit
 * is the file system's answer and is asked where a file is opened; this is the extension half the seam carries.
 */
const MACOS_EXECUTABLE_EXTENSIONS: readonly string[] = ['.app', '.command', '.mpkg', '.pkg', '.terminal', '.tool', '.workflow'];

export class MacosExecutableExtensions implements IExecutableExtensions {
  isExecutable(filePath: string): boolean {
    if (typeof filePath !== 'string' || filePath.length === 0 || /[\\/]$/.test(filePath)) return false;
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return false;
    return MACOS_EXECUTABLE_EXTENSIONS.includes(name.slice(dot).toLowerCase());
  }

  executableExtensions(): readonly string[] {
    return MACOS_EXECUTABLE_EXTENSIONS;
  }
}

/** Schemes whose macOS handlers configure the system, run scripts or install software (045 FR-159, 070 R13). */
const REFUSED: ReadonlySet<string> = new Set([
  'applescript',
  'itms-services',
  'macappstore',
  'x-apple-helpbasic',
  'x-apple.systempreferences',
]);

export class MacosRefusedUriSchemes implements IRefusedUriSchemes {
  refusedSchemes(): ReadonlySet<string> {
    return REFUSED;
  }
}

/** macOS has no Properties dialog an application can open: the action is absent (070 FR-013, R11). */
export class MacosOsPropertiesDialog implements IOsPropertiesDialog {
  readonly available = false;
  readonly unavailableReason = "macOS has no Properties dialog an application can open; use Finder's Get Info.";

  async show(_path: string): Promise<ShellActionResult> {
    return { ok: false, osReason: this.unavailableReason };
  }
}

const NO_FINDER_ITEM: FileManagerRegistration = {
  state: 'unavailable',
  reason: 'Finder has no "Open as throng project" item; open a folder by dropping it on throng in the Dock, or with Open With.',
};

/** Finder offers no per-user item throng could add (070 FR-024, R11), so the control does not appear. */
export class MacosFileManagerRegistration implements IFileManagerRegistration {
  async status(): Promise<FileManagerRegistration> {
    return NO_FINDER_ITEM;
  }

  async setEnabled(_on: boolean): Promise<FileManagerRegistration> {
    return NO_FINDER_ITEM;
  }
}

/** The words a translocated copy is refused with (070 FR-007). */
export const TRANSLOCATION_REFUSAL = 'Quit throng, drag it to Applications, then open it again.';

const translocated = (path: string | undefined): boolean => path !== undefined && path.includes('/AppTranslocation/');

export interface MacosStartupFacts {
  readonly uid: number | undefined;
  readonly execPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Why this process must not start, or null (070 FR-007, FR-019, R10, R15). Root is refused as on Linux. A copy macOS
 * runs from a randomised read-only folder (App Translocation: opened from the download, never moved) is refused too,
 * because its path changes on every launch and nothing it records would find it again.
 *
 * `THRONG_TEST_EXEC_PATH` lets a package check launch the installed app as if translocated. It can only add this
 * refusal, never lift one, so a value left in a user's environment cannot make a translocated copy start.
 */
export function macosStartupRefusal(facts: MacosStartupFacts): string | null {
  const root = posixStartupRefusal(facts.uid);
  if (root !== null) return root;
  if (translocated(facts.execPath) || translocated(facts.env.THRONG_TEST_EXEC_PATH)) return TRANSLOCATION_REFUSAL;
  return null;
}

/** This process's refusal, from its own facts. */
export function startupRefusal(): string | null {
  return macosStartupRefusal({ uid: process.getuid?.(), execPath: process.execPath, env: process.env });
}

/** The JXA program that prints the installed families as a JSON array (070 R8). */
export const FONT_FAMILIES_JXA =
  "ObjC.import('AppKit'); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))";

/** The families `FONT_FAMILIES_JXA` printed: de-duplicated, no empties, sorted. Anything else is an empty list. */
export function parseFontFamilies(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    logCaught('macos-font-enumeration: parse the family list', error);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const names = parsed.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter((n) => n.length > 0);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Font families from AppKit's font manager, through `osascript -l JavaScript` off the event loop (070 R8). Asked once
 * per process: the list is what the picker shows, and installing a font mid-session is rare enough to need a restart.
 */
export class MacosFontEnumeration implements IFontEnumeration {
  private cached: Promise<string[]> | null = null;

  listInstalledFamilies(): Promise<string[]> {
    this.cached ??= new Promise((resolve) => {
      execFile(
        'osascript',
        ['-l', 'JavaScript', '-e', FONT_FAMILIES_JXA],
        { timeout: 10_000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            logChildFailure('osascript (font families)', error, stderr);
            this.cached = null; // Asked again next time, rather than an empty list for the rest of the session.
            resolve([]);
            return;
          }
          resolve(parseFontFamilies(String(stdout)));
        },
      );
    });
    return this.cached;
  }
}
