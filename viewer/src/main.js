import './style.css';
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

// gaussian viewer config
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

// palette state .. so the scene isn't changed until all five colors are configured
const palette = Array.from(
  { length: 5 },
  () => new THREE.Vector3(1, 1, 1)
);

const paletteConfigured = Array(5).fill(false);

// palette controls
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

// return the uniforms object for the Gaussian shader, or null if not available
function getPaletteUniforms() {
  return viewer.splatMesh?.material?.uniforms ?? null;
}

// copy palette colors from interface to the shader uniforms
function syncPaletteUniforms() {
  const uniforms = getPaletteUniforms();

  if (!uniforms) {
    return;
  }

  palette.forEach((color, index) => {
    uniforms.nprPalette.value[index].copy(color);
  });

  const paletteIsReady = paletteConfigured.every(Boolean);

  uniforms.nprPaletteEnabled.value =
    paletteIsReady ? 1 : 0;

  uniforms.nprPaletteStrength.value =
    paletteIsReady ? 1.0 : 0.0;
}

// remapping enabled after all five colors are configured
function updatePaletteState() {
  const configuredCount =
    paletteConfigured.filter(Boolean).length;

  const paletteIsReady =
    paletteConfigured.every(Boolean);

  if (paletteIsReady) {
    instructions.style.display = 'none';
  } else {
    instructions.style.display = 'block';
    instructions.textContent =
      `Choose all five colors to apply (${configuredCount}/5)`;
  }

  syncPaletteUniforms();
}

// editable color swatcches for frontend
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

    paletteConfigured[index] = true;

    updatePaletteState();
  });

  swatchRow.appendChild(input);
});

updatePaletteState();

// rendering loop
function animate() {
  requestAnimationFrame(animate);

  viewer.update();
  viewer.render();
}

// load the bonsai scene & start the viewer
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

    const uniforms = getPaletteUniforms();

    if (
      !uniforms?.nprPalette ||
      !uniforms?.nprPaletteEnabled ||
      !uniforms?.nprPaletteStrength
    ) {
      throw new Error(
        'The custom DC-palette uniforms were not found. Rebuild the local renderer.'
      );
    }

    syncPaletteUniforms();
    animate();
  })
  .catch((error) => {
    console.error(
      'Could not load Bonsai:',
      error
    );
  });