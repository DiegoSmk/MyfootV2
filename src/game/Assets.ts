export interface BlocksetData {
  blocks: number[][];
}

export type { MapData } from './types';

export interface SpriteSheet {
  image: HTMLImageElement;
}

export class Assets {
  private cache = new Map<string, unknown>();

  async loadImage(url: string): Promise<HTMLImageElement> {
    const cached = this.cache.get(url);
    if (cached) return cached as HTMLImageElement;
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to load ${url}`));
    });
    this.cache.set(url, img);
    return img;
  }

  async loadJSON<T>(url: string): Promise<T> {
    const cached = this.cache.get(url);
    if (cached) return cached as T;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch ${url}`);
    const data = (await res.json()) as T;
    this.cache.set(url, data);
    return data;
  }
}
