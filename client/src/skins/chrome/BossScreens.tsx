import type { ReactNode } from 'react';

const CODE = `import { createHash } from 'node:crypto';
import { readConfig } from './config';
import type { Session, Worker } from './types';

const RETRY_LIMIT = 3;
const BACKOFF_MS = 250;

/** Resolve a worker for the session, honouring sticky assignment. */
export async function resolveWorker(session: Session): Promise<Worker | null> {
  const config = await readConfig();
  const pool = config.workers.filter((worker) => worker.healthy);
  if (pool.length === 0) return null;

  const key = createHash('sha1').update(session.id).digest('hex');
  const index = parseInt(key.slice(0, 8), 16) % pool.length;
  return pool[index] ?? null;
}

export async function dispatch(session: Session, payload: unknown) {
  for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
    const worker = await resolveWorker(session);
    if (!worker) throw new Error('no healthy worker available');

    try {
      return await worker.send(payload);
    } catch (error) {
      if (attempt === RETRY_LIMIT - 1) throw error;
      await sleep(BACKOFF_MS * 2 ** attempt);
    }
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}`;

const TOKEN =
  /(\/\/.*|\/\*\*.*\*\/)|('[^']*'|"[^"]*"|`[^`]*`)|\b(import|from|export|async|await|const|let|function|return|if|for|try|catch|throw|new|of|null|number|unknown|interface|type|Promise)\b|\b(\d+)\b/g;

/** 極簡上色：夠讓遠看像程式碼就好，不追求正確的語法解析。 */
function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(line)) !== null) {
    if (match.index > last) out.push(line.slice(last, match.index));
    const cls = match[1] ? 'c' : match[2] ? 's' : match[3] ? 'k' : 'n';
    out.push(
      <span key={`${match.index}-${cls}`} className={`boss__t boss__t--${cls}`}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** 老闆鍵蓋上來的靜態程式碼。完全不可互動。 */
export function CodeBoss(): ReactNode {
  const lines = CODE.split('\n');
  return (
    <div className="boss boss--code">
      <div className="boss__bar">
        <span className="boss__tab is-active">dispatch.ts</span>
        <span className="boss__tab">config.ts</span>
      </div>
      <div className="boss__code">
        {lines.map((line, i) => (
          <div key={i} className="boss__line">
            <span className="boss__ln">{i + 1}</span>
            <code>
              {highlight(line)}
              {i === 21 && <span className="boss__caret" />}
            </code>
          </div>
        ))}
      </div>
      <div className="boss__status">
        <span>main*</span>
        <span className="chrome__spacer" />
        <span>Ln 22, Col 34</span>
        <span>UTF-8</span>
        <span>TypeScript</span>
      </div>
    </div>
  );
}

const SHELL = [
  '$ npm run build -- --profile',
  '',
  '> workspace@2.4.0 build',
  '> tsc -b && node scripts/bundle.mjs --profile',
  '',
  'tsc: 214 files, 0 errors (4.82s)',
  'bundle: entry src/index.ts',
  'bundle:   src/session.ts        18.4 kB',
  'bundle:   src/queue.ts          12.1 kB',
  'bundle:   src/dispatch.ts        9.7 kB',
  'bundle:   node_modules/**      182.3 kB',
  'bundle: written dist/index.js  222.5 kB (gzip 71.2 kB)',
  '',
  '$ npm test -- --run',
  '',
  ' PASS  src/session.test.ts (24 tests)',
  ' PASS  src/queue.test.ts (31 tests)',
  ' PASS  src/dispatch.test.ts (18 tests)',
  '',
  'Test Files  3 passed (3)',
  '     Tests  73 passed (73)',
  '  Duration  2.41s',
  '',
];

/** 老闆鍵蓋上來的靜態終端機輸出。 */
export function ShellBoss(): ReactNode {
  return (
    <div className="boss boss--shell">
      <div className="boss__bar">
        <span className="boss__tab is-active">user@host: ~/work</span>
      </div>
      <pre className="boss__shell">
        {SHELL.map((line, i) => (
          <div key={i} className={line.startsWith('$') ? 'boss__cmd' : undefined}>
            {line || ' '}
          </div>
        ))}
        <div>
          <span className="boss__cmd">$ </span>
          <span className="boss__caret" />
        </div>
      </pre>
    </div>
  );
}
