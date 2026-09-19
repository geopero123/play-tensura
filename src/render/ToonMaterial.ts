import * as THREE from 'three';

/** Shared uniforms updated once per frame, referenced by every stylized material. */
export const globalUniforms = {
  uTime: { value: 0 },
  uSunDirView: { value: new THREE.Vector3(0.3, 0.8, 0.4) },
  uWindStrength: { value: 1 },
  uPlayerPos: { value: new THREE.Vector3() },
  uStorm: { value: 0 },
};

let gradientTex: THREE.DataTexture | null = null;
export function getGradientMap() {
  if (gradientTex) return gradientTex;
  // 8 texels: NdotL -1..1. Anime-style controlled bands.
  const vals = [0.36, 0.36, 0.36, 0.36, 0.36, 0.7, 1.0, 1.0];
  const data = new Uint8Array(vals.map((v) => Math.round(v * 255)));
  gradientTex = new THREE.DataTexture(data, vals.length, 1, THREE.RedFormat);
  gradientTex.minFilter = THREE.NearestFilter;
  gradientTex.magFilter = THREE.NearestFilter;
  gradientTex.generateMipmaps = false;
  gradientTex.needsUpdate = true;
  return gradientTex;
}

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
  rimPower?: number;
  specular?: number;
  /** 0..1 wind bend amount for vegetation (uses vertex y) */
  wind?: number;
  /** enable jelly deformation uniforms (slime) */
  jelly?: boolean;
  /** instanced color support */
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  map?: THREE.Texture | null;
  /** shadow tint color mixed into shaded areas (anime purple-ish shadows) */
  shadowTint?: THREE.ColorRepresentation;
  flatShading?: boolean;
  /** per-material wind phase offset */
  windScale?: number;
}

export type ToonMat = THREE.MeshToonMaterial & { u: Record<string, THREE.IUniform> };

/**
 * Anime cel-shaded material built on MeshToonMaterial with injected rim light,
 * stylized specular, hit flash, wind and jelly deformation.
 */
export function createToonMaterial(opts: ToonOptions = {}): ToonMat {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    gradientMap: getGradientMap(),
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map ?? null,
    vertexColors: opts.vertexColors ?? false,
  }) as ToonMat;

  const u: Record<string, THREE.IUniform> = {
    uRimColor: { value: new THREE.Color(opts.rimColor ?? 0xbfe8ff) },
    uRimStrength: { value: opts.rimStrength ?? 0.55 },
    uRimPower: { value: opts.rimPower ?? 3.0 },
    uSpecular: { value: opts.specular ?? 0.35 },
    uFlash: { value: 0 },
    uWind: { value: opts.wind ?? 0 },
    uWindScale: { value: opts.windScale ?? 1 },
    uSquash: { value: new THREE.Vector3(1, 1, 1) },
    uWobble: { value: 0 },
    uWobblePhase: { value: 0 },
    uShadowTint: { value: new THREE.Color(opts.shadowTint ?? 0x6a5aa8) },
    uDissolve: { value: 0 },
    uTint: { value: new THREE.Color(0xffffff) },
  };
  mat.u = u;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, globalUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform float uWind; uniform float uWindStrength; uniform float uWindScale;
        uniform vec3 uSquash; uniform float uWobble; uniform float uWobblePhase;
        varying vec3 vWorldPosT; varying vec3 vObjPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vObjPos = position;
        #ifdef USE_INSTANCING
          vec4 wpBase = modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
        #else
          vec4 wpBase = modelMatrix * vec4(0.0,0.0,0.0,1.0);
        #endif
        if (uWind > 0.0) {
          float h = max(position.y, 0.0) * uWindScale;
          float ph = wpBase.x * 0.15 + wpBase.z * 0.11 + uTime * 1.3;
          float gust = sin(ph) * 0.6 + sin(ph * 2.7 + 1.3) * 0.3 + sin(uTime * 5.0 + wpBase.x) * 0.1;
          gust *= uWindStrength;
          transformed.x += gust * uWind * h * h * 0.35;
          transformed.z += cos(ph * 0.7) * uWind * h * h * 0.12 * uWindStrength;
        }
        if (uWobble > 0.0 || uSquash.x != 1.0 || uSquash.y != 1.0) {
          float wob = uWobble * sin(position.y * 6.0 + uWobblePhase) * 0.12;
          transformed.xz *= (uSquash.x + wob);
          transformed.y *= uSquash.y;
        }`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vWorldPosT = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWorldPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRimColor; uniform float uRimStrength; uniform float uRimPower; uniform float uSpecular;
        uniform float uFlash; uniform vec3 uSunDirView; uniform vec3 uShadowTint; uniform float uDissolve; uniform vec3 uTint;
        uniform float uTime;
        varying vec3 vWorldPosT; varying vec3 vObjPos;
        float hashf(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }`
      )
      .replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>
        // stylized shadow tint: shaded regions lean toward a cool anime tone
        {
          vec3 nrm = normalize(normal);
          float ndl = dot(nrm, uSunDirView);
          float shadeMask = 1.0 - smoothstep(-0.05, 0.25, ndl);
          reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, reflectedLight.indirectDiffuse * uShadowTint * 1.6, shadeMask * 0.5);
        }`
      )
      .replace(
        '#include <output_fragment>',
        `{
          vec3 nrm = normalize(normal);
          vec3 vDir = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(dot(nrm, vDir), 0.0, 1.0), uRimPower);
          float lightFacing = clamp(dot(nrm, uSunDirView) * 0.5 + 0.5, 0.0, 1.0);
          float rim = fres * uRimStrength * (0.35 + 0.65 * lightFacing);
          outgoingLight += uRimColor * rim * diffuseColor.rgb * 1.6;
          // anime specular: hard-edged highlight
          vec3 h = normalize(uSunDirView + vDir);
          float ndh = max(dot(nrm, h), 0.0);
          float spec = smoothstep(0.86, 0.9, pow(ndh, 8.0)) * uSpecular;
          outgoingLight += vec3(spec) * (0.6 + 0.4 * diffuseColor.rgb);
          outgoingLight *= uTint;
          outgoingLight = mix(outgoingLight, vec3(1.0, 0.98, 0.95), uFlash);
          if (uDissolve > 0.0) {
            float n = hashf(floor(vObjPos * 18.0));
            if (n < uDissolve) discard;
            float edge = smoothstep(uDissolve, uDissolve + 0.12, n);
            outgoingLight = mix(vec3(1.5, 0.9, 2.0), outgoingLight, edge);
          }
        }
        #include <output_fragment>`
      );
  };
  mat.customProgramCacheKey = () => 'toon-anime-v3';
  return mat;
}

/** Inverted-hull outline material: BackSide, pushed along normals. */
export function createOutlineMaterial(thickness = 0.03, color: THREE.ColorRepresentation = 0x1a1030, opts: { jelly?: boolean; wind?: number } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const u = {
    uOutline: { value: thickness },
    uSquash: { value: new THREE.Vector3(1, 1, 1) },
    uWobble: { value: 0 },
    uWobblePhase: { value: 0 },
    uWind: { value: opts.wind ?? 0 },
    uWindScale: { value: 1 },
    uDissolve: { value: 0 },
  };
  (mat as any).u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, globalUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uOutline; uniform vec3 uSquash; uniform float uWobble; uniform float uWobblePhase;
        uniform float uTime; uniform float uWind; uniform float uWindStrength; uniform float uWindScale; varying vec3 vObjPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vObjPos = position;
        if (uWobble > 0.0 || uSquash.x != 1.0 || uSquash.y != 1.0) {
          float wob = uWobble * sin(position.y * 6.0 + uWobblePhase) * 0.12;
          transformed.xz *= (uSquash.x + wob);
          transformed.y *= uSquash.y;
        }
        transformed += normalize(normal) * uOutline;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDissolve; varying vec3 vObjPos;
        float hashf(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (uDissolve > 0.0 && hashf(floor(vObjPos * 18.0)) < uDissolve) discard;`);
  };
  mat.customProgramCacheKey = () => 'outline-v2';
  return mat as THREE.MeshBasicMaterial & { u: typeof u };
}

/** Adds an outline child mesh to a mesh using inverted hull */
export function addOutline(mesh: THREE.Mesh, thickness = 0.03, color: THREE.ColorRepresentation = 0x1a1030) {
  const outline = new THREE.Mesh(mesh.geometry, createOutlineMaterial(thickness, color));
  outline.name = 'outline';
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = -1;
  mesh.add(outline);
  return outline;
}

/** Simple unlit glow material (for VFX) with additive blending. */
export function createGlowMaterial(color: THREE.ColorRepresentation, opacity = 1, additive = true) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
