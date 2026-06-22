import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateState =
  | { status: "idle" }
  | { status: "available"; update: Update; version: string }
  | { status: "downloading"; progress: number }
  | { status: "ready" }
  | { status: "error"; message: string };

const CACHE_KEY = "super-s3-update-check";
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
// Set when the user deferred an install via "Later"; the launch-time install flow
// in Sidebar owns the update check in that case, so the auto-check must stand down.
const PENDING_UPDATE_KEY = "super-s3:install-update-on-launch";

export function useUpdateCheck(currentVersion: string, enabled: boolean = true) {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [checking, setChecking] = useState(false);
  const runningRef = useRef(false);

  const doCheck = async (skipCache = false): Promise<"up-to-date" | "error" | null> => {
    if (runningRef.current) return null;

    if (!skipCache) {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const { ts } = JSON.parse(cached);
          if (Date.now() - ts < CACHE_TTL) return null;
        } catch { /* ignore */ }
      }
    }

    runningRef.current = true;
    setChecking(true);
    try {
      const update = await check();
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() }));
      if (update) {
        setState({ status: "available", update, version: update.version });
      } else if (skipCache) {
        return "up-to-date";
      }
    } catch {
      if (skipCache) return "error";
    } finally {
      runningRef.current = false;
      setChecking(false);
    }
    return null;
  };

  useEffect(() => {
    if (!enabled) return;
    // Defer to Sidebar's launch-time install flow when an update is pending,
    // so the two paths don't run concurrent check() calls and clobber state.
    let pending = false;
    try { pending = localStorage.getItem(PENDING_UPDATE_KEY) === "1"; } catch { /* ignore */ }
    if (!pending) doCheck();
  }, [currentVersion, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const recheck = async (): Promise<"up-to-date" | "error" | null> => {
    sessionStorage.removeItem(CACHE_KEY);
    return doCheck(true);
  };

  return { state, setState, checking, recheck };
}
