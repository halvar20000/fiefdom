import * as THREE from 'three';
import type { Lighting } from './lighting';

/**
 * The human units as animated meshes.
 *
 * One draw call per body. A body is a rest-pose mesh whose every vertex
 * names ONE bone (the peasant is rigidly bound, see tools/render/peasant.py),
 * plus an animation texture: for every frame of every clip, every bone's
 * skinning matrix as three RGBA32F texels. The vertex shader fetches its
 * bone's matrix for the instance's frame and that is the skinning -- no
 * SkinnedMesh per soldier, no bone uploads, and an army of three hundred is
 * one instanced mesh with three hundred rows of attributes.
 *
 * Instances carry position, heading, frame row and tint. Frames are chosen
 * by the caller from the clip table exactly as sprite frames were:
 * floor(phase * fps) mod count.
 *
 * Lit here by hand -- the sun, sky and bounce of engine/lighting.ts with the
 * same weights three's standard material gives them -- and shadowed with the
 * sun's map, both cast and received. Gazelles and siege engines are not
 * here: different rigs, still sprites.
 */

export interface UnitClip {
  /** Absolute first row in the animation texture. */
  start: number;
  count: number;
  fps: number;
}

export interface UnitBody {
  geometry: THREE.InstancedBufferGeometry;
  anim: THREE.DataTexture;
  animSize: THREE.Vector2;
  clips: Record<string, UnitClip>;
  height: number;
}

interface BodyMeta {
  verts: number; indices: number; bones: number;
  frames: { mixamo: number; '0ad': number };
  clips: Record<string, { source: 'mixamo' | '0ad'; start: number; count: number; fps: number }>;
  height: number;
}

export class UnitLibrary {
  readonly bodies = new Map<string, UnitBody>();

  static async load(base: string): Promise<UnitLibrary> {
    const lib = new UnitLibrary();
    const { bodies } = await fetch(`${base}/units.json`).then(r => r.json()) as { bodies: string[] };
    await Promise.all(bodies.map(async name => {
      try {
        lib.bodies.set(name, await UnitLibrary.loadBody(base, name));
      } catch (e) {
        console.warn(`[units] ${name}: ${(e as Error).message}`);
      }
    }));
    return lib;
  }

  has(name: string): boolean { return this.bodies.has(name); }

  private static async loadBody(base: string, name: string): Promise<UnitBody> {
    const meta = await fetch(`${base}/${name}.json`).then(r => r.json()) as BodyMeta;
    const [mesh, mixamo, zeroad] = await Promise.all([
      fetch(`${base}/${name}.bin`).then(r => r.arrayBuffer()),
      fetch(`${base}/${name}.anim.bin`).then(r => r.arrayBuffer()),
      meta.frames['0ad'] > 0
        ? fetch(`${base}/0ad/${name}.anim.bin`).then(r => r.arrayBuffer())
        : Promise.resolve(new ArrayBuffer(0)),
    ]);

    // --- mesh: positions, normals, colours, bone, indices, back to back
    const V = meta.verts;
    let off = 0;
    const pos = new Float32Array(mesh, off, V * 3); off += V * 12;
    const nrm = new Float32Array(mesh, off, V * 3); off += V * 12;
    const col = new Uint8Array(mesh, off, V * 4); off += V * 4;
    const bone = new Uint8Array(mesh, off, V * 4); off += V * 4;
    const idx = new Uint32Array(mesh, off, meta.indices);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 4, true));
    geometry.setAttribute('aBone', new THREE.BufferAttribute(bone, 4, false));
    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    geometry.instanceCount = 0;
    // a generous bound: a unit never leaves the tile it is drawn on by more
    // than its own height, and culling is off on the batch anyway
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, meta.height / 2, 0), meta.height);

    // --- animation: the two sources appended, 0 A.D. after Mixamo
    const width = meta.bones * 3;
    const rows = meta.frames.mixamo + meta.frames['0ad'];
    const data = new Float32Array(width * rows * 4);
    data.set(new Float32Array(mixamo), 0);
    data.set(new Float32Array(zeroad), meta.frames.mixamo * width * 4);
    const anim = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.FloatType);
    anim.magFilter = THREE.NearestFilter;
    anim.minFilter = THREE.NearestFilter;
    anim.generateMipmaps = false;
    anim.needsUpdate = true;

    const clips: Record<string, UnitClip> = {};
    for (const [clip, c] of Object.entries(meta.clips)) {
      clips[clip] = {
        start: c.source === '0ad' ? c.start + meta.frames.mixamo : c.start,
        count: c.count, fps: c.fps,
      };
    }
    return { geometry, anim, animSize: new THREE.Vector2(width, rows), clips, height: meta.height };
  }
}

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------

const VERTEX = /* glsl */`
  attribute vec4 aColor;
  attribute vec4 aBone;
  attribute vec3 iPos;
  attribute float iRot;
  attribute float iFrame;
  attribute vec3 iTint;

  uniform sampler2D uAnim;
  uniform vec2 uAnimSize;
  uniform mat4 uShadowMatrix;

  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec4 vShadowCoord;

  mat4 boneMatrix(float bone, float frame) {
    float v = (frame + 0.5) / uAnimSize.y;
    float u = (bone * 3.0 + 0.5) / uAnimSize.x;
    float du = 1.0 / uAnimSize.x;
    vec4 r0 = texture2D(uAnim, vec2(u, v));
    vec4 r1 = texture2D(uAnim, vec2(u + du, v));
    vec4 r2 = texture2D(uAnim, vec2(u + du * 2.0, v));
    // rows in, columns out
    return mat4(
      vec4(r0.x, r1.x, r2.x, 0.0),
      vec4(r0.y, r1.y, r2.y, 0.0),
      vec4(r0.z, r1.z, r2.z, 0.0),
      vec4(r0.w, r1.w, r2.w, 1.0));
  }

  void main() {
    mat4 B = boneMatrix(aBone.x, iFrame);
    vec3 p = (B * vec4(position, 1.0)).xyz;
    vec3 n = mat3(B) * normal;
    float c = cos(iRot), s = sin(iRot);
    mat3 R = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
    vec3 world = R * p + iPos;
    vNormal = R * n;
    vColor = aColor.rgb * iTint;
    vShadowCoord = uShadowMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FRAGMENT = /* glsl */`
  #include <common>
  #include <packing>
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec4 vShadowCoord;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uBounceDir;
  uniform vec3 uBounceColor;
  uniform sampler2D uShadowMap;
  uniform float uShadowSize;
  uniform float uShadowOn;

  float sunlight() {
    if (uShadowOn < 0.5) return 1.0;
    vec3 sc = vShadowCoord.xyz / vShadowCoord.w;
    if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
    float texel = 1.0 / uShadowSize;
    float lit = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        float depth = unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(dx, dy) * texel));
        lit += sc.z - 0.002 <= depth ? 1.0 : 0.0;
      }
    }
    return lit / 9.0;
  }

  void main() {
    vec3 n = normalize(vNormal);
    // the same three lights, weighted as MeshStandardMaterial weights them
    vec3 light = uSunColor * max(dot(n, uSunDir), 0.0) * sunlight()
               + mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5)
               + uBounceColor * max(dot(n, uBounceDir), 0.0);
    gl_FragColor = vec4(vColor * light / PI, 1.0);
  }
`;

const DEPTH_FRAGMENT = /* glsl */`
  #include <common>
  #include <packing>
  void main() {
    gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
  }
`;

// ---------------------------------------------------------------------------

interface Slot {
  mesh: THREE.Mesh;
  body: UnitBody;
  geometry: THREE.InstancedBufferGeometry;
  pos: THREE.InstancedBufferAttribute;
  rot: THREE.InstancedBufferAttribute;
  frame: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
  count: number;
}

/**
 * Every unit on screen this frame, by body. clear / add / flush, like the
 * sprite batch it stands beside.
 */
export class UnitBatch {
  readonly group = new THREE.Group();
  private slots = new Map<string, Slot>();
  private shared: Record<string, THREE.IUniform>;

  constructor(private lib: UnitLibrary, lighting: Lighting) {
    this.group.frustumCulled = false;
    const sunDir = lighting.sun.position.clone().normalize();
    const bounceDir = lighting.bounce.position.clone().normalize();
    const scaled = (l: THREE.Light) => l.color.clone().multiplyScalar(l.intensity);
    this.shared = {
      uSunDir: { value: sunDir },
      uSunColor: { value: scaled(lighting.sun) },
      uSkyColor: { value: scaled(lighting.sky) },
      uGroundColor: { value: lighting.sky.groundColor.clone().multiplyScalar(lighting.sky.intensity) },
      uBounceDir: { value: bounceDir },
      uBounceColor: { value: scaled(lighting.bounce) },
      uShadowMap: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowSize: { value: 1 },
      uShadowOn: { value: 0 },
    };
  }

  /** Receive the sun's shadow map; call once a frame after the light moved. */
  setShadow(light: THREE.DirectionalLight | null): void {
    const map = light?.shadow.map;
    if (!light || !map) { this.shared.uShadowOn.value = 0; return; }
    this.shared.uShadowMap.value = map.texture;
    (this.shared.uShadowMatrix.value as THREE.Matrix4).copy(light.shadow.matrix);
    this.shared.uShadowSize.value = light.shadow.mapSize.x;
    this.shared.uShadowOn.value = 1;
  }

  has(body: string): boolean { return this.lib.has(body); }

  /** The clip table of a body, for the caller to pick a frame from. */
  clip(body: string, clip: string): UnitClip | undefined {
    return this.lib.bodies.get(body)?.clips[clip];
  }

  clear(): void {
    for (const s of this.slots.values()) s.count = 0;
  }

  /**
   * One unit: `frame` is a row of the body's animation texture (see clip),
   * `heading` the world-space direction it faces in radians, as the
   * simulation keeps it.
   */
  add(body: string, frame: number, x: number, y: number, z: number, heading: number,
      tint: [number, number, number] = [1, 1, 1]): void {
    const s = this.slot(body);
    if (!s) return;
    if (s.count >= s.pos.count) this.grow(s);
    const i = s.count++;
    s.pos.setXYZ(i, x, y, z);
    // modelled facing +z; a heading h moves along (cos h, sin h) in x/z
    s.rot.setX(i, Math.PI / 2 - heading);
    s.frame.setX(i, frame);
    s.tint.setXYZ(i, tint[0], tint[1], tint[2]);
  }

  flush(): void {
    for (const s of this.slots.values()) {
      s.geometry.instanceCount = s.count;
      s.mesh.visible = s.count > 0;
      if (s.count === 0) continue;
      for (const a of [s.pos, s.rot, s.frame, s.tint]) {
        a.addUpdateRange(0, s.count * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  private slot(body: string): Slot | null {
    let s = this.slots.get(body);
    if (s) return s;
    const b = this.lib.bodies.get(body);
    if (!b) return null;
    s = this.make(body, b, 64);
    this.slots.set(body, s);
    return s;
  }

  private make(name: string, body: UnitBody, capacity: number): Slot {
    const geometry = body.geometry.clone() as THREE.InstancedBufferGeometry;
    geometry.setIndex(body.geometry.getIndex());
    const attr = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const pos = attr(3), rot = attr(1), frame = attr(1), tint = attr(3);
    geometry.setAttribute('iPos', pos);
    geometry.setAttribute('iRot', rot);
    geometry.setAttribute('iFrame', frame);
    geometry.setAttribute('iTint', tint);
    geometry.instanceCount = 0;

    const uniforms = {
      ...this.shared,
      uAnim: { value: body.anim },
      uAnimSize: { value: body.animSize },
    };
    const material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.customDepthMaterial = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader: DEPTH_FRAGMENT, side: THREE.DoubleSide,
    });
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `units:${name}`;
    this.group.add(mesh);
    return { mesh, body, geometry, pos, rot, frame, tint, count: 0 };
  }

  private grow(s: Slot): void {
    const bigger = this.make(s.mesh.name.slice(6), s.body, s.pos.count * 2);
    for (const [a, b] of [[s.pos, bigger.pos], [s.rot, bigger.rot], [s.frame, bigger.frame], [s.tint, bigger.tint]] as const) {
      (b.array as Float32Array).set(a.array as Float32Array);
    }
    bigger.count = s.count;
    this.group.remove(s.mesh);
    s.geometry.dispose();
    (s.mesh.material as THREE.Material).dispose();
    Object.assign(s, bigger);
  }
}
