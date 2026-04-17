import { useEffect, useState } from "react";

interface UpdateInfo {
  latestVersion: string;
  releaseUrl: string;
}

const GITHUB_API =
  "https://api.github.com/repos/Jacksonary/super-s3/releases/latest";
const GITEE_API =
  "https://gitee.com/api/v5/repos/weiguoliu/super-s3/releases/latest";

const CACHE_KEY = "super-s3-update-check";
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

function parseVersion(v: string): number[] {
  return v.replace(/^v/i, "").split(".").map(Number);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function fetchRelease(
  url: string,
  source: "github" | "gitee"
): Promise<UpdateInfo> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${source}: ${resp.status}`);
  const data = await resp.json();
  const tag: string = data.tag_name ?? "";
  if (!tag) throw new Error(`${source}: no tag_name`);
  const releaseUrl =
    source === "github"
      ? data.html_url ?? `https://github.com/Jacksonary/super-s3/releases`
      : `https://gitee.com/weiguoliu/super-s3/releases/tag/${tag}`;
  return { latestVersion: tag.replace(/^v/i, ""), releaseUrl };
}

export function useUpdateCheck(currentVersion: string) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const { info, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          if (info && isNewer(info.latestVersion, currentVersion)) {
            setUpdate(info);
          }
          return;
        }
      } catch { /* ignore */ }
    }

    const controller = new AbortController();

    Promise.any([
      fetchRelease(GITHUB_API, "github"),
      fetchRelease(GITEE_API, "gitee"),
    ])
      .then((info) => {
        if (controller.signal.aborted) return;
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ info, ts: Date.now() })
        );
        if (isNewer(info.latestVersion, currentVersion)) {
          setUpdate(info);
        }
      })
      .catch(() => {
        // both sources failed — silently ignore
      });

    return () => controller.abort();
  }, [currentVersion]);

  return update;
}
