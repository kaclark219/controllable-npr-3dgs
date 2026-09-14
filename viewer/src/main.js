import './style.css';
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

/*
 * Gaussian viewer
 */
const viewer = new GaussianSplats3D.Viewer({
  cameraUp: [0, -1, -0.6],
  initialCameraPosition: [-1, -4, 6],
  initialCameraLookAt: [0, 4, 0],

  sharedMemoryForWorkers: false,
  gpuAcceleratedSort: false,

  sphericalHarmonicsDegree: 0,
  backgroundColor: 0xffffff,

  selfDrivenMode: false,
});

window.gaussianViewer = viewer;

/*
 * Palette state
 *
 * All colors begin as white placeholders.
 * Palette mapping remains disabled until the user edits all five.
 */
const palette = Array.from(
  { length: 5 },
  () => new THREE.Vector3(1, 1, 1)
);

const paletteConfigured = Array(5).fill(false);

/*
 * Render target containing the original Gaussian scene.
 */
const renderTarget = new THREE.WebGLRenderTarget(
  window.innerWidth,
  window.innerHeight
);

/*
 * Full-screen palette shader.
 */
const postScene = new THREE.Scene();

const postCamera = new THREE.OrthographicCamera(
  -1,
  1,
  1,
  -1,
  0,
  1
);

const paletteMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: {
      value: renderTarget.texture,
    },

    palette: {
      value: palette,
    },

    /*
     * Start at zero so the original scene is displayed.
     */
    strength: {
      value: 0.0,
    },
  },

  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 palette[5];
    uniform float strength;

    varying vec2 vUv;

    void main() {
      vec4 original = texture2D(tDiffuse, vUv);

      vec3 closestColor = palette[0];

      float closestDistance = distance(
        original.rgb,
        palette[0]
      );

      for (int i = 1; i < 5; i++) {
        float candidateDistance = distance(
          original.rgb,
          palette[i]
        );

        if (candidateDistance < closestDistance) {
          closestDistance = candidateDistance;
          closestColor = palette[i];
        }
      }

      vec3 finalColor = mix(
        original.rgb,
        closestColor,
        strength
      );

      gl_FragColor = vec4(
        finalColor,
        original.a
      );
    }
  `,
});

const postQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  paletteMaterial
);

postScene.add(postQuad);

/*
 * Palette controls
 */
const controls = document.createElement('div');
controls.className = 'palette-controls';

const heading = document.createElement('div');
heading.className = 'palette-heading';
heading.textContent = 'Color Palette';

const instructions = document.createElement('div');
instructions.className = 'palette-instructions';
instructions.textContent = 'Choose all five colors to apply';

const swatchRow = document.createElement('div');
swatchRow.className = 'palette-swatches';

controls.appendChild(heading);
controls.appendChild(instructions);
controls.appendChild(swatchRow);

document.body.appendChild(controls);

const swatchInputs = [];

function updatePaletteState() {
  const configuredCount = paletteConfigured.filter(
    Boolean
  ).length;

  const paletteIsReady = paletteConfigured.every(
    Boolean
  );

  if (paletteIsReady) {
    paletteMaterial.uniforms.strength.value = 1.0;
    instructions.textContent = '';
  } else {
    paletteMaterial.uniforms.strength.value = 0.0;

    instructions.textContent =
      `Choose all five colors to apply (${configuredCount}/5)`;
  }
}

palette.forEach((_, index) => {
  const input = document.createElement('input');

  input.type = 'color';
  input.value = '#ffffff';

  input.className = 'palette-swatch';
  input.title = `Palette color ${index + 1}`;

  input.setAttribute(
    'aria-label',
    `Palette color ${index + 1}`
  );

  input.addEventListener('input', (event) => {
    const selectedColor = new THREE.Color(
      event.target.value
    );

    palette[index].set(
      selectedColor.r,
      selectedColor.g,
      selectedColor.b
    );

    /*
     * Mark this slot as configured after the user edits it.
     * The user can still choose white as an intentional color.
     */
    paletteConfigured[index] = true;

    updatePaletteState();
  });

  swatchInputs.push(input);
  swatchRow.appendChild(input);
});

updatePaletteState();

/*
 * Render loop
 */
function animate() {
  requestAnimationFrame(animate);

  viewer.update();

  /*
   * Render the original Gaussian scene into a texture.
   */
  viewer.renderer.setRenderTarget(renderTarget);
  viewer.render();

  /*
   * Render that texture through the palette shader.
   * With strength zero, the original colors pass through.
   */
  viewer.renderer.setRenderTarget(null);

  viewer.renderer.render(
    postScene,
    postCamera
  );
}

/*
 * Load scene
 */
viewer
  .addSplatScene(
    '/models/bonsai_trimmed.ksplat',
    {
      splatAlphaRemovalThreshold: 5,
      showLoadingUI: true,
      progressiveLoad: false,

      position: [0, -0.5, 0],
      rotation: [0, 0, 0, 1],
      scale: [1.5, 1.5, 1.5],
    }
  )
  .then(() => {
    console.log('Viewer ready:', viewer);
    animate();
  })
  .catch((error) => {
    console.error(
      'Could not load Bonsai:',
      error
    );
  });

/*
 * Keep the render target aligned with the browser viewport.
 */
window.addEventListener('resize', () => {
  const pixelRatio =
    viewer.renderer.getPixelRatio();

  renderTarget.setSize(
    window.innerWidth * pixelRatio,
    window.innerHeight * pixelRatio
  );
});