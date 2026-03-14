type DeferredResolve<T> = [T] extends [void]
  ? (value?: T | PromiseLike<T>) => void
  : (value: T | PromiseLike<T>) => void;

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: DeferredResolve<T>;
  reject: (reason?: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve: resolve as DeferredResolve<T>,
    reject,
  };
}
