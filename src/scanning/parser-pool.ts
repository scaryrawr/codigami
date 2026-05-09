import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CodeUnit } from "../types.ts";
import type { ParseRequest, ParseResponse } from "./parser-worker.ts";

interface PendingTask {
  resolve: (units: CodeUnit[]) => void;
  reject: (error: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  ready: boolean;
}

export interface ParserPool {
  parse(filePath: string, source: string): Promise<CodeUnit[]>;
  close(): Promise<void>;
}

export interface ParserPoolOptions {
  poolSize?: number;
  workerPath?: string;
}

const defaultWorkerPath = (): string => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "parser-worker.ts");
};

export const createParserPool = (options?: ParserPoolOptions): Promise<ParserPool> => {
  const poolSize = options?.poolSize ?? Math.max(1, availableParallelism() - 1);
  const workerPath = options?.workerPath ?? defaultWorkerPath();

  const workers: PoolWorker[] = [];
  const taskQueue: Array<{ request: ParseRequest; task: PendingTask }> = [];
  let nextId = 0;
  const pendingTasks = new Map<number, PendingTask>();
  let closed = false;

  const dispatch = (): void => {
    if (taskQueue.length === 0) return;

    const available = workers.find((w) => w.ready && !w.busy);
    if (!available) return;

    const queued = taskQueue.shift()!;
    available.busy = true;
    pendingTasks.set(queued.request.id, queued.task);
    available.worker.postMessage(queued.request);
  };

  const handleMessage = (
    poolWorker: PoolWorker,
    msg: ParseResponse & { ready?: boolean; initError?: string },
  ): void => {
    if (msg.ready) {
      poolWorker.ready = true;
      dispatch();
      return;
    }

    if (msg.initError) {
      // Worker failed to initialize — reject all pending tasks for this worker
      poolWorker.ready = false;
      return;
    }

    poolWorker.busy = false;
    const task = pendingTasks.get(msg.id);
    if (!task) return;
    pendingTasks.delete(msg.id);

    if (msg.error) {
      task.reject(new Error(`Parser worker error: ${msg.error}`));
    } else {
      task.resolve(msg.units ?? []);
    }

    dispatch();
  };

  const readyPromises: Promise<void>[] = [];

  for (let i = 0; i < poolSize; i++) {
    const worker = new Worker(workerPath);
    const poolWorker: PoolWorker = { worker, busy: false, ready: false };
    workers.push(poolWorker);

    const readyPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (msg: { ready?: boolean; initError?: string }) => {
        if (msg.ready) {
          poolWorker.ready = true;
          worker.off("message", onMessage);
          worker.on("message", (m: ParseResponse) => handleMessage(poolWorker, m));
          resolve();
        } else if (msg.initError) {
          reject(new Error(`Worker init failed: ${msg.initError}`));
        }
      };
      worker.on("message", onMessage);
      worker.on("error", reject);
    });

    readyPromises.push(readyPromise);
  }

  return Promise.all(readyPromises).then(() => ({
    parse(filePath: string, source: string): Promise<CodeUnit[]> {
      if (closed) {
        return Promise.reject(new Error("Parser pool is closed"));
      }

      const id = nextId++;
      const request: ParseRequest = { id, filePath, source };

      return new Promise<CodeUnit[]>((resolve, reject) => {
        taskQueue.push({ request, task: { resolve, reject } });
        dispatch();
      });
    },

    async close(): Promise<void> {
      closed = true;

      // Reject any remaining queued tasks
      for (const queued of taskQueue) {
        queued.task.reject(new Error("Parser pool closed"));
      }
      taskQueue.length = 0;

      await Promise.all(workers.map((w) => w.worker.terminate()));
    },
  }));
};
