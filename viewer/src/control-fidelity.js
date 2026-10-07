export const DEFAULT_CONFIG = {
  seed: 219, width: 1280, height: 720, sampleCount: 4096,
  settleFrames: 45, warmupFrames: 180, stabilityTolerance: 0.002,
  buildId: 'SET-YOUR-COMMIT-OR-BUILD-ID',
  controls: ['strokeScale', 'elongation', 'directionality', 'abstraction', 'density'],
  levels: Array.from({length: 11}, (_, i) => i * 10),
  views: [{id: 'main'}],
  scenes: [{id: 'current'}],
  palettes: [
    {id:'cool',colors:['#526d82','#8ba6b2','#b8cdd0','#dbcdbd','#f0e9df']},
    {id:'warm',colors:['#302219','#65492f','#917044','#bd895f','#e3c49b']},
    {id:'contrast',colors:['#17191c','#243c5a','#963735','#bd8250','#eee0bd']},
  ],
};
const names = {
  strokeScale: 'nprStrokeScale', elongation: 'nprElongation',
  directionality: 'nprDirectionality', abstraction: 'nprAbstraction', density: 'nprDensity',
};
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(values, seed) {
  const a = [...values], r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function median(a) {
  if (!a.length) return null;
  const b = [...a].sort((x,y) => x-y), n = b.length;
  return n % 2 ? b[n >> 1] : (b[n/2-1] + b[n/2]) / 2;
}
function ranks(a) {
  const indices = a.map((_,i) => i).sort((i,j) => a[i]-a[j]), out = [];
  for(let i=0;i<indices.length;) { let j=i+1;
    while(j<indices.length && a[indices[j]]===a[indices[i]]) j++;
    for(let k=i;k<j;k++) out[indices[k]]=(i+j-1)/2; i=j; }
  return out;
}
export function spearman(x,y) {
  if(x.length !== y.length || x.length < 2 || [...x,...y].some(v=>!Number.isFinite(v))) return null;
  const a=ranks(x),b=ranks(y), mean=v=>v.reduce((s,t)=>s+t,0)/v.length;
  const ma=mean(a),mb=mean(b);let n=0,da=0,db=0;
  a.forEach((v,i)=>{n+=(v-ma)*(b[i]-mb);da+=(v-ma)**2;db+=(b[i]-mb)**2;});
  return da && db ? n/Math.sqrt(da*db) : null;
}
export function makePlan(config) {
  const plan=[];
  for(const control of config.controls) for(const level of config.levels) {
    const values={strokeScale:0,elongation:0,directionality:0,abstraction:0,density:0};
    if(control==='directionality') values.elongation=50;
    values[control]=level;plan.push({id:`${control}-${level}`,kind:'sweep',control,level,values});
  }
  plan.push({id:'equivalent-stroke',kind:'equivalence',values:{strokeScale:40,elongation:0,directionality:0,abstraction:0,density:0}});
  plan.push({id:'equivalent-abstraction',kind:'equivalence',values:{strokeScale:0,elongation:0,directionality:0,abstraction:100,density:0}});
  for(const palette of config.palettes??[])plan.push({id:`palette-${palette.id}`,kind:'palette',palette,values:{strokeScale:0,elongation:0,directionality:0,abstraction:0,density:0}});
  return shuffle(plan,config.seed);
}
function sampleIDs(count,n,seed) {
  const random=rng(seed), ids=new Set(); n=Math.min(n,count);
  if(n===count) return Array.from({length:count},(_,i)=>i);
  while(ids.size<n) ids.add(Math.floor(random()*count)); return [...ids].sort((a,b)=>a-b);
}
function encodeCSV(rows) {
  if(!rows.length)return '';
  const keys=[...new Set(rows.flatMap(Object.keys))], q=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return [keys.map(q).join(','),...rows.map(r=>keys.map(k=>q(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])).join(','))].join('\n');
}
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const json=(v)=>JSON.stringify(v,null,2);
async function hash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function snapshotUniforms(uniforms) {
  const result={};
  for(const [k,u] of Object.entries(uniforms)) if(k.startsWith('npr') || ['splatScale','pointCloudModeEnabled','orthographicMode','focal','viewport','covariancesAreHalfFloat'].includes(k)) {
    const v=u.value;result[k]=v?.toArray?v.toArray():Array.isArray(v)?v.map(x=>x?.toArray?x.toArray():x):v;
  } return result;
}
function imageMetrics(data,mask,baseline) {
  let total=0,sum=0,diff=0,changed=0,edge=0;
  const {width:w,height:h}=data;
  const lum=i=>(0.2126*data.data[i]+0.7152*data.data[i+1]+0.0722*data.data[i+2])/255;
  for(let p=0;p<w*h;p++) if(mask[p]) {
    const i=p*4,y=Math.floor(p/w),x=p%w; total++;sum+=lum(i);
    let d=0;for(let c=0;c<3;c++)d+=Math.abs(data.data[i+c]-baseline.data[i+c])/255;
    diff+=d/3;if(d/3>1/255)changed++;
    if(x>0&&y>0&&x<w-1&&y<h-1)edge+=Math.abs(4*lum(i)-lum(i-4)-lum(i+4)-lum(i-4*w)-lum(i+4*w));
  }
  return {maskPixels:total,meanLuminance:total?sum/total:null,imageMAEFromBaseline:total?diff/total:null,
    changedPixelFraction:total?changed/total:null,laplacianDetailProxy:total?edge/total:null};
}

function makeProbe(THREE,viewer,ids) {
  const mesh=viewer.splatMesh, source=mesh.material, renderer=viewer.renderer;
  if(!renderer.getContext().getExtension('EXT_color_buffer_float')) throw new Error('GPU measurement requires EXT_color_buffer_float. No synthetic fallback is used.');
  for(const token of ['basisVector1','basisVector2','eigenVector1','vColor','vPosition'])
    if(!source.vertexShader.includes(token)) throw new Error(`Active shader does not contain ${token}; check renderer build.`);
  const side=Math.ceil(Math.sqrt(ids.length)), geometry=mesh.geometry.clone();
  const original=mesh.geometry.getAttribute('splatIndex');
  if(!original)throw new Error('Missing instanced splatIndex attribute.');
  const attribute=new THREE.InstancedBufferAttribute(new original.array.constructor(ids),1);
  attribute.gpuType=original.gpuType; geometry.setAttribute('splatIndex',attribute);geometry.instanceCount=ids.length;
  let vertex=source.vertexShader;
  const main=/void\s+main\s*\(\s*\)\s*\{/;
  if(!main.test(vertex))throw new Error('Cannot instrument shader main.');
  vertex=vertex.replace(main,`varying vec4 evalMeasurement;\nuniform int evalMode;\nvoid main() {\n gl_Position=vec4(2.0,2.0,2.0,1.0); evalMeasurement=vec4(0.0);`);
  const end=vertex.lastIndexOf('}');
  vertex=vertex.slice(0,end)+`
    evalMeasurement = evalMode == 0 ? vec4(length(basisVector1), length(basisVector2), atan(eigenVector1.y,eigenVector1.x), vColor.a) : vColor;
    float evalSlot=float(gl_InstanceID);
    vec2 evalCell=vec2(mod(evalSlot,${side}.0),floor(evalSlot/${side}.0));
    vec2 evalCorner=vPosition/sqrt(8.0);
    gl_Position=vec4((evalCell+vec2(0.5)+evalCorner*0.49)/${side}.0*2.0-1.0,0.0,1.0);
  `+vertex.slice(end);
  const uniforms={...source.uniforms,evalMode:{value:0}};
  const material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:'precision highp float; varying vec4 evalMeasurement; void main(){gl_FragColor=evalMeasurement;}',
    uniforms,defines:source.defines,glslVersion:source.glslVersion,side:THREE.DoubleSide,depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
  const object=new THREE.Mesh(geometry,material);object.frustumCulled=false;object.matrixAutoUpdate=false;
  const scene=new THREE.Scene();scene.add(object);
  const target=new THREE.WebGLRenderTarget(side,side,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false,stencilBuffer:false});
  target.texture.colorSpace=THREE.NoColorSpace;
  return {
    read() {
      mesh.updateMatrixWorld(true);object.matrix.copy(mesh.matrixWorld);
      const oldTarget=renderer.getRenderTarget(), oldColor=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha();
      const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
      const oldShaderError=renderer.debug.onShaderError;
      renderer.debug.onShaderError=()=>{throw new Error('Diagnostic shader failed to compile/link. Check console and renderer version.');};
      const result=[];
      try { renderer.setRenderTarget(target);renderer.setViewport(0,0,side,side);renderer.setScissorTest(false);renderer.setClearColor(0,0);
        for(let mode=0;mode<2;mode++) {uniforms.evalMode.value=mode;renderer.clear();renderer.render(scene,viewer.camera);
          const pixels=new Float32Array(side*side*4);renderer.readRenderTargetPixels(target,0,0,side,side,pixels);result.push(pixels);}
      } finally {renderer.debug.onShaderError=oldShaderError;renderer.setRenderTarget(oldTarget);renderer.setClearColor(oldColor,oldAlpha);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);}
      return ids.map((id,i)=>{const a=result[0].subarray(i*4,i*4+4),c=result[1].subarray(i*4,i*4+4);
        return {id,valid:a[0]>0&&a[1]>0&&[...a,...c].every(Number.isFinite),major:a[0],minor:a[1],theta:a[2],alpha:a[3],r:c[0],g:c[1],b:c[2]};});
    },
    dispose(){geometry.dispose();material.dispose();target.dispose();},
  };
}
function measure(records,baseline) {
  const base=new Map(baseline.filter(x=>x.valid).map(x=>[x.id,x])),matched=records.filter(x=>x.valid&&base.has(x.id));
  const eligible=matched.filter(x=>base.get(x.id).major/base.get(x.id).minor>=1.2);
  const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  return {validSampleCount:records.filter(x=>x.valid).length,invalidSampleCount:records.filter(x=>!x.valid).length,matchedSampleCount:matched.length,
    majorRatio:median(matched.map(x=>x.major/base.get(x.id).major)),minorRatio:median(matched.map(x=>x.minor/base.get(x.id).minor)),
    aspectRatioRatio:median(matched.map(x=>(x.major/x.minor)/(base.get(x.id).major/base.get(x.id).minor))),
    supportAreaRatio:median(matched.map(x=>(x.major*x.minor)/(base.get(x.id).major*base.get(x.id).minor))),
    orientationSampleCount:eligible.length,horizontalDeviationDegrees:avg(eligible.map(x=>Math.acos(Math.min(1,Math.abs(Math.cos(x.theta))))*180/Math.PI)),
    meanEffectiveVertexAlpha:avg(matched.map(x=>x.alpha))};
}
export function summarize(rows) {
  const metrics=['majorRatio','minorRatio','aspectRatioRatio','supportAreaRatio','horizontalDeviationDegrees','meanEffectiveVertexAlpha','laplacianDetailProxy'];
  const groups=new Map();for(const r of rows.filter(r=>r.kind==='sweep')) {const key=`${r.scene}/${r.view}/${r.control}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  const out=[];for(const [group,rs] of groups) {rs.sort((a,b)=>a.level-b.level);
    for(const metric of metrics) {const v=rs.filter(r=>Number.isFinite(r[metric])),ys=v.map(r=>r[metric]);
      const decreasing=metric==='horizontalDeviationDegrees';
      const expected=r=>{const x=r.level/100;
        if(r.control==='strokeScale')return {majorRatio:1+2*x,minorRatio:1+2*x,aspectRatioRatio:1,supportAreaRatio:(1+2*x)**2}[metric];
        if(r.control==='elongation')return {majorRatio:1+2*x,minorRatio:1,aspectRatioRatio:1+2*x,supportAreaRatio:1+2*x}[metric];
        if(r.control==='abstraction')return {majorRatio:1+0.8*x,minorRatio:1+0.8*x,aspectRatioRatio:1,supportAreaRatio:(1+0.8*x)**2}[metric];};
      const errors=v.map(r=>expected(r)).every(Number.isFinite)&&v.length?v.map(r=>Math.abs(r[metric]-expected(r))):[];
      out.push({group,metric,levelsMeasured:v.length,spearman:spearman(v.map(r=>r.level),ys),constantResponse:ys.length>0&&ys.every(y=>y===ys[0]),
        responseRange:ys.length?Math.max(...ys)-Math.min(...ys):null,adjacentWrongDirectionSteps:ys.slice(1).filter((y,i)=>decreasing?y>ys[i]+1e-6:y<ys[i]-1e-6).length,
        formulaMAE:errors.length?errors.reduce((s,v)=>s+v,0)/errors.length:null});}}
  return out;
}

export async function runControlFidelity({THREE,viewer,config={},onProgress=console.log,signal}={}) {
  const cfg={...DEFAULT_CONFIG,...config}; const files=[],rows=[],failures=[];
  const manifest={schema:1,started:new Date().toISOString(),config:cfg,status:'running',userAgent:navigator.userAgent,
    warnings:['GPU probe measures pre-compositing vertex outputs. Early returns are recorded as invalid cells; individual rejection reasons are unavailable.',
      'Density and palette semantics remain unverified without SplatMaterial.js. Density and palette diagnostic responses are exploratory; palette stays disabled in slider sweeps.',
      'Mask is fixed from the baseline image using distance from white; this is not an object segmentation mask.',
      'Fixed order randomization reduces order effects; it does not remove metric/design bias.'],scenes:[]};
  let restore=()=>{};
  const add=(name,content)=>files.push({name,content});
  try {
    if(!THREE||!viewer?.renderer||!viewer?.camera||!viewer?.splatMesh?.material)throw new Error('Pass THREE and a fully loaded viewer.');
    if(viewer.splatMesh.dynamicMode)throw new Error('This probe supports the current static-scene setup only.');
    if(!Number.isInteger(cfg.sampleCount)||cfg.sampleCount<1||cfg.sampleCount>16384)throw new Error('sampleCount must be 1..16384.');
    if(cfg.controls.some(c=>!names[c])||cfg.levels.some(v=>!Number.isFinite(v)||v<0||v>100))throw new Error('Invalid control or level.');
    if(cfg.buildId===DEFAULT_CONFIG.buildId)manifest.warnings.push('Build ID was not supplied. Shader hashes are retained, but record your source commit before final collection.');
    const renderer=viewer.renderer,camera=viewer.camera,canvas=renderer.domElement;
    const size=renderer.getSize(new THREE.Vector2()),pixelRatio=renderer.getPixelRatio();
    const initialCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone(),up:camera.up.clone(),aspect:camera.aspect};
    const originals=Object.fromEntries(Object.entries(viewer.splatMesh.material.uniforms).filter(([k])=>k.startsWith('npr')).map(([k,u])=>[k,Array.isArray(u.value)?u.value.map(v=>v.clone?v.clone():v):u.value?.clone?u.value.clone():u.value]));
    const controls=viewer.controls,oldEnabled=controls?.enabled; if(controls)controls.enabled=false;
    const blocker=document.createElement('div');blocker.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.1);display:flex;align-items:flex-start;justify-content:center;pointer-events:auto';
    const label=document.createElement('div');label.style.cssText='background:#111;color:white;padding:16px;font:14px monospace';blocker.append(label);document.body.append(blocker);
    const note=t=>{label.textContent=t;onProgress(t);};
    restore=()=>{blocker.remove();if(controls)controls.enabled=oldEnabled;
      for(const [k,v]of Object.entries(originals))if(viewer.splatMesh.material.uniforms[k])viewer.splatMesh.material.uniforms[k].value=v;
      renderer.setPixelRatio(pixelRatio);renderer.setSize(size.x,size.y,false);camera.position.copy(initialCamera.position);camera.quaternion.copy(initialCamera.quaternion);camera.up.copy(initialCamera.up);camera.aspect=initialCamera.aspect;camera.updateProjectionMatrix();};
    renderer.setPixelRatio(1);renderer.setSize(cfg.width,cfg.height,false);camera.aspect=cfg.width/cfg.height;camera.updateProjectionMatrix();
    const check=()=>{if(signal?.aborted)throw new Error('Aborted; partial results retained.');if(document.visibilityState!=='visible')throw new Error('Tab became hidden; partial results retained. Keep the evaluation tab visible.');};
    const settle=async n=>{for(let i=0;i<n;i++){check();await frame();viewer.update();viewer.render();}};
    const capture=()=>{check();viewer.update();viewer.render();if(canvas.width!==cfg.width||canvas.height!==cfg.height)throw new Error(`Viewer resized to ${canvas.width}x${canvas.height}; fix viewer-pane dimensions to the configured capture size.`);const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0);
      return {data:ctx.getImageData(0,0,c.width,c.height),png:()=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'))};};
    for(let si=0;si<cfg.scenes.length;si++) {
      const spec=cfg.scenes[si];check();
      if(spec.path) {note(`Loading ${spec.id}`);const n=viewer.splatMesh.scenes.length;
        if(n)await viewer.removeSplatScenes(Array.from({length:n},(_,i)=>i),true);
        await viewer.addSplatScene(spec.path,{splatAlphaRemovalThreshold:5,showLoadingUI:true,progressiveLoad:false,position:[0,-0.5,0],rotation:[0,0,0,1],scale:[1.5,1.5,1.5],...spec.loadOptions});}
      const mesh=viewer.splatMesh,uniforms=mesh.material.uniforms;
      for(const c of cfg.controls)if(!uniforms[names[c]])throw new Error(`Missing ${names[c]}. No-op control cannot be evaluated.`);
      if(!uniforms.nprPaletteEnabled||!uniforms.nprPaletteStrength)throw new Error('Missing palette enable/strength uniforms. Cannot establish neutral baseline.');
      const apply=(values,palette)=>{for(const [c,k]of Object.entries(names))if(uniforms[k])uniforms[k].value=c==='strokeScale'?1+2*(values[c]??0)/100:(values[c]??0)/100;
        if(palette){if(!uniforms.nprPalette?.value||palette.colors.length!==5)throw new Error('Palette requires five swatches and nprPalette uniform.');
          palette.colors.forEach((hex,i)=>{const c=new THREE.Color(hex);uniforms.nprPalette.value[i].set(c.r,c.g,c.b);});}
        uniforms.nprPaletteEnabled.value=palette?1:0;uniforms.nprPaletteStrength.value=palette?1:0;mesh.material.uniformsNeedUpdate=true;};
      const ids=sampleIDs(mesh.getSplatCount(),cfg.sampleCount,cfg.seed+si);if(!ids.length)throw new Error('No loaded splats.');
      const sceneMeta={id:spec.id,loadedCount:mesh.getSplatCount(),ids,vertexShaderSHA256:await hash(new TextEncoder().encode(mesh.material.vertexShader)),fragmentShaderSHA256:await hash(new TextEncoder().encode(mesh.material.fragmentShader)),runtime:{dynamicMode:mesh.dynamicMode,antialiased:mesh.antialiased,kernel2DSize:mesh.kernel2DSize,maxScreenSpaceSplatSize:mesh.maxScreenSpaceSplatSize,sphericalHarmonicsDegree:mesh.sphericalHarmonicsDegree},views:[]};
      manifest.scenes.push(sceneMeta);add(`shaders/${si}-vertex.glsl`,mesh.material.vertexShader);add(`shaders/${si}-fragment.glsl`,mesh.material.fragmentShader);
      const probe=makeProbe(THREE,viewer,ids);
      try {for(let vi=0;vi<cfg.views.length;vi++) {
        const view=cfg.views[vi],prefix=`s${si}-v${vi}`;
        camera.position.copy(initialCamera.position);camera.quaternion.copy(initialCamera.quaternion);camera.up.copy(initialCamera.up);
        if(view.position)camera.position.fromArray(view.position);if(view.up)camera.up.fromArray(view.up);
        if(view.lookAt)camera.lookAt(new THREE.Vector3(...view.lookAt));camera.updateMatrixWorld(true);
        sceneMeta.views.push({id:view.id,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),projectionMatrix:camera.projectionMatrix.toArray()});
        apply({});await settle(cfg.warmupFrames);
        const neutral=capture(),mask=new Uint8Array(neutral.data.width*neutral.data.height);
        for(let p=0;p<mask.length;p++){const i=p*4;mask[p]=Math.max(255-neutral.data.data[i],255-neutral.data.data[i+1],255-neutral.data.data[i+2])>8?1:0;}
        if(!mask.some(Boolean))throw new Error('Baseline image contains no foreground; check framing/rendering.');
        add(`images/${prefix}-baseline.png`,await neutral.png());
        const baseline=probe.read();if(!baseline.some(r=>r.valid))throw new Error('GPU probe returned no valid primitives; check shader compilation, framing, and sampling.');
        add(`gpu/${prefix}-baseline.csv`,encodeCSV(baseline));
        const plan=makePlan({...cfg,seed:cfg.seed+si*100+vi});
        for(let ti=0;ti<plan.length;ti++) {
          const trial=plan[ti];note(`${spec.id} / ${view.id}: ${ti+1}/${plan.length} ${trial.id}`);
          const expectedPosition=camera.position.toArray(),expectedQuaternion=camera.quaternion.toArray();
          apply(trial.values,trial.palette);await settle(cfg.settleFrames);
          if(json(camera.position.toArray())!==json(expectedPosition)||json(camera.quaternion.toArray())!==json(expectedQuaternion))throw new Error('Camera changed during trial; evaluation aborted.');
          const observed=snapshotUniforms(uniforms);
          for(const c of cfg.controls){const expected=c==='strokeScale'?1+2*trial.values[c]/100:trial.values[c]/100;
            if(Math.abs(observed[names[c]]-expected)>1e-6)throw new Error(`Uniform drift for ${c}.`);}
          const a=capture();await settle(8);const b=capture();
          const metrics=imageMetrics(b.data,mask,neutral.data),stability=imageMetrics(b.data,mask,a.data).imageMAEFromBaseline;
          if(stability>cfg.stabilityTolerance)throw new Error(`Unstable rendering in ${trial.id}: image MAE ${stability}. Increase settling or investigate animation.`);
          const raw=probe.read(),m=measure(raw,baseline);
          if(trial.palette){const colors=trial.palette.colors.map(hex=>new THREE.Color(hex)),distances=raw.filter(x=>x.valid).map(x=>Math.min(...colors.map(c=>Math.hypot(x.r-c.r,x.g-c.g,x.b-c.b))));
            m.medianNearestPaletteDistanceShaderRGB=median(distances);}
          const row={scene:spec.id,view:view.id,order:ti,...trial,...m,...metrics,stabilityMAE:stability,loadedCount:mesh.getSplatCount(),actualUniforms:observed};
          rows.push(row);add(`images/${prefix}-${trial.id}.png`,await b.png());add(`gpu/${prefix}-${trial.id}.csv`,encodeCSV(raw));
        }
      }} finally {probe.dispose();}
    }
    manifest.status='complete';
  } catch(error){manifest.status='failed';failures.push({message:error.message,stack:error.stack});onProgress(`Evaluation stopped: ${error.message}`);}
  finally {restore();manifest.finished=new Date().toISOString();manifest.completedTrials=rows.length;manifest.failures=failures;}
  add('manifest.json',json(manifest));add('trials.csv',encodeCSV(rows));add('summary.csv',encodeCSV(summarize(rows)));
  add('interpretation.txt','GPU measurements are final vertex-stage axes/orientation/alpha/color. They are not final composited opacity, perceptual stroke counts, or stored 3D Gaussian scales. Density has no expected formula until SplatMaterial.js is reviewed. Palette nearest-distance is measured in shader RGB, not perceptual Lab; palette stays disabled in slider sweeps. Image metrics use a fixed baseline foreground mask and are proxies, not a recognizability score. Invalid sampled primitives include shader early returns, degeneracy, and offscreen points; do not silently discard them. Correlations are descriptive, not significance tests. Read manifest status before using results.');
  const zip=await zipStore(files);download(zip,`control-fidelity-${new Date().toISOString().replaceAll(':','-')}.zip`);
  return {manifest,rows,summary:summarize(rows),zip};
}

function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export async function zipStore(files){const local=[],central=[];let offset=0;
  for(const f of files){const name=new TextEncoder().encode(f.name),bytes=f.content instanceof Blob?new Uint8Array(await f.content.arrayBuffer()):new TextEncoder().encode(f.content);
    if(offset+bytes.length>0xffffffff)throw new Error('ZIP exceeds 4GB; reduce sampleCount or scenes.');
    const crc=crc32(bytes),h=new Uint8Array(30),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);v.setUint16(12,0x0021,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);
    local.push(h,name,bytes);const c=new Uint8Array(46),d=new DataView(c.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(14,0x0021,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);central.push(c,name);offset+=h.length+name.length+bytes.length;
  }
  const length=central.reduce((s,x)=>s+x.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);if(files.length>65535)throw new Error('Too many ZIP entries.');v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,length,true);v.setUint32(16,offset,true);
  return new Blob([...local,...central,end],{type:'application/zip'});
}