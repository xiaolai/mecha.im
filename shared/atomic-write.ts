import { writeFileSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync, unlinkSync } from "node:fs";
import { writeFile, rename, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export function atomicWriteJson(filePath: string, data: unknown): void {
  atomicWrite(filePath, JSON.stringify(data, null, 2) + "\n");
}

export function atomicWriteText(filePath: string, content: string): void {
  atomicWrite(filePath, content);
}

export async function atomicWriteJsonAsync(filePath: string, data: unknown): Promise<void> {
  await atomicWriteAsync(filePath, JSON.stringify(data, null, 2) + "\n");
}

export async function atomicWriteTextAsync(filePath: string, content: string): Promise<void> {
  await atomicWriteAsync(filePath, content);
}

function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    writeFileSync(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
    const fd = openSync(tmpPath, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
    throw err;
  }
}

async function atomicWriteAsync(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
    const fh = await open(tmpPath, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmpPath, filePath);
  } catch (err) {
    try { await unlink(tmpPath); } catch { /* cleanup best-effort */ }
    throw err;
  }
}
