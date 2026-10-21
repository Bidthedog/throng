import { afterEach, describe, expect, it } from 'vitest';
import { BEL, ESC, config, makeHarness, sleep, type AttentionHarness, type HarnessOptions } from './attention-harness.js';

/*
 * 057 — the daemon's attention producer, through the real TerminalService and RPC router.
 * Layer: integration — what is under test is the wiring between the output handler, the rate limiter, the
 * config the service holds and the events sink; none of it exists below a real service. The PTY host is a
 * fake so the bytes are exact and no shell is spawned (a bell storm through a real conhost proves nothing
 * more about this wiring).
 */
const live: AttentionHarness[] = [];
async function harness(options: HarnessOptions = {}): Promise<AttentionHarness> {
  const h = makeHarness(options);
  live.push(h);
  await h.attach();
  return h;
}
afterEach(async () => {
  for (const h of live.splice(0)) await h.stop();
});

describe('terminal.attention producer (057)', () => {
  it('publishes one bell signal carrying the panel and project', async () => {
    const h = await harness();
    h.host.emit(`done${BEL}`);
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0]).not.toHaveProperty('activityAt'); // only outputQuiet carries it
    expect(h.signals[0]).toMatchObject({
      panelId: 'p1',
      projectId: 'proj',
      signal: 'bell',
      kind: 'attention',
      detail: null,
      startup: false,
    });
    expect(typeof h.signals[0]!.at).toBe('number');
  });

  it('a burst of 1,000 bells in 250 ms publishes one (R3)', async () => {
    const h = await harness();
    const started = Date.now();
    for (let i = 0; i < 1000; i++) h.host.emit(BEL);
    expect(Date.now() - started).toBeLessThan(250);
    await sleep(350);
    expect(h.signals.filter((s) => s.signal === 'bell')).toHaveLength(1);
  });

  it('a bell after the window publishes again', async () => {
    const h = await harness();
    h.host.emit(BEL);
    await sleep(300);
    h.host.emit(BEL);
    expect(h.signals).toHaveLength(2);
  });

  it('a notification arriving inside the window carries new information and is delivered at its end', async () => {
    const h = await harness();
    h.host.emit(`${ESC}]9;first${BEL}`);
    h.host.emit(`${ESC}]9;second${BEL}`);
    expect(h.signals.map((s) => s.detail)).toEqual(['first']);
    await sleep(350);
    expect(h.signals.map((s) => s.detail)).toEqual(['first', 'second']);
  });

  it('disabled: nothing is published and the scanner does not run', async () => {
    const h = await harness();
    expect((await h.rpc('terminal.attentionConfig', config({ enabled: false }))).result).toEqual({ ok: true });
    h.host.emit(BEL);
    h.host.emit(`${ESC}]9;hello${BEL}`);
    await sleep(50);
    expect(h.signals).toEqual([]);
    expect(h.scans.count).toBe(0);
  });

  it('a switched-off signal is not published; the others still are', async () => {
    const h = await harness();
    await h.rpc('terminal.attentionConfig', config({}, { bell: false }));
    h.host.emit(BEL);
    expect(h.signals).toEqual([]);
    h.host.emit(`${ESC}]9;hello${BEL}`);
    expect(h.signals.map((s) => s.signal)).toEqual(['notification']);
  });

  it('carries the panel title and project name, falling back to "Terminal"', async () => {
    const named = await harness({
      names: (panelId, projectId) => ({ panelTitle: `Title of ${panelId}`, projectName: `Name of ${projectId}`, tabTitle: 'Agents' }),
    });
    named.host.emit(BEL);
    expect(named.signals[0]).toMatchObject({ panelTitle: 'Title of p1', projectName: 'Name of proj', tabTitle: 'Agents' }); // FR-100

    const bare = await harness();
    bare.host.emit(BEL);
    expect(bare.signals[0]).toMatchObject({ panelTitle: 'Terminal', tabTitle: '' });
  });

  // FR-116: the daemon names a panel with its terminal's live window title, as the panel header does —
  // not with the flavour label a saved layout alone produces ("Command Prompt").
  it('hands the name resolver the terminal\'s live window title', async () => {
    const seen: (string | null)[] = [];
    const h = await harness({
      names: (_panelId, _projectId, liveTitle) => {
        seen.push(liveTitle ?? null);
        return { panelTitle: liveTitle ?? 'Command Prompt', projectName: 'Alpha' };
      },
    });
    h.host.emit(`${ESC}]0;✳ Fix the login bug${BEL}`);
    h.host.emit(BEL);
    expect(seen.at(-1)).toBe('✳ Fix the login bug');
    expect(h.signals.at(-1)!.panelTitle).toBe('✳ Fix the login bug');
  });

  it('resolves names at most once per published signal — a 1,000-bell chunk is not 1,000 store loads', async () => {
    let resolutions = 0;
    const h = await harness({
      names: () => {
        resolutions += 1;
        return { panelTitle: 'T', projectName: 'P' };
      },
    });
    h.host.emit(BEL.repeat(1000));
    for (let i = 0; i < 1000; i++) h.host.emit(BEL);
    await sleep(350);
    const published = h.signals.length;
    expect(published).toBe(1);
    expect(resolutions).toBeLessThanOrEqual(published);
  });

  it('a bell, a notification and a progress end publish with no view attached (FR-067a)', async () => {
    const h = await harness();
    await h.rpc('terminal.detach', { panelId: 'p1' });
    h.host.emit(BEL);
    h.host.emit(`${ESC}]9;hello${BEL}`);
    h.host.emit(`${ESC}]9;4;1;20${BEL}`);
    h.host.emit(`${ESC}]9;4;0${BEL}`);
    expect(h.signals.map((s) => s.signal).sort()).toEqual(['bell', 'notification', 'progressEnded']);
  });

  describe('heuristic signals (R4)', () => {
    it('unseenOutput emits on the first chunk after at least 1 s without output, and not on the first chunk ever', async () => {
      const h = await harness();
      await h.rpc('terminal.attentionConfig', config({}, { unseenOutput: true }));
      h.host.emit('prompt> ');
      h.host.emit('more');
      expect(h.signals).toEqual([]);
      await sleep(1100);
      h.host.emit('late output');
      expect(h.signals.map((s) => s.signal)).toEqual(['unseenOutput']);
      h.host.emit('and more straight away');
      expect(h.signals).toHaveLength(1);
    });

    it('outputQuiet emits once output has been silent for quietMs after activity, afresh after each burst', async () => {
      const h = await harness();
      await h.rpc('terminal.attentionConfig', config({ quietMs: 200 }, { outputQuiet: true }));
      const burstOneAt = Date.now();
      h.host.emit('burst one');
      await sleep(100);
      h.host.emit('still going');
      await sleep(120);
      expect(h.signals).toEqual([]); // 120 ms since the last chunk: not quiet yet
      await sleep(250);
      expect(h.signals.map((s) => s.signal)).toEqual(['outputQuiet']);
      // activityAt is when the burst that armed the timer began (the first chunk), not when it went quiet.
      expect(h.signals[0]!.activityAt).toBeGreaterThanOrEqual(burstOneAt);
      expect(h.signals[0]!.activityAt).toBeLessThanOrEqual(burstOneAt + 60);
      expect(h.signals[0]!.at - h.signals[0]!.activityAt!).toBeGreaterThanOrEqual(250);
      await sleep(300);
      expect(h.signals).toHaveLength(1); // once per burst
      h.host.emit('burst two');
      await sleep(450);
      expect(h.signals.map((s) => s.signal)).toEqual(['outputQuiet', 'outputQuiet']);
    });

    it('neither is emitted while switched off (the defaults)', async () => {
      const h = await harness();
      await h.rpc('terminal.attentionConfig', config({ quietMs: 100 }));
      h.host.emit('output');
      await sleep(1200);
      h.host.emit('late');
      await sleep(200);
      expect(h.signals).toEqual([]);
    });

    it('outputQuiet is cancelled when attention is switched off meanwhile', async () => {
      const h = await harness();
      await h.rpc('terminal.attentionConfig', config({ quietMs: 200 }, { outputQuiet: true }));
      h.host.emit('output');
      await h.rpc('terminal.attentionConfig', config({ enabled: false, quietMs: 200 }, { outputQuiet: true }));
      await sleep(350);
      expect(h.signals).toEqual([]);
    });
  });

  describe('command finished (FR-065, FR-065a)', () => {
    const running = (): import('@throng/core').ChildProcess[] => [
      { pid: 2001, ppid: 1000, commandLine: 'npm run dev', startedAt: Date.now() },
    ];
    const finished = (h: AttentionHarness) => h.signals.filter((s) => s.signal === 'commandFinished');

    it('command → nothing publishes commandFinished with the command name', async () => {
      const h = await harness();
      h.host.children = running();
      await sleep(200);
      expect(finished(h)).toEqual([]);
      h.host.children = [];
      await sleep(200);
      expect(finished(h)).toHaveLength(1);
      expect(finished(h)[0]).toMatchObject({ panelId: 'p1', kind: 'attention', detail: 'npm run dev', startup: false });
    });

    it('command → another command publishes nothing', async () => {
      const h = await harness();
      h.host.children = running();
      await sleep(200);
      h.host.children = [{ pid: 2002, ppid: 1000, commandLine: 'npm test', startedAt: Date.now() }];
      await sleep(200);
      expect(finished(h)).toEqual([]);
    });

    it('the first command to finish after a launch with a startup command is tagged startup, once', async () => {
      const h = makeHarness();
      live.push(h);
      await h.attach('p1', 'proj', { launch: { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj', startupCommand: true } });
      h.host.children = running();
      await sleep(200);
      h.host.children = [];
      await sleep(200);
      expect(finished(h)).toHaveLength(1);
      expect(finished(h)[0]!.startup).toBe(true);
      await sleep(300); // clear the rate window for the next one
      h.host.children = running();
      await sleep(200);
      h.host.children = [];
      await sleep(200);
      expect(finished(h).map((s) => s.startup)).toEqual([true, false]);
    });

    it('a writeOnReady startup command is recognised the same way', async () => {
      const h = makeHarness();
      live.push(h);
      await h.attach('p1', 'proj', { launch: { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj', writeOnReady: 'npm run dev' } });
      h.host.children = running();
      await sleep(200);
      h.host.children = [];
      await sleep(200);
      expect(finished(h)[0]!.startup).toBe(true);
    });

    it('a terminal.write before the first finish clears the startup flag', async () => {
      const h = makeHarness();
      live.push(h);
      await h.attach('p1', 'proj', { launch: { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj', startupCommand: true } });
      await h.rpc('terminal.write', { panelId: 'p1', data: 'ls\r' });
      h.host.children = running();
      await sleep(200);
      h.host.children = [];
      await sleep(200);
      expect(finished(h)[0]!.startup).toBe(false);
    });

    it('terminal responses written by xterm (DA, focus, mouse reports) do not clear the startup flag', async () => {
      const h = makeHarness();
      live.push(h);
      await h.attach('p1', 'proj', { launch: { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj', startupCommand: true } });
      await h.rpc('terminal.write', { panelId: 'p1', data: `${ESC}[?1;2c` });
      await h.rpc('terminal.write', { panelId: 'p1', data: `${ESC}[I` });
      await h.rpc('terminal.write', { panelId: 'p1', data: `${ESC}[<0;3;4M` });
      h.host.children = running();
      await sleep(200);
      h.host.children = [];
      await sleep(200);
      expect(finished(h)[0]!.startup).toBe(true);
    });

    it('a terminal no view is attached to is still observed while an events sink is attached (FR-062)', async () => {
      const h = await harness();
      await h.rpc('terminal.detach', { panelId: 'p1' });
      h.host.children = running();
      await sleep(200);
      h.host.children = [];
      await sleep(200);
      expect(finished(h)).toHaveLength(1);
    });
  });

  describe('process exited (FR-064)', () => {
    const exited = (h: AttentionHarness) => h.signals.filter((s) => s.signal === 'processExited');

    it('an unexpected non-zero exit is Failed and carries the code; terminal.exit is unchanged', async () => {
      const h = await harness();
      h.host.fireExit({ code: 7 });
      await sleep(50);
      expect(exited(h)).toHaveLength(1);
      expect(exited(h)[0]).toMatchObject({ panelId: 'p1', kind: 'failed', detail: '7' });
      expect(h.exits).toEqual([{ panelId: 'p1', code: 7, unexpected: true, sessionId: expect.any(Number) }]);
    });

    it('an unexpected zero exit is Attention', async () => {
      const h = await harness();
      h.host.fireExit({ code: 0 });
      await sleep(50);
      expect(exited(h)[0]).toMatchObject({ kind: 'attention', detail: '0' });
    });

    it('terminal.kill publishes no attention', async () => {
      const h = await harness();
      await h.rpc('terminal.kill', { panelId: 'p1' });
      await sleep(50);
      expect(h.exits).toHaveLength(1);
      expect(h.exits[0].unexpected).toBe(false);
      expect(exited(h)).toEqual([]);
    });

    it('killAll, killForProject and shutdown publish no attention', async () => {
      const all = await harness();
      await all.rpc('terminal.killAll', {});
      await sleep(50);
      expect(exited(all)).toEqual([]);

      const byProject = await harness();
      byProject.service.killForProject('proj');
      await sleep(50);
      expect(byProject.exits.length).toBeGreaterThan(0);
      expect(exited(byProject)).toEqual([]);

      const closing = await harness();
      await closing.stop();
      await sleep(50);
      expect(exited(closing)).toEqual([]);
    });

    it('is not published when the processExited signal is off', async () => {
      const h = await harness();
      await h.rpc('terminal.attentionConfig', config({}, { processExited: false }));
      h.host.fireExit({ code: 1 });
      await sleep(50);
      expect(exited(h)).toEqual([]);
    });
  });

  /*
   * SC-004 / Principle XII — measured, not assumed. 10 s of a 1,000-bell-a-second storm (10 chunks of 100 every
   * 100 ms, so the event loop and the rate-window timers run as they would), once with attention on and once
   * off. What is timed is the work the output path does for those chunks; the difference is what attention
   * costs. Layer: integration — the cost is the whole handler (scan, limiter, publish), not the scanner alone
   * (that is attention-scan.bench.test.ts). Measured at authoring: 59 ms of handler work with attention off,
   * 87 ms on, for 10,000 chunks (about 3 µs a chunk), one signal published.
   */
  it('a sustained 1,000/s bell storm costs the output path within noise and publishes one signal (SC-004)', async () => {
    const STORM_MS = 10_000;
    const TICK_MS = 100;
    const PER_TICK = 100;
    const payload = `${'x'.repeat(256)}${BEL}`;

    async function storm(enabled: boolean): Promise<{ workMs: number; signals: number; bytes: number }> {
      const h = await harness();
      await h.rpc('terminal.attentionConfig', config({ enabled }));
      let workMs = 0;
      const started = Date.now();
      let tick = 0;
      while (Date.now() - started < STORM_MS) {
        const t0 = performance.now();
        for (let i = 0; i < PER_TICK; i++) h.host.emit(payload);
        workMs += performance.now() - t0;
        tick += 1;
        const wait = started + tick * TICK_MS - Date.now();
        if (wait > 0) await sleep(wait);
      }
      return { workMs, signals: h.signals.length, bytes: h.outputs.join('').length };
    }

    const off = await storm(false);
    const on = await storm(true);
    console.log(
      `attention storm: ${off.workMs.toFixed(0)} ms of handler work off, ${on.workMs.toFixed(0)} ms on, ${on.signals} signal(s)`,
    );
    expect(on.bytes).toBe(off.bytes); // same bytes through either way
    expect(off.signals).toBe(0);
    expect(on.signals).toBe(1);
    // Noise bound: 10,000 chunks; attention may add at most 100 ms in all (10 µs a chunk) or the off run's
    // own cost again, whichever is larger — a loaded workstation moves both runs, not just one.
    expect(on.workMs - off.workMs).toBeLessThan(Math.max(100, off.workMs));
  }, 60_000);

  it('the bytes published on terminal.output are identical with attention on and off (FR-067)', async () => {
    const stream = [`a${BEL}b`, `${ESC}]9;note${BEL}`, `${ESC}]9;4;1;5${BEL}${ESC}]9;4;0${BEL}`, 'plain\r\n'];
    const on = await harness();
    for (const chunk of stream) on.host.emit(chunk);
    const off = await harness();
    await off.rpc('terminal.attentionConfig', config({ enabled: false }));
    for (const chunk of stream) off.host.emit(chunk);
    expect(on.outputs).toEqual(stream);
    expect(off.outputs).toEqual(stream);
  });
});

/*
 * 057 FR-099 — a program with focus reporting (DEC 1004) on is told when its panel stops and starts being
 * attended. Main sends the whole attended set (`terminal.attentionFocus`); the daemon writes the report to
 * the PTY, because a tab or project switch unmounts the only view that could. Through the real service so
 * the write lands where the program reads it; the fake host records every byte written.
 */
describe('focus reports for focus-reporting programs (FR-099)', () => {
  const IN = `${ESC}[I`;
  const OUT = `${ESC}[O`;
  const reports = (h: AttentionHarness): string[] => h.host.writes.filter((w) => w === IN || w === OUT);

  it('tells a program it lost focus when its panel leaves the attended set, and regained it on return', async () => {
    const h = await harness();
    await h.rpc('terminal.attentionFocus', { attended: ['p1'] });
    h.host.emit(`${ESC}[?1004h`);
    expect(reports(h)).toEqual([]); // attended as it asked: it assumes focus, and has it
    await h.rpc('terminal.attentionFocus', { attended: [] });
    await h.rpc('terminal.attentionFocus', { attended: ['p1'] });
    expect(reports(h)).toEqual([OUT, IN]);
  });

  it('never repeats the state the program was last told', async () => {
    const h = await harness();
    await h.rpc('terminal.attentionFocus', { attended: ['p1'] });
    h.host.emit(`${ESC}[?1004h`);
    await h.rpc('terminal.attentionFocus', { attended: [] });
    await h.rpc('terminal.attentionFocus', { attended: [] });
    await h.rpc('terminal.attentionFocus', { attended: ['other'] });
    expect(reports(h)).toEqual([OUT]);
  });

  it('writes nothing to a program that has not asked, or has stopped asking', async () => {
    const h = await harness();
    await h.rpc('terminal.attentionFocus', { attended: ['p1'] });
    await h.rpc('terminal.attentionFocus', { attended: [] });
    h.host.emit(`${ESC}[?1004h`);
    h.host.emit(`${ESC}[?1004l`);
    const before = reports(h).length;
    await h.rpc('terminal.attentionFocus', { attended: ['p1'] });
    await h.rpc('terminal.attentionFocus', { attended: [] });
    expect(reports(h)).toHaveLength(before);
  });

  it('tells a program that turns reporting on while its panel is unattended that it is not focused, at once', async () => {
    const h = await harness();
    await h.rpc('terminal.attentionFocus', { attended: [] });
    h.host.emit(`${ESC}[?2004;1004;2031h`);
    expect(reports(h)).toEqual([OUT]);
  });

  it('a program that re-enables reporting starts from "focused" again, as a terminal assumes', async () => {
    const h = await harness();
    await h.rpc('terminal.attentionFocus', { attended: ['p1'] });
    h.host.emit(`${ESC}[?1004h`);
    await h.rpc('terminal.attentionFocus', { attended: [] }); // OUT
    h.host.emit(`${ESC}[?1004l`);
    await h.rpc('terminal.attentionFocus', { attended: ['p1'] }); // mode off: nothing
    h.host.emit(`${ESC}[?1004h`); // attended, assumed focused: nothing
    expect(reports(h)).toEqual([OUT]);
  });

  it('reports to each terminal by its own panel', async () => {
    const h = await harness();
    await h.attach('p2', 'proj');
    await h.rpc('terminal.attentionFocus', { attended: ['p1', 'p2'] });
    h.host.emit(`${ESC}[?1004h`); // both shells ask
    await h.rpc('terminal.attentionFocus', { attended: ['p2'] });
    expect(reports(h)).toEqual([OUT]); // only p1 lost it
  });
});

describe('focus reports when main is gone, or the mode flickers (FR-099, review)', () => {
  const IN = `${ESC}[I`;
  const OUT = `${ESC}[O`;
  const reports = (h: AttentionHarness): string[] => h.host.writes.filter((w) => w === IN || w === OUT);

  it('tells an attended program it lost focus when the last events socket goes — main has quit or died', async () => {
    const h = await harness();
    await h.rpc('terminal.attentionFocus', { attended: ['p1'] });
    h.host.emit(`${ESC}[?1004h`);
    h.detachSink();
    expect(reports(h)).toEqual([OUT]);
  });

  it('a program that turns the mode off and on in ONE chunk while unattended is told again', async () => {
    const h = await harness();
    await h.rpc('terminal.attentionFocus', { attended: [] });
    h.host.emit(`${ESC}[?1004h`); // OUT
    h.host.emit(`${ESC}[?1004l${ESC}[?2004h${ESC}[?1004h`); // re-enabled: assumes focus again
    expect(reports(h)).toEqual([OUT, OUT]);
  });
});


// 057 FR-102 — a signal says what its terminal was doing: the program's own title, else its last command.
describe('what the terminal was doing (FR-102)', () => {
  const running = (): import('@throng/core').ChildProcess[] => [
    { pid: 2001, ppid: 1000, commandLine: 'npm run build', startedAt: Date.now() },
  ];

  it('is nothing while the terminal has neither a title nor a command', async () => {
    const h = await harness();
    h.host.emit(BEL);
    expect(h.signals[0]!.doing).toBeNull();
  });

  it('is the window title a program set, ahead of its command line', async () => {
    const h = await harness();
    h.host.children = running();
    await sleep(200);
    h.host.emit(`${ESC}]0;Fix the login bug${BEL}`);
    h.host.emit(BEL);
    expect(h.signals.at(-1)!.doing).toBe('Fix the login bug');
  });

  it('is the last command the terminal ran when no program set a title — even after it finished', async () => {
    const h = await harness();
    h.host.children = running();
    await sleep(200);
    h.host.children = [];
    await sleep(200);
    await sleep(300); // clear the bell's rate window from nothing; commandFinished has its own
    h.host.emit(BEL);
    const bell = h.signals.find((s) => s.signal === 'bell');
    expect(bell!.doing).toBe('npm run build');
  });

  it('is captured when the signal is raised and carried into the ledger', async () => {
    const h = await harness();
    h.host.children = running();
    await sleep(200);
    h.host.emit(`${ESC}]2;Deploying${BEL}`);
    h.detachSink();
    h.host.emit(BEL);
    const { result } = await h.rpc('terminal.attentionLedger');
    expect(result.entries[0]).toMatchObject({ doing: 'Deploying' });
  });

  it('ignores a title while no command runs, and one in the shell\'s own form — those are the shell\'s, not a program\'s', async () => {
    const h = await harness();
    h.host.emit(`${ESC}]0;Fix the login bug${BEL}`); // at the prompt: the shell's
    h.host.emit(BEL);
    expect(h.signals.at(-1)!.doing).toBeNull();
    h.host.children = running();
    await sleep(200);
    h.host.emit(`${ESC}]0;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe${BEL}`);
    await sleep(300);
    h.host.emit(BEL);
    expect(h.signals.at(-1)!.doing).toBe('npm run build');
  });

  it('ignores the title the prompt showed before the command started', async () => {
    const h = await harness();
    h.host.emit(`${ESC}]0;~/project${BEL}`);
    await sleep(120); // the prompt is showing: an idle poll reads its title
    h.host.children = running();
    await sleep(200);
    h.host.emit(BEL);
    expect(h.signals.at(-1)!.doing).toBe('npm run build');
  });

  it('keeps a title the program set before the first poll saw it running (review)', async () => {
    const h = await harness();
    await sleep(120); // an idle poll records the prompt's title: none
    h.host.children = running();
    h.host.emit(`${ESC}]0;Fix the login bug${BEL}`); // claude titles itself at once
    await sleep(200);
    h.host.emit(BEL);
    expect(h.signals.at(-1)!.doing).toBe('Fix the login bug');
  });
});
