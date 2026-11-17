import * as THREE from 'three';

export function spatialDensityWorker(scope) {
    let centers;
    let priorityOrder;
    let cache;
    scope.onmessage = ({ data }) => {
        if (data.centers) {
            centers = data.centers;
            cache = null;
            const count = centers.length / 3;
            priorityOrder = new Uint32Array(count);
            const scratch = new Uint32Array(count);
            const hashes = new Uint32Array(count);
            for (let i = 0; i < count; i++) {
                let x = i >>> 0;
                x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
                x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
                hashes[i] = (x ^ (x >>> 16)) >>> 0;
                priorityOrder[i] = i;
            }
            const offsets = new Uint32Array(65536);
            for (let pass = 0; pass < 2; pass++) {
                const input = pass === 0 ? priorityOrder : scratch;
                const output = pass === 0 ? scratch : priorityOrder;
                const shift = pass * 16;
                offsets.fill(0);
                for (let i = 0; i < count; i++) offsets[(hashes[input[i]] >>> shift) & 65535]++;
                let start = 0;
                for (let i = 0; i < offsets.length; i++) {
                    const size = offsets[i];
                    offsets[i] = start;
                    start += size;
                }
                for (let i = 0; i < count; i++) {
                    const index = input[i];
                    output[offsets[(hashes[index] >>> shift) & 65535]++] = index;
                }
            }
            return;
        }
        const { indexes, matrix: m, key, viewKey, gridSize } = data;
        let sameCandidates = cache && cache.viewKey === viewKey && cache.candidateCount === indexes.length;
        if (sameCandidates && cache.key !== key) {
            for (let i = 0; i < indexes.length; i++) {
                if (cache.cellIDs[indexes[i]] === -2) {
                    sameCandidates = false;
                    break;
                }
            }
        }
        if (!sameCandidates) {
            const cellIDs = new Int32Array(centers.length / 3).fill(-2);
            const ranks = new Uint32Array(centers.length / 3);
            const cellCounts = new Uint32Array(gridSize * gridSize);
            let outsideCount = 0;
            for (let i = 0; i < indexes.length; i++) {
                const index = indexes[i];
                const offset = index * 3;
                const x = centers[offset];
                const y = centers[offset + 1];
                const z = centers[offset + 2];
                const w = m[3] * x + m[7] * y + m[11] * z + m[15];
                const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
                const py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
                const pz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
                if (!(w > 0 && px >= -1 && px <= 1 && py >= -1 && py <= 1 && pz >= -1 && pz <= 1)) {
                    cellIDs[index] = -1;
                    outsideCount++;
                    continue;
                }
                const gx = Math.min(gridSize - 1, Math.floor((px + 1) * 0.5 * gridSize));
                const gy = Math.min(gridSize - 1, Math.floor((py + 1) * 0.5 * gridSize));
                const cell = gy * gridSize + gx;
                cellIDs[index] = cell;
                cellCounts[cell]++;
            }
            const nextRank = new Uint32Array(cellCounts.length);
            for (let i = 0; i < priorityOrder.length; i++) {
                const index = priorityOrder[i];
                const cell = cellIDs[index];
                if (cell >= 0) ranks[index] = nextRank[cell]++;
            }
            cache = { key, viewKey, cellIDs, ranks, cellCounts, outsideCount, candidateCount: indexes.length };
        }
        cache.key = key;
        if (sameCandidates && data.appliedSelectionID === cache.selectionID) {
            scope.postMessage({ id: data.id, unchanged: true });
            return;
        }
        cache.selectionID = data.id;
        const cellIDs = cache.cellIDs.slice();
        const ranks = cache.ranks.slice();
        scope.postMessage({ id: data.id, cellIDs, ranks, cellCounts: cache.cellCounts,
            outsideCount: cache.outsideCount, candidateCount: cache.candidateCount }, [cellIDs.buffer, ranks.buffer]);
    };
}

function createSpatialDensityWorker() {
    const url = URL.createObjectURL(new Blob([`(${spatialDensityWorker.toString()})(self);`], { type: 'text/javascript' }));
    try {
        return new Worker(url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function compactIndexes(indexes, count, selection, keepCounts, output) {
    const { cellIDs, ranks } = selection;
    let selectedCount = 0;
    for (let i = 0; i < count; i++) {
        const index = indexes[i];
        const cell = cellIDs[index];
        if (!(cell >= 0) || ranks[index] < keepCounts[cell]) output[selectedCount++] = index;
    }
    return selectedCount;
}

export class SpatialDensity {
    constructor(gridSize = 16, minDensity = 0.10, options = {}) {
        this.gridSize = gridSize;
        this.minDensity = minDensity;
        this.workerFactory = options.workerFactory || createSpatialDensityWorker;
        this.settleDelay = options.settleDelay ?? 0;
        this.viewProjection = new THREE.Matrix4();
        this.center = new THREE.Vector3();
        this.collectStats = false;
        this.revision = 0;
        this.selectionVersion = 0;
        this.waiters = [];
    }

    invalidate() {
        this.revision++;
        this.result = null;
    }

    filter(sortedIndexes, count, camera, mesh, density) {
        const d = Number.isFinite(density) ? THREE.MathUtils.clamp(density, 0, 1) : 1;
        if (this.inputIndexes !== sortedIndexes || this.inputCount !== count) {
            this.inputIndexes = sortedIndexes;
            this.inputCount = count;
            this.invalidate();
        }
        this.desiredDensity = d;
        if (d === 1 && !this.collectStats) {
            clearTimeout(this.timer);
            this.timer = null;
            this.pending = null;
            this.requestKey = null;
            if (this.stats?.targetRetainedFraction !== 1 || this.stats.densityCandidateCount !== count) {
                this.stats = {
                    targetRetainedFraction: 1, retainedGaussianFraction: count ? 1 : 0,
                    densityCandidateCount: count, densitySelectedCount: count,
                    densityOffscreenCount: null, occupiedCellCoverage: null, perCellRetention: null
                };
            }
            this.notifyReady();
        } else {
            this.request(sortedIndexes, count, camera, mesh, d);
        }
        if (this.result && this.resultIndexes === sortedIndexes && this.resultCount === count &&
            this.resultRevision === this.revision && this.resultVersion === this.selectionVersion && this.resultDensity === d) {
            return this.result;
        }
        let indexes = sortedIndexes;
        let selectedCount = count;
        if (this.selection && (d < 1 || this.collectStats)) {
            const targetFraction = this.minDensity + (1 - this.minDensity) * d;
            const { cellCounts, outsideCount, candidateCount } = this.selection;
            const keepCounts = Uint32Array.from(cellCounts, size => Math.ceil(size * targetFraction));
            const occupied = cellCounts.filter(size => size > 0).length;
            const selected = keepCounts.reduce((sum, size) => sum + size, outsideCount);
            this.stats = {
                targetRetainedFraction: targetFraction,
                retainedGaussianFraction: candidateCount ? selected / candidateCount : 0,
                densityCandidateCount: candidateCount, densitySelectedCount: selected,
                densityOffscreenCount: outsideCount,
                occupiedCellCoverage: occupied ? keepCounts.filter(size => size > 0).length / occupied : 0,
                perCellRetention: Array.from(cellCounts, (size, cell) => ({
                    cell, candidates: size, selected: keepCounts[cell], fraction: size ? keepCounts[cell] / size : null
                }))
            };
            if (d < 1) {
                if (!this.output || this.output.length < count) this.output = new Uint32Array(count);
                selectedCount = compactIndexes(sortedIndexes, count, this.selection, keepCounts, this.output);
                indexes = this.output.subarray(0, selectedCount);
            }
        }
        this.resultIndexes = sortedIndexes;
        this.resultCount = count;
        this.resultRevision = this.revision;
        this.resultVersion = this.selectionVersion;
        this.resultDensity = d;
        this.result = { indexes, count: selectedCount };
        return this.result;
    }

    request(indexes, count, camera, mesh, density) {
        camera.updateWorldMatrix(true, false);
        mesh.updateWorldMatrix(true, false);
        this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
        const matrix = this.viewProjection.elements;
        const buffers = mesh.scenes.map(scene => scene.splatBuffer);
        const buffersChanged = !this.buffers || buffers.length !== this.buffers.length ||
            buffers.some((buffer, i) => buffer !== this.buffers[i]);
        if (buffersChanged) {
            this.buffers = buffers;
            this.dataVersion = (this.dataVersion || 0) + 1;
        }
        const totalCount = mesh.getSplatCount();
        const centerKey = [this.dataVersion, totalCount, ...mesh.scenes.flatMap(scene => scene.transform.elements)].join(',');
        const viewKey = [centerKey, ...matrix].join(',');
        const key = [this.revision, count, viewKey].join('|');
        const requestKey = key;
        if (requestKey === this.requestKey) return;
        if (centerKey !== this.centerKey) {
            this.centerKey = centerKey;
            if (buffersChanged) this.selection = null;
            this.stats = null;
            this.selectionVersion++;
        }
        this.viewKey = viewKey;
        this.requestKey = requestKey;
        this.pending = { indexes, count, matrix: matrix.slice(), centerKey, totalCount, mesh, key, viewKey, density };
        if (!this.busy && !this.timer) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.startPending();
            }, this.settleDelay);
        }
    }

    async startPending() {
        if (this.busy || !this.pending) return;
        const job = this.pending;
        this.pending = null;
        this.busy = true;
        const generation = this.generation || 0;
        const indexes = job.indexes.slice(0, job.count);
        try {
            if (!this.worker) {
                this.worker = this.workerFactory();
                this.worker.onmessage = ({ data }) => {
                    const active = this.active;
                    if (!active || data.id !== active.id) return;
                    if (active.centerKey === this.centerKey && !data.unchanged) {
                        this.selection = data;
                        this.appliedSelectionID = data.id;
                        this.selectionVersion++;
                        if (this.onChange) this.onChange();
                    }
                    this.busy = false;
                    this.active = null;
                    if (this.pending && !this.timer) this.startPending();
                    this.notifyReady();
                };
                this.worker.onerror = event => this.fail(new Error(event.message || 'Spatial density worker failed'));
            }
            if (this.uploadedCenterKey !== job.centerKey) {
                const centers = new Float32Array(job.totalCount * 3);
                let i = 0;
                while (i < job.totalCount) {
                    const deadline = performance.now() + 3;
                    do {
                        const end = Math.min(i + 256, job.totalCount);
                        for (; i < end; i++) {
                            job.mesh.getSplatCenter(i, this.center, true);
                            this.center.toArray(centers, i * 3);
                        }
                    } while (i < job.totalCount && performance.now() < deadline);
                    if (i < job.totalCount) await new Promise(resolve => setTimeout(resolve, 0));
                    if (generation !== (this.generation || 0)) return;
                    if (this.centerKey !== job.centerKey || (this.desiredDensity === 1 && !this.collectStats)) {
                        this.busy = false;
                        if (this.pending && !this.timer) this.startPending();
                        this.notifyReady();
                        return;
                    }
                }
                this.worker.postMessage({ centers }, [centers.buffer]);
                this.uploadedCenterKey = job.centerKey;
            }
            if (generation !== (this.generation || 0)) return;
            this.active = { id: (this.jobID = (this.jobID || 0) + 1), centerKey: job.centerKey, viewKey: job.viewKey };
            this.worker.postMessage({
                id: this.active.id, indexes, matrix: job.matrix, key: job.key, viewKey: job.viewKey,
                density: job.density, gridSize: this.gridSize, minDensity: this.minDensity,
                appliedSelectionID: this.appliedSelectionID
            }, [indexes.buffer]);
        } catch (error) {
            if (generation === (this.generation || 0)) this.fail(error);
        }
    }

    fail(error) {
        this.error = error;
        this.busy = false;
        this.pending = null;
        clearTimeout(this.timer);
        this.timer = null;
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.uploadedCenterKey = null;
        for (const { reject } of this.waiters.splice(0)) reject(error);
        console.error(error);
    }

    whenReady() {
        if (this.error) return Promise.reject(this.error);
        if (!this.busy && !this.pending && !this.timer) return Promise.resolve();
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }

    notifyReady() {
        if (this.busy || this.pending || this.timer || !this.waiters.length) return;
        for (const { resolve } of this.waiters.splice(0)) resolve();
    }

    dispose() {
        this.generation = (this.generation || 0) + 1;
        clearTimeout(this.timer);
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.timer = null;
        this.pending = null;
        this.active = null;
        this.busy = false;
        this.uploadedCenterKey = null;
        this.centerKey = null;
        this.requestKey = null;
        this.buffers = null;
        this.viewKey = undefined;
        this.selection = null;
        this.appliedSelectionID = null;
        this.output = null;
        this.result = null;
        this.resultIndexes = null;
        this.inputIndexes = null;
        this.stats = null;
        this.error = null;
        this.notifyReady();
        this.invalidate();
    }
}
