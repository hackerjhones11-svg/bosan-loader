import { BranchSearch, type BranchProgress, type BranchRequest } from './branchSearch';

/**
 * Runs the look-ahead search (branchSearch.ts) off the main thread, so trying
 * continuations never costs a rendered frame. Works in short slices, posting
 * the best continuation found so far after each one; the page uses whatever
 * it has when playback needs the answer. A new search replaces the old one.
 */

export type BranchWorkerRequest = { type: 'search'; id: number; request: BranchRequest } | { type: 'cancel'; id: number };
export type BranchWorkerReply = { id: number; error?: string } & Partial<BranchProgress>;

const scope = self as unknown as {
  postMessage(message: BranchWorkerReply): void;
  onmessage: ((event: MessageEvent<BranchWorkerRequest>) => void) | null;
};

const SLICE_MS = 20;
let search: BranchSearch | null = null;
let current = -1;
let scheduled = false;

const slice = () => {
  scheduled = false;
  if (!search) return;
  const id = current;
  try {
    const { best, tried, done, baseHash } = search.run(performance.now() + SLICE_MS);
    scope.postMessage({ id, best: best && { ...best }, tried, done, baseHash });
    if (done) search = null;
  } catch (error) {
    search = null;
    scope.postMessage({ id, error: String(error) });
  }
  schedule();
};

const schedule = () => {
  if (search && !scheduled) {
    scheduled = true;
    setTimeout(slice, 0);
  }
};

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    if (message.id === current) search = null;
    return;
  }
  current = message.id;
  try {
    search = new BranchSearch(message.request);
  } catch (error) {
    search = null;
    scope.postMessage({ id: message.id, error: String(error) });
  }
  schedule();
};
