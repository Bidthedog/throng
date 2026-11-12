/**
 * The Properties dialog (067 US5, FR-045 to FR-055, FR-119 to FR-122).
 *
 * Modal, in the window it was asked for, one at a time (the host holds one request). It is on screen in
 * the same frame as the menu choice, showing the names it already knows; main answers `properties.open`
 * with the items' own figures, and a folder's contents (size, files, folders) arrive afterwards as
 * `FolderTally` pushes while the walk runs, labelled as still being calculated until it is done
 * (FR-048). Closing it, however it closes, stops the walk (FR-049): from the X at its top right, from a
 * click on the scrim, or with Escape. There is no Close button (FR-119).
 *
 * Every value carries a copy button that places that value on the clipboard (FR-120); a raw count is
 * copied without the digit grouping it is displayed with.
 *
 * Read-only by construction: the only input is the path, which is read-only so it can be selected and
 * copied. Editing attributes or permissions, owners and ACLs are out of scope (FR-055); a single item's
 * owner, group and permissions are shown (FR-121).
 *
 * Main owns what is hard here — the asynchronous walk, the 60-second cache and never following a link
 * (FR-049 to FR-051) — so this component only draws what it is told and sends two things back: close,
 * and the two actions (reveal in the OS file manager through the existing seam, and the OS's own
 * properties window where the platform has one, absent where it has none, FR-122).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { formatGrouped, logCaught, type FolderTally, type ItemKind, type ItemProperties } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { useFocusTrap } from '../common/focus-trap.js';

type Opened = Awaited<ReturnType<NonNullable<NonNullable<Window['throng']>['properties']>['open']>>;

const TYPE_WORDS: Record<ItemKind, string> = {
  file: 'File',
  folder: 'Folder',
  symlink: 'Symbolic link',
  junction: 'Junction',
};

const leaf = (rel: string): string => rel.split(/[\\/]/).filter(Boolean).pop() ?? rel;

/** A quantity as the dialog shows it (grouped) and as the clipboard gets it (the bare digits). */
const noun = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const count = (n: number, one: string, many: string): string => `${formatGrouped(n)} ${noun(n, one, many)}`;
const bytes = (n: number): string => `${formatGrouped(n)} bytes`;

function attributeWords(item: ItemProperties): string {
  const a = item.attributes;
  const set = [
    a.readOnly ? 'Read-only' : null,
    a.hidden ? 'Hidden' : null,
    a.system ? 'System' : null,
    a.archive ? 'Archive' : null,
  ].filter((w): w is string => w !== null);
  return set.length > 0 ? set.join(', ') : 'None';
}

const when = (ms: number): string => new Date(ms).toLocaleString();

/** One labelled value, with the copy button that goes with it (FR-120). `copy` is `null` while the value is not final. */
function Row({
  label,
  id,
  copy,
  testId,
  className,
  children,
  busy,
}: {
  label: string;
  /** Names the copy control's test id: `properties-copy-<id>`. */
  id: string;
  copy: string | null;
  testId: string;
  className?: string;
  children: ReactNode;
  busy?: boolean;
}): ReactElement {
  return (
    <>
      <dt>{label}</dt>
      <dd className={`properties-grid__value${className ? ` ${className}` : ''}`}>
        <span className="properties-grid__text" data-testid={testId} aria-busy={busy}>
          {children}
        </span>
        {copy !== null ? (
          <IconButton
            token="copy"
            title={`Copy ${label.toLowerCase()}`}
            testId={`properties-copy-${id}`}
            onClick={() => void window.throng?.clipboard?.write({ text: copy, mode: 'verbatim' })}
          />
        ) : null}
      </dd>
    </>
  );
}

export function PropertiesDialog({
  relPaths,
  onClose,
}: {
  /** Root-relative paths of what the menu was opened on: one item, or a selection (`''` is the project root). */
  relPaths: readonly string[];
  onClose: () => void;
}): ReactElement {
  const titleId = useId();
  const trap = useFocusTrap<HTMLDivElement>(true);
  const dismissRef = useRef<HTMLDivElement>(null);
  const downOnScrim = useRef(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [tally, setTally] = useState<FolderTally | null>(null);
  // Paths main found deleted or renamed while the walk ran (T112); a tally carrying them is the last one.
  const [goneExtra, setGoneExtra] = useState<ReadonlySet<string>>(new Set());
  const final = useRef(false);
  const requestId = useRef<string | null>(null);
  const closed = useRef(false);
  // A tally can beat the answer to `open` (they travel separately); the last one is kept until the id is known.
  const early = useRef<{ requestId: string; tally: FolderTally } | null>(null);

  const applyTally = useCallback((next: FolderTally): void => {
    if (final.current) return; // nothing updates after the final tally
    if (next.gone !== undefined) {
      final.current = true;
      setGoneExtra(new Set(next.gone));
    }
    setTally(next);
  }, []);

  useEffect(() => {
    const api = window.throng?.properties;
    if (!api) return undefined;
    const off = api.onTally((evt) => {
      if (requestId.current === null) early.current = evt;
      else if (evt.requestId === requestId.current) applyTally(evt.tally);
    });
    api
      .open(relPaths)
      .then((answer) => {
        requestId.current = answer.requestId;
        if (closed.current) {
          // Closed before main answered: the request exists now, so stop it.
          api.close(answer.requestId);
          return;
        }
        if (early.current?.requestId === answer.requestId) applyTally(early.current.tally);
        setOpened(answer);
      })
      .catch((error: unknown) => logCaught('properties-dialog: open', error));
    return () => {
      off();
      // However the dialog goes away, the walk goes with it (FR-049).
      if (!closed.current && requestId.current !== null) api.close(requestId.current);
      closed.current = true;
    };
    // The request is made once, for the paths the dialog was opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dismissRef.current?.querySelector('button')?.focus();
  }, []);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    if (requestId.current !== null) window.throng?.properties?.close(requestId.current);
    onClose();
  }, [onClose]);

  const items = useMemo(
    () => opened?.items.map((i) => (goneExtra.has(i.path) ? { ...i, gone: true } : i)) ?? null,
    [opened, goneExtra],
  );
  const single = relPaths.length === 1;
  const item = single ? (items?.[0] ?? null) : null;
  const title = single ? `Properties: ${item?.name ?? leaf(relPaths[0]!)}` : `Properties: ${count(relPaths.length, 'item', 'items')}`;

  // What the walk has to answer for: folders only. A link is never followed, so it is not walked (FR-051).
  const walked = items?.some((i) => i.type === 'folder' && i.gone !== true) ?? false;
  const fileItems = items?.filter((i) => i.type !== 'folder' && i.gone !== true) ?? [];
  const showContents = items !== null && (!single || item?.type === 'folder');
  const calculating = walked && !final.current && (tally === null || !tally.done);
  const totalBytes =
    items === null || (walked && tally === null)
      ? null
      : fileItems.reduce((sum, i) => sum + i.sizeBytes, 0) + (tally?.sizeBytes ?? 0);
  const totalFiles = fileItems.filter((i) => i.type === 'file').length + (tally?.files ?? 0);
  const totalFolders = tally?.folders ?? 0;

  const gone = items?.filter((i) => i.gone === true) ?? [];
  const os = opened?.osProperties;
  const osUsable = single && os?.available === true && item !== null && item.gone !== true;
  // FR-122 — where the OS has no properties window the action is not drawn at all, and says nothing.
  const showOs = os?.available === true;
  const osTitle = !single ? 'Select one item to open its system properties.' : 'Open the system properties window';

  /** The contents line, grouped for the eye or bare for the clipboard. */
  const contentsText = (group: boolean): string => {
    const n = (v: number): string => (group ? formatGrouped(v) : String(v));
    const files = `${n(totalFiles)} ${noun(totalFiles, 'file', 'files')}`;
    const folders = walked ? `, ${n(totalFolders)} ${noun(totalFolders, 'folder', 'folders')}` : '';
    return `${totalBytes === null ? '' : `${n(totalBytes)} bytes in `}${files}${folders}`;
  };
  const sizeRow = (
    <Row
      label="Size"
      id="size"
      testId="properties-size"
      copy={totalBytes === null ? null : String(totalBytes)}
    >
      {totalBytes === null ? 'Calculating…' : bytes(totalBytes)}
    </Row>
  );
  const access = item?.access;

  return (
    <div
      className="modal-overlay"
      data-testid="properties-overlay"
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
        if (downOnScrim.current) e.preventDefault();
      }}
      // A press that began inside the dialog (selecting the path) and ended on the scrim is not a click on it.
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnScrim.current) close();
      }}
    >
      <div
        className="modal modal--wide properties-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="properties-dialog"
        ref={trap.ref}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
            return;
          }
          trap.onKeyDown(e);
        }}
      >
        <div className="properties-dialog__head">
          <h3 className="modal__title" id={titleId}>
            {title}
          </h3>
          <div ref={dismissRef}>
            <IconButton token="dismiss" title="Close" testId="properties-dismiss" onClick={close} />
          </div>
        </div>

        {items === null ? (
          <p className="properties-dialog__busy" data-testid="properties-busy" aria-busy="true" role="status">
            Loading…
          </p>
        ) : null}

        <dl className="properties-grid">
          {single ? (
            <Row label="Name" id="name" testId="properties-name" copy={item?.name ?? leaf(relPaths[0]!)}>
              {item?.name ?? leaf(relPaths[0]!)}
            </Row>
          ) : (
            <Row label="Items" id="items" testId="properties-names" copy={relPaths.map(leaf).join(', ')}>
              {relPaths.map(leaf).join(', ')}
            </Row>
          )}

          {item !== null ? (
            <>
              <dt>Path</dt>
              <dd className="properties-grid__value properties-grid__path">
                <input
                  className="properties-grid__path-input"
                  data-testid="properties-path"
                  aria-label="Full path"
                  readOnly
                  value={item.path}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <IconButton
                  token="copy"
                  title="Copy path"
                  testId="properties-copy-path"
                  onClick={() => void window.throng?.clipboard?.write({ text: item.path, mode: 'verbatim' })}
                />
              </dd>
              <Row label="Type" id="type" testId="properties-type" copy={TYPE_WORDS[item.type]}>
                {TYPE_WORDS[item.type]}
              </Row>
              {item.linkTarget !== undefined ? (
                <Row label="Points to" id="link-target" testId="properties-link-target" copy={item.linkTarget}>
                  {item.linkTarget}
                </Row>
              ) : null}
            </>
          ) : null}

          {items !== null && (item === null || item.type !== 'folder') ? sizeRow : null}

          {showContents ? (
            <Row
              label="Contents"
              id="contents"
              testId="properties-contents"
              busy={calculating}
              copy={walked && tally === null ? null : contentsText(false)}
            >
              {walked && tally === null ? 'Calculating…' : contentsText(true)}
              {calculating && tally !== null ? <span className="properties-grid__calculating"> Calculating…</span> : null}
              {tally !== null && tally.skipped > 0 ? (
                <span className="properties-grid__skipped" data-testid="properties-skipped">
                  {' '}
                  {count(tally.skipped, 'folder', 'folders')} could not be read
                </span>
              ) : null}
            </Row>
          ) : null}

          {item !== null && item.type === 'folder' && showContents ? sizeRow : null}

          {item !== null ? (
            <>
              <Row label="Attributes" id="attributes" testId="properties-attributes" copy={attributeWords(item)}>
                {attributeWords(item)}
              </Row>
              {/* FR-121 — a single item's owner, group and permissions, where the OS reports them. Read-only. */}
              {access?.owner !== undefined ? (
                <Row label="Owner" id="owner" testId="properties-owner" copy={access.owner}>
                  {access.owner}
                </Row>
              ) : null}
              {access?.group !== undefined ? (
                <Row label="Group" id="group" testId="properties-group" copy={access.group}>
                  {access.group}
                </Row>
              ) : null}
              {access?.modeSymbolic !== undefined ? (
                <Row label="Permissions" id="permissions" testId="properties-permissions" copy={access.modeSymbolic}>
                  {access.modeSymbolic}
                </Row>
              ) : null}
              {access?.modeOctal !== undefined ? (
                <Row label="Octal" id="octal" testId="properties-octal" copy={access.modeOctal}>
                  {access.modeOctal}
                </Row>
              ) : null}
              <Row label="Created" id="created" testId="properties-created" copy={when(item.created)}>
                {when(item.created)}
              </Row>
              <Row label="Modified" id="modified" testId="properties-modified" copy={when(item.modified)}>
                {when(item.modified)}
              </Row>
              <Row label="Accessed" id="accessed" testId="properties-accessed" copy={when(item.accessed)}>
                {when(item.accessed)}
              </Row>
            </>
          ) : null}
        </dl>

        {gone.length > 0 ? (
          <p className="properties-dialog__gone" data-testid="properties-gone" role="status">
            {single
              ? 'This item no longer exists.'
              : `${count(gone.length, 'item', 'items')} no longer ${gone.length === 1 ? 'exists' : 'exist'}.`}
          </p>
        ) : null}

        <div className="properties-dialog__actions">
          <IconButton
            token="folderOpen"
            title={single ? 'Show in file manager' : 'Select one item to show it in the file manager'}
            testId="properties-reveal"
            disabled={!single}
            onClick={() => {
              if (single) void window.throng?.files?.reveal(relPaths[0]!);
            }}
          />
          {showOs ? (
            <IconButton
              token="settings"
              title={osTitle}
              testId="properties-os"
              disabled={!osUsable}
              onClick={() => {
                if (osUsable && item !== null) void window.throng?.properties?.showOsProperties(item.path);
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
