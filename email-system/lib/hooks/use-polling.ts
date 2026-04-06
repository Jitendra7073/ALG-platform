"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UsePollingOptions<T> {
  fn: () => Promise<T>;
  interval?: number; // milliseconds
  immediate?: boolean;
  onError?: (error: Error) => void;
}

interface UsePollingResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  isPolling: boolean;
  refetch: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export function usePolling<T>({
  fn,
  interval = 30000,
  immediate = true,
  onError,
}: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(immediate);
  const [error, setError] = useState<Error | null>(null);
  const [isPolling, setIsPolling] = useState(true);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!isMountedRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await fn();
      if (isMountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const error = err instanceof Error ? err : new Error("An error occurred");
        setError(error);
        onError?.(error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [fn, onError]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;

    setIsPolling(true);
    intervalRef.current = setInterval(() => {
      fetchData();
    }, interval);
  }, [interval, fetchData]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (immediate) {
      fetchData();
    }

    startPolling();

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, [fetchData, startPolling, stopPolling, immediate]);

  return {
    data,
    isLoading,
    error,
    isPolling,
    refetch,
    startPolling,
    stopPolling,
  };
}
