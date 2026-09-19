import * as THREE from 'three';
import { HEIGHT_STEP, SUN_DIRECTION } from './iso';
import type { GroundArrays } from './assets';
import type { Lighting } from './lighting';

export interface TerrainOptions {
  width: number;
  height: number;
  /** Number of texture-array layers, i.e. types * variants. */
  layers: number;
}

/**
 * Stepped isometric terrain.
 *
 * Corner heights are integers (elevation steps), so the ground tiers the way
 * Stronghold's does rather than rolling smoothly. Each tile carries its own
 * texture-array layer and a random UV orientation; without that last part,
 * 40,000 tiles of the same four sand variants read as obvious wallpaper.
 *
 * Tile textures already have the sun baked in (they are rendered top-down
 * through the same Blender rig), so flat ground needs no further lighting.
 * Slopes get a lambert term normalised so that flat ground comes out at
 * exactly 1.0 and therefore matches the baked result seamlessly.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly width: number;
  readonly height: number;

  /** Corner heights in steps, (width+1) * (height+1). */
  readonly corners: Int16Array;
  /** Texture-array layer per tile. */
  readonly layer: Uint8Array;

  private geometry: THREE.BufferGeometry;
  private material: THREE.RawShaderMaterial;
  private positions: Float32Array;
  private normals: Float32Array;
  private overlayData!: Uint8Array<ArrayBuffer>;
  private overlayTex!: THREE.DataTexture;

  constructor(opts: TerrainOptions, texture: THREE.DataArrayTexture) {
    this.width = opts.width;
    this.height = opts.height;
    this.corners = new Int16Array((opts.width + 1) * (opts.height + 1));
    this.layer = new Uint8Array(opts.width * opts.height);

    const tiles = opts.width * opts.height;
    this.positions = new Float32Array(tiles * 4 * 3);
    this.normals = new Float32Array(tiles * 4 * 3);
    const uvs = new Float32Array(tiles * 4 * 2);
    const layers = new Float32Array(tiles * 4);
    const tints = new Float32Array(tiles * 4);
    const tileCoords = new Float32Array(tiles * 4 * 2);
    const indices = new Uint32Array(tiles * 6);

    // four UV orientations, chosen per tile to break up repetition
    const orientations = [
      [0, 0, 1, 0, 1, 1, 0, 1],
      [1, 0, 1, 1, 0, 1, 0, 0],
      [1, 1, 0, 1, 0, 0, 1, 0],
      [0, 1, 0, 0, 1, 0, 1, 1],
    ];

    for (let z = 0; z < opts.height; z++) {
      for (let x = 0; x < opts.width; x++) {
        const t = z * opts.width + x;
        const v = t * 4;

        const o = orientations[(x * 7 + z * 13 + ((x * z) & 3)) & 3];
        for (let k = 0; k < 4; k++) {
          uvs[v * 2 + k * 2] = o[k * 2];
          uvs[v * 2 + k * 2 + 1] = o[k * 2 + 1];
        }

        // Small per-tile brightness variation. Four texture variants alone
        // still read as wallpaper over a 200x200 map; this is what makes a
        // large expanse of one ground type look like ground.
        //
        // The hash needs a real avalanche step. A plain (x*A ^ z*B) >> shift
        // correlates hard along diagonals and paints an obvious plaid across
        // the desert -- worse than the flatness it was meant to fix.
        let hv = (x * 374761393 + z * 668265263) | 0;
        hv = Math.imul(hv ^ (hv >>> 13), 1274126177);
        hv = (hv ^ (hv >>> 16)) >>> 0;
        const jitter = 0.96 + (hv / 4294967295) * 0.08;
        for (let k = 0; k < 4; k++) tints[v + k] = jitter;

        // Same value on all four verts: interpolating world position instead
        // would land edge fragments in the neighbouring tile.
        for (let k = 0; k < 4; k++) {
          tileCoords[(v + k) * 2] = x;
          tileCoords[(v + k) * 2 + 1] = z;
        }

        const i = t * 6;
        indices[i] = v; indices[i + 1] = v + 2; indices[i + 2] = v + 1;
        indices[i + 3] = v; indices[i + 4] = v + 3; indices[i + 5] = v + 2;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
    this.geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
    this.geometry.setAttribute('aTile', new THREE.BufferAttribute(tileCoords, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    const sun = new THREE.Vector3(...SUN_DIRECTION).normalize();

    // Build-mode overlay: one byte per tile, 0 = illegal, 255 = legal.
    // Explicit ArrayBuffer: DataTexture wants Uint8Array<ArrayBuffer>, and the
    // default Uint8Array generic widens to ArrayBufferLike.
    this.overlayData = new Uint8Array(new ArrayBuffer(opts.width * opts.height));
    this.overlayTex = new THREE.DataTexture(
      this.overlayData, opts.width, opts.height,
      THREE.RedFormat, THREE.UnsignedByteType);
    this.overlayTex.minFilter = THREE.NearestFilter;
    this.overlayTex.magFilter = THREE.NearestFilter;
    this.overlayTex.needsUpdate = true;

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uTiles: { value: texture },
        uSun: { value: sun },
        // flat ground already carries the baked sun, so normalise against it
        uFlatDot: { value: Math.max(0.001, sun.y) },
        uAmbient: { value: 0.34 },
        uOverlay: { value: this.overlayTex },
        uOverlayOn: { value: 0 },
        // The sun's shadow map (see setShadow). Off until the 3D world is up.
        uShadowMap: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowSize: { value: 1 },
        uShadowOn: { value: 0 },
        uShadowFloor: { value: 0.3 },
        // The 3D ground: unlit colour and normal tiles, lit here with the
        // scene's own lights (see setGround). Off, the baked tiles draw.
        uGround: { value: null },
        uGroundNrm: { value: null },
        uGroundOn: { value: 0 },
        uGroundSpan: { value: 4 },
        uVariants: { value: 4 },
        uSunColor: { value: new THREE.Vector3() },
        uSkyColor: { value: new THREE.Vector3() },
        uGroundColor: { value: new THREE.Vector3() },
        uBounceDir: { value: new THREE.Vector3(0, 1, 0) },
        uBounceColor: { value: new THREE.Vector3() },
        uTypeGain: { value: Array.from({ length: 16 }, () => new THREE.Vector3(1, 1, 1)) },
      },
      vertexShader: /* glsl */`
        precision highp float;
        in vec3 position;
        in vec3 normal;
        in vec2 uv;
        in float aLayer;
        in float aTint;
        in vec2 aTile;

        uniform mat4 modelMatrix;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        uniform mat4 uShadowMatrix;

        out vec2 vUv;
        out float vLayer;
        out float vTint;
        out vec2 vTile;
        out vec3 vNormal;
        out vec4 vShadowCoord;
        out vec3 vWorld;

        void main() {
          vUv = uv;
          vLayer = aLayer;
          vTint = aTint;
          vTile = aTile;
          vNormal = normal;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vShadowCoord = uShadowMatrix * world;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        precision highp sampler2DArray;

        in vec2 vUv;
        in float vLayer;
        in float vTint;
        in vec2 vTile;
        in vec3 vNormal;
        in vec4 vShadowCoord;
        in vec3 vWorld;

        uniform sampler2DArray uGround;
        uniform sampler2DArray uGroundNrm;
        uniform float uGroundOn;
        uniform float uGroundSpan;
        uniform float uVariants;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uGroundColor;
        uniform vec3 uBounceDir;
        uniform vec3 uBounceColor;
        uniform vec3 uTypeGain[16];

        uniform sampler2DArray uTiles;
        uniform vec3 uSun;
        uniform float uFlatDot;
        uniform float uAmbient;
        uniform sampler2D uOverlay;
        uniform float uOverlayOn;
        uniform sampler2D uShadowMap;
        uniform float uShadowSize;
        uniform float uShadowOn;
        uniform float uShadowFloor;

        out vec4 fragColor;

        #include <packing>

        // How much of the sun reaches this point, 0..1, from the sun's depth
        // map. A 3x3 tap: the buildings get three.js's own soft filter, and
        // the ground under them should not look sharper than they do.
        float sunlight() {
          if (uShadowOn < 0.5) return 1.0;
          vec3 sc = vShadowCoord.xyz / vShadowCoord.w;
          if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
          float texel = 1.0 / uShadowSize;
          float lit = 0.0;
          for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
              float depth = unpackRGBAToDepth(texture(uShadowMap, sc.xy + vec2(dx, dy) * texel));
              lit += sc.z - 0.0012 <= depth ? 1.0 : 0.0;
            }
          }
          return lit / 9.0;
        }

        void main() {
          vec3 colour;
          if (uGroundOn > 0.5) {
            // The 3D ground. A tile samples its own patch of the 4x4-tile
            // texture by world position, so a block is seamless; the bump
            // is a tangent-space normal map on the face normal, tangent
            // along +x and bitangent along -z as the bake plane had them.
            float type = floor(vLayer / uVariants + 0.001);
            vec2 guv = vec2(vWorld.x, -vWorld.z) / uGroundSpan;
            vec3 albedo = texture(uGround, vec3(guv, type)).rgb * vTint * uTypeGain[int(type)];
            vec3 nts = texture(uGroundNrm, vec3(guv, type)).xyz * 2.0 - 1.0;
            vec3 N = normalize(vNormal);
            vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
            vec3 B = cross(N, T);
            vec3 n = normalize(T * nts.x + B * nts.y + N * nts.z);
            // the same three lights, weighted as the buildings' material
            // weights them
            vec3 light = uSunColor * max(dot(n, uSun), 0.0) * sunlight()
                       + mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5)
                       + uBounceColor * max(dot(n, uBounceDir), 0.0);
            colour = albedo * light / 3.14159265;
          } else {
            vec3 texel = texture(uTiles, vec3(vUv, vLayer)).rgb;

            // Slope shading only. Flat ground evaluates to exactly 1.0 so it
            // matches the sun already baked into the tile render -- and the
            // baked sun is then taken away again wherever a building stands
            // between the ground and it.
            vec3 n = normalize(vNormal);
            float lit = max(dot(n, uSun), 0.0);
            float sun = mix(uShadowFloor, 1.0, sunlight());
            float shade = (uAmbient + (1.0 - uAmbient) * (lit / uFlatDot)) * sun;

            colour = texel * vTint * clamp(shade, 0.0, 1.6);
          }

          // In build mode, wash legal ground green and mute everything else, so
          // the eye finds the buildable strip instead of hunting tile by tile.
          if (uOverlayOn > 0.5) {
            float legal = texelFetch(uOverlay, ivec2(vTile), 0).r;
            float grey = dot(colour, vec3(0.299, 0.587, 0.114));
            // Illegal ground: desaturated and a little darker, but still clearly
            // readable. Crushing it to near-black made the map unusable rather
            // than clearer.
            vec3 muted = mix(colour, vec3(grey), 0.55) * 0.78;
            vec3 lit = colour * 1.10 + vec3(0.00, 0.17, 0.02);
            colour = mix(muted, lit, legal);
          }

          fragColor = vec4(colour, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  cornerHeight(x: number, z: number): number {
    const cx = Math.min(this.width, Math.max(0, x));
    const cz = Math.min(this.height, Math.max(0, z));
    return this.corners[cz * (this.width + 1) + cx];
  }

  setCorner(x: number, z: number, h: number): void {
    if (x < 0 || z < 0 || x > this.width || z > this.height) return;
    this.corners[z * (this.width + 1) + x] = h;
  }

  /** Ground height in world units at a tile centre. */
  heightAt(x: number, z: number): number {
    const tx = Math.min(this.width - 1, Math.max(0, Math.floor(x)));
    const tz = Math.min(this.height - 1, Math.max(0, Math.floor(z)));
    const h = (this.cornerHeight(tx, tz) + this.cornerHeight(tx + 1, tz) +
               this.cornerHeight(tx + 1, tz + 1) + this.cornerHeight(tx, tz + 1)) / 4;
    return h * HEIGHT_STEP;
  }

  /** Rebuild vertex positions, normals and layers from the current data. */
  rebuild(): void {
    const { width, height } = this;
    const pos = this.positions;
    const nrm = this.normals;
    const layers = this.geometry.getAttribute('aLayer') as THREE.BufferAttribute;
    const layerArr = layers.array as Float32Array;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const n = new THREE.Vector3();

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const t = z * width + x;
        const v = t * 4;

        const h00 = this.cornerHeight(x, z) * HEIGHT_STEP;
        const h10 = this.cornerHeight(x + 1, z) * HEIGHT_STEP;
        const h11 = this.cornerHeight(x + 1, z + 1) * HEIGHT_STEP;
        const h01 = this.cornerHeight(x, z + 1) * HEIGHT_STEP;

        pos[v * 3 + 0] = x;     pos[v * 3 + 1] = h00; pos[v * 3 + 2] = z;
        pos[v * 3 + 3] = x + 1; pos[v * 3 + 4] = h10; pos[v * 3 + 5] = z;
        pos[v * 3 + 6] = x + 1; pos[v * 3 + 7] = h11; pos[v * 3 + 8] = z + 1;
        pos[v * 3 + 9] = x;     pos[v * 3 + 10] = h01; pos[v * 3 + 11] = z + 1;

        // one flat normal for the whole tile keeps the faceted, tiered look
        a.set(x, h00, z);
        b.set(x + 1, h10, z);
        c.set(x, h01, z + 1);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        n.crossVectors(ac, ab).normalize();
        if (n.y < 0) n.negate();

        for (let k = 0; k < 4; k++) {
          nrm[v * 3 + k * 3] = n.x;
          nrm[v * 3 + k * 3 + 1] = n.y;
          nrm[v * 3 + k * 3 + 2] = n.z;
          layerArr[v + k] = this.layer[t];
        }
      }
    }

    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('normal').needsUpdate = true;
    layers.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /**
   * Switch to the lit ground: unlit colour and normal tiles, and the lights
   * to shade them with -- the scene's, so the ground and the buildings on
   * it agree about where the sun is and how bright.
   */
  setGround(ground: GroundArrays, lighting: Lighting, variants: number,
            oldMean: (type: string) => [number, number, number]): void {
    const u = this.material.uniforms;
    u.uGround.value = ground.colour;
    u.uGroundNrm.value = ground.normal;
    u.uGroundSpan.value = ground.span;
    u.uVariants.value = variants;
    const scaled = (l: THREE.Light) => new THREE.Vector3(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity);
    u.uSunColor.value = scaled(lighting.sun);
    u.uSkyColor.value = scaled(lighting.sky);
    const g = lighting.sky.groundColor;
    u.uGroundColor.value = new THREE.Vector3(g.r, g.g, g.b).multiplyScalar(lighting.sky.intensity);
    u.uBounceColor.value = scaled(lighting.bounce);
    u.uBounceDir.value = lighting.bounce.position.clone().normalize();

    // Calibrate each ground type to the tile it replaces. Cycles lit these
    // materials through a bump the size of a grass tuft, which takes half
    // the light off a lawn in a way no filtered normal map can repeat; so
    // the gain that makes flat, sunlit, unshadowed ground average exactly
    // what the old tile averaged is measured here, per type and channel.
    const up = new THREE.Vector3(0, 1, 0);
    const sun = new THREE.Vector3(...SUN_DIRECTION).normalize();
    const flat = new THREE.Vector3()
      .addScaledVector(u.uSunColor.value, Math.max(0, up.dot(sun)))
      .add(u.uSkyColor.value)
      .addScaledVector(u.uBounceColor.value, Math.max(0, up.dot(u.uBounceDir.value)))
      .multiplyScalar(1 / Math.PI);
    const gains = u.uTypeGain.value as THREE.Vector3[];
    ground.types.forEach((type, i) => {
      const want = oldMean(type);
      const have = ground.means[i];
      gains[i].set(
        want[0] / Math.max(1e-4, have[0] * flat.x),
        want[1] / Math.max(1e-4, have[1] * flat.y),
        want[2] / Math.max(1e-4, have[2] * flat.z));
    });
    u.uGroundOn.value = 1;
  }

  /**
   * Receive the sun's shadow map. Call once a frame after the light has been
   * updated; the map is only allocated by the renderer's first shadow pass,
   * so a null is expected on the first call and simply leaves shadows off.
   */
  setShadow(light: THREE.DirectionalLight | null): void {
    const u = this.material.uniforms;
    const map = light?.shadow.map;
    if (!light || !map) { u.uShadowOn.value = 0; return; }
    u.uShadowMap.value = map.texture;
    u.uShadowMatrix.value.copy(light.shadow.matrix);
    u.uShadowSize.value = light.shadow.mapSize.x;
    u.uShadowOn.value = 1;
  }

  /**
   * Mark which tiles are legal for the currently selected building.
   * `test` is called once per tile; pass null to turn the overlay off.
   */
  setOverlay(test: ((x: number, z: number) => boolean) | null): void {
    if (!test) {
      this.material.uniforms.uOverlayOn.value = 0;
      return;
    }
    const { width, height } = this;
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        this.overlayData[z * width + x] = test(x, z) ? 255 : 0;
      }
    }
    this.overlayTex.needsUpdate = true;
    this.material.uniforms.uOverlayOn.value = 1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.overlayTex.dispose();
  }
}
