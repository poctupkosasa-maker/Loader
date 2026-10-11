import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { DownloadProgress } from '../../shared/types';

export interface DownloadRequest {
  url: string;
  destination: string;
  sha1?: string;
  size?: number;
  name?: string;
  category: DownloadProgress['category'];
}

type TransferState = { downloaded: number; total: number; speed: number; status: DownloadProgress['status']; error?: string };
type BatchState = {
  id: string;
  name: string;
  category: DownloadProgress['category'];
  total: number;
  taskCount: number;
  tasks: Map<string, TransferState>;
  lastEmittedAt: number;
};
type QueueItem = {
  request: DownloadRequest;
  resolve: (path: string) => void;
  reject: (error: Error) => void;
  id: string;
  batch?: BatchState;
};

/** Bounded queue with streamed chunks, HTTP Range resume, progress, and SHA-1 checks. */
export class DownloadService {
  private readonly queue: QueueItem[] = [];
  private active = 0;

  constructor(
    private readonly emit: (progress: DownloadProgress) => void,
    private readonly concurrency = 6,
  ) {}

  download(request: DownloadRequest): Promise<string> {
    const id = `${request.category}-${randomUUID()}`;
    this.emit({ id, name: request.name ?? basename(request.destination), category: request.category, status: 'queued', downloaded: 0, total: request.size ?? 0, speed: 0, etaSeconds: 0 });
    return this.enqueue(request, id);
  }

  /** Large asset/library collections are shown as one aggregate row instead of thousands of UI events. */
  downloadMany(requests: DownloadRequest[]): Promise<string[]> {
    if (!requests.length) return Promise.resolve([]);
    if (requests.length <= 8) return Promise.all(requests.map((request) => this.download(request)));
    const category = requests[0]?.category ?? 'asset';
    const noun = category === 'asset' ? 'assets' : category === 'library' ? 'libraries' : 'files';
    const batch: BatchState = {
      id: `${category}-batch-${randomUUID()}`,
      name: `${requests.length.toLocaleString()} ${noun}`,
      category,
      total: requests.reduce((sum, request) => sum + (request.size ?? 0), 0),
      taskCount: requests.length,
      tasks: new Map(),
      lastEmittedAt: Date.now(),
    };
    this.emit({ id: batch.id, name: batch.name, category, status: 'queued', downloaded: 0, total: batch.total, speed: 0, etaSeconds: 0 });
    return Promise.all(requests.map((request) => this.enqueue(request, randomUUID(), batch)));
  }

  private enqueue(request: DownloadRequest, id: string, batch?: BatchState): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      if (batch) batch.tasks.set(id, { downloaded: 0, total: request.size ?? 0, speed: 0, status: 'queued' });
      this.queue.push({ request, resolve: resolvePromise, reject, id, batch });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const item = this.queue.shift();
      if (!item) return;
      this.active += 1;
      void this.run(item).then(item.resolve, item.reject).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(item: QueueItem): Promise<string> {
    const { request } = item;
    const name = request.name ?? basename(request.destination);
    const partPath = `${request.destination}.part`;
    try {
      await mkdir(dirname(request.destination), { recursive: true });
      const existing = await stat(request.destination).catch(() => null);
      if (existing && (!request.sha1 || await this.matchesSha1(request.destination, request.sha1))) {
        this.report(item, 'complete', existing.size, request.size ?? existing.size, 0);
        return request.destination;
      }
      if (existing) await rm(request.destination, { force: true });

      const partial = await stat(partPath).catch(() => null);
      let offset = partial?.size ?? 0;
      if (request.size && offset >= request.size && offset > 0) {
        if (request.sha1 && await this.matchesSha1(partPath, request.sha1)) {
          await rename(partPath, request.destination);
          this.report(item, 'complete', offset, request.size, 0);
          return request.destination;
        }
        await rm(partPath, { force: true });
        offset = 0;
      }
      let response = await this.fetchFrom(request.url, offset);
      if (response.status === 416 && offset > 0 && request.sha1 && await this.matchesSha1(partPath, request.sha1)) {
        await rename(partPath, request.destination);
        this.report(item, 'complete', offset, request.size ?? offset, 0);
        return request.destination;
      }
      if (offset > 0) {
        const contentRange = response.headers.get('content-range');
        if (response.status !== 206 || !contentRange?.startsWith(`bytes ${offset}-`)) {
          await response.body?.cancel().catch(() => undefined);
          offset = 0;
          response = await this.fetchFrom(request.url, 0);
        }
      }
      if (!response.ok) throw new Error(`Download failed (${response.status}) for ${name}.`);
      if (!response.body) throw new Error(`The server returned an empty response for ${name}.`);

      const responseLength = Number(response.headers.get('content-length') ?? 0);
      const total = request.size && request.size > 0 ? request.size : responseLength + offset;
      let downloaded = offset;
      let lastBytes = downloaded;
      let lastTime = Date.now();
      this.report(item, 'downloading', downloaded, total, 0);
      const output = await open(partPath, offset > 0 ? 'a' : 'w', 0o600);
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await output.write(value);
          downloaded += value.byteLength;
          const now = Date.now();
          if (now - lastTime >= 300) {
            const speed = Math.max(0, ((downloaded - lastBytes) * 1000) / (now - lastTime));
            this.report(item, 'downloading', downloaded, total, speed);
            lastBytes = downloaded;
            lastTime = now;
          }
        }
      } finally {
        await output.close();
        reader.releaseLock();
      }
      const actualSize = (await stat(partPath)).size;
      if (request.size && actualSize !== request.size) {
        throw new Error(`${name} has an unexpected size (${actualSize} bytes; expected ${request.size}).`);
      }
      if (request.sha1 && !(await this.matchesSha1(partPath, request.sha1))) {
        await rm(partPath, { force: true });
        throw new Error(`Integrity check failed for ${name} (SHA-1 mismatch).`);
      }
      await rename(partPath, request.destination);
      this.report(item, 'complete', actualSize, total || actualSize, 0);
      return request.destination;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown download error.';
      this.report(item, 'error', 0, request.size ?? 0, 0, message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async fetchFrom(url: string, offset: number): Promise<Response> {
    const headers: Record<string, string> = {};
    if (offset > 0) headers.Range = `bytes=${offset}-`;
    return fetch(url, { headers, redirect: 'follow' });
  }

  private report(item: QueueItem, status: DownloadProgress['status'], downloaded: number, total: number, speed: number, error?: string): void {
    const { batch } = item;
    if (!batch) {
      this.emit({
        id: item.id,
        name: item.request.name ?? basename(item.request.destination),
        category: item.request.category,
        status,
        downloaded,
        total,
        speed,
        etaSeconds: speed > 0 && total > 0 ? Math.max(0, Math.ceil((total - downloaded) / speed)) : 0,
        error,
      });
      return;
    }
    batch.tasks.set(item.id, { downloaded, total: item.request.size ?? total, speed, status, error });
    const states = [...batch.tasks.values()];
    const bytesDone = states.reduce((sum, state) => sum + state.downloaded, 0);
    const bytesPerSecond = states.reduce((sum, state) => sum + (state.status === 'downloading' ? state.speed : 0), 0);
    const failed = states.find((state) => state.status === 'error');
    const complete = states.every((state) => state.status === 'complete');
    const anyActive = states.some((state) => state.status === 'downloading');
    const nextStatus: DownloadProgress['status'] = failed ? 'error' : complete ? 'complete' : anyActive ? 'downloading' : 'queued';
    const now = Date.now();
    if (nextStatus !== 'complete' && nextStatus !== 'error' && now - batch.lastEmittedAt < 350) return;
    batch.lastEmittedAt = now;
    this.emit({
      id: batch.id,
      name: batch.name,
      category: batch.category,
      status: nextStatus,
      downloaded: bytesDone,
      total: batch.total,
      speed: bytesPerSecond,
      etaSeconds: bytesPerSecond > 0 ? Math.max(0, Math.ceil((batch.total - bytesDone) / bytesPerSecond)) : 0,
      error: failed?.error,
    });
  }

  private async matchesSha1(filePath: string, expected: string): Promise<boolean> {
    try {
      const hash = createHash('sha1');
      for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
      return hash.digest('hex').toLowerCase() === expected.toLowerCase();
    } catch {
      return false;
    }
  }
}
