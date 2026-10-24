// The final look of the frame: a colour grade on the whole frame, so the bird, the props and the street
// all get the same light: cool lavender lifted into the shade, warm sun in the light (but not on the
// blue sky), a little more colour, and a warm vignette. One pass: the scene draws to a multisampled
// target, then a full-screen quad grades it to the canvas. (The three.js composer with bloom cost about
// 5 ms a frame, for a glow too faint to see at a threshold that kept the kerb from glowing.)
//
//   const grade = new Grade(renderer, scene, camera);
//   grade.render();            // in place of renderer.render(scene, camera)
//   grade.setSize(w, h);       // on resize
import { Color, ShaderMaterial, SRGBColorSpace, Vector2, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export const GRADE = {
  shade: new Color(0.50, 0.50, 0.78),   // sRGB. Dark parts lift toward this cool lavender
  lift: 0.12,                           // how far the darkest parts lift
  warm: new Color(1.06, 1.01, 0.91),    // sRGB gain on the light parts, but not on blue (the sky)
  saturation: 1.05,
  vignette: { strength: 0.22, colour: new Color(0.55, 0.38, 0.30) },   // sRGB, warm brown
};

function gradeMaterial() {
  return new ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      uShade: { value: GRADE.shade }, uLift: { value: GRADE.lift }, uWarm: { value: GRADE.warm },
      uSaturation: { value: GRADE.saturation }, uVignette: { value: GRADE.vignette.strength },
      uVignetteColour: { value: GRADE.vignette.colour }, uAspect: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tScene;
      uniform vec3 uShade, uWarm, uVignetteColour;
      uniform float uLift, uSaturation, uVignette, uAspect;
      varying vec2 vUv;
      vec3 toSrgb(vec3 c) {
        c = max(c, 0.0);
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }
      void main() {
        // The target holds linear colour. Grade in sRGB, where the steps are even to the eye; the
        // GRADE colours are sRGB. The result goes to the canvas as it is.
        vec3 c = toSrgb(texture2D(tScene, vUv).rgb);
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, uShade, uLift * (1.0 - smoothstep(0.0, 0.75, l)));
        c *= mix(vec3(1.0), uWarm, smoothstep(0.35, 0.95, l) * (1.0 - smoothstep(0.0, 0.2, c.b - c.r)));
        c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, uSaturation);
        vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
        c = mix(c, c * uVignetteColour * 1.6, uVignette * smoothstep(0.35, 0.95, length(q)));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export class Grade {
  constructor(renderer, scene, camera) {
    Object.assign(this, { renderer, scene, camera });
    // Multisampled, with a stencil buffer: the ibis outlines need it. 8-bit sRGB: the hardware encodes on
    // write and decodes on read, so the shaders still see linear colour, with even steps in the dark.
    this.target = new WebGLRenderTarget(1, 1, { colorSpace: SRGBColorSpace, samples: 4, stencilBuffer: true });
    this.quad = new FullScreenQuad(gradeMaterial());
    this.quad.material.uniforms.tScene.value = this.target.texture;
    const size = renderer.getSize(new Vector2());
    this.setSize(size.x, size.y);
  }

  setSize(w, h) {   // CSS pixels, as renderer.setSize()
    const ratio = this.renderer.getPixelRatio();
    this.target.setSize(Math.round(w * ratio), Math.round(h * ratio));
    this.quad.material.uniforms.uAspect.value = w / h;
  }

  render() {
    const { renderer } = this;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }
}
