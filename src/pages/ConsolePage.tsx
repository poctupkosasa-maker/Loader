import { useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, Ban, CheckCircle2, ChevronDown, CircleAlert, Copy, ExternalLink, Terminal, Trash2 } from 'lucide-react';
import type { ConsoleLine, DownloadProgress, LanguageCode } from '../../shared/types';
import { t } from '../i18n';

interface ConsolePageProps {
  logs: ConsoleLine[];
  progress: DownloadProgress[];
  running: boolean;
  language: LanguageCode;
  onClear: () => void;
}

type ViewFilter = 'all' | 'stderr' | 'stdout' | 'system';
const timestamp = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const sizeLabel = (size: number) => size >= 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.round(size / 1000)} KB`;

export function ConsolePage({ logs, progress, running, language, onClear }: ConsolePageProps) {
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [copied, setCopied] = useState(false);
  const visibleLogs = useMemo(() => logs.filter((line) => (filter === 'all' || line.stream === filter) && (!onlyErrors || line.stream === 'stderr')), [logs, filter, onlyErrors]);
  const active = progress.filter((item) => item.status === 'downloading' || item.status === 'queued');
  const copyLogs = async () => {
    await navigator.clipboard?.writeText(visibleLogs.map((line) => `[${timestamp(line.timestamp)}] [${line.stream}] ${line.text}`).join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const labels: Record<ViewFilter, string> = { all: t(language, 'all'), stdout: 'stdout', stderr: 'stderr', system: 'launcher' };
  return (
    <div className="page-content console-page">
      <div className="page-heading">
        <div><div className="eyebrow">UNDER THE HOOD</div><h1>{t(language, 'console')}</h1><p>{t(language, 'consoleSubtitle')}</p></div>
        <div className={`console-live-pill ${running ? 'is-running' : ''}`}><span />{running ? 'GAME RUNNING' : 'LAUNCHER READY'}</div>
      </div>

      <div className="console-top-grid">
        <section className="panel console-window">
          <div className="console-window-bar"><div className="console-window-title"><span className="terminal-icon"><Terminal size={16} /></span><strong>LIVE OUTPUT</strong><span className="console-window-path">~/loader/console</span></div><div className="console-window-actions"><span className="log-count">{visibleLogs.length} lines</span><button className="icon-button" onClick={() => void copyLogs()} title="Copy logs"><Copy size={15} /></button><button className="icon-button" onClick={onClear} title={t(language, 'clear')}><Trash2 size={15} /></button></div></div>
          <div className="console-filter-row"><div className="console-filter-list">{(Object.keys(labels) as ViewFilter[]).map((key) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{labels[key]}</button>)}</div><button className={`error-filter ${onlyErrors ? 'active' : ''}`} onClick={() => setOnlyErrors((current) => !current)}><CircleAlert size={14} /> Errors only</button></div>
          <div className="console-log-body" role="log" aria-live="polite">
            {visibleLogs.length ? visibleLogs.map((line) => <div className={`console-line stream-${line.stream}`} key={line.id}><span className="console-time">{timestamp(line.timestamp)}</span><span className="console-stream">{line.stream === 'system' ? 'loader' : line.stream}</span><span className="console-text">{line.text}</span></div>) : <div className="console-empty"><div className="console-empty-icon"><Terminal size={23} /></div><strong>No output yet</strong><span>Launcher events and game output will appear here.</span></div>}
          </div>
          <div className="console-status-bar"><span><span className="console-status-dot" />{running ? 'Connected to Minecraft process' : 'Waiting for game process'}</span><span>{copied ? 'Copied to clipboard' : 'UTF-8'} <ChevronDown size={12} /></span></div>
        </section>

        <aside className="console-side-column">
          <section className="panel download-queue-panel"><div className="queue-heading"><div><div className="eyebrow">TRANSFER QUEUE</div><h3>{t(language, 'downloads')}</h3></div><span className="queue-count">{active.length.toString().padStart(2, '0')}</span></div>
            {active.length ? <div className="queue-items">{active.slice(0, 8).map((item) => <div className="queue-item" key={item.id}><div className="queue-item-head"><span className="queue-item-icon"><ArrowDownToLine size={14} /></span><strong title={item.name}>{item.name}</strong><span>{item.speed > 0 ? `${sizeLabel(item.speed)}/s` : 'Queued'}</span></div><div className="progress-track"><span style={{ width: `${item.total ? Math.min(100, item.downloaded / item.total * 100) : 10}%` }} /></div><div className="queue-item-foot"><span>{sizeLabel(item.downloaded)} / {item.total ? sizeLabel(item.total) : '—'}</span><span>{item.etaSeconds ? `${item.etaSeconds}s remaining` : item.status}</span></div></div>)}</div> : <div className="queue-empty"><div className="queue-empty-icon"><CheckCircle2 size={18} /></div><strong>Queue is clear</strong><span>Your downloads will show up here.</span></div>}
          </section>
          <section className="runtime-card"><div className="runtime-card-mark"><Activity size={18} /></div><div className="eyebrow">LAUNCHER STATUS</div><h3>All systems<br /><em>nominal.</em></h3><div className="runtime-status-list"><div><span>Process bridge</span><b><span />ACTIVE</b></div><div><span>SQLite storage</span><b><span />CONNECTED</b></div><div><span>Download queue</span><b><span />READY</b></div></div><div className="runtime-card-footer">{active.length} active task{active.length === 1 ? '' : 's'} <ExternalLink size={12} /></div></section>
        </aside>
      </div>
      {progress.some((item) => item.status === 'error') && <section className="panel failed-downloads"><div className="failed-title"><Ban size={15} />Failed downloads</div>{progress.filter((item) => item.status === 'error').slice(-3).map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.error}</span></div>)}</section>}
      <div className="console-bottom-note"><Activity size={14} />{t(language, 'consoleSubtitle')} <span>Logs are kept locally for this session.</span></div>
    </div>
  );
}
