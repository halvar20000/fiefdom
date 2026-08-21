import * as THREE from 'three';

export interface Frame {
  x: number; y: number; w: number; h: number;   // px in the atlas
  ax: number; ay: number;                        // anchor px, from the frame's top-left
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

  constructor(texture: THREE.Texture, capacity: number) {
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
    for (const a of [this.aPos, this.aRect, this.aUV, this.aTint, this.aBias]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }

    this.geom.setAttribute('iPos', this.aPos);
    this.geom.setAttribute('iRect', this.aRect);
    this.geom.setAttribute('iUV', this.aUV);
    this.geom.setAttribute('iTint', this.aTint);
    this.geom.setAttribute('iBias', this.aBias);
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

        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        uniform float uEpsilon;

        out vec2 vUv;
        out vec3 vTint;

        void main() {
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
          gl_Position = projectionMatrix * anchorView;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        in vec2 vUv;
        in vec3 vTint;
        uniform sampler2D uAtlas;
        out vec4 fragColor;

        void main() {
          vec4 texel = texture(uAtlas, vUv);
          // Only drop what is genuinely empty. Anything above that keeps its
          // alpha so shadows stay translucent.
          if (texel.a < 0.02) discard;
          fragColor = vec4(texel.rgb * vTint, texel.a);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  clear(): void { this.count = 0; }

  /**
   * Queue one sprite. `worldPos` is the ground point the sprite stands on.
   * `ppu` is pixels-per-world-unit the atlas was rendered at.
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
