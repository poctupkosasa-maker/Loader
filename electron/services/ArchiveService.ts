import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

/** Extracts native classifiers without META-INF and rejects zip-slip paths. */
export async function extractNativeArchive(archivePath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await new Promise<void>((resolvePromise, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: false, decodeStrings: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError ?? new Error('Unable to read native library archive.'));
      let finished = false;
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        zip.close();
        reject(error);
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (!finished) {
          finished = true;
          zip.close();
          resolvePromise();
        }
      });
      zip.on('entry', (entry) => {
        const normalizedName = entry.fileName.replace(/\\/g, '/');
        if (normalizedName.startsWith('META-INF/') || normalizedName === 'META-INF' || normalizedName.includes('/META-INF/')) {
          zip.readEntry();
          return;
        }
        const outputPath = resolve(destination, normalizedName);
        const root = resolve(destination) + sep;
        if (outputPath !== resolve(destination) && !outputPath.startsWith(root)) {
          fail(new Error(`Unsafe native archive entry: ${entry.fileName}`));
          return;
        }
        if (normalizedName.endsWith('/')) {
          void mkdir(outputPath, { recursive: true }).then(() => zip.readEntry(), fail);
          return;
        }
        void mkdir(dirname(outputPath), { recursive: true }).then(() => {
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return fail(streamError ?? new Error('Unable to extract native file.'));
            void pipeline(stream, createWriteStream(outputPath)).then(() => zip.readEntry(), fail);
          });
        }, fail);
      });
      zip.readEntry();
    });
  });
}
