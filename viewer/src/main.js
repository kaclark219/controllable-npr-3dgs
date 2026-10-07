import './style.css';

import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

// app shell
document.title = 'Artist-Directed 3DGS';

const app = document.createElement('main');
app.className = 'app-shell';

const viewerPane = document.createElement('section');
viewerPane.className = 'viewer-pane';
viewerPane.setAttribute('aria-label', '3D Gaussian scene viewer');

const controlPanel = document.createElement('aside');
controlPanel.className = 'control-panel';
controlPanel.setAttribute('aria-label', 'Appearance controls');

app.append(viewerPane, controlPanel);
document.body.appendChild(app);

// gaussian viewer
const viewer = new GaussianSplats3D.Viewer({
  rootElement: viewerPane,
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

const originalScenePath = '/models/garden.ksplat';

const palette = Array.from(
  { length: 5 },
  () => new THREE.Vector3(1, 1, 1)
);

const paletteConfigured = Array(5).fill(false);

function getPaletteUniforms() {
  return viewer.splatMesh?.material?.uniforms ?? null;
}

function syncPaletteUniforms() {
  const uniforms = getPaletteUniforms();

  if (!uniforms) {
    return;
  }

  palette.forEach((color, index) => {
    uniforms.nprPalette.value[index].copy(color);
  });

  const paletteIsReady = paletteConfigured.every(Boolean);

  uniforms.nprPaletteEnabled.value = paletteIsReady ? 1 : 0;
  uniforms.nprPaletteStrength.value = paletteIsReady ? 1.0 : 0.0;
}

// controls
const title = document.createElement('h1');
title.textContent = 'Appearance Controls';
controlPanel.appendChild(title);

function createControlGroup(labelText, className = '') {
  const group = document.createElement('section');
  group.className = `control-group ${className}`.trim();

  const label = document.createElement('label');
  label.className = 'control-label';
  label.textContent = labelText;

  group.appendChild(label);
  controlPanel.appendChild(group);

  return { group, label };
}

// preset dropdown
const presetControl = createControlGroup('Style Preset');

const presetSelect = document.createElement('select');
presetSelect.className = 'preset-select';
presetSelect.setAttribute('aria-label', 'Style preset');

[
  'None',
  'Impressionism',
  'Watercolor',
  'Oil Paint',
  'Woodblock',
].forEach((name) => {
  const option = document.createElement('option');

  option.value = name
    .toLowerCase()
    .replaceAll(' ', '-');

  option.textContent = name;

  presetSelect.appendChild(option);
});

presetControl.group.appendChild(presetSelect);
const stylePresets = {
  impressionism: {
    palette: [
      '#334c5c',
      '#708c69',
      '#d6ac67',
      '#cc7861',
      '#eee0bd',
    ],
    abstraction: 20,
    strokeScale: 35,
    directionality: 15,
    density: 30,
    elongation: 35,
  },

  watercolor: {
    palette: [
      '#526d82',
      '#8ba6b2',
      '#b8cdd0',
      '#dbcdbd',
      '#f0e9df',
    ],
    abstraction: 10,
    strokeScale: 20,
    directionality: 10,
    density: 5,
    elongation: 15,
  },

  'oil-paint': {
    palette: [
      '#302219',
      '#65492f',
      '#917044',
      '#bd895f',
      '#e3c49b',
    ],
    abstraction: 15,
    strokeScale: 50,
    directionality: 25,
    density: 65,
    elongation: 60,
  },

  woodblock: {
    palette: [
      '#17191c',
      '#243c5a',
      '#963735',
      '#bd8250',
      '#eee0bd',
    ],
    abstraction: 55,
    strokeScale: 35,
    directionality: 75,
    density: 70,
    elongation: 45,
  },
};

// color palette
const paletteControl = createControlGroup(
  'Color Palette',
  'palette-group'
);

const swatchRow = document.createElement('div');
swatchRow.className = 'palette-swatches';
swatchRow.setAttribute('role', 'group');
paletteControl.group.appendChild(swatchRow);

function resetPalette() {
  palette.forEach((color, index) => {
    color.set(1, 1, 1);
    paletteConfigured[index] = false;

    const swatch = swatchRow.children[index];
    swatch.value = '#d9d9d9';
    swatch.classList.remove('is-configured');
  });

syncPaletteUniforms();
}

palette.forEach((_, index) => {
  const input = document.createElement('input');

  input.type = 'color';
  input.value = '#d9d9d9';
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
    input.classList.add('is-configured');

syncPaletteUniforms();
  });

  swatchRow.appendChild(input);
});

// sliders
function createRangeControl(labelText, initialValue) {
  const { group, label } = createControlGroup(
    labelText,
    'range-group'
  );

  const row = document.createElement('div');
  row.className = 'range-row';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.value = String(initialValue);
  input.className = 'range-input';
  input.setAttribute('aria-label', labelText);

  const valueInput = document.createElement('input');
  valueInput.type = 'number';
  valueInput.min = '0';
  valueInput.max = '100';
  valueInput.step = 'any';
  valueInput.value = String(initialValue);
  valueInput.className = 'range-value';
  valueInput.setAttribute('aria-label', `${labelText} percentage`);

  const percent = document.createElement('span');
  percent.className = 'range-unit';
  percent.textContent = '%';

  input.addEventListener('input', () => {
    valueInput.value = input.value;
  });

  valueInput.addEventListener('input', () => {
    if (valueInput.value === '') return;

    const value = Number(valueInput.value);
    if (Number.isFinite(value)) {
      input.value = String(Math.max(0, Math.min(100, Math.round(value))));
    }
  });

  valueInput.addEventListener('change', () => {
    valueInput.value = input.value;
  });

  const controlId =
    `control-${labelText
      .toLowerCase()
      .replaceAll(' ', '-')}`;

  label.htmlFor = controlId;
  input.id = controlId;

  row.append(input, valueInput, percent);
  group.appendChild(row);

  return input;
}

const abstractionInput =
createRangeControl('Abstraction', 0);

const strokeScaleInput =
createRangeControl('Stroke Scale', 0);

const directionalityInput =
createRangeControl('Directionality', 0);

const densityInput =
createRangeControl('Density', 0);

const elongationInput =
createRangeControl('Elongation', 0);

function resetSliders() {
  [
    abstractionInput,
    strokeScaleInput,
    directionalityInput,
    densityInput,
    elongationInput,
  ].forEach((input) => {
    input.value = '0';

    input.dispatchEvent(
      new Event('input', {
        bubbles: true,
      })
    );
  });
}

function syncStrokeScale() {
  if (!viewer.splatMesh?.material) {
    return;
  }

  const sliderValue =
Number(strokeScaleInput.value) / 100;

  const strokeScale = THREE.MathUtils.lerp(
    1.0,
    3.0,
    sliderValue
  );

  viewer.splatMesh.setNprStrokeScale(
    strokeScale
  );
}

strokeScaleInput.addEventListener(
  'input',
  syncStrokeScale
);

function syncDirectionality() {
  if (!viewer.splatMesh?.material) {
    return;
  }

  const directionality =
Number(directionalityInput.value) / 100;

  viewer.splatMesh.setNprDirectionality(
    directionality
  );
}

directionalityInput.addEventListener(
  'input',
  syncDirectionality
);

function syncDensity() {
  if (!viewer.splatMesh?.material) {
    return;
  }

  const density =
Number(densityInput.value) / 100;

  viewer.splatMesh.setNprDensity(
    density
  );
}

densityInput.addEventListener(
  'input',
  syncDensity
);

function syncAbstraction() {
  if (!viewer.splatMesh?.material) {
    return;
  }

  const abstraction =
Number(abstractionInput.value) / 100;

  viewer.splatMesh.setNprAbstraction(
    abstraction
  );
}

abstractionInput.addEventListener(
  'input',
  syncAbstraction
);

function syncElongation() {
  if (!viewer.splatMesh?.material) {
    return;
  }

  const elongation =
Number(elongationInput.value) / 100;

  viewer.splatMesh.setNprElongation(
    elongation
  );
}

elongationInput.addEventListener(
  'input',
  syncElongation
);

function setSliderValue(input, value) {
  input.value = String(value);

  input.dispatchEvent(
    new Event('input', {
      bubbles: true,
    })
  );
}

function applyPreset(presetName) {
  if (presetName === 'none') {
resetPalette();
resetSliders();
    return;
  }

  const preset = stylePresets[presetName];

  if (!preset) {
    return;
  }

  preset.palette.forEach((hexColor, index) => {
    const swatch = swatchRow.children[index];

    swatch.value = hexColor;

    swatch.dispatchEvent(
      new Event('input', {
        bubbles: true,
      })
    );
  });

setSliderValue(
    abstractionInput,
    preset.abstraction
  );

setSliderValue(
    strokeScaleInput,
    preset.strokeScale
  );

setSliderValue(
    directionalityInput,
    preset.directionality
  );

setSliderValue(
  densityInput,
  preset.density
);

setSliderValue(
  elongationInput,
  preset.elongation
);
}

presetSelect.addEventListener('change', () => {
applyPreset(presetSelect.value);
});

// file controls
const actionRow = document.createElement('div');
actionRow.className = 'action-row';

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.ksplat,.splat,.ply';
fileInput.hidden = true;

const selectFileButton =
  document.createElement('button');

selectFileButton.type = 'button';
selectFileButton.className = 'action-button';
selectFileButton.textContent = 'Select File';

selectFileButton.addEventListener('click', () => {
  fileInput.click();
});

const clearSceneButton =
  document.createElement('button');

clearSceneButton.type = 'button';
clearSceneButton.className = 'action-button';
clearSceneButton.textContent = 'Reset Scene';

actionRow.append(
  selectFileButton,
  clearSceneButton,
  fileInput
);

controlPanel.appendChild(actionRow);

async function removeCurrentScene() {
  const sceneCount =
    viewer.splatMesh?.scenes?.length ?? 0;

  if (sceneCount === 0) {
    return;
  }

  const sceneIndexes = Array.from(
    { length: sceneCount },
    (_, index) => index
  );

  await viewer.removeSplatScenes(
    sceneIndexes,
    true
  );
}

async function loadScene(path) {
  await viewer.addSplatScene(path, {
    splatAlphaRemovalThreshold: 5,
    showLoadingUI: true,
    progressiveLoad: false,
    position: [0, -0.5, 0],
    rotation: [0, 0, 0, 1],
    scale: [1.5, 1.5, 1.5],
  });

  const uniforms = getPaletteUniforms();

  if (
    !uniforms?.nprPalette ||
    !uniforms?.nprPaletteEnabled ||
    !uniforms?.nprPaletteStrength
  ) {
    throw new Error(
      'The custom DC-palette uniforms were not found. ' +
      'Rebuild the local renderer.'
    );
  }

  syncPaletteUniforms();
  syncStrokeScale();
  syncDirectionality();
  syncDensity();
  syncAbstraction();
  syncElongation();
}

async function resetScene() {
  await removeCurrentScene();

  presetSelect.value = 'none';

  resetPalette();
  resetSliders();

  await loadScene(originalScenePath);
}

fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files;

  if (!file) {
    return;
  }

  selectFileButton.disabled = true;
  clearSceneButton.disabled = true;

  const objectUrl = URL.createObjectURL(file);

  try {
    await removeCurrentScene();
    await loadScene(objectUrl);
  } catch (error) {
    console.error(
      'Could not load selected scene:',
      error
    );
  } finally {
    URL.revokeObjectURL(objectUrl);

    selectFileButton.disabled = false;
    clearSceneButton.disabled = false;
    fileInput.value = '';
  }
});

clearSceneButton.addEventListener(
  'click',
  async () => {
    clearSceneButton.disabled = true;
    selectFileButton.disabled = true;

    try {
      await resetScene();
    } catch (error) {
      console.error(
        'Could not reset scene:',
        error
      );
    } finally {
      clearSceneButton.disabled = false;
      selectFileButton.disabled = false;
    }
  }
);

syncPaletteUniforms();

// render loop
function animate() {
  requestAnimationFrame(animate);

  viewer.update();
  viewer.render();
}

clearSceneButton.disabled = true;
selectFileButton.disabled = true;

loadScene(originalScenePath)
  // .then(() => {
  //   console.log('Viewer ready:', viewer);
  //   animate();
  // })
  .then(async () => {
    console.log('Viewer ready:', viewer);
    animate();

    if (new URLSearchParams(window.location.search).get('evaluate') === '1') {
      viewerPane.style.width = '1280px';
      viewerPane.style.height = '720px';
      viewerPane.style.flex = 'none';
      viewerPane.style.minWidth = '1280px';
      viewerPane.style.minHeight = '720px';
      viewerPane.style.maxWidth = 'none';
      viewerPane.style.maxHeight = 'none';

      const { runControlFidelity } = await import('./control-fidelity.js');
      window.controlFidelityResult = await runControlFidelity({
        THREE,
        viewer,
        config: {
          buildId: 'eval-garden-view03-2026-10-07',
          seed: 219,
        },
      });
    }
  })
  .catch((error) => {
    console.error(
      'Could not load scene:',
      error
    );
  })
  .finally(() => {
    clearSceneButton.disabled = false;
    selectFileButton.disabled = false;
  });
