import { Assets } from './Assets';
import { World, CELL } from './World';
import { Tileset, BLOCK } from './Tileset';
import { Player, Facing, Direction, Transition } from './Player';
import type { MapData, MapObject } from './types';

interface ActiveTransition {
  trans: Transition;
  phase: 'out' | 'load' | 'in';
  t: number;
}

const DIR_KEYS: Array<[Direction, string, string]> = [
  ['down', 'ArrowDown', 'KeyS'],
  ['up', 'ArrowUp', 'KeyW'],
  ['left', 'ArrowLeft', 'KeyA'],
  ['right', 'ArrowRight', 'KeyD'],
];

const NPC_SPRITES: Record<string, string> = {
  red: 'sprite_red.png',
  mom: 'sprite_mom.png',
  oak: 'sprite_oak.png',
  girl: 'sprite_girl.png',
  fisher: 'sprite_fisher.png',
  daisy: 'sprite_daisy.png',
  blue: 'sprite_blue.png',
  scientist: 'sprite_scientist.png',
  youngster: 'sprite_youngster.png',
  hiker: 'sprite_hiker.png',
  cooltrainer_m: 'sprite_cooltrainer_m.png',
  poke_ball: 'sprite_poke_ball.png',
  pokedex: 'sprite_pokedex.png',
};

// Frame ids in the 16x96 character sheet (stand down/up/left, walk down/up/left)
const STAND_FRAME: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 2 };
const WALK_FRAME: Record<Facing, number> = { down: 3, up: 4, left: 5, right: 5 };

// Sprites that get a portrait frame in the dialogue box (items don't)
const PORTRAIT_SPRITES = new Set([
  'oak',
  'mom',
  'girl',
  'fisher',
  'daisy',
  'blue',
  'scientist',
  'youngster',
  'hiker',
  'cooltrainer_m',
  'red',
]);

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private assets = new Assets();
  private world!: World;
  private mapId = '';
  private player!: Player;
  private playerSprite!: HTMLImageElement;
  private npcImages = new Map<string, HTMLImageElement>();
  private tilesetCache = new Map<string, Tileset>();
  private raf = 0;
  private keys = new Set<string>();
  private lastKeyDir = '';
  private camX = 0;
  private camY = 0;
  private scale = 3;
  private transition: ActiveTransition | null = null;
  private dialogue: MapObject | null = null;
  private waterTimer = 0;
  private waterFrame = 0;
  private step = 0;
  private lastTime = 0;

  private resizeHandler: () => void;
  private keydownHandler: (e: KeyboardEvent) => void;
  private keyupHandler: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resizeHandler = () => this.resize();
    this.keydownHandler = (e) => {
      if (e.repeat) return;
      const dir = DIR_KEYS.find(([, a, b]) => a === e.code || b === e.code);
      if (dir) {
        this.lastKeyDir = e.code;
        this.keys.add(e.code);
      } else if (e.code === 'Space' || e.code === 'Enter') {
        this.pressInteract();
      }
    };
    this.keyupHandler = (e) => {
      this.keys.delete(e.code);
      if (this.lastKeyDir === e.code) {
        // fall back to the most recently held direction, if any
        let fallback = '';
        for (const [dir, a, b] of DIR_KEYS) {
          if (this.keys.has(a)) {
            fallback = a;
            break;
          }
          if (this.keys.has(b)) {
            fallback = b;
            break;
          }
        }
        this.lastKeyDir = fallback;
      }
    };
    // deterministic single-step driver used by the headless smoke test (?test=1)
    if (new URLSearchParams(window.location.search).has('test')) {
      const game = this;
      (window as unknown as Record<string, unknown>).__game = {
        testStep: (dir: Direction) => game.testStep(dir),
        testInteract: () => game.testInteract(),
        get player() {
          return {
            x: game.player?.x,
            y: game.player?.y,
            moving: game.player?.moving ?? false,
            facing: game.player?.facing,
          };
        },
        get mapId() {
          return game.mapId;
        },
        get transition() {
          return game.transition !== null;
        },
        get dialogue() {
          return game.dialogue?.text ?? null;
        },
      };
    }
  }

  testStep(dir: Direction): void {
    const entry = DIR_KEYS.find(([d]) => d === dir);
    if (!entry) return;
    this.lastKeyDir = entry[1];
    this.keys.add(entry[1]);
    this.handleInput();
    this.keys.delete(entry[1]);
    this.lastKeyDir = '';
  }

  testInteract(): void {
    this.pressInteract();
  }

  async init(): Promise<void> {
    this.playerSprite = await this.assets.loadImage('assets/sprite_red.png');
    await this.loadMap('pallet', 5, 5, 'down');

    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);
    this.resize();
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('keyup', this.keyupHandler);
  }

  private async loadMap(mapId: string, spawnX: number, spawnY: number, facing: Facing): Promise<void> {
    const map = await this.assets.loadJSON<MapData>(`assets/map_${mapId}.json`);
    let tileset = this.tilesetCache.get(map.tileset);
    if (!tileset) {
      const [img, bs] = await Promise.all([
        this.assets.loadImage(`assets/tileset_${map.tileset}.png`),
        this.assets.loadJSON<{ blocks: number[][] }>(`assets/blockset_${map.tileset}.json`),
      ]);
      tileset = new Tileset(img, bs.blocks, map.tileset);
      this.tilesetCache.set(map.tileset, tileset);
    }
    this.world = new World(mapId, map, tileset);
    this.mapId = mapId;
    if (!this.player) this.player = new Player(spawnX, spawnY, facing);
    else this.player.spawn(spawnX, spawnY, facing);
    this.dialogue = null;

    const labelEl = document.getElementById('map-label');
    if (labelEl) labelEl.textContent = map.label;
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.canvas.width = Math.floor(vw * dpr);
    this.canvas.height = Math.floor(vh * dpr);
    this.canvas.style.width = `${vw}px`;
    this.canvas.style.height = `${vh}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // integer scale so the GBC resolution stays crisp
    this.scale = Math.max(2, Math.min(6, Math.floor(Math.min(vw, vh) / 160)));
  }

  private currentDir(): Direction | null {
    if (!this.lastKeyDir) return null;
    for (const [dir, a, b] of DIR_KEYS) {
      if (a === this.lastKeyDir || b === this.lastKeyDir) return dir;
    }
    return null;
  }

  private pressInteract(): void {
    if (this.transition) return;
    if (this.dialogue) {
      this.dialogue = null;
      return;
    }
    const [dx, dy] = this.player.facingOffset();
    const fx = this.player.x + dx;
    const fy = this.player.y + dy;
    const obj =
      this.world.data.objects.find((o) => o.x === fx && o.y === fy) ||
      this.world.data.objects.find((o) => o.x === this.player.x && o.y === this.player.y);
    if (obj) this.dialogue = obj;
  }

  private handleInput(): void {
    if (this.transition || this.player.moving || this.dialogue) return;
    const dir = this.currentDir();
    if (!dir) return;
    this.player.facing = dir;
    const trans = this.player.resolveMove(dir, this.world);
    if (trans) {
      this.transition = { trans, phase: 'out', t: 0 };
      return;
    }
    if (this.player.tryMove(dir, this.world)) this.step++;
  }

  private startTransitionLoad(): void {
    const tr = this.transition;
    if (!tr) return;
    tr.phase = 'load';
    void this.performTransition(tr.trans).then(() => {
      if (!this.transition) return;
      this.transition.phase = 'in';
      this.transition.t = 0;
    });
  }

  private async performTransition(trans: Transition): Promise<void> {
    if (trans.kind === 'warp') {
      const { map, destX, destY } = trans.warp;
      await this.loadMap(map, destX, destY, 'down');
    } else {
      const { mapId, arrivalEdge, cx, cy } = trans.conn;
      await this.loadMap(mapId, cx, cy, 'down');
      // land on the opposite edge of the connected map
      let landX = cx;
      let landY = cy;
      if (arrivalEdge === 'north') landY = 0;
      else if (arrivalEdge === 'south') landY = this.world.heightCells - 1;
      else if (arrivalEdge === 'west') landX = 0;
      else if (arrivalEdge === 'east') landX = this.world.widthCells - 1;
      const { x, y } = this.nudgeLanding(landX, landY, arrivalEdge);
      this.player.spawn(x, y);
      this.player.setArrivalEdge(arrivalEdge);
    }
  }

  // Find the nearest walkable cell near (cx, cy), scanning the row then the column.
  private nudgeLanding(cx: number, cy: number, _edge: string): { x: number; y: number } {
    if (this.world.isWalkableCell(cx, cy)) return { x: cx, y: cy };
    for (let d = 1; d < 8; d++) {
      for (const s of [-d, d]) {
        const x = cx + s;
        if (x >= 0 && x < this.world.widthCells && this.world.isWalkableCell(x, cy)) {
          return { x, y: cy };
        }
        const yy = cy + s;
        if (yy >= 0 && yy < this.world.heightCells && this.world.isWalkableCell(cx, yy)) {
          return { x: cx, y: yy };
        }
      }
    }
    return { x: cx, y: cy };
  }

  private updateCamera(): void {
    const [px, py] = this.player.px();
    const viewW = window.innerWidth / this.scale;
    const viewH = window.innerHeight / this.scale;
    const mapW = this.world.widthCells * CELL;
    const mapH = this.world.heightCells * CELL;
    let cx = px + CELL / 2 - viewW / 2;
    let cy = py + CELL / 2 - viewH / 2;
    cx = Math.max(0, Math.min(mapW - viewW, cx));
    cy = Math.max(0, Math.min(mapH - viewH, cy));
    this.camX = cx;
    this.camY = cy;
  }

  private drawWorld(): void {
    const viewW = window.innerWidth / this.scale;
    const viewH = window.innerHeight / this.scale;
    // one block of margin so the border ring fills the screen edges
    const startCol = Math.floor(this.camX / BLOCK) - 1;
    const startRow = Math.floor(this.camY / BLOCK) - 1;
    const endCol = Math.ceil((this.camX + viewW) / BLOCK) + 1;
    const endRow = Math.ceil((this.camY + viewH) / BLOCK) + 1;
    for (let y = startRow; y <= endRow; y++) {
      for (let x = startCol; x <= endCol; x++) {
        const block = this.world.blockAt(x, y);
        if (block < 0) continue;
        this.world.tileset.drawBlock(this.ctx, block, x * BLOCK - this.camX, y * BLOCK - this.camY);
      }
    }
  }

  private spriteImage(name: string): HTMLImageElement {
    const file = NPC_SPRITES[name] || 'sprite_red.png';
    let img = this.npcImages.get(file);
    if (!img) {
      img = new Image();
      img.src = `assets/${file}`;
      this.npcImages.set(file, img);
    }
    return img;
  }

  private drawNPCLayer(): void {
    const [px, py] = this.player.px();
    const behind: MapObject[] = [];
    const front: MapObject[] = [];
    for (const obj of this.world.data.objects) {
      (obj.y * CELL < py ? behind : front).push(obj);
    }
    for (const obj of [...behind, ...front]) {
      const sx = obj.x * CELL - this.camX;
      const sy = obj.y * CELL - this.camY - 4;
      const vw = window.innerWidth / this.scale;
      const vh = window.innerHeight / this.scale;
      if (sy < -16 || sy > vh || sx < -16 || sx > vw) continue;
      const img = this.spriteImage(obj.sprite);
      this.ctx.drawImage(img, 0, 0, 16, 16, sx, sy, 16, 16);
    }
  }

  private drawPlayer(): void {
    const [px, py] = this.player.px();
    const sx = px - this.camX;
    const sy = py - this.camY - 4;
    let frame = STAND_FRAME[this.player.facing];
    let flip = false;
    if (this.player.moving) {
      frame = WALK_FRAME[this.player.facing];
      flip = this.step % 2 === 1;
    }
    const fy = frame * 16;
    if (flip) {
      this.ctx.save();
      this.ctx.translate(sx + 8, 0);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(this.playerSprite, 0, fy, 16, 16, -8, sy, 16, 16);
      this.ctx.restore();
    } else {
      this.ctx.drawImage(this.playerSprite, 0, fy, 16, 16, sx, sy, 16, 16);
    }
  }

  private drawFade(): void {
    if (!this.transition) return;
    const tr = this.transition;
    let alpha = 0;
    if (tr.phase === 'out') alpha = tr.t;
    else if (tr.phase === 'load') alpha = 1;
    else alpha = 1 - tr.t;
    if (alpha <= 0) return;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, window.innerWidth / this.scale, window.innerHeight / this.scale);
    this.ctx.restore();
  }

  private drawGbcBox(x: number, y: number, w: number, h: number): void {
    // pokered dialogue box: cream fill, blue-gray border, offset shadow
    this.ctx.fillStyle = 'rgba(88, 88, 152, 0.45)';
    this.ctx.fillRect(x + 4, y + 4, w, h);
    this.ctx.fillStyle = '#f8f8f8';
    this.ctx.fillRect(x, y, w, h);
    this.ctx.strokeStyle = '#585898';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    this.ctx.strokeStyle = '#7878b8';
    this.ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  }

  private drawDialogue(): void {
    if (!this.dialogue) return;
    const vw = window.innerWidth / this.scale;
    const vh = window.innerHeight / this.scale;
    const bw = vw - 16;
    const bx = 8;
    const bh = 80;
    const by = vh - bh - 8;
    this.ctx.save();
    this.drawGbcBox(bx, by, bw, bh);

    const portrait = PORTRAIT_SPRITES.has(this.dialogue.sprite);
    let tx = bx + 16;
    if (portrait) {
      // portrait frame with the NPC standing sprite
      const frame = 48;
      const px = bx + 12;
      const py = by + 12;
      this.ctx.fillStyle = '#d0d0d8';
      this.ctx.fillRect(px, py, frame, frame);
      this.ctx.strokeStyle = '#585898';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(px + 1, py + 1, frame - 2, frame - 2);
      const img = this.spriteImage(this.dialogue.sprite);
      if (img.complete && img.naturalWidth > 0) {
        this.ctx.drawImage(img, 0, 0, 16, 16, px + 8, py + 8, 32, 32);
      }
      tx = px + frame + 16;
    }

    const maxW = Math.max(40, bx + bw - 16 - tx);
    this.ctx.fillStyle = '#101030';
    this.ctx.font = '12px "Press Start 2P", monospace';
    this.ctx.textBaseline = 'top';
    this.wrapText(this.dialogue.text, tx, by + 16, maxW, 13, 4);

    // "continue" arrow
    this.drawTriangle(bx + bw - 22, by + bh - 20, 10, '#101030');
    this.ctx.restore();
  }

  private drawTriangle(x: number, y: number, size: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + size, y);
    this.ctx.lineTo(x + size / 2, y + size);
    this.ctx.closePath();
    this.ctx.fill();
  }

  private wrapText(text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number): void {
    const words = text.split(' ');
    let line = '';
    let count = 0;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (this.ctx.measureText(test).width > maxW && line) {
        if (count >= maxLines - 1) {
          this.ctx.fillText(line + '...', x, y + count * lineH);
          return;
        }
        this.ctx.fillText(line, x, y + count * lineH);
        count++;
        line = w;
      } else {
        line = test;
      }
    }
    if (count < maxLines) this.ctx.fillText(line, x, y + count * lineH);
  }

  private loop = (now: number): void => {
    const dt = Math.min(50, now - this.lastTime);
    this.lastTime = now;

    // water animation ticks every ~200ms
    this.waterTimer += dt;
    if (this.waterTimer >= 200) {
      this.waterTimer -= 200;
      this.waterFrame = (this.waterFrame + 1) % 8;
      Tileset.advanceWater(this.waterFrame);
    }

    this.handleInput();
    this.player.update(dt);

    if (this.transition) {
      const tr = this.transition;
      if (tr.phase === 'out') {
        tr.t += dt / 180;
        if (tr.t >= 1) this.startTransitionLoad();
      } else if (tr.phase === 'in') {
        tr.t += dt / 180;
        if (tr.t >= 1) this.transition = null;
      }
    }

    this.updateCamera();

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.save();
    this.ctx.scale(this.scale, this.scale);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, window.innerWidth / this.scale, window.innerHeight / this.scale);
    this.drawWorld();
    this.drawNPCLayer();
    this.drawPlayer();
    this.drawFade();
    this.drawDialogue();
    this.ctx.restore();

    this.raf = requestAnimationFrame(this.loop);
  };
}
