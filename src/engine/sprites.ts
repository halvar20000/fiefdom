import * as THREE from 'three';

export interface Frame {
  x: number; y: number; w: number; h: number;   // px in the atlas
  ax: number; ay: number;                        // anchor px, from the frame's top-left
  /**
   * Which page of the atlas holds it. The atlas is a texture ARRAY: one
   * layer would be the whole catalogue in a single 8192-high strip, and
   * that strip was full -- the fourth and fifth clip of a soldier were
   * cut for want of rows. A second page is the same texture with another
   * layer, sampled by index, so the budget is now memory rather than a
   * hardware limit. Absent means the first page.
   */
  page?: number;
  /**
   * The render scale this ONE frame was baked at, as a multiple of zoom 1.0.
   *
   * Per frame rather than per atlas because the two are genuinely allowed to
   * differ. The 0 A.D. motion clips can only be re-rendered against an archive
   * that is not vendored here, so when everything else moved to scale 3 they
   * stayed at 2; drawing them at the atlas-wide scale would have made a
   * carrying peasant half again the size of a walking one.
   */
  scale: number;
}

export interface Atlas {
  image: string;
  size: [number, number];
  scale: number;                                  // px per world unit the art was rendered at
  frames: Record<string, Frame>;
}

/**
 * A batch of pre-rendered sprites drawn as screen-aligned quads.
 *
 * The depth trick, which is the whole reason this class exists:
 * the quad is built in VIEW space around the instance's ground anchor, offset
 * only in view X/Y. Because the camera is orthographic, that leaves every
 * fragment of the sprite at exactly the ground point's depth. So the z-buffer
 * alone gives us correct painter ordering between sprites AND correct occlusion
 * behind terrain hills, with no CPU sorting and no gl_FragDepth.
 *
 * Rendering is BLENDED and writes no depth, and callers must submit sprites
 * back-to-front. A hard alpha cutout looks fine on a building's walls but
 * destroys its baked shadow: the shadow is dark pixels at ~0.75 alpha, so
 * cutting out drew it as an opaque black slab, discarded its soft edge, and --
 * because it wrote depth at the building's depth -- hid any figure standing
 * behind it. Blending renders the shadow as a shadow and lets people show
 * through it.
 */
export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  private geom: THREE.InstancedBufferGeometry;
  private material: THREE.RawShaderMaterial;

  private capacity: number;
  private count = 0;

  private aPos: THREE.InstancedBufferAttribute;
  private aRect: THREE.InstancedBufferAttribute;
  private aUV: THREE.InstancedBufferAttribute;
  private aTint: THREE.InstancedBufferAttribute;
  private aBias: THREE.InstancedBufferAttribute;
  private aPage: THREE.InstancedBufferAttribute;

  constructor(texture: THREE.DataArrayTexture, capacity: number) {
    this.capacity = capacity;

    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    base.setIndex([0, 1, 2, 0, 2, 3]);

    this.geom = new THREE.InstancedBufferGeometry();
    this.geom.index = base.index;
    this.geom.setAttribute('position', base.getAttribute('position'));

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aRect = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aUV = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aBias = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aPage = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.aPos, this.aRect, this.aUV, this.aTint, this.aBias, this.aPage]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }

    this.geom.setAttribute('iPos', this.aPos);
    this.geom.setAttribute('iRect', this.aRect);
    this.geom.setAttribute('iUV', this.aUV);
    this.geom.setAttribute('iTint', this.aTint);
    this.geom.setAttribute('iBias', this.aBias);
    this.geom.setAttribute('iPage', this.aPage);
    this.geom.instanceCount = 0;

    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uAtlas: { value: texture },
        uEpsilon: { value: 0.12 },
        // The sun's shadow map, once the 3D world is up (see setShadow). A
        // sprite carries its own baked sunlight, so a peasant standing in the
        // shadow of a wall is darkened here to what the ground under him is.
        uShadowMap: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowOn: { value: 0 },
        uShadowFloor: { value: 0.3 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        precision highp float;
        in vec3 position;
        in vec3 iPos;
        in vec4 iRect;   // left, bottom, right, top  (world units, relative to anchor)
        in vec4 iUV;     // u0, v0, du, dv
        in vec3 iTint;
        in float iBias;
        in float iPage;

        uniform mat4 modelMatrix;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        uniform float uEpsilon;
        uniform mat4 uShadowMatrix;

        out vec2 vUv;
        out vec3 vTint;
        flat out float vPage;
        flat out vec4 vShadowCoord;

        void main() {
          // one shadow sample per sprite, at the feet, lifted a little so a
          // figure on flat ground is not shadowed by that ground
          vShadowCoord = uShadowMatrix * (modelMatrix * vec4(iPos + vec3(0.0, 0.15, 0.0), 1.0));
          vec4 anchorView = modelViewMatrix * vec4(iPos, 1.0);
          // Offset purely within the view plane -> depth stays the anchor's depth.
          anchorView.x += mix(iRect.x, iRect.z, position.x);
          anchorView.y += mix(iRect.y, iRect.w, position.y);
          // Push to the depth of the footprint's nearest corner, so the sprite
          // sits in front of every ground tile it stands on rather than being
          // half-buried by the terrain drawn in front of its origin.
          anchorView.z += iBias + uEpsilon;

          // v0 is the frame's BOTTOM edge (canvas y is flipped on upload), so
          // the quad's top (position.y == 1) must map to v0 + dv, not v0.
          vUv = iUV.xy + position.xy * iUV.zw;
          vTint = iTint;
          vPage = iPage;
          gl_Position = projectionMatrix * anchorView;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        in vec2 vUv;
        in vec3 vTint;
        flat in float vPage;
        flat in vec4 vShadowCoord;
        precision highp sampler2DArray;
        uniform sampler2DArray uAtlas;
        uniform sampler2D uShadowMap;
        uniform float uShadowOn;
        uniform float uShadowFloor;
        out vec4 fragColor;

        #include <packing>

        float sunlight() {
          if (uShadowOn < 0.5) return 1.0;
          vec3 sc = vShadowCoord.xyz / vShadowCoord.w;
          if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
          float depth = unpackRGBAToDepth(texture(uShadowMap, sc.xy));
          return sc.z - 0.0015 <= depth ? 1.0 : 0.0;
        }

        void main() {
          vec4 texel = texture(uAtlas, vec3(vUv, vPage));
          // Only drop what is genuinely empty. Anything above that keeps its
          // alpha so shadows stay translucent.
          if (texel.a < 0.02) discard;
          float sun = mix(uShadowFloor, 1.0, sunlight());
          fragColor = vec4(texel.rgb * vTint * sun, texel.a);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  clear(): void { this.count = 0; }

  /** Receive the sun's shadow map; null leaves the sprites as baked. */
  setShadow(light: THREE.DirectionalLight | null): void {
    const u = this.material.uniforms;
    const map = light?.shadow.map;
    if (!light || !map) { u.uShadowOn.value = 0; return; }
    u.uShadowMap.value = map.texture;
    u.uShadowMatrix.value.copy(light.shadow.matrix);
    u.uShadowOn.value = 1;
  }

  /**
   * Queue one sprite. `worldPos` is the ground point the sprite stands on.
   * `ppu` is pixels-per-world-unit THIS FRAME was rendered at -- see
   * `Frame.scale`; callers must not assume one value for the whole atlas.
   */
  add(frame: Frame, atlasSize: [number, number], ppu: number,
      x: number, y: number, z: number, depthBias = 0,
      tint: [number, number, number] = [1, 1, 1]): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;

    this.aPos.setXYZ(i, x, y, z);

    const left = -frame.ax / ppu;
    const right = (frame.w - frame.ax) / ppu;
    const top = frame.ay / ppu;
    const bottom = -(frame.h - frame.ay) / ppu;
    this.aRect.setXYZW(i, left, bottom, right, top);

    const [aw, ah] = atlasSize;
    this.aUV.setXYZW(i, frame.x / aw, 1 - (frame.y + frame.h) / ah, frame.w / aw, frame.h / ah);

    this.aTint.setXYZ(i, tint[0], tint[1], tint[2]);
    this.aBias.setX(i, depthBias);
    this.aPage.setX(i, frame.page ?? 0);
  }

  /**
   * Push the queued instances to the GPU. Call once per frame after adding.
   *
   * Only the used prefix is uploaded. Marking the whole attribute dirty would
   * re-send the entire reserved capacity every frame -- over a megabyte per
   * frame at 20k capacity, to move a few hundred sprites.
   */
  flush(): void {
    this.geom.instanceCount = this.count;
    const n = this.count;
    for (const [attr, itemSize] of [
      [this.aPos, 3], [this.aRect, 4], [this.aUV, 4], [this.aTint, 3], [this.aBias, 1],
      [this.aPage, 1],
    ] as [THREE.InstancedBufferAttribute, number][]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * itemSize);
      attr.needsUpdate = true;
    }
  }

  get drawn(): number { return this.count; }

  dispose(): void {
    this.geom.dispose();
    this.material.dispose();
  }
}
