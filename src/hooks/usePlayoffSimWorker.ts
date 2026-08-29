import { useEffect, useRef, useState, useCallback } from "react";
import type { SimRequest, WorkerSimResult, WorkerSimResponse } from "@/workers/playoffSim.worker";

/** Runs the Monte Carlo playoff simulation in a Web Worker so a high
 *  iteration count doesn't block the UI thread. */
export function usePlayoffSimWorker() {
  const workerRef = useRef<Worker | null>(null);
  const nextRequestId = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/playoffSim.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const run = useCallback((request: Omit<SimRequest, "requestId">): Promise<WorkerSimResult[]> => {
    return new Promise((resolve, reject) => {
      const worker = workerRef.current;
      if (!worker) { reject(new Error("Simulation worker not ready")); return; }
      const requestId = nextRequestId.current++;
      setIsRunning(true);
      // The worker is a single shared, persistent instance — if run() is
      // called again before an earlier call's result arrives (e.g. the
      // initial default-sims run is still crunching when the user clicks
      // Re-run), both calls' listeners sit on the same 'message' stream.
      // Without matching on requestId, whichever reply arrives first would
      // get delivered to every listener, silently handing older/newer calls
      // a stale result. Ignore replies that aren't ours and keep listening.
      const onMessage = (e: MessageEvent<WorkerSimResponse>) => {
        if (e.data.requestId !== requestId) return;
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        setIsRunning(false);
        resolve(e.data.results);
      };
      const onError = (e: ErrorEvent) => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        setIsRunning(false);
        reject(new Error(e.message));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ ...request, requestId });
    });
  }, []);

  return { run, isRunning };
}
