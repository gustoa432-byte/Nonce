import { useState, useRef, useEffect, useCallback } from 'react';

export type LogMessage = {
    id: string;
    text: string;
    type: 'info' | 'success' | 'error' | 'warning';
    timestamp: number;
};

export function useWebGpuResonator() {
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [isReady, setIsReady] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);
    const [isRunning, setIsRunning] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [hashRate, setHashRate] = useState<number>(0);
    
    const workerRef = useRef<Worker | null>(null);
    const isStreamingRef = useRef(false);
    const abortRef = useRef(false);

    const addLog = useCallback((text: string, type: LogMessage['type'] = 'info') => {
        setLogs(prev => {
            const newLogs = [...prev, {
                id: Math.random().toString(36).substring(7),
                text,
                type,
                timestamp: Date.now()
            }];
            return newLogs.slice(-150); // Keep max 150 logs
        });
    }, []);

    const stopAll = useCallback(() => {
        abortRef.current = true;
        isStreamingRef.current = false;
        setIsStreaming(false);
        setIsRunning(false);
        addLog("🛑 ПРИНУДИТЕЛЬНАЯ ОСТАНОВКА...", "error");
        if (workerRef.current) {
            workerRef.current.terminate();
        }
    }, [addLog]);

    useEffect(() => {
        setIsInitializing(true);
        addLog("⚡ Инициализация WASM/Rust Search Engine (Web Worker)...", "warning");

        const worker = new Worker('/engine.worker.js');
        workerRef.current = worker;

        worker.onmessage = (e) => {
            if (e.data.type === 'SOLUTION_FOUND') {
                const nonceHex = e.data.nonce.toString(16).toUpperCase().padStart(8, '0');
                const seedHex = e.data.seed.toString(16).toUpperCase().padStart(8, '0');
                const hr = (e.data.hashRate / 1_000_000).toFixed(2);
                
                setHashRate(e.data.hashRate);
                addLog(`[РЕШЕНИЕ НАЙДЕНО. ВЫПЛЕВЫВАЕМ В MAIN THREAD. Hashrate: ${hr} MH/s] Proof-of-Work => Nonce: 0x${nonceHex} / Seed: 0x${seedHex}`, "success");
                setIsRunning(false);

                if (isStreamingRef.current) {
                    launchWorker(workerRef.current);
                }
            }
        };

        setIsReady(true);
        setIsInitializing(false);
        addLog("✅ Worker Thread готов рубить математику.", "success");

        return () => {
            worker.terminate();
        };
    }, []);

    const launchWorker = (worker: Worker | null) => {
        if (!worker) return;
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        worker.postMessage({ type: 'START_ENGINE', seed });
    };

    const fire = useCallback(() => {
        if (!isReady || isRunning) return;
        setIsRunning(true);
        addLog(`\n🔥 Запуск голого брутфорс-треда... Отвязка от графического конвейера!`, "info");
        launchWorker(workerRef.current);
    }, [addLog, isReady, isRunning]);

    const toggleStream = useCallback(() => {
        setIsStreaming(prev => {
            const next = !prev;
            isStreamingRef.current = next;
            
            if (next && !isRunning) {
                setIsRunning(true);
                addLog(`\n🔄 Активация непрерывного потока в Worker...`, "warning");
                launchWorker(workerRef.current);
            }
            
            return next;
        });
    }, [isRunning, addLog]);

    const runDagCrash = useCallback(async () => {
        if (isRunning) return;
        abortRef.current = false;
        setIsRunning(true);
        addLog("РАСЧЛЕНЕНИЕ СЛОНА: Инициализация...", "info");
        
        const gpu = (navigator as any).gpu;
        if (!gpu) {
            addLog("WebGPU не поддерживается.", "error");
            setIsRunning(false);
            return;
        }

        try {
            const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
            const device = await adapter.requestDevice();

            addLog("Кристалл GPU захвачен.");

            const SLIDE_SIZE = 1 * 1024 * 1024; // 1 MB
            const SLIDE_ELEMENTS = SLIDE_SIZE / 4; // 256K u32
            const TOTAL_SLIDES = 256; // 256 MB total
            const WORK_THREADS = 1000000;

            addLog(`Схема: ${TOTAL_SLIDES} слайдов по ${SLIDE_SIZE/1024/1024} МБ. На каждый слайд ${WORK_THREADS} потоков.`, "warning");
            
            const GPUBufferUsage = (window as any).GPUBufferUsage;

            const slideBuffer = device.createBuffer({
                size: SLIDE_ELEMENTS * 4,
                usage: GPUBufferUsage.STORAGE,
                mappedAtCreation: false,
            });

            // Воронка для выживших битов
            const survivorBuffer = device.createBuffer({
                size: (1 + 100000) * 4, // 1 счетчик + 100к емкость
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
            });
            device.queue.writeBuffer(survivorBuffer, 0, new Uint32Array([0]));

            addLog("Память для слайдов выделена. Компилируем шейдер перемалывания...");

            const shaderModule = device.createShaderModule({
                code: `
                    @group(0) @binding(0) var<storage, read> slide: array<u32>;
                    @group(0) @binding(1) var<storage, read_write> survivors: array<atomic<u32>>;
                    @group(0) @binding(2) var<uniform> params: vec4<u32>;

                    fn hash(state: u32) -> u32 {
                        var x = state;
                        x ^= x >> 16u;
                        x *= 0x7feb352du;
                        x ^= x >> 15u;
                        x *= 0x846ca68bu;
                        x ^= x >> 16u;
                        return x;
                    }

                    @compute @workgroup_size(64)
                    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                        let index = global_id.x;
                        if (index >= ${WORK_THREADS}u) { return; }

                        let slide_idx = params.x;
                        let seed = params.y;
                        let slide_size = ${SLIDE_ELEMENTS}u;

                        var value = hash(index ^ seed ^ (slide_idx * 1337u));
                        
                        // Вязкость внутри 1МБ (Cache-Friendly!)
                        for (var i = 0u; i < 50u; i = i + 1u) {
                            let jump_addr = (value ^ hash(i)) % slide_size;
                            value = value ^ slide[jump_addr]; 
                        }

                        // Условие выживания: 1 из 10,000 потоков
                        if (value % 10000u == 0u) {
                            let insert_pos = atomicAdd(&survivors[0], 1u);
                            if (insert_pos < 100000u) {
                                atomicStore(&survivors[insert_pos + 1u], index ^ value);
                            }
                        }
                    }
                `
            });

            const paramBuffer = device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            const computePipeline = device.createComputePipeline({
                layout: 'auto',
                compute: { module: shaderModule, entryPoint: 'main' }
            });

            const bindGroup = device.createBindGroup({
                layout: computePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: slideBuffer } },
                    { binding: 1, resource: { buffer: survivorBuffer } },
                    { binding: 2, resource: { buffer: paramBuffer } }
                ]
            });

            addLog("Начинаем прокачку 256 слайдов (наложение друг на друга)...", "error");

            const startTime = performance.now();
            
            for (let i = 0; i < TOTAL_SLIDES; i++) {
                if (abortRef.current) {
                    addLog("Процесс прерван пользователем.", "error");
                    break;
                }
                const params = new Uint32Array([i, Math.floor(Math.random() * 0xFFFFFFFF), 0, 0]);
                device.queue.writeBuffer(paramBuffer, 0, params);

                const commandEncoder = device.createCommandEncoder();
                const passEncoder = commandEncoder.beginComputePass();
                passEncoder.setPipeline(computePipeline);
                passEncoder.setBindGroup(0, bindGroup);
                passEncoder.dispatchWorkgroups(Math.ceil(WORK_THREADS / 64)); 
                passEncoder.end();

                device.queue.submit([commandEncoder.finish()]);
                
                if (i % 64 === 0 && i !== 0) {
                    addLog(`Обработано слайдов: ${i} / ${TOTAL_SLIDES}...`, "info");
                    await device.queue.onSubmittedWorkDone();
                    await new Promise(r => setTimeout(r, 0)); // Yield to UI
                }
            }

            await device.queue.onSubmittedWorkDone();

            const readBuffer = device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
            const commandEncoder = device.createCommandEncoder();
            commandEncoder.copyBufferToBuffer(survivorBuffer, 0, readBuffer, 0, 4);
            device.queue.submit([commandEncoder.finish()]);

            await readBuffer.mapAsync(GPUBufferUsage.MAP_READ);
            const survivorCount = new Uint32Array(readBuffer.getMappedRange())[0];
            readBuffer.unmap();
            
            const endTime = performance.now();
            const timeDiff = ((endTime - startTime) / 1000).toFixed(2);
            
            addLog(`Прокол через ${TOTAL_SLIDES} слоев завершен. Время: ${timeDiff} сек.`, "warning");
            addLog(`На дне воронки выжило битов: ${survivorCount}`, "success");

        } catch (e: any) {
            addLog(`КРАШ: ${e.message}`, "error");
        } finally {
            setIsRunning(false);
        }
    }, [addLog]);

    const runBitcoinMiner = useCallback(async () => {
        if (isRunning) return;
        abortRef.current = false;
        setIsRunning(true);
        addLog("БИТОК: Инициализация ASIC эмулятора...", "warning");
        
        const gpu = (navigator as any).gpu;
        if (!gpu) {
            addLog("WebGPU не поддерживается.", "error");
            setIsRunning(false);
            return;
        }

        try {
            const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
            const device = await adapter.requestDevice();

            const WORK_THREADS = 1024 * 1024; // 1M threads
            const ITERATIONS = 1000; // 1000 hashes per thread per dispatch
            addLog(`ASIC CORE READY: ${WORK_THREADS} потоков. Запуск майнинга...`, "info");
            
            const GPUBufferUsage = (window as any).GPUBufferUsage;

            const survivorBuffer = device.createBuffer({
                size: 8, // Nonce + Hash
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
            });
            device.queue.writeBuffer(survivorBuffer, 0, new Uint32Array([0, 0]));

            const shaderModule = device.createShaderModule({
                code: `
                    @group(0) @binding(1) var<storage, read_write> result: array<atomic<u32>>;

                    // Упрощенная имитация Double SHA-256 для плотности вычислений
                    fn pseudo_sha256(state: u32) -> u32 {
                        var x = state;
                        x ^= x >> 12u;
                        x *= 0x2545f491u;
                        x ^= x >> 13u;
                        x *= 0x5f35d213u;
                        x ^= x >> 16u;
                        return x;
                    }

                    @compute @workgroup_size(64)
                    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                        let index = global_id.x;
                        if (index >= ${WORK_THREADS}u) { return; }

                        let seed = 0xBTC0FFEEu ^ index;
                        var nonce = index;
                        var found_hash = 0u;
                        var is_found = false;

                        for (var i = 0u; i < ${ITERATIONS}u; i = i + 1u) {
                            let hash_val = pseudo_sha256(pseudo_sha256(seed ^ nonce));
                            
                            // Ищем блок с 5 нулями в начале (сложность)
                            if (hash_val <= 0x000FFFFFu) {
                                is_found = true;
                                found_hash = hash_val;
                                break;
                            }
                            nonce += ${WORK_THREADS}u;
                        }

                        if (is_found) {
                            // Сохраняем первый найденный
                            let old = atomicExchange(&result[0], nonce);
                            if (old == 0u) {
                                atomicStore(&result[1], found_hash);
                            }
                        }
                    }
                `
            });

            const computePipeline = device.createComputePipeline({
                layout: 'auto',
                compute: { module: shaderModule, entryPoint: 'main' }
            });

            const bindGroup = device.createBindGroup({
                layout: computePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 1, resource: { buffer: survivorBuffer } }
                ]
            });

            let total_hashes = 0;
            let blockFound = false;

            const startTime = performance.now();
            let lastUpdate = startTime;

            while (!blockFound) {
                if (abortRef.current) {
                    addLog("Майнинг прерван пользователем.", "error");
                    break;
                }
                const commandEncoder = device.createCommandEncoder();
                const passEncoder = commandEncoder.beginComputePass();
                passEncoder.setPipeline(computePipeline);
                passEncoder.setBindGroup(0, bindGroup);
                passEncoder.dispatchWorkgroups(Math.ceil(WORK_THREADS / 64)); 
                passEncoder.end();

                device.queue.submit([commandEncoder.finish()]);
                await device.queue.onSubmittedWorkDone();

                total_hashes += WORK_THREADS * ITERATIONS;
                const now = performance.now();
                
                if (now - lastUpdate > 500) {
                    const elapsed = (now - startTime) / 1000;
                    const mh = (total_hashes / elapsed / 1_000_000).toFixed(2);
                    setHashRate(total_hashes / elapsed);
                    addLog(`[MINING] Скорость: ${mh} MH/s... Поиск блока...`, "warning");
                    lastUpdate = now;
                    await new Promise(r => setTimeout(r, 0)); // Yield to UI
                }

                // Check result
                const readBuffer = device.createBuffer({
                    size: 8,
                    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                });
                const copyEncoder = device.createCommandEncoder();
                copyEncoder.copyBufferToBuffer(survivorBuffer, 0, readBuffer, 0, 8);
                device.queue.submit([copyEncoder.finish()]);
                await readBuffer.mapAsync(GPUBufferUsage.MAP_READ);
                
                const resArray = new Uint32Array(readBuffer.getMappedRange());
                const resNonce = resArray[0];
                const resHash = resArray[1];
                readBuffer.unmap();

                if (resNonce !== 0) {
                    const hashHex = resHash.toString(16).padStart(8, '0');
                    addLog(`💎 БЛОК НАЙДЕН! Hash: 0x${hashHex}, Nonce: ${resNonce}`, "success");
                    addLog(`Общее число хешей: ${(total_hashes/1_000_000).toFixed(2)} млн.`, "success");
                    blockFound = true;
                }
            }

        } catch (e: any) {
            addLog(`КРАШ МАЙНЕРА: ${e.message}`, "error");
        } finally {
            setIsRunning(false);
        }
    }, [addLog]);

    const runRicciFlow = useCallback(async () => {
        if (isRunning) return;
        abortRef.current = false;
        setIsRunning(true);
        addLog("RICCI FLOW: Инициализация потока Риччи (Перельман)...", "warning");
        
        const gpu = (navigator as any).gpu;
        if (!gpu) {
            addLog("WebGPU не поддерживается.", "error");
            setIsRunning(false);
            return;
        }

        try {
            const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
            const device = await adapter.requestDevice();

            const WORK_THREADS = 100000; // 100k threads to maintain high FPS and low memory
            const CLOUD_SIZE = 50; 
            const TARGET_ZEROS = 19; 
            
            addLog(`МНОГООБРАЗИЕ: ${WORK_THREADS} исходных 3D-точек. Облако: ${CLOUD_SIZE}. Цель: ${TARGET_ZEROS} нулей...`, "info");
            
            const GPUBufferUsage = (window as any).GPUBufferUsage;

            const survivorBuffer = device.createBuffer({
                size: 24, // result[0]..res[5] = max_zeros, x(f32), y(f32), z(f32), hash_val, padding
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
            });
            device.queue.writeBuffer(survivorBuffer, 0, new Uint32Array([0, 0, 0, 0, 0, 0]));

            const pointsBuffer = device.createBuffer({
                size: WORK_THREADS * 3 * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            
            // Randomly initialize points buffer on CPU
            const initialPoints = new Float32Array(WORK_THREADS * 3);
            for(let i=0; i<WORK_THREADS*3; i++) {
                initialPoints[i] = (Math.random() - 0.5) * 4000.0;
            }
            device.queue.writeBuffer(pointsBuffer, 0, initialPoints);

            const paramBuffer = device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            const shaderModule = device.createShaderModule({
                code: `
                    @group(0) @binding(1) var<storage, read_write> result: array<atomic<u32>>;
                    @group(0) @binding(2) var<storage, read_write> points: array<f32>;
                    @group(0) @binding(3) var<uniform> params: vec4<u32>;

                    fn pseudo_sha256(x: f32, y: f32, z: f32) -> u32 {
                        let hx = bitcast<u32>(x);
                        let hy = bitcast<u32>(y);
                        let hz = bitcast<u32>(z);
                        var state = hx ^ (hy * 1337u) ^ (hz * 42069u);
                        state ^= state >> 12u;
                        state *= 0x2545f491u;
                        state ^= state >> 13u;
                        state *= 0x5f35d213u;
                        state ^= state >> 16u;
                        return state;
                    }

                    fn hash_rand(state: u32) -> u32 {
                        var x = state;
                        x ^= x >> 16u;
                        x *= 0x7feb352du;
                        x ^= x >> 15u;
                        x *= 0x846ca68bu;
                        x ^= x >> 16u;
                        return x;
                    }

                    fn random_float(state: ptr<function, u32>) -> f32 {
                        *state = hash_rand(*state);
                        return f32(*state) / 4294967295.0;
                    }

                    fn get_zeros(p: vec3<f32>) -> u32 {
                        let target = vec3<f32>(1337.0, -420.0, 777.0);
                        let d = distance(p, target);
                        
                        // Добавляем шум (локальные минимумы) чтобы алгоритм не сошелся за 1 такт
                        let noise = sin(p.x * 2.0) * cos(p.y * 2.0) * sin(p.z * 2.0) * 10.0;
                        let noisy_dist = max(0.0, d + noise);
                        
                        let max_d = 2000.0;
                        let fitness = max(0.0, 1.0 - (noisy_dist / max_d));
                        
                        // Возводим в квадрат, чтобы последние нули добывались тяжелее
                        var z = u32(pow(fitness, 2.0) * 20.0); 
                        if (z > 20u) { z = 20u; }
                        if (z > 19u) { z = 19u; } 
                        return z;
                    }

                    @compute @workgroup_size(64)
                    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                        let index = global_id.x;
                        if (index >= ${WORK_THREADS}u) { return; }

                        let seed_val = params.y ^ index;
                        var r_state = hash_rand(seed_val);

                        var px = points[index * 3u];
                        var py = points[index * 3u + 1u];
                        var pz = points[index * 3u + 2u];
                        var current_p = vec3<f32>(px, py, pz);
                        
                        var current_fitness = get_zeros(current_p);

                        for (var i = 0u; i < ${CLOUD_SIZE}u; i = i + 1u) {
                            let step_size = max(0.5, 20.0 - f32(current_fitness));
                            
                            let dx = (random_float(&r_state) - 0.5) * step_size;
                            let dy = (random_float(&r_state) - 0.5) * step_size;
                            let dz = (random_float(&r_state) - 0.5) * step_size;
                            
                            let neighbor = current_p + vec3<f32>(dx, dy, dz);
                            let neighbor_fitness = get_zeros(neighbor);
                            
                            if (neighbor_fitness >= current_fitness) {
                                current_p = neighbor;
                                current_fitness = neighbor_fitness;
                            } else {
                                let chance = random_float(&r_state);
                                if (chance < 0.05) {
                                    current_p = neighbor;
                                    current_fitness = neighbor_fitness;
                                }
                            }
                        }

                        points[index * 3u] = current_p.x;
                        points[index * 3u + 1u] = current_p.y;
                        points[index * 3u + 2u] = current_p.z;

                        var old_max = atomicLoad(&result[0]);
                        if (current_fitness > old_max) {
                            let actual_old = atomicMax(&result[0], current_fitness);
                            if (current_fitness > actual_old) {
                                let h = pseudo_sha256(current_p.x, current_p.y, current_p.z);
                                atomicStore(&result[1], bitcast<u32>(current_p.x));
                                atomicStore(&result[2], bitcast<u32>(current_p.y));
                                atomicStore(&result[3], bitcast<u32>(current_p.z));
                                atomicStore(&result[4], h);
                            }
                        }
                    }
                `
            });

            const computePipeline = device.createComputePipeline({
                layout: 'auto',
                compute: { module: shaderModule, entryPoint: 'main' }
            });

            const bindGroup = device.createBindGroup({
                layout: computePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 1, resource: { buffer: survivorBuffer } },
                    { binding: 2, resource: { buffer: pointsBuffer } },
                    { binding: 3, resource: { buffer: paramBuffer } }
                ]
            });

            let total_steps = 0;
            let current_best_zeros = 0;

            const startTime = performance.now();
            let lastUpdate = startTime;
            let step = 0;

            while (current_best_zeros < TARGET_ZEROS) {
                if (abortRef.current) {
                    addLog("Ricci Flow прерван пользователем.", "error");
                    break;
                }
                
                const paramsData = new Uint32Array([step, Math.floor(Math.random() * 0xFFFFFFFF), 0, 0]);
                device.queue.writeBuffer(paramBuffer, 0, paramsData);

                const commandEncoder = device.createCommandEncoder();
                const passEncoder = commandEncoder.beginComputePass();
                passEncoder.setPipeline(computePipeline);
                passEncoder.setBindGroup(0, bindGroup);
                passEncoder.dispatchWorkgroups(Math.ceil(WORK_THREADS / 64)); 
                passEncoder.end();

                device.queue.submit([commandEncoder.finish()]);
                await device.queue.onSubmittedWorkDone();

                total_steps += WORK_THREADS * CLOUD_SIZE;
                step++;
                const now = performance.now();
                
                if (now - lastUpdate > 500) {
                    const elapsed = (now - startTime) / 1000;
                    const mh = (total_steps / elapsed / 1_000_000).toFixed(2);
                    setHashRate(total_steps / elapsed);
                    addLog(`[RICCI FLOW] Искривление: ${mh} млн. узлов/с...`, "info");
                    
                    const readBuffer = device.createBuffer({
                        size: 24,
                        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                    });
                    const copyEncoder = device.createCommandEncoder();
                    copyEncoder.copyBufferToBuffer(survivorBuffer, 0, readBuffer, 0, 24);
                    device.queue.submit([copyEncoder.finish()]);
                    await readBuffer.mapAsync(GPUBufferUsage.MAP_READ);
                    
                    const resArray = new Uint32Array(readBuffer.getMappedRange());
                    const f32Array = new Float32Array(readBuffer.getMappedRange());
                    
                    const resZeros = resArray[0];
                    const px = f32Array[1];
                    const py = f32Array[2];
                    const pz = f32Array[3];
                    const resHash = resArray[4];
                    readBuffer.unmap();
                    
                    if (resZeros > current_best_zeros) {
                        current_best_zeros = resZeros;
                        const hashHex = resHash.toString(16).padStart(8, '0');
                        addLog(`🌌 ТОПОЛОГИЧЕСКИЙ СДВИГ! Найдено ${resZeros}/${TARGET_ZEROS} нулей. Точка: (${px.toFixed(1)}, ${py.toFixed(1)}, ${pz.toFixed(1)}), Хэш: 0x${hashHex}`, "success");
                    }
                    
                    lastUpdate = now;
                    await new Promise(r => setTimeout(r, 0)); 
                }
            }

            if (current_best_zeros >= TARGET_ZEROS && !abortRef.current) {
                addLog(`🎯 ПРОСТРАНСТВО СВЕРНУЛОСЬ! ${TARGET_ZEROS} нулей достигнуто. Одобрено Перельманом.`, "warning");
            }

        } catch (e: any) {
            addLog(`КРАШ ТОПОЛОГИИ: ${e.message}`, "error");
        } finally {
            setIsRunning(false);
        }
    }, [addLog]);

    const clearLogs = () => setLogs([]);

    const exportCSV = useCallback(() => {
        if (logs.length === 0) return;
        
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
        csvContent += "Timestamp,Type,Message\r\n";
        
        logs.forEach(log => {
            const time = new Date(log.timestamp).toISOString();
            const safeText = log.text.replace(/"/g, '""').replace(/\n/g, " ");
            csvContent += `"${time}","${log.type}","${safeText}"\r\n`;
        });
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `wasm_worker_logs_${new Date().getTime()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [logs]);

    return { logs, isReady, isInitializing, isRunning, isStreaming, toggleStream, fire, clearLogs, exportCSV, hashRate, runDagCrash, runBitcoinMiner, stopAll, runRicciFlow };
}
