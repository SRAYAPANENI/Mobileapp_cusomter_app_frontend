import { useCallback, useRef, useState } from 'react';

/** One tab's list as far as it's been read. */
export interface TabPage<T> {
  items: T[];
  /** Its first page has arrived (or failed) at least once. */
  loaded: boolean;
  /** The last read of its first page failed. */
  failed: boolean;
  /** Everything there is has been read. */
  done: boolean;
  loadingMore: boolean;
  /** Something changed since it was read: read again when next shown. */
  stale: boolean;
}

const EMPTY: TabPage<never> = { items: [], loaded: false, failed: false, done: false, loadingMore: false, stale: false };

/**
 * Lists split into tabs, each read from the server on its own, a page at a
 * time, the next page when the end is scrolled to. A tab is read the first
 * time it's shown; reload() reads the shown one again and marks the others
 * to be read again when they're next opened.
 *
 * `fetchPage(tab, last, limit)`: up to `limit` items after `last` (the last
 * item shown), or from the top without it. Fewer back than asked: that's all.
 * `maxPage`: the most one read may ask for (the server's own limit).
 */
export function usePagedTabs<K extends string, T extends { id: string }>(
  fetchPage: (tab: K, last: T | undefined, limit: number) => Promise<T[]>,
  pageSize: number,
  maxPage: number = pageSize,
) {
  const [pages, setPages] = useState<Partial<Record<K, TabPage<T>>>>({});
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  // Each first-page read gets a number: a later page that arrives after the
  // tab was read again belongs to the old list and is dropped.
  const generation = useRef<Partial<Record<K, number>>>({});
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  // A next page being read, per tab: two scrolls to the end in a row asked
  // for the same page twice (state hadn't caught up between them).
  const readingMore = useRef(new Set<K>());
  // A tab being read from the top: no next page meanwhile — it would start
  // after the old list's last item and land on the new list.
  const readingFirst = useRef(new Set<K>());

  const page = useCallback((tab: K): TabPage<T> => pagesRef.current[tab] ?? EMPTY, []);
  const update = useCallback((tab: K, change: (p: TabPage<T>) => TabPage<T>) => {
    setPages(prev => {
      const next = { ...prev, [tab]: change(prev[tab] ?? EMPTY) };
      pagesRef.current = next;
      return next;
    });
  }, []);

  /** The tab from the top, again — as far down as was shown, read `maxPage`
   * at a time: coming back from a job used to cut a long list back to its
   * first page, and the place in it was lost. Never further than was shown,
   * so it's only ever what was already scrolled through. */
  const loadFirst = useCallback(async (tab: K) => {
    const gen = (generation.current[tab] ?? 0) + 1;
    generation.current[tab] = gen;
    readingMore.current.delete(tab);
    readingFirst.current.add(tab);
    const target = Math.max(pageSize, page(tab).items.length);
    try {
      const items: T[] = [];
      let done = false;
      while (items.length < target) {
        const limit = Math.min(target - items.length, maxPage);
        const chunk = await fetchRef.current(tab, items[items.length - 1], limit);
        if (generation.current[tab] !== gen) return;
        const seen = new Set(items.map(i => i.id));
        const fresh = chunk.filter(i => !seen.has(i.id));
        items.push(...fresh);
        if (chunk.length < limit) { done = true; break; }
        // Nothing new (can't happen with the cursor, but never loop on it).
        if (fresh.length === 0) break;
      }
      update(tab, () => ({ ...EMPTY, items, loaded: true, done }));
    } catch {
      if (generation.current[tab] !== gen) return;
      // What was shown stays; an empty tab says it couldn't load.
      update(tab, p => ({ ...p, loaded: true, failed: p.items.length === 0, loadingMore: false }));
    } finally {
      if (generation.current[tab] === gen) readingFirst.current.delete(tab);
    }
  }, [maxPage, page, pageSize, update]);

  /** The next page, at the end of the list. */
  const loadMore = useCallback(async (tab: K) => {
    const p = page(tab);
    if (!p.loaded || p.done || p.loadingMore || p.items.length === 0) return;
    if (readingMore.current.has(tab) || readingFirst.current.has(tab)) return;
    readingMore.current.add(tab);
    const gen = generation.current[tab];
    update(tab, q => ({ ...q, loadingMore: true }));
    try {
      const more = await fetchRef.current(tab, p.items[p.items.length - 1], pageSize);
      if (generation.current[tab] !== gen) return;
      update(tab, q => {
        const seen = new Set(q.items.map(i => i.id));
        return {
          ...q,
          items: [...q.items, ...more.filter(i => !seen.has(i.id))],
          done: more.length < pageSize,
          loadingMore: false,
        };
      });
    } catch {
      // Not done: scrolling to the end tries again.
      if (generation.current[tab] === gen) update(tab, q => ({ ...q, loadingMore: false }));
    } finally {
      if (generation.current[tab] === gen) readingMore.current.delete(tab);
    }
  }, [page, pageSize, update]);

  /** The shown tab read again now; the rest when next opened. */
  const reload = useCallback(async (shown: K) => {
    setPages(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next) as K[]) {
        if (key !== shown) next[key] = { ...(next[key] ?? EMPTY), stale: true };
      }
      pagesRef.current = next;
      return next;
    });
    await loadFirst(shown);
  }, [loadFirst]);

  /** Opening a tab: read if never read, stale, or its last read failed. */
  const open = useCallback((tab: K) => {
    const p = page(tab);
    if (!p.loaded || p.stale || p.failed) void loadFirst(tab);
  }, [loadFirst, page]);

  return { pages, page, loadMore, reload, open };
}
