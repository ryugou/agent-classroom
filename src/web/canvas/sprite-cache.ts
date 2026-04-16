export class SpriteCache {
  private readonly cache = new Map<string, HTMLImageElement>();
  private readonly promises = new Map<string, Promise<HTMLImageElement>>();

  load(src: string): Promise<HTMLImageElement> {
    const hit = this.cache.get(src);
    if (hit) return Promise.resolve(hit);
    const pending = this.promises.get(src);
    if (pending) return pending;
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.cache.set(src, img);
        this.promises.delete(src);
        resolve(img);
      };
      img.onerror = (err) => {
        this.promises.delete(src);
        reject(err);
      };
      img.src = src;
    });
    this.promises.set(src, p);
    return p;
  }

  get(src: string): HTMLImageElement | null { return this.cache.get(src) ?? null; }
}

export const sharedCache = new SpriteCache();
