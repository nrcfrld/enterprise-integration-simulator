export interface MassOrderProgress {
  completed: number;
  created: number;
  rejected: number;
  total: number;
}

export interface MassOrderResult {
  created: number;
  rejected: number;
  errors: string[];
}

interface RunMassOrdersOptions {
  total: number;
  concurrency: number;
  createOrder: (index: number) => Promise<unknown>;
  onProgress?: (progress: MassOrderProgress) => void;
}

/** Runs order requests through a bounded worker pool so HTTP calls overlap. */
export async function runMassOrders({
  total,
  concurrency,
  createOrder,
  onProgress,
}: RunMassOrdersOptions): Promise<MassOrderResult> {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error("Order count must be a positive integer.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer.");
  }

  let cursor = 0;
  let completed = 0;
  let created = 0;
  const errors: string[] = [];
  const workerCount = Math.min(total, concurrency);

  const worker = async () => {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      try {
        await createOrder(index);
        created += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Request failed");
      } finally {
        completed += 1;
        onProgress?.({
          completed,
          created,
          rejected: errors.length,
          total,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { created, rejected: errors.length, errors };
}
