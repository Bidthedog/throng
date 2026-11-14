import koffi from 'koffi';
import { logCaught, type IOsPropertiesDialog, type ShellActionResult } from '@throng/core';

const SEE_MASK_INVOKEIDLIST = 0x0000000c;
const SW_SHOW = 5;
const REASON = 'The OS could not open its Properties dialog for this item.';

export type ShowProperties = (path: string) => boolean;

let cached: ShowProperties | null = null;

function nativeShow(): ShowProperties {
  if (cached) return cached;
  const shell32 = koffi.load('shell32.dll');
  const INFO = koffi.struct('THRONG_SHELLEXECUTEINFOW', {
    cbSize: 'uint32',
    fMask: 'uint32',
    hwnd: 'void *',
    lpVerb: 'str16',
    lpFile: 'str16',
    lpParameters: 'str16',
    lpDirectory: 'str16',
    nShow: 'int',
    hInstApp: 'void *',
    lpIDList: 'void *',
    lpClass: 'str16',
    hkeyClass: 'void *',
    dwHotKey: 'uint32',
    hIcon: 'void *',
    hProcess: 'void *',
  });
  const execute = shell32.func('bool __stdcall ShellExecuteExW(_Inout_ THRONG_SHELLEXECUTEINFOW *info)');
  const size = koffi.sizeof(INFO);
  cached = (path) =>
    execute({ cbSize: size, fMask: SEE_MASK_INVOKEIDLIST, lpVerb: 'properties', lpFile: path, nShow: SW_SHOW }) as boolean;
  return cached;
}

export class WindowsOsPropertiesDialog implements IOsPropertiesDialog {
  readonly available = true;

  constructor(private readonly showProperties?: ShowProperties) {}

  async show(path: string): Promise<ShellActionResult> {
    try {
      return (this.showProperties ?? nativeShow())(path) ? { ok: true } : { ok: false, osReason: REASON };
    } catch (error) {
      logCaught('windows-os-properties-dialog: show', error);
      return { ok: false, osReason: REASON };
    }
  }
}
