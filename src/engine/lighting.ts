import * as THREE from 'three';
import { SUN_DIRECTION, ELEVATION } from './iso';

/**
 * The sun and the sky, for the 3D world.
 *
 * The sprites carried their own light: rig.py's sun, sky and warm bounce
 * baked into every pixel. Real meshes are lit here instead, with the same
 * numbers, so that what the sun does to a keep in the engine is what it did
 * to the keep in Blender -- the direction is SUN_DIRECTION, shared with the
 * terrain's slope shading and the sprite renders, and the colours are the
 * rig's.
 *
 * One shadow map, orthographic, re-centred on the camera target every frame
 * and sized to what is on screen. The camera is orthographic too, so a single
 * cascade covers the view exactly; there is nothing far away to fade.
 */
export class Lighting {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.HemisphereLight;
  readonly bounce: THREE.DirectionalLight;

  private dir = new THREE.Vector3(...SUN_DIRECTION).normalize();

  constructor(shadowMapSize = 2048) {
    // rig.py's numbers carry straight over: Blender's sun strength is an
    // irradiance and so is three's directional intensity, both feeding a
    // Lambert term that divides by pi. The sky is different -- a world of
    // radiance L gives a surface L * albedo, a hemisphere light of intensity
    // I gives I * albedo / pi -- so the rig's 0.52 becomes 0.52 * pi.
    this.sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.935, 0.82), 4.4);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(shadowMapSize, shadowMapSize);
    sh.camera.near = 1;
    sh.camera.far = 600;
    sh.bias = -0.0006;
    sh.normalBias = 0.02;
    sh.radius = 2;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    // SKY_COLOR from above, BOUNCE_COLOR from the ground, as the rig has it.
    // The ground half is brighter and warmer than the rig's bounce colour:
    // it also stands in for the light Cycles bounced between a wall and the
    // sunlit ground under it, which no light here does.
    this.sky = new THREE.HemisphereLight(
      new THREE.Color(0.50, 0.48, 0.45), new THREE.Color(1.0, 0.80, 0.54), 2.6);
    this.group.add(this.sky);

    // The rig's bounce: warm light kicked back off hot sand, a shadowless
    // fill from the sun's side of the sky but low down, so walls the sun
    // only grazes are still warm rather than grey.
    this.bounce = new THREE.DirectionalLight(new THREE.Color(0.78, 0.63, 0.42), 2.0);
    this.bounce.position.set(this.dir.x, 0.35, this.dir.z).multiplyScalar(100);
    this.group.add(this.bounce);
    this.group.add(this.bounce.target);
  }

  /**
   * Follow the view. `target` is the ground point the camera looks at,
   * `viewW`/`viewH` the viewport in pixels and `ppu` its pixels per world
   * unit -- together the ground the screen covers, which the shadow frustum
   * must enclose as seen from the sun.
   */
  update(target: THREE.Vector3, viewW: number, viewH: number, ppu: number): void {
    const dist = 300;
    this.sun.position.set(
      target.x + this.dir.x * dist,
      target.y + this.dir.y * dist,
      target.z + this.dir.z * dist);
    this.sun.target.position.copy(target);
    this.bounce.target.position.copy(target);

    // Half the ground reach of the view along its longer axis, plus the room
    // a tall building needs to throw a shadow into it. Generous rather than
    // tight: a frustum that clips gives a hard line of missing shadow.
    const reach = Math.max(viewW, viewH / Math.sin(ELEVATION)) / ppu;
    const half = reach * 0.62 + 6;
    const cam = this.sun.shadow.camera;
    if (cam.right !== half) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
  }
}
