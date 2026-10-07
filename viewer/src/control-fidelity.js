export const DEFAULT_CONFIG = {
  seed: 219,
  width: 1280,
  height: 720,
  sampleCount: 4096,
  settleFrames: 45,
  warmupFrames: 180,
  stabilityTolerance: 0.002,
  buildId: 'eval',
  controls: [
    'strokeScale',
    'elongation',
    'directionality',
    'abstraction',
    'density',
  ],
  levels: Array.from({ length: 11 }, (_, i) => i * 10),
  views: [{ id: 'view-3',
            position: [5.136272095411758, 4.886444035714771, -6.172185581703447],
            lookAt: [1.7344551866246267, 1.7579636808712409, 5.6447655130073],
            up: [0, -0.8574929257125443, -0.5144957554275266], 
          }],
  scenes: [{ id: 'current' }],
  palettes: [
    {
      id: 'cool',
      colors: ['#526d82', '#8ba6b2', '#b8cdd0', '#dbcdbd', '#f0e9df'],
    },
    {
      id: 'warm',
      colors: ['#302219', '#65492f', '#917044', '#bd895f', '#e3c49b'],
    },
    {
      id: 'contrast',
      colors: ['#17191c', '#243c5a', '#963735', '#bd8250', '#eee0bd'],
    },
  ],
};

const names = {
  strokeScale: 'nprStrokeScale',
  elongation: 'nprElongation',
  directionality: 'nprDirectionality',
  abstraction: 'nprAbstraction',
  density: 'nprDensity',
};

export function rng(seed) {
  let a = seed >>> 0;

  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(values, seed) {
  const a = [...values];
  const random = rng(seed);

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

export function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  return n % 2
    ? sorted[n >> 1]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function ranks(values) {
  const indices = values
    .map((_, i) => i)
    .sort((i, j) => values[i] - values[j]);

  const result = [];

  for (let i = 0; i < indices.length;) {
    let j = i + 1;

    while (
      j < indices.length &&
      values[indices[j]] === values[indices[i]]
    ) {
      j++;
    }

    for (let k = i; k < j; k++) {
      result[indices[k]] = (i + j - 1) / 2;
    }

    i = j;
  }

  return result;
}

export function spearman(x, y) {
  if (
    x.length !== y.length ||
    x.length < 2 ||
    [...x, ...y].some(value => !Number.isFinite(value))
  ) {
    return null;
  }

  const a = ranks(x);
  const b = ranks(y);
  const mean = values =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  const meanA = mean(a);
  const meanB = mean(b);

  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;

  a.forEach((value, i) => {
    numerator += (value - meanA) * (b[i] - meanB);
    varianceA += (value - meanA) ** 2;
    varianceB += (b[i] - meanB) ** 2;
  });

  return varianceA && varianceB
    ? numerator / Math.sqrt(varianceA * varianceB)
    : null;
}

export function makePlan(config) {
  const plan = [];

  for (const control of config.controls) {
    for (const level of config.levels) {
      const values = {
        strokeScale: 0,
        elongation: 0,
        directionality: 0,
        abstraction: 0,
        density: 0,
      };

      if (control === 'directionality') {
        values.elongation = 50;
      }

      values[control] = level;

      plan.push({
        id: `${control}-${level}`,
        kind: 'sweep',
        control,
        level,
        values,
      });
    }
  }

  plan.push({
    id: 'equivalent-stroke',
    kind: 'equivalence',
    values: {
      strokeScale: 40,
      elongation: 0,
      directionality: 0,
      abstraction: 0,
      density: 0,
    },
  });

  plan.push({
    id: 'equivalent-abstraction',
    kind: 'equivalence',
    values: {
      strokeScale: 0,
      elongation: 0,
      directionality: 0,
      abstraction: 100,
      density: 0,
    },
  });

  for (const palette of config.palettes ?? []) {
    plan.push({
      id: `palette-${palette.id}`,
      kind: 'palette',
      palette,
      values: {
        strokeScale: 0,
        elongation: 0,
        directionality: 0,
        abstraction: 0,
        density: 0,
      },
    });
  }

  return shuffle(plan, config.seed);
}

function sampleIDs(count, sampleCount, seed) {
  const random = rng(seed);
  const ids = new Set();
  const n = Math.min(sampleCount, count);

  if (n === count) {
    return Array.from({ length: count }, (_, i) => i);
  }

  while (ids.size < n) {
    ids.add(Math.floor(random() * count));
  }

  return [...ids].sort((a, b) => a - b);
}

function encodeCSV(rows) {
  if (!rows.length) return '';

  const keys = [...new Set(rows.flatMap(Object.keys))];
  const quote = value =>
    `"${String(value ?? '').replaceAll('"', '""')}"`;

  return [
    keys.map(quote).join(','),
    ...rows.map(row =>
      keys.map(key => {
        const value = row[key];

        return quote(
          typeof value === 'object'
            ? JSON.stringify(value)
            : value
        );
      }).join(',')
    ),
  ].join('\n');
}

const frame = () =>
  new Promise(resolve => requestAnimationFrame(resolve));

const json = value => JSON.stringify(value, null, 2);

async function hash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

function snapshotUniforms(uniforms) {
  const result = [];
  const extra = [
    'splatScale',
    'pointCloudModeEnabled',
    'orthographicMode',
    'focal',
    'viewport',
    'covariancesAreHalfFloat',
  ];

  for (const [name, uniform] of Object.entries(uniforms)) {
    if (!name.startsWith('npr') && !extra.includes(name)) continue;

    const value = uniform.value;

    result.push([
      name,
      value?.toArray
        ? value.toArray()
        : Array.isArray(value)
          ? value.map(item => item?.toArray ? item.toArray() : item)
          : value,
    ]);
  }

  return Object.fromEntries(result);
}

function imageMetrics(data, mask, baseline) {
  let total = 0;
  let difference = 0;
  let edge = 0;

  const { width, height } = data;

  const luminance = i =>
    (
      0.2126 * data.data[i] +
      0.7152 * data.data[i + 1] +
      0.0722 * data.data[i + 2]
    ) / 255;

  for (let p = 0; p < width * height; p++) {
    if (!mask[p]) continue;

    const i = p * 4;
    const y = Math.floor(p / width);
    const x = p % width;
    total++;

    let pixelDifference = 0;

    for (let channel = 0; channel < 3; channel++) {
      pixelDifference += Math.abs(
        data.data[i + channel] - baseline.data[i + channel]
      ) / 255;
    }

    difference += pixelDifference / 3;

    if (
      x > 0 &&
      y > 0 &&
      x < width - 1 &&
      y < height - 1
    ) {
      edge += Math.abs(
        4 * luminance(i) -
        luminance(i - 4) -
        luminance(i + 4) -
        luminance(i - 4 * width) -
        luminance(i + 4 * width)
      );
    }
  }

  return {
    maskPixels: total,
    imageMAEFromBaseline: total ? difference / total : null,
    laplacianDetailProxy: total ? edge / total : null,
  };
}

function makeProbe(THREE, viewer, ids) {
  const mesh = viewer.splatMesh;
  const source = mesh.material;
  const renderer = viewer.renderer;

  if (
    !renderer.getContext().getExtension('EXT_color_buffer_float')
  ) {
    throw new Error('EXT_color_buffer_float unavailable.');
  }

  for (const name of [
    'basisVector1',
    'basisVector2',
    'eigenVector1',
    'vColor',
    'vPosition',
  ]) {
    if (!source.vertexShader.includes(name)) {
      throw new Error(`Missing shader variable: ${name}.`);
    }
  }

  const side = Math.ceil(Math.sqrt(ids.length));
  const geometry = mesh.geometry.clone();
  const original = mesh.geometry.getAttribute('splatIndex');

  if (!original) {
    throw new Error('Missing instanced splatIndex attribute.');
  }

  const attribute = new THREE.InstancedBufferAttribute(
    new original.array.constructor(ids),
    1
  );

  attribute.gpuType = original.gpuType;
  geometry.setAttribute('splatIndex', attribute);
  geometry.instanceCount = ids.length;

  let vertexShader = source.vertexShader;
  const main = /void\s+main\s*\(\s*\)\s*\{/;

  if (!main.test(vertexShader)) {
    throw new Error('Cannot instrument shader main.');
  }

  vertexShader = vertexShader.replace(
    main,
    `
      varying vec4 evalMeasurement;
      uniform int evalMode;

      void main() {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        evalMeasurement = vec4(0.0);
    `
  );

  const end = vertexShader.lastIndexOf('}');

  vertexShader =
    vertexShader.slice(0, end) +
    `
      evalMeasurement = evalMode == 0
        ? vec4(
            length(basisVector1),
            length(basisVector2),
            atan(eigenVector1.y, eigenVector1.x),
            vColor.a
          )
        : vColor;

      float evalSlot = float(gl_InstanceID);

      vec2 evalCell = vec2(
        mod(evalSlot, ${side}.0),
        floor(evalSlot / ${side}.0)
      );

      vec2 evalCorner = vPosition / sqrt(8.0);

      gl_Position = vec4(
        (evalCell + vec2(0.5) + evalCorner * 0.49)
          / ${side}.0 * 2.0 - 1.0,
        0.0,
        1.0
      );
    ` +
    vertexShader.slice(end);

  const uniforms = {
    ...source.uniforms,
    evalMode: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: `
      precision highp float;
      varying vec4 evalMeasurement;

      void main() {
        gl_FragColor = evalMeasurement;
      }
    `,
    uniforms,
    defines: source.defines,
    glslVersion: source.glslVersion,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });

  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;

  const scene = new THREE.Scene();
  scene.add(object);

  const target = new THREE.WebGLRenderTarget(side, side, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });

  target.texture.colorSpace = THREE.NoColorSpace;

  return {
    read() {
      mesh.updateMatrixWorld(true);
      object.matrix.copy(mesh.matrixWorld);

      const oldTarget = renderer.getRenderTarget();
      const oldColor = renderer.getClearColor(new THREE.Color());
      const oldAlpha = renderer.getClearAlpha();
      const viewport = renderer.getViewport(new THREE.Vector4());
      const scissor = renderer.getScissor(new THREE.Vector4());
      const scissorTest = renderer.getScissorTest();
      const oldShaderError = renderer.debug.onShaderError;

      renderer.debug.onShaderError = () => {
        throw new Error('GPU measurement shader compilation failed.');
      };

      const result = [];

      try {
        renderer.setRenderTarget(target);
        renderer.setViewport(0, 0, side, side);
        renderer.setScissorTest(false);
        renderer.setClearColor(0, 0);

        for (let mode = 0; mode < 2; mode++) {
          uniforms.evalMode.value = mode;
          renderer.clear();
          renderer.render(scene, viewer.camera);

          const pixels = new Float32Array(side * side * 4);

          renderer.readRenderTargetPixels(
            target,
            0,
            0,
            side,
            side,
            pixels
          );

          result.push(pixels);
        }
      } finally {
        renderer.debug.onShaderError = oldShaderError;
        renderer.setRenderTarget(oldTarget);
        renderer.setClearColor(oldColor, oldAlpha);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest);
      }

      return ids.map((id, i) => {
        const axes = result[0].subarray(i * 4, i * 4 + 4);
        const color = result[1].subarray(i * 4, i * 4 + 4);

        return {
          id,
          valid:
            axes[0] > 0 &&
            axes[1] > 0 &&
            [...axes, ...color].every(Number.isFinite),
          major: axes[0],
          minor: axes[1],
          theta: axes[2],
          alpha: axes[3],
          r: color[0],
          g: color[1],
          b: color[2],
        };
      });
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      target.dispose();
    },
  };
}

function measure(records, baseline) {
  const base = new Map(
    baseline.filter(record => record.valid)
      .map(record => [record.id, record])
  );

  const matched = records.filter(
    record => record.valid && base.has(record.id)
  );

  const oriented = matched.filter(record => {
    const original = base.get(record.id);
    return original.major / original.minor >= 1.2;
  });

  const mean = values => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

  return {
    validSampleCount: records.filter(record => record.valid).length,
    invalidSampleCount: records.filter(record => !record.valid).length,
    matchedSampleCount: matched.length,
    retainedSampleRatio: base.size ? matched.length / base.size : null,

    majorRatio: median(matched.map(record =>
      record.major / base.get(record.id).major
    )),

    minorRatio: median(matched.map(record =>
      record.minor / base.get(record.id).minor
    )),

    aspectRatioRatio: median(matched.map(record => {
      const original = base.get(record.id);

      return (record.major / record.minor) /
        (original.major / original.minor);
    })),

    supportAreaRatio: median(matched.map(record => {
      const original = base.get(record.id);

      return (record.major * record.minor) /
        (original.major * original.minor);
    })),

    orientationSampleCount: oriented.length,

    horizontalDeviationDegrees: mean(
      oriented.map(record =>
        Math.acos(
          Math.min(1, Math.abs(Math.cos(record.theta)))
        ) * 180 / Math.PI
      )
    ),

    meanEffectiveVertexAlpha: mean(
      matched.map(record => record.alpha)
    ),
  };
}

export function summarize(rows) {
  const metrics = {
    strokeScale: [
      'majorRatio',
      'minorRatio',
      'aspectRatioRatio',
      'supportAreaRatio',
    ],
    elongation: [
      'majorRatio',
      'minorRatio',
      'aspectRatioRatio',
      'supportAreaRatio',
    ],
    directionality: ['horizontalDeviationDegrees'],
    abstraction: [
      'majorRatio',
      'minorRatio',
      'retainedSampleRatio',
      'laplacianDetailProxy',
    ],
    density: ['meanEffectiveVertexAlpha'],
  };

  const groups = new Map();

  for (const row of rows.filter(row => row.kind === 'sweep')) {
    const key = `${row.scene}/${row.view}/${row.control}`;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const result = [];

  for (const [group, records] of groups) {
    records.sort((a, b) => a.level - b.level);

    for (const metric of metrics[records[0].control] ?? []) {
      const valid = records.filter(
        record => Number.isFinite(record[metric])
      );

      const values = valid.map(record => record[metric]);

      const decreasing = [
        'horizontalDeviationDegrees',
        'retainedSampleRatio',
        'laplacianDetailProxy',
      ].includes(metric);

      const expected = record => {
        const x = record.level / 100;

        if (record.control === 'strokeScale') {
          return {
            majorRatio: 1 + 2 * x,
            minorRatio: 1 + 2 * x,
            aspectRatioRatio: 1,
            supportAreaRatio: (1 + 2 * x) ** 2,
          }[metric];
        }

        if (record.control === 'elongation') {
          return {
            majorRatio: 1 + 2 * x,
            minorRatio: 1,
            aspectRatioRatio: 1 + 2 * x,
            supportAreaRatio: 1 + 2 * x,
          }[metric];
        }

        if (record.control === 'abstraction') {
          return {
            majorRatio: 1 + 0.8 * x,
            minorRatio: 1 + 0.8 * x,
            aspectRatioRatio: 1,
            supportAreaRatio: (1 + 0.8 * x) ** 2,
          }[metric];
        }
      };

      const errors =
        valid.length &&
        valid.map(expected).every(Number.isFinite)
          ? valid.map(record =>
              Math.abs(record[metric] - expected(record))
            )
          : [];

      const range = values.length
        ? Math.max(...values) - Math.min(...values)
        : null;

      const constant = values.length > 0 && range < 1e-6;

      result.push({
        group,
        metric,
        levelsMeasured: valid.length,
        spearman: constant
          ? null
          : spearman(valid.map(record => record.level), values),
        constantResponse: constant,
        responseRange: range,
        adjacentWrongDirectionSteps: values.slice(1).filter(
          (value, i) => decreasing
            ? value > values[i] + 1e-6
            : value < values[i] - 1e-6
        ).length,
        formulaMAE: errors.length
          ? errors.reduce((sum, value) => sum + value, 0) / errors.length
          : null,
      });
    }
  }

  return result;
}

export async function runControlFidelity({
  THREE,
  viewer,
  config = {},
  onProgress = console.log,
  signal,
} = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const files = [];
  const rows = [];
  const failures = [];

  const manifest = {
    schema: 1,
    started: new Date().toISOString(),
    config: cfg,
    status: 'running',
    userAgent: navigator.userAgent,
    scenes: [],
  };

  let restore = () => {};

  const add = (name, content) => files.push({ name, content });

  try {
    if (
      !THREE ||
      !viewer?.renderer ||
      !viewer?.camera ||
      !viewer?.splatMesh?.material
    ) {
      throw new Error('Viewer unavailable.');
    }

    if (viewer.splatMesh.dynamicMode) {
      throw new Error('Dynamic scenes unsupported.');
    }

    if (
      !Number.isInteger(cfg.sampleCount) ||
      cfg.sampleCount < 1 ||
      cfg.sampleCount > 16384
    ) {
      throw new Error('sampleCount must be 1..16384.');
    }

    if (
      cfg.controls.some(control => !names[control]) ||
      cfg.levels.some(level =>
        !Number.isFinite(level) || level < 0 || level > 100
      )
    ) {
      throw new Error('Invalid control or level.');
    }

    const renderer = viewer.renderer;
    const camera = viewer.camera;
    const canvas = renderer.domElement;

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();

    const initialCamera = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      up: camera.up.clone(),
      aspect: camera.aspect,
    };

    const originals = Object.fromEntries(
      Object.entries(viewer.splatMesh.material.uniforms)
        .filter(([name]) => name.startsWith('npr'))
        .map(([name, uniform]) => {
          const value = uniform.value;

          return [
            name,
            Array.isArray(value)
              ? value.map(item => item.clone ? item.clone() : item)
              : value?.clone ? value.clone() : value,
          ];
        })
    );

    const controls = viewer.controls;
    const oldEnabled = controls?.enabled;

    if (controls) controls.enabled = false;

    const blocker = document.createElement('div');
    blocker.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;' +
      'background:rgba(0,0,0,.1);display:flex;' +
      'align-items:flex-start;justify-content:center;' +
      'pointer-events:auto';

    const label = document.createElement('div');
    label.style.cssText =
      'background:#111;color:white;padding:16px;font:14px monospace';

    blocker.append(label);
    document.body.append(blocker);

    const note = message => {
      label.textContent = message;
      onProgress(message);
    };

    restore = () => {
      blocker.remove();

      if (controls) controls.enabled = oldEnabled;

      for (const [name, value] of Object.entries(originals)) {
        if (viewer.splatMesh.material.uniforms[name]) {
          viewer.splatMesh.material.uniforms[name].value = value;
        }
      }

      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(size.x, size.y, false);

      camera.position.copy(initialCamera.position);
      camera.quaternion.copy(initialCamera.quaternion);
      camera.up.copy(initialCamera.up);
      camera.aspect = initialCamera.aspect;
      camera.updateProjectionMatrix();
    };

    renderer.setPixelRatio(1);
    renderer.setSize(cfg.width, cfg.height, false);

    camera.aspect = cfg.width / cfg.height;
    camera.updateProjectionMatrix();

    const check = () => {
      if (signal?.aborted) {
        throw new Error('Evaluation aborted.');
      }

      if (document.visibilityState !== 'visible') {
        throw new Error('Evaluation tab hidden.');
      }
    };

    const settle = async count => {
      for (let i = 0; i < count; i++) {
        check();
        await frame();
        viewer.update();
        viewer.render();
      }
    };

    const capture = () => {
      check();
      viewer.update();
      viewer.render();

      if (
        canvas.width !== cfg.width ||
        canvas.height !== cfg.height
      ) {
        throw new Error(
          `Viewer resized to ${canvas.width}x${canvas.height}.`
        );
      }

      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;

      const context = copy.getContext('2d', {
        willReadFrequently: true,
      });

      context.drawImage(canvas, 0, 0);

      return {
        data: context.getImageData(
          0,
          0,
          copy.width,
          copy.height
        ),

        png: () => new Promise((resolve, reject) => {
          copy.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('PNG encoding failed'));
          }, 'image/png');
        }),
      };
    };

    for (let sceneIndex = 0; sceneIndex < cfg.scenes.length; sceneIndex++) {
      const spec = cfg.scenes[sceneIndex];
      check();

      if (spec.path) {
        note(`Loading ${spec.id}`);

        const count = viewer.splatMesh.scenes.length;

        if (count) {
          await viewer.removeSplatScenes(
            Array.from({ length: count }, (_, i) => i),
            true
          );
        }

        await viewer.addSplatScene(spec.path, {
          splatAlphaRemovalThreshold: 5,
          showLoadingUI: true,
          progressiveLoad: false,
          position: [0, -0.5, 0],
          rotation: [0, 0, 0, 1],
          scale: [1.5, 1.5, 1.5],
          ...spec.loadOptions,
        });
      }

      const mesh = viewer.splatMesh;
      const uniforms = mesh.material.uniforms;

      for (const control of cfg.controls) {
        if (!uniforms[names[control]]) {
          throw new Error(`Missing ${names[control]}.`);
        }
      }

      if (
        !uniforms.nprPaletteEnabled ||
        !uniforms.nprPaletteStrength
      ) {
        throw new Error('Missing palette uniforms.');
      }

      const apply = (values, palette) => {
        const sliderIds = {
          strokeScale: 'control-stroke-scale',
          elongation: 'control-elongation',
          directionality: 'control-directionality',
          abstraction: 'control-abstraction',
          density: 'control-density',
        };

        for (const control of Object.keys(names)) {
          const input = document.getElementById(sliderIds[control]);

          if (!input) {
            throw new Error(`Missing slider: ${control}`);
          }

          input.value = String(values[control] ?? 0);
          input.dispatchEvent(
            new Event('input', { bubbles: true })
          );
        }

        if (palette) {
          if (
            !uniforms.nprPalette?.value ||
            palette.colors.length !== 5
          ) {
            throw new Error('Invalid palette uniforms or swatches.');
          }

          palette.colors.forEach((hex, i) => {
            const color = new THREE.Color(hex);

            uniforms.nprPalette.value[i].set(
              color.r,
              color.g,
              color.b
            );
          });
        }

        uniforms.nprPaletteEnabled.value = palette ? 1 : 0;
        uniforms.nprPaletteStrength.value = palette ? 1 : 0;
        mesh.material.uniformsNeedUpdate = true;
      };

      const ids = sampleIDs(
        mesh.getSplatCount(),
        cfg.sampleCount,
        cfg.seed + sceneIndex
      );

      if (!ids.length) {
        throw new Error('No loaded splats.');
      }

      const sceneMeta = {
        id: spec.id,
        loadedCount: mesh.getSplatCount(),
        ids,

        vertexShaderSHA256: await hash(
          new TextEncoder().encode(mesh.material.vertexShader)
        ),

        fragmentShaderSHA256: await hash(
          new TextEncoder().encode(mesh.material.fragmentShader)
        ),

        runtime: {
          dynamicMode: mesh.dynamicMode,
          antialiased: mesh.antialiased,
          kernel2DSize: mesh.kernel2DSize,
          maxScreenSpaceSplatSize: mesh.maxScreenSpaceSplatSize,
          sphericalHarmonicsDegree: mesh.sphericalHarmonicsDegree,
        },

        views: [],
      };

      manifest.scenes.push(sceneMeta);

      add(
        `shaders/${sceneIndex}-vertex.glsl`,
        mesh.material.vertexShader
      );

      add(
        `shaders/${sceneIndex}-fragment.glsl`,
        mesh.material.fragmentShader
      );

      const probe = makeProbe(THREE, viewer, ids);

      try {
        for (let viewIndex = 0; viewIndex < cfg.views.length; viewIndex++) {
          const view = cfg.views[viewIndex];
          const prefix = `s${sceneIndex}-v${viewIndex}`;

          camera.position.copy(initialCamera.position);
          camera.quaternion.copy(initialCamera.quaternion);
          camera.up.copy(initialCamera.up);

          if (view.position) {
            camera.position.fromArray(view.position);
          }

          if (view.up) {
            camera.up.fromArray(view.up);
          }

          if (view.lookAt) {
            camera.lookAt(new THREE.Vector3(...view.lookAt));
          }

          camera.updateMatrixWorld(true);

          sceneMeta.views.push({
            id: view.id,
            position: camera.position.toArray(),
            quaternion: camera.quaternion.toArray(),
            up: camera.up.toArray(),
            projectionMatrix: camera.projectionMatrix.toArray(),
          });

          apply({});
          await settle(cfg.warmupFrames);

          const neutral = capture();
          const mask = new Uint8Array(
            neutral.data.width * neutral.data.height
          );

          for (let p = 0; p < mask.length; p++) {
            const i = p * 4;

            mask[p] = Math.max(
              255 - neutral.data.data[i],
              255 - neutral.data.data[i + 1],
              255 - neutral.data.data[i + 2]
            ) > 8 ? 1 : 0;
          }

          if (!mask.some(Boolean)) {
            throw new Error('Empty baseline image.');
          }

          add(`images/${prefix}-baseline.png`, await neutral.png());

          const baseline = probe.read();

          if (!baseline.some(record => record.valid)) {
            throw new Error('No valid GPU measurements.');
          }

          add(`gpu/${prefix}-baseline.csv`, encodeCSV(baseline));

          const plan = makePlan({
            ...cfg,
            seed: cfg.seed + sceneIndex * 100 + viewIndex,
          });

          for (let trialIndex = 0; trialIndex < plan.length; trialIndex++) {
            const trial = plan[trialIndex];

            note(
              `${spec.id} / ${view.id}: ` +
              `${trialIndex + 1}/${plan.length} ${trial.id}`
            );

            const expectedPosition = camera.position.toArray();
            const expectedQuaternion = camera.quaternion.toArray();

            apply(trial.values, trial.palette);
            await settle(cfg.settleFrames);

            if (
              json(camera.position.toArray()) !==
                json(expectedPosition) ||
              json(camera.quaternion.toArray()) !==
                json(expectedQuaternion)
            ) {
              throw new Error('Camera changed during trial.');
            }

            const observed = snapshotUniforms(uniforms);

            for (const control of cfg.controls) {
              const expected = control === 'strokeScale'
                ? 1 + 2 * trial.values[control] / 100
                : trial.values[control] / 100;

              if (
                Math.abs(observed[names[control]] - expected) > 1e-6
              ) {
                throw new Error(`Uniform drift for ${control}.`);
              }
            }

            const first = capture();
            await settle(8);
            const second = capture();

            const metrics = imageMetrics(
              second.data,
              mask,
              neutral.data
            );

            const stability = imageMetrics(
              second.data,
              mask,
              first.data
            ).imageMAEFromBaseline;

            if (stability > cfg.stabilityTolerance) {
              throw new Error(
                `Unstable rendering in ${trial.id}: ${stability}.`
              );
            }

            const raw = probe.read();
            const measurements = measure(raw, baseline);

            if (trial.palette) {
              const colors = trial.palette.colors.map(
                hex => new THREE.Color(hex)
              );

              const distances = raw
                .filter(record => record.valid)
                .map(record => Math.min(
                  ...colors.map(color => Math.hypot(
                    record.r - color.r,
                    record.g - color.g,
                    record.b - color.b
                  ))
                ));

              measurements.medianNearestPaletteDistanceShaderRGB =
                median(distances);
            }

            rows.push({
              scene: spec.id,
              view: view.id,
              order: trialIndex,
              ...trial,
              ...measurements,
              ...metrics,
              stabilityMAE: stability,
              loadedCount: mesh.getSplatCount(),
              actualUniforms: observed,
            });

            add(
              `images/${prefix}-${trial.id}.png`,
              await second.png()
            );

            add(
              `gpu/${prefix}-${trial.id}.csv`,
              encodeCSV(raw)
            );
          }
        }
      } finally {
        probe.dispose();
      }
    }

    manifest.status = 'complete';
  } catch (error) {
    manifest.status = 'failed';

    failures.push({
      message: error.message,
      stack: error.stack,
    });

    onProgress(`Evaluation stopped: ${error.message}`);
  } finally {
    restore();
    manifest.finished = new Date().toISOString();
    manifest.completedTrials = rows.length;
    manifest.failures = failures;
  }

  const summary = summarize(rows);

  add('manifest.json', json(manifest));
  add('trials.csv', encodeCSV(rows));
  add('summary.csv', encodeCSV(summary));

  const zip = await zipStore(files);

  download(
    zip,
    `control-fidelity-${new Date().toISOString().replaceAll(':', '-')}.zip`
  );

  return { manifest, rows, summary, zip };
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export async function zipStore(files) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name);

    const bytes = file.content instanceof Blob
      ? new Uint8Array(await file.content.arrayBuffer())
      : new TextEncoder().encode(file.content);

    if (offset + bytes.length > 0xffffffff) {
      throw new Error('ZIP exceeds 4GB.');
    }

    const crc = crc32(bytes);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(12, 0x0021, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true);

    local.push(header, name, bytes);

    const directory = new Uint8Array(46);
    const directoryView = new DataView(directory.buffer);

    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint16(14, 0x0021, true);
    directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, bytes.length, true);
    directoryView.setUint32(24, bytes.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint32(42, offset, true);

    central.push(directory, name);
    offset += header.length + name.length + bytes.length;
  }

  if (files.length > 65535) {
    throw new Error('Too many ZIP entries.');
  }

  const centralLength = central.reduce(
    (sum, item) => sum + item.length,
    0
  );

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralLength, true);
  endView.setUint32(16, offset, true);

  return new Blob(
    [...local, ...central, end],
    { type: 'application/zip' }
  );
}