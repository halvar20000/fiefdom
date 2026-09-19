import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The static world as real meshes.
 *
 * Every building, tree, pile and yard square is a glTF exported from the same
 * Blender builders that used to be rendered to sprites (tools/render/
 * export_glb.py). Here they are drawn as one InstancedMesh per model: a few
 * thousand wall segments are one draw call, and the depth buffer sorts them
 * against each other, the terrain and the unit sprites without any painter's
 * ordering at all.
 *
 * Materials are shared, not per model. The exporter bakes each procedural
 * material once as a tileable colour + normal pair over a 4x4-tile plane;
 * a model's glTF carries only material KEYS, and the geometry's UVs are in
 * map tiles, so one castle-stone texture dresses the keep, every wall and
 * every tower at the same texel density whatever their size.
 *
 * Conventions, matching the sprite anchor they replace:
 *  - A model's origin is the north-west corner of its footprint. It extends
 *    +X across and -Z down the footprint (Blender +Y became -Z on export), so
 *    a building on tile (x, z) with depth d is placed at (x, y, z + d).
 *  - A quarter turn is +90 degrees about +Y around the footprint's middle,
 *    which is exactly what rig.turn_object did to the sprite renders.
 */

export interface ModelEntry {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  footprint: [number, number];
}

export interface ModelManifest {
  [name: string]: { footprint: [number, number] };
}

interface MaterialSpec {
  name: string;
  roughness: number;
  col?: string;
  nrm?: string;
  span?: number;
  emissive?: [number, number, number];
  emissiveStrength?: number;
}

/**
 * Every static model, loaded once. Missing files are reported, not fatal: a
 * building with no model simply draws nothing, the way a missing sprite did.
 */
export class ModelLibrary {
  readonly entries = new Map<string, ModelEntry>();
  readonly materials = new Map<string, THREE.Material>();
  readonly missing: string[] = [];
  private fallback = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });

  static async load(base: string, anisotropy: number,
                    onProgress?: (done: number, total: number) => void): Promise<ModelLibrary> {
    const lib = new ModelLibrary();
    const [manifest, specs] = await Promise.all([
      fetch(`${base}/models.json`).then(r => r.json()) as Promise<ModelManifest>,
      fetch(`${base}/materials.json`).then(r => r.json()) as Promise<Record<string, MaterialSpec>>,
    ]);
    lib.buildMaterials(base, specs, anisotropy);

    const names = Object.keys(manifest);
    const loader = new GLTFLoader();
    let done = 0;
    // A handful at a time: the browser queues past six anyway, and a hundred
    // and fifty simultaneous fetches just make the progress bar jerky.
    const queue = names.slice();
    const worker = async () => {
      for (;;) {
        const name = queue.shift();
        if (!name) return;
        try {
          const gltf = await loader.loadAsync(`${base}/${name}.glb`);
          lib.adopt(name, gltf, manifest[name].footprint);
        } catch {
          lib.missing.push(name);
        }
        done++;
        onProgress?.(done, names.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return lib;
  }

  private buildMaterials(base: string, specs: Record<string, MaterialSpec>, anisotropy: number): void {
    const tl = new THREE.TextureLoader();
    const tile = (path: string, span: number, srgb: boolean) => {
      const t = tl.load(`${base}/${path}`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / span, 1 / span);
      t.anisotropy = anisotropy;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return t;
    };
    for (const [key, spec] of Object.entries(specs)) {
      const m = new THREE.MeshStandardMaterial({
        roughness: spec.roughness ?? 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      if (spec.emissive) {
        // the coals in a forge: no bake, they simply glow
        m.color.setRGB(0, 0, 0);
        m.emissive.setRGB(...spec.emissive);
        m.emissiveIntensity = Math.min(2, (spec.emissiveStrength ?? 1) / 3);
      } else if (spec.col && spec.nrm) {
        const span = spec.span ?? 4;
        m.map = tile(spec.col, span, true);
        m.normalMap = tile(spec.nrm, span, false);
      }
      m.name = spec.name;
      this.materials.set(key, m);
    }
  }

  private adopt(name: string, gltf: GLTF, footprint: [number, number]): void {
    // One glTF mesh with several primitives arrives as several Meshes; put
    // them back into one geometry with a group per material so a single
    // InstancedMesh draws the whole model.
    const geoms: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      geoms.push(g);
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
      // Blender numbers a repeated name: "m409e6242d2.001"
      const key = src.name.replace(/\.\d+$/, '');
      mats.push(this.materials.get(key) ?? this.fallback);
    });
    if (!geoms.length) { this.missing.push(name); return; }
    for (const g of geoms) {
      // every primitive must carry the same attributes to merge; a part
      // without tangents just gets none (the normal map then goes unused)
      if (!g.getAttribute('tangent') && g.getAttribute('uv')) g.computeTangents();
    }
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, true);
    if (!merged) { this.missing.push(name); return; }
    this.entries.set(name, { geometry: merged, materials: mats, footprint });
  }

  has(name: string): boolean { return this.entries.has(name); }
}

interface Slot {
  mesh: THREE.InstancedMesh;
  count: number;
}

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * A set of placed instances, rebuilt on demand. One per purpose -- the
 * static scenery, the few restless buildings that change every frame, the
 * placement ghost -- so the big one is only re-uploaded when something is
 * built or felled.
 */
export class ModelBatch {
  readonly group = new THREE.Group();
  private slots = new Map<string, Slot>();

  constructor(
    private lib: ModelLibrary,
    private opts: { shadows: boolean; ghost?: boolean } = { shadows: true },
  ) {
    this.group.frustumCulled = false;
  }

  clear(): void {
    for (const s of this.slots.values()) s.count = 0;
  }

  /**
   * Place `name` on tile (x, z) with its footing at height y.
   * `turn` is in quarter turns; `tint` multiplies the colour (a rival's
   * stone, a ghost's verdict).
   */
  add(name: string, x: number, y: number, z: number, turn = 0,
      tint?: [number, number, number]): boolean {
    const entry = this.lib.entries.get(name);
    if (!entry) return false;
    const slot = this.slot(name, entry);
    if (slot.count >= slot.mesh.instanceMatrix.count) this.grow(name, slot);

    const [w, d] = entry.footprint;
    _m.makeTranslation(x, y, z + d);
    if (turn) {
      // rotate about the footprint's middle, in place
      const cx = x + w / 2, cz = z + d / 2;
      _t.makeTranslation(cx, 0, cz)
        .multiply(new THREE.Matrix4().makeRotationY(turn * Math.PI / 2))
        .multiply(new THREE.Matrix4().makeTranslation(-cx, 0, -cz));
      _m.premultiply(_t);
    }
    const mesh = this.slots.get(name)!.mesh;
    mesh.setMatrixAt(slot.count, _m);
    if (tint) _c.setRGB(tint[0], tint[1], tint[2]);
    else _c.setRGB(1, 1, 1);
    mesh.setColorAt(slot.count, _c);
    slot.count++;
    return true;
  }

  /** Upload what was added since clear(). */
  flush(): void {
    for (const s of this.slots.values()) {
      s.mesh.count = s.count;
      s.mesh.visible = s.count > 0;
      if (s.count > 0) {
        s.mesh.instanceMatrix.needsUpdate = true;
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private slot(name: string, entry: ModelEntry): Slot {
    let s = this.slots.get(name);
    if (s) return s;
    s = { mesh: this.make(entry, 16), count: 0 };
    s.mesh.name = name;
    this.slots.set(name, s);
    this.group.add(s.mesh);
    return s;
  }

  private make(entry: ModelEntry, capacity: number): THREE.InstancedMesh {
    let material: THREE.Material | THREE.Material[] = entry.materials;
    if (this.opts.ghost) {
      material = entry.materials.map(m => {
        const g = m.clone();
        g.transparent = true;
        g.opacity = 0.6;
        g.depthWrite = false;
        return g;
      });
    }
    const mesh = new THREE.InstancedMesh(entry.geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // allocate the colour buffer up front so setColorAt never reallocates
    mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = this.opts.shadows;
    mesh.receiveShadow = this.opts.shadows;
    mesh.frustumCulled = false;
    if (this.opts.ghost) mesh.renderOrder = 11;
    return mesh;
  }

  private grow(name: string, slot: Slot): void {
    const old = slot.mesh;
    const entry = this.lib.entries.get(name)!;
    const bigger = this.make(entry, old.instanceMatrix.count * 2);
    bigger.name = name;
    for (let i = 0; i < slot.count; i++) {
      old.getMatrixAt(i, _m); bigger.setMatrixAt(i, _m);
      old.getColorAt(i, _c); bigger.setColorAt(i, _c);
    }
    this.group.remove(old);
    old.dispose();
    this.group.add(bigger);
    slot.mesh = bigger;
  }

  dispose(): void {
    for (const s of this.slots.values()) { this.group.remove(s.mesh); s.mesh.dispose(); }
    this.slots.clear();
  }
}
