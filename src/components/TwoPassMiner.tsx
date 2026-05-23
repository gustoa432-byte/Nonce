/// <reference types="@webgpu/types" />
import React, { useEffect, useRef, useState } from 'react';
import { Activity, Shield, Zap, ChevronLeft, Layout, MousePointer2, Download } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, CuboidCollider, InstancedRigidBodies } from '@react-three/rapier';

// Выделяем ~200 МБ оперативной памяти под Глобальную Тень
const SHADOW_GRAPH_SIZE = 50000000; 
export const globalShadowGraph = new Float32Array(SHADOW_GRAPH_SIZE);
export let shadowCursor = 0;

// Тяжелая функция для загрузки CPU: сканирует RAM и находит исторический центр масс
function calculateHistoricalMomentum() {
    let sumX = 0, sumY = 0, sumZ = 0;
    // CPU сканирует последние 10 000 записей (искусственная нагрузка на кэш процессора)
    let depth = Math.min(shadowCursor, 10000) * 3; 
    if (depth === 0) return { x: 1, y: 1, z: 1 };
    
    for (let i = 0; i < depth; i += 3) {
        sumX += globalShadowGraph[i];
        sumY += globalShadowGraph[i+1];
        sumZ += globalShadowGraph[i+2];
    }
    return { x: sumX/depth, y: sumY/depth, z: sumZ/depth };
}

// Глобальная переменная для связи Оракула и Майнера (без ререндеров React)
export const oracleState = { x: 0, y: 0, z: 0 };

const SWARM_COUNT = 2048;

function SwarmOracle() {
    const rigidBodies = useRef<any>(null);
    const cryptoBuffer = new Uint32Array(SWARM_COUNT * 3);

    // Начальные случайные позиции внутри полигона
    const positions = React.useMemo(() => {
        const pos = [];
        for (let i = 0; i < SWARM_COUNT; i++) {
            pos.push([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
        }
        return pos as [number, number, number][];
    }, []);

    useFrame(() => {
        if (!rigidBodies.current) return;
        
        window.crypto.getRandomValues(cryptoBuffer);
        
        let centerX = 0, centerY = 0, centerZ = 0;

        // CPU рассчитывает векторы хаоса для 2048 частиц (тяжелый цикл)
        for (let i = 0; i < SWARM_COUNT; i++) {
            let idx = i * 3;
            let ix = (cryptoBuffer[idx] / 4294967295) * 2 - 1;
            let iy = (cryptoBuffer[idx+1] / 4294967295) * 2 - 1;
            let iz = (cryptoBuffer[idx+2] / 4294967295) * 2 - 1;
            
            // Читаем позицию из WASM
            let pos = rigidBodies.current.at(i).translation();
            centerX += pos.x; centerY += pos.y; centerZ += pos.z;
            
            // Впрыскиваем хаос (удары по частицам)
            rigidBodies.current.at(i).applyImpulse({ x: ix*0.01, y: iy*0.01, z: iz*0.01 }, true);
        }

        // Центр масс кристаллизованного роя
        oracleState.x = centerX / SWARM_COUNT;
        oracleState.y = centerY / SWARM_COUNT;
        oracleState.z = centerZ / SWARM_COUNT;
    });

    return (
        // @ts-ignore
        <InstancedRigidBodies ref={rigidBodies} positions={positions} colliders="ball">
            <instancedMesh args={[undefined as any, undefined as any, SWARM_COUNT]}>
                <sphereGeometry args={[0.02]} />
                <meshBasicMaterial color="red" />
            </instancedMesh>
        </InstancedRigidBodies>
    );
}

// Скрытая 3D-камера для полигона (Добавить в основной рендер приложения)
export function TopologicalOracle() {
    return (
        <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
            <Canvas>
                <Physics gravity={[0, 0, 0]}>
                    {/* Треугольный ограничитель (Полигон хаоса) */}
                    <CuboidCollider position={[2, 0, 0]} args={[0.1, 2, 2]} />
                    <CuboidCollider position={[-2, 0, 0]} args={[0.1, 2, 2]} />
                    <CuboidCollider position={[0, 2, 0]} args={[2, 0.1, 2]} />
                    <CuboidCollider position={[0, -2, 0]} args={[2, 0.1, 2]} />
                    
                    <SwarmOracle />
                </Physics>
            </Canvas>
        </div>
    );
}

const PASS1_WGSL = `
const K: array<u32, 64> = array<u32, 64>(
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
);
fn rotr(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }
fn ch(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (~x & z); }
fn maj(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (x & z) ^ (y & z); }
fn ep0(x: u32) -> u32 { return rotr(x, 2u) ^ rotr(x, 13u) ^ rotr(x, 22u); }
fn ep1(x: u32) -> u32 { return rotr(x, 6u) ^ rotr(x, 11u) ^ rotr(x, 25u); }
fn sig0(x: u32) -> u32 { return rotr(x, 7u) ^ rotr(x, 18u) ^ (x >> 3u); }
fn sig1(x: u32) -> u32 { return rotr(x, 17u) ^ rotr(x, 19u) ^ (x >> 10u); }

struct Checkpoint {
    nonce: u32, pad0: u32, pad1: u32, pad2: u32,
    s0: u32, s1: u32, s2: u32, s3: u32,
    s4: u32, s5: u32, s6: u32, s7: u32,
    w0: u32, w1: u32, w2: u32, w3: u32,
    w4: u32, w5: u32, w6: u32, w7: u32,
    w8: u32, w9: u32, w10: u32, w11: u32,
    w12: u32, w13: u32, w14: u32, w15: u32
}

struct AtomicCounters {
    checkpoints_found: atomic<u32>,
    successes_found: atomic<u32>,
    apoptosis_kills: atomic<u32>,
    pad: atomic<u32>,
}

struct Params1 {
    base_offset: u32,
    max_checkpoints: u32,
    grid_dim_x: u32,
    pad1: u32,
}

@group(0) @binding(0) var<storage, read_write> checkpoints: array<Checkpoint>;
@group(0) @binding(1) var<storage, read_write> counters: AtomicCounters;
@group(0) @binding(2) var<uniform> params1: Params1;

@compute @workgroup_size(256)
fn pass1_main(@builtin(global_invocation_id) global_id: vec3<u32>, @builtin(workgroup_id) group_id: vec3<u32>, @builtin(local_invocation_id) local_id: vec3<u32>) {
    let global_flat_x = (group_id.x + group_id.y * params1.grid_dim_x) * 256u + local_id.x;
    let nonce = params1.base_offset + global_flat_x;
    
    var a = 0x6a09e667u; var b = 0xbb67ae85u; var c = 0x3c6ef372u; var d = 0xa54ff53au;
    var e = 0x510e527fu; var f = 0x9b05688cu; var g = 0x1f83d9abu; var h = 0x5be0cd19u;

    var w: array<u32, 64>;
    for (var i = 0u; i < 15u; i++) {
        w[i] = (nonce * 0x85ebca6bu) ^ (i * 0x10000000u);
    }
    w[15] = nonce;

    for (var i = 16u; i < 24u; i++) {
        w[i] = w[i - 16u] + sig0(w[i - 15u]) + w[i - 7u] + sig1(w[i - 2u]);
    }

    for (var i = 0u; i < 24u; i++) {
        let t1 = h + ep1(e) + ch(e, f, g) + K[i] + w[i];
        let t2 = ep0(a) + maj(a, b, c);
        h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }

    // Pass 1: Geometric Filter Anomaly
    let v1 = normalize(vec3<f32>(f32(a) / 4294967295.0, f32(b) / 4294967295.0, f32(c) / 4294967295.0));
    let v2 = normalize(vec3<f32>(f32(e) / 4294967295.0, f32(f) / 4294967295.0, f32(g) / 4294967295.0));
    let dot_prod = dot(v1, v2);

    if (abs(dot_prod) > 0.85) {
        let idx = atomicAdd(&counters.checkpoints_found, 1u);
        if (idx < params1.max_checkpoints) {
            checkpoints[idx] = Checkpoint(
                nonce, 0u, 0u, 0u,
                a, b, c, d,
                e, f, g, h,
                w[0], w[1], w[2], w[3],
                w[4], w[5], w[6], w[7],
                w[8], w[9], w[10], w[11],
                w[12], w[13], w[14], w[15]
            );
        }
    }
}
`;

const PASS2_WGSL = `
const K: array<u32, 64> = array<u32, 64>(
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
);
fn rotr(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }
fn ch(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (~x & z); }
fn maj(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (x & z) ^ (y & z); }
fn ep0(x: u32) -> u32 { return rotr(x, 2u) ^ rotr(x, 13u) ^ rotr(x, 22u); }
fn ep1(x: u32) -> u32 { return rotr(x, 6u) ^ rotr(x, 11u) ^ rotr(x, 25u); }
fn sig0(x: u32) -> u32 { return rotr(x, 7u) ^ rotr(x, 18u) ^ (x >> 3u); }
fn sig1(x: u32) -> u32 { return rotr(x, 17u) ^ rotr(x, 19u) ^ (x >> 10u); }

struct Checkpoint {
    nonce: u32, pad0: u32, pad1: u32, pad2: u32,
    s0: u32, s1: u32, s2: u32, s3: u32,
    s4: u32, s5: u32, s6: u32, s7: u32,
    w0: u32, w1: u32, w2: u32, w3: u32,
    w4: u32, w5: u32, w6: u32, w7: u32,
    w8: u32, w9: u32, w10: u32, w11: u32,
    w12: u32, w13: u32, w14: u32, w15: u32
}

struct AtomicCounters {
    checkpoints_found: atomic<u32>,
    successes_found: atomic<u32>,
    apoptosis_kills: atomic<u32>,
    pad: atomic<u32>,
}

struct Params2 {
    max_checkpoints: u32,
    max_winners: u32,
    zero_target: u32,
    grid_dim_x: u32,
}

struct SuccessWinner {
    base_nonce: u32,
    mutated_nonce: u32,
    hash_word0: u32,
    hash_word1: u32,
    distance: f32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

struct MLWeights {
    apoptosis_threshold: f32,
    cut_round: u32,
    current_floor: u32,
    viral_mask: u32,
}

@group(0) @binding(0) var<storage, read_write> checkpoints: array<Checkpoint>;
@group(0) @binding(1) var<storage, read_write> counters: AtomicCounters;
@group(0) @binding(2) var<storage, read_write> winners: array<SuccessWinner>;
@group(0) @binding(3) var<uniform> params2: Params2;
@group(0) @binding(4) var<uniform> ml_weights: MLWeights;

// Аккумулятор Тени (Схлопнувшаяся суперпозиция мертвых веток)
var<workgroup> shadow_superposition: atomic<u32>;

@compute @workgroup_size(256)
fn pass2_main(@builtin(global_invocation_id) global_id: vec3<u32>, @builtin(local_invocation_id) local_id: vec3<u32>, @builtin(workgroup_id) group_id: vec3<u32>) {
    if (local_id.x == 0u) {
        atomicStore(&shadow_superposition, 0u);
    }
    workgroupBarrier();

    let cp_idx = group_id.x + group_id.y * params2.grid_dim_x;
    let max_cp = atomicLoad(&counters.checkpoints_found);
    if (cp_idx >= max_cp || cp_idx >= params2.max_checkpoints) {
        return;
    }

    let cp = checkpoints[cp_idx];
    
    var final_diff_distance: f32 = 0.0;
    
    var a = cp.s0; var b = cp.s1; var c = cp.s2; var d = cp.s3;
    var e = cp.s4; var f = cp.s5; var g = cp.s6; var h = cp.s7;

    var w: array<u32, 64>;
    w[0] = cp.w0; w[1] = cp.w1; w[2] = cp.w2; w[3] = cp.w3;
    w[4] = cp.w4; w[5] = cp.w5; w[6] = cp.w6; w[7] = cp.w7;
    w[8] = cp.w8; w[9] = cp.w9; w[10] = cp.w10; w[11] = cp.w11;
    w[12] = cp.w12; w[13] = cp.w13; w[14] = cp.w14; w[15] = cp.w15;

    // Mutate the nonce
    var mutant_nonce = cp.nonce;
    var current_strain = ml_weights.viral_mask;

    if (current_strain != 0u) {
        mutant_nonce = mutant_nonce ^ (current_strain ^ (local_id.x * ml_weights.current_floor));
    } else {
        // Обычный симбиоз
        mutant_nonce = mutant_nonce ^ (1u << (local_id.x % 32u));
    }
    w[15] = mutant_nonce;

    for (var i = 16u; i < 64u; i++) {
        w[i] = w[i - 16u] + sig0(w[i - 15u]) + w[i - 7u] + sig1(w[i - 2u]);
    }

    // 1. Проекция оригинального состояния (24 раунд) в 3D-вектор
    let scale = 1.0 / 4294967295.0; // Масштабирование u32 в f32
    let orig_a = f32(cp.s0) * scale;
    let orig_b = f32(cp.s1) * scale;
    let orig_c = f32(cp.s2) * scale;
    let original_vec = vec3<f32>(orig_a, orig_b, orig_c);

    for (var i = 24u; i < 64u; i++) {
        let t1 = h + ep1(e) + ch(e, f, g) + K[i] + w[i];
        let t2 = ep0(a) + maj(a, b, c);
        h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;

        // 2. Топологический срез на cut_round (настраиваемый из JS)
        if (i == ml_weights.cut_round) {
            let mut_a = f32(a) * scale;
            let mut_b = f32(b) * scale;
            let mut_c = f32(c) * scale;
            let mutant_vec = vec3<f32>(mut_a, mut_b, mut_c);
            
            // 1. Извлекаем "Спин" (правое полушарие регистров)
            let spin_orig = vec4<f32>(f32(cp.s4), f32(cp.s5), f32(cp.s6), f32(cp.s7));
            let spin_mut = vec4<f32>(f32(e), f32(f), f32(g), f32(h));

            // 2. Вычисляем Тензор Ошибки Спина (Cross-Product аналог для 4D)
            // Это геометрическая форма того, КАК именно закрутилась коллизия
            let spin_error = spin_mut - spin_orig;
            let spin_magnitude = length(spin_error);
            
            // 3. Вычисление физического расхождения (дифференциала)
            let norm_mut = normalize(mutant_vec);
            let norm_orig = normalize(original_vec);
            // Скалярное произведение дает от -1 (противоположны) до 1 (идентичны).
            // 1.0 - dot() дает нам удобный порог от 0.0 до 2.0, не зависящий от масштаба лавины!
            final_diff_distance = 1.0 - dot(norm_mut, norm_orig); 
            
            // 4. Условие Апоптоза
            // Если дистанция > thresholds, волна мутации пошла по разрушительному пути.
            if (final_diff_distance > ml_weights.apoptosis_threshold) {
                atomicAdd(&counters.apoptosis_kills, 1u);
                
                // Преобразуем вектор ошибки спина в 32-битный скаляр (сжатие размерности)
                // Мы берем самый искаженный регистр (например, 'e' - первый компонент спина)
                let error_gradient = bitcast<u32>(spin_error.x);
                
                // Сбрасываем слепок замочной скважины в общую память
                atomicXor(&shadow_superposition, error_gradient);
                
                return; // Мгновенный коллапс ветки
            }
        }

        if (i == ml_weights.cut_round + 1u) {
            let collapsed_shadow = atomicLoad(&shadow_superposition);
            
            if (collapsed_shadow != 0u) {
                // Извлекаем корень из ошибки. Инвертируем геометрию коллизии.
                // Если ошибка тянула вектор "влево", мы аналитически сдвигаем nonce "вправо".
                let analytic_correction = ~collapsed_shadow + 1u; // Комплексное сопряжение (Two's complement)
                
                // Туннелирование: применяем инвертированную геометрию напрямую к геному
                mutant_nonce = mutant_nonce ^ analytic_correction;
                
                // Синхронизируем спин победителя с новым геномом
                e = e ^ analytic_correction;
                w[15] = mutant_nonce;
            }
        }
    }

    // Pseudo-finalisation
    let hash_word0 = a + 0x6a09e667u;
    let hash_word1 = b + 0xbb67ae85u;

    var total_zeros = countLeadingZeros(hash_word0);
    if (total_zeros == 32u) {
        total_zeros += countLeadingZeros(hash_word1);
    }

    if (total_zeros >= params2.zero_target) {
        let w_idx = atomicAdd(&counters.successes_found, 1u);
        if (w_idx < params2.max_winners) {
            winners[w_idx] = SuccessWinner(cp.nonce, mutant_nonce, hash_word0, hash_word1, final_diff_distance, 0u, 0u, 0u);
        }
    }
}
`;

type EvolutionTick = {
    time: string;
    pass1: number;
    pass2: number;
    cps: number;
    apoptosis: number;
    floor: number;
    viralMask: number;
    totalPass1: number;
    totalPass2: number;
    totalApoptosis: number;
};

type EvolutionSlot = {
    floor: number;
    timestamp: number;
    ticksBefore: EvolutionTick[];
    ticksAfter: EvolutionTick[];
};

export function TwoPassMiner({ onClose }: { onClose: () => void }) {
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState({ pass1Hdr: 0, pass2Hdr: 0, cps: 0, hr: 0, apoptosis: 0, viralMask: 0 });
    const [recordedSlots, setRecordedSlots] = useState<EvolutionSlot[]>([]);
    const recentTicksRef = useRef<EvolutionTick[]>([]);
    const recordingTailRef = useRef<{ active: boolean; floor: number; before: EvolutionTick[]; after: EvolutionTick[]; remaining: number }>({
        active: false,
        floor: 0,
        before: [],
        after: [],
        remaining: 0
    });
    const [logLines, setLogLines] = useState<{msg: string, type: 'evo' | 'system' | 'spam', time: string, id: number}[]>([]);
    const [winnersList, setWinnersList] = useState<{mutant: number, hash0: number, hash1: number, zeros: number}[]>([]);
    const winnersListRef = useRef<{mutant: number, hash0: number, hash1: number, zeros: number}[]>([]);
    const statsAccRef = useRef({ pass1Hdr: 0, pass2Hdr: 0, apoptosis: 0 });
    
    const gpuRef = useRef<{ جهاز: GPUDevice | null } | null>(null);
    const loopEnabled = useRef(false);
    const metaCheckpointRef = useRef({ baseNonce: 0 });
    const mlStateRef = useRef({
        threshold: 0.5,
        cutRound: 30,
        currentFloor: 22,
        floorMemory: new Map<number, number>(),
        stagnationCounter: 0,
        viralMask: 0,
        viralStrikes: 0
    });

    const [epoch, setEpoch] = useState(1);
    const [epochTimeLeft, setEpochTimeLeft] = useState(600);
    
    // Performance controls
    const [intensity, setIntensity] = useState(1);
    const [vramScale, setVramScale] = useState(1);
    const [memoryScale, setMemoryScale] = useState(1);
    const [lsWriteRate, setLsWriteRate] = useState(1);
    const configRef = useRef({ intensity: 1, vramScale: 1, memoryScale: 1, lsWriteRate: 1 });

    const updateIntensity = (val: number) => {
        setIntensity(val);
        configRef.current.intensity = val;
    };

    const updateConfig = (key: keyof typeof configRef.current, val: number) => {
        configRef.current[key] = val;
        if (key === 'vramScale') setVramScale(val);
        if (key === 'memoryScale') setMemoryScale(val);
        if (key === 'lsWriteRate') setLsWriteRate(val);
    };

    const launchPipelineRef = useRef<() => void>();

    useEffect(() => {
        const saved = localStorage.getItem('twopass_meta_state');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.winnersList) {
                    setWinnersList(parsed.winnersList);
                    winnersListRef.current = parsed.winnersList;
                }
                if (parsed.baseNonce) metaCheckpointRef.current.baseNonce = parsed.baseNonce;
            } catch (e) {}
        }
        const savedEvo = localStorage.getItem('twopass_evolution_logs');
        if (savedEvo) {
            try {
                setRecordedSlots(JSON.parse(savedEvo));
            } catch (e) {}
        }
        
        if (launchPipelineRef.current) launchPipelineRef.current();

        const timerId = setInterval(() => {
            setEpochTimeLeft(prev => {
                if (prev <= 1) {
                    setEpoch(e => e + 1);
                    return 600;
                }
                return prev - 1;
            });
        }, 1000);

        return () => {
            loopEnabled.current = false;
            clearInterval(timerId);
        };
    }, []);

    useEffect(() => {
        if (epoch > 1) {
            addLog(`[ЭПОХА] Началась эпоха ${epoch}`, 'evo');
        }
    }, [epoch]);

    const exportEvolutionCSV = () => {
        let csvContent = "data:text/csv;charset=utf-8,SlotTimestamp,Floor,Phase,TickTime,Pass1,Pass2,CPS,Apoptosis,FloorState,ViralMask,TotalPass1,TotalPass2,TotalApoptosis\n";
        
        recordedSlots.forEach(slot => {
            const slotTs = new Date(slot.timestamp).toISOString();
            slot.ticksBefore.forEach(t => {
                csvContent += `${slotTs},${slot.floor},BEFORE,${t.time},${t.pass1},${t.pass2},${t.cps},${t.apoptosis},${t.floor},${t.viralMask},${t.totalPass1},${t.totalPass2},${t.totalApoptosis}\n`;
            });
            slot.ticksAfter.forEach(t => {
                csvContent += `${slotTs},${slot.floor},AFTER,${t.time},${t.pass1},${t.pass2},${t.cps},${t.apoptosis},${t.floor},${t.viralMask},${t.totalPass1},${t.totalPass2},${t.totalApoptosis}\n`;
            });
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `evolution_ticks_${new Date().getTime()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportCSV = () => {
        if (winnersList.length === 0) return;
        const csvContent = "data:text/csv;charset=utf-8,MutantNonce,Zeros,Hash0,Hash1\n" + 
            winnersList.map(w => `${w.mutant},${w.zeros},${w.hash0.toString(16).padStart(8,'0')},${w.hash1.toString(16).padStart(8,'0')}`).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `twopass_meta_checkpoints.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const addLog = (msg: string, type: 'evo' | 'system' | 'spam' = 'system') => {
        setLogLines(prev => {
            const newLog = {msg, type, time: new Date().toLocaleTimeString(), id: Date.now() + Math.random()};
            const allLogs = [newLog, ...prev];
            const evoSystemLogs = allLogs.filter(l => l.type === 'evo' || l.type === 'system').slice(0, 150);
            const spamLogs = allLogs.filter(l => l.type === 'spam').slice(0, 150);
            return [...evoSystemLogs, ...spamLogs].sort((a,b) => b.id - a.id);
        });
    };

    launchPipelineRef.current = async () => {
        if (!running) await toggleMiner();
    };

    const toggleMiner = async () => {
        if (running) {
            loopEnabled.current = false;
            setRunning(false);
            return;
        }
        
        setError(null);
        try {
            if (!navigator.gpu) {
                throw new Error("WebGPU is not supported on this browser.");
            }
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) throw new Error("No GPU adapter found.");
            const device = await adapter.requestDevice();
            gpuRef.current = { جهاز: device };

            const pass1Module = device.createShaderModule({ code: PASS1_WGSL });
            const pass2Module = device.createShaderModule({ code: PASS2_WGSL });
            
            const bindGroupLayout1 = device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                ]
            });
            const bindGroupLayout2 = device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                ]
            });

            const pipeline1 = device.createComputePipeline({
                layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout1] }),
                compute: { module: pass1Module, entryPoint: "pass1_main" }
            });

            const pipeline2 = device.createComputePipeline({
                layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout2] }),
                compute: { module: pass2Module, entryPoint: "pass2_main" }
            });

            const MAX_CHECKPOINTS = 8192 * configRef.current.vramScale;
            const MAX_WINNERS = 64 * configRef.current.vramScale;
            
            const checkpointsBuffer = device.createBuffer({ size: MAX_CHECKPOINTS * 112, usage: GPUBufferUsage.STORAGE });
            const countersBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
            const countersReadBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
            
            const winnersBuffer = device.createBuffer({ size: MAX_WINNERS * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
            const winnersReadBuffer = device.createBuffer({ size: MAX_WINNERS * 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

            const params1Buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            const params2Buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            const mlWeightsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

            const bindGroup1 = device.createBindGroup({
                layout: bindGroupLayout1,
                entries: [
                    { binding: 0, resource: { buffer: checkpointsBuffer } },
                    { binding: 1, resource: { buffer: countersBuffer } },
                    { binding: 2, resource: { buffer: params1Buffer } },
                ]
            });

            const bindGroup2 = device.createBindGroup({
                layout: bindGroupLayout2,
                entries: [
                    { binding: 0, resource: { buffer: checkpointsBuffer } },
                    { binding: 1, resource: { buffer: countersBuffer } },
                    { binding: 2, resource: { buffer: winnersBuffer } },
                    { binding: 3, resource: { buffer: params2Buffer } },
                    { binding: 4, resource: { buffer: mlWeightsBuffer } },
                ]
            });

            loopEnabled.current = true;
            setRunning(true);
            
            let baseNonce = metaCheckpointRef.current.baseNonce;
            let iterCounter = 0;
            const ZERO_TARGET = 17; // Adjust here for difficulty

            const loop = async () => {
                if (!loopEnabled.current) return;

                const PASS1_WORKGROUPS = 1024 * configRef.current.intensity;
                const pass1WgX = Math.min(PASS1_WORKGROUPS, 65535);
                const pass1WgY = Math.ceil(PASS1_WORKGROUPS / pass1WgX);
                const pass1BatchSize = pass1WgX * pass1WgY * 256;
                const p1Data = new Uint32Array([baseNonce, MAX_CHECKPOINTS, pass1WgX, 0]);
                device.queue.writeBuffer(params1Buffer, 0, p1Data);
                
                const pass2WgX = Math.min(MAX_CHECKPOINTS, 65535);
                const pass2WgY = Math.ceil(MAX_CHECKPOINTS / pass2WgX);
                const p2Data = new Uint32Array([MAX_CHECKPOINTS, MAX_WINNERS, ZERO_TARGET, pass2WgX]);
                device.queue.writeBuffer(params2Buffer, 0, p2Data);

                const mlDataBuf = new ArrayBuffer(16);
                const mlDataFloat = new Float32Array(mlDataBuf);
                const mlDataUint = new Uint32Array(mlDataBuf);
                
                const FIXED_CUT_ROUND = 30;
                // Идеальный горизонт событий. Абсолютное равновесие.
                const FIXED_THRESHOLD = 0.5; 
                mlDataFloat[0] = FIXED_THRESHOLD;
                mlDataUint[1] = FIXED_CUT_ROUND;
                mlDataUint[2] = mlStateRef.current.currentFloor;
                mlDataUint[3] = mlStateRef.current.viralMask;
                device.queue.writeBuffer(mlWeightsBuffer, 0, mlDataFloat);

                // Reset counters
                device.queue.writeBuffer(countersBuffer, 0, new Uint32Array([0, 0, 0, 0]));

                const encoder = device.createCommandEncoder();
                
                // PASS 1: SCOUTS
                const pass1 = encoder.beginComputePass();
                pass1.setPipeline(pipeline1);
                pass1.setBindGroup(0, bindGroup1);
                pass1.dispatchWorkgroups(pass1WgX, pass1WgY, 1);
                pass1.end();

                // PASS 2: STORMTROOPERS (Indirect dispatch based on checkpoints... actually wgsl doesn't support indirect easily in simple examples, so we launch assuming max and let shader abort early)
                // Wait, it's simpler to just launch 1 workgroup per checkpoint if we can! But we must do it from CPU or use dispatchWorkgroupsIndirect.
                // Let's use max checkpoints!
                const pass2 = encoder.beginComputePass();
                pass2.setPipeline(pipeline2);
                pass2.setBindGroup(0, bindGroup2);
                pass2.dispatchWorkgroups(pass2WgX, pass2WgY, 1);
                pass2.end();

                encoder.copyBufferToBuffer(countersBuffer, 0, countersReadBuffer, 0, 16);
                device.queue.submit([encoder.finish()]);

                await countersReadBuffer.mapAsync(GPUMapMode.READ);
                const countArr = new Uint32Array(countersReadBuffer.getMappedRange());
                const cps = countArr[0];
                const wns = countArr[1];
                const apoptosisKills = countArr[2];
                countersReadBuffer.unmap();
                
                let bestDist = 0;
                let newFloorReached = false;
                let nextBaseNonce: number | null = null;

                if (wns > 0) {
                    const readEnc = device.createCommandEncoder();
                    readEnc.copyBufferToBuffer(winnersBuffer, 0, winnersReadBuffer, 0, wns * 32);
                    device.queue.submit([readEnc.finish()]);
                    await winnersReadBuffer.mapAsync(GPUMapMode.READ);
                    const mappedBuffer = winnersReadBuffer.getMappedRange();
                    const winBufUint = new Uint32Array(mappedBuffer);
                    const winBufFloat = new Float32Array(mappedBuffer);
                    
                    let anyNew = false;
                    for (let i = 0; i < Math.min(wns, MAX_WINNERS); i++) {
                        const base = winBufUint[i * 8];
                        const mut = winBufUint[i * 8 + 1];
                        const h0 = winBufUint[i * 8 + 2];
                        const h1 = winBufUint[i * 8 + 3];
                        const dist = winBufFloat[i * 8 + 4];
                        const zeros = h0 === 0 ? 32 + Math.clz32(h1) : Math.clz32(h0);
                        
                        // Если мутант пробил текущий этаж или поднялся выше
                        if (zeros >= mlStateRef.current.currentFloor) {
                            newFloorReached = true;
                            
                            // 1. Лифт едет вверх
                            mlStateRef.current.currentFloor = zeros + 1;
                            
                            // 2. ХРАПОВИК ЭВОЛЮЦИИ (Долговременная память)
                            // Победитель становится новой отправной точкой для всей Вселенной!
                            nextBaseNonce = mut;
                            
                            console.log(`[ПАМЯТЬ] База обновлена! Новый фундамент: ${nextBaseNonce}`);
                            
                            // 3. Откатываем стагнацию
                            mlStateRef.current.stagnationCounter = 0;
                            mlStateRef.current.viralStrikes = 0;
                            
                            const msg = `[ЭВОЛЮЦИЯ] Лифт поднялся на этаж ${mlStateRef.current.currentFloor}!`;
                            console.log(msg);
                            addLog(msg, 'evo');
                            
                            if (!recordingTailRef.current.active) {
                                recordingTailRef.current = {
                                    active: true,
                                    floor: mlStateRef.current.currentFloor,
                                    before: [...recentTicksRef.current],
                                    after: [],
                                    remaining: 50 // record 50 ticks after
                                };
                            }
                        }

                        const exists = winnersListRef.current.some(p => p.mutant === mut);
                        if (!exists) {
                            anyNew = true;
                            if (bestDist === 0 || dist < bestDist) bestDist = dist;
                            winnersListRef.current.push({mutant: mut, hash0: h0, hash1: h1, zeros});
                            winnersListRef.current.sort((a, b) => b.zeros - a.zeros);
                            winnersListRef.current = winnersListRef.current.slice(0, 10); // Keep ONLY top 10

                            addLog(`[БЛОК] Выпал блок с ${zeros} нулями! Hash Start: ${h0.toString(16).padStart(8, '0')}`, 'spam');
                        }
                    }
                    winnersReadBuffer.unmap();
                    
                    if (anyNew) {
                        const currentList = [...winnersListRef.current];
                        setWinnersList(currentList);
                        localStorage.setItem('twopass_meta_state', JSON.stringify({
                            baseNonce: baseNonce,
                            winnersList: currentList
                        }));
                    }
                }

                const STAGNATION_LIMIT = 150;
                if (newFloorReached) {
                    mlStateRef.current.stagnationCounter = 0;
                    mlStateRef.current.viralMask = 0;
                } else {
                    mlStateRef.current.stagnationCounter++;
                }

                // === ВСПЫШКА ВИРУСА ===
                if (mlStateRef.current.stagnationCounter > 150) {
                    if (mlStateRef.current.currentFloor % 2 !== 0) { // Дыхание: работаем только в Диастолу
                        // 1. Читаем физику роя
                        let swarmHash = Math.abs(oracleState.x * 1000 + oracleState.y * 1000 + oracleState.z * 1000);
                        
                        // 2. Читаем тяжелую память из RAM
                        let momentum = calculateHistoricalMomentum();
                        let momentumHash = Math.abs(momentum.x * 100 + momentum.y * 100 + Math.sin(momentum.z) * 100);
                        
                        // 3. Вычисляем Резонансный Бит
                        let resonantBit = Math.floor(swarmHash + momentumHash + mlStateRef.current.viralStrikes) % 32;
                        
                        mlStateRef.current.viralMask = 1 << resonantBit;
                        mlStateRef.current.viralStrikes++; // Вращаем барабан на случай следующей неудачи
                        
                        const msg = `☣️ СИНГУЛЯРНОСТЬ: Рой и RAM активированы. Сдвиг бита №${resonantBit} (Удар ${mlStateRef.current.viralStrikes})`;
                        console.log(msg);
                        addLog(msg, 'evo');
                        
                        // 4. Записываем текущее состояние Роя в Глобальную RAM
                        if (shadowCursor < SHADOW_GRAPH_SIZE - 3) {
                            globalShadowGraph[shadowCursor] = oracleState.x;
                            globalShadowGraph[shadowCursor+1] = oracleState.y;
                            globalShadowGraph[shadowCursor+2] = oracleState.z;
                            shadowCursor += 3;
                        }
                    } else {
                        mlStateRef.current.viralMask = 0;
                        mlStateRef.current.viralStrikes = 0;
                        const msg = `⏳ СИСТОЛА: Вирус спит. Квантовый коллапс активен.`;
                        console.log(msg);
                        addLog(msg, 'evo');
                    }
                    mlStateRef.current.stagnationCounter = 0;
                }
                
                const totalPass2 = cps * 256;
                statsAccRef.current.pass1Hdr += pass1BatchSize;
                statsAccRef.current.pass2Hdr += totalPass2;
                statsAccRef.current.apoptosis += apoptosisKills;

                const currentTick: EvolutionTick = {
                    time: new Date().toISOString(),
                    pass1: pass1BatchSize,
                    pass2: totalPass2,
                    cps: cps,
                    apoptosis: apoptosisKills,
                    floor: mlStateRef.current.currentFloor,
                    viralMask: mlStateRef.current.viralMask,
                    totalPass1: statsAccRef.current.pass1Hdr,
                    totalPass2: statsAccRef.current.pass2Hdr,
                    totalApoptosis: statsAccRef.current.apoptosis
                };

                // Add to recent ticks buffer
                recentTicksRef.current.push(currentTick);
                const maxTicks = 50 * configRef.current.memoryScale;
                if (recentTicksRef.current.length > maxTicks) {
                    recentTicksRef.current.splice(0, recentTicksRef.current.length - maxTicks);
                }

                // Append after if recording
                if (recordingTailRef.current.active) {
                    recordingTailRef.current.after.push(currentTick);
                    recordingTailRef.current.remaining--;
                    if (recordingTailRef.current.remaining <= 0) {
                        recordingTailRef.current.active = false;
                        const newSlot: EvolutionSlot = {
                            floor: recordingTailRef.current.floor,
                            timestamp: Date.now(),
                            ticksBefore: [...recordingTailRef.current.before],
                            ticksAfter: [...recordingTailRef.current.after]
                        };
                        setRecordedSlots(prev => {
                            const updated = [...prev, newSlot];
                            localStorage.setItem('twopass_evolution_logs', JSON.stringify(updated));
                            return updated;
                        });
                    }
                }

                setStats(s => ({
                    pass1Hdr: s.pass1Hdr + pass1BatchSize,
                    pass2Hdr: s.pass2Hdr + totalPass2,
                    cps: cps,
                    hr: (s.pass1Hdr + pass1BatchSize),
                    apoptosis: s.apoptosis + apoptosisKills,
                    viralMask: mlStateRef.current.viralMask
                }));

                if (nextBaseNonce !== null) {
                    baseNonce = nextBaseNonce;
                } else {
                    baseNonce += pass1BatchSize;
                }
                metaCheckpointRef.current.baseNonce = baseNonce;
                
                // Save meta-checkpoint periodically
                iterCounter++;
                const writeThreshold = Math.max(1, Math.floor(60 / configRef.current.lsWriteRate));
                if (iterCounter % writeThreshold === 0) {
                    localStorage.setItem('twopass_meta_state', JSON.stringify({
                        baseNonce: baseNonce,
                        winnersList: winnersListRef.current
                    }));
                }

                requestAnimationFrame(loop);
            };

            requestAnimationFrame(loop);
        } catch(e: any) {
            setError(e.message);
            addLog(`ERROR: ${e.message}`);
            setRunning(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-[#050505] text-[#00FF41] font-mono flex flex-col overflow-y-auto">
            <TopologicalOracle />
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 p-3 md:p-4 flex justify-between items-start md:items-center z-20 border-b border-[#00FF41]/30 bg-black/80 backdrop-blur-md">
                <div className="flex items-center gap-2 md:gap-4 flex-1">
                    <Activity className="w-5 h-5 min-w-[20px] animate-pulse hidden sm:block" />
                    <div className="flex-1">
                        <h1 className="text-sm md:text-xl font-black tracking-tighter leading-tight uppercase flex items-center gap-2">
                            <Zap className="w-4 h-4" /> Two-Pass Shader Architecture
                        </h1>
                        <p className="text-[8px] md:text-[10px] opacity-60 leading-tight mt-1">Отказ от 64 раундов: Pass 1 Scouts (0-24), Сheckpointing, Pass 2 Stormtroopers (25-63)</p>
                    </div>
                </div>
                <button 
                    onClick={onClose}
                    className="p-2 border border-[#00FF41]/30 hover:bg-[#00FF41]/20 flex items-center gap-2 shrink-0 bg-black rounded"
                >
                    <ChevronLeft className="w-4 h-4" /> <span className="hidden sm:inline">EXIT</span>
                </button>
            </header>

            <div className="flex-1 mt-20 md:mt-24 max-w-6xl w-full mx-auto p-4 flex flex-col lg:flex-row gap-6 pb-20">
                {/* Control Panel */}
                <div className="flex flex-col gap-4 w-full lg:w-1/3 shrink-0">
                    <div className="p-4 border border-[#00FF41]/30 bg-black/80 flex flex-col gap-4 shadow-[0_0_15px_rgba(0,255,65,0.1)]">
                        <h2 className="text-sm font-bold uppercase border-b border-[#00FF41]/30 pb-2 mb-2 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2"><Shield className="w-4 h-4" /> Coordinator</span>
                            <span className="text-[#FF00FF]">EPOCH {epoch} ({Math.floor(epochTimeLeft / 60)}:{(epochTimeLeft % 60).toString().padStart(2, '0')})</span>
                        </h2>
                        {error && <div className="text-[#FF3E3E] text-xs p-2 bg-[#FF3E3E]/10 border border-[#FF3E3E]/30">{error}</div>}
                        
                        <button 
                            onClick={toggleMiner}
                            className={`w-full py-3 font-bold uppercase transition-colors flex justify-center items-center gap-2 border ${running ? 'bg-[#00FF41] text-black border-[#00FF41] shadow-[0_0_10px_#00FF41]' : 'bg-transparent text-[#00FF41] border-[#00FF41] hover:bg-[#00FF41]/10'}`}
                        >
                            {running ? 'STOP PIPELINE' : 'LAUNCH PIPELINE'}
                        </button>

                        <div className="flex flex-col gap-2 border border-[#00FF41]/30 p-2 mt-2">
                            <span className="text-[10px] uppercase opacity-70">Настройки Нагрузки Железа</span>
                            
                            <div className="flex flex-col gap-1">
                                <span className="text-[9px] opacity-50 flex justify-between">
                                    <span>GPU: ХЕШ ВОРКЕРЫ (Увеличит нагрузку на видеоядро)</span>
                                    <span className="text-[#00FF41]">{intensity}x</span>
                                </span>
                                <input 
                                    type="range" min="1" max="1000" step="1" 
                                    value={intensity} 
                                    onChange={(e) => updateIntensity(parseInt(e.target.value))}
                                    className="w-full cursor-pointer accent-[#00FF41]"
                                />
                                <span className="text-[8px] text-[#00FF41]/50 mb-2">~ {(262144 * intensity).toLocaleString()} хешей/кадр</span>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-[9px] opacity-50 flex justify-between">
                                    <span>VRAM: ВЫДЕЛЕНИЕ ПАМЯТИ (Применится при перезапуске)</span>
                                    <span className="text-[#00FF41]">{vramScale}x</span>
                                </span>
                                <input 
                                    type="range" min="1" max="200" step="1" 
                                    value={vramScale} 
                                    onChange={(e) => updateConfig('vramScale', parseInt(e.target.value))}
                                    className="w-full cursor-pointer accent-[#00FF41]"
                                />
                                <span className="text-[8px] text-[#00FF41]/50 mb-2">Объем буферов: {8192 * vramScale} слотов</span>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-[9px] opacity-50 flex justify-between">
                                    <span>RAM / HEAP: РАЗМЕР ХВОСТОВ (JS Массивы)</span>
                                    <span className="text-[#00FF41]">{memoryScale}x</span>
                                </span>
                                <input 
                                    type="range" min="1" max="2000" step="1" 
                                    value={memoryScale} 
                                    onChange={(e) => updateConfig('memoryScale', parseInt(e.target.value))}
                                    className="w-full cursor-pointer accent-[#00FF41]"
                                />
                                <span className="text-[8px] text-[#00FF41]/50 mb-2">{50 * memoryScale} записей в хвосте</span>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-[9px] opacity-50 flex justify-between">
                                    <span>LOCALSTORAGE: ЧАСТОТА ЗАПИСИ (I/O)</span>
                                    <span className="text-[#00FF41]">{lsWriteRate}x</span>
                                </span>
                                <input 
                                    type="range" min="1" max="60" step="1" 
                                    value={lsWriteRate} 
                                    onChange={(e) => updateConfig('lsWriteRate', parseInt(e.target.value))}
                                    className="w-full cursor-pointer accent-[#00FF41]"
                                />
                                <span className="text-[8px] text-[#00FF41]/50">Запись каждые {Math.max(1, Math.floor(60 / lsWriteRate))} итераций</span>
                            </div>
                        </div>

                        <button 
                            onClick={exportCSV}
                            className="w-full py-2 font-bold uppercase transition-colors flex justify-center items-center gap-2 border border-[#00FF41]/50 bg-[#00FF41]/10 text-[#00FF41] hover:bg-[#00FF41]/30 text-xs"
                        >
                            <Download className="w-3 h-3" /> ВЫГРУЗИТЬ ЧЕКПОИНТ И ЛИДЕРБОРД (CSV)
                        </button>

                        <div className="mt-2 border border-blue-500/30 bg-blue-900/10 p-2 flex flex-col gap-2">
                            <div className="flex justify-between text-[10px] uppercase text-blue-400">
                                <span>RECORDED EVOLUTION SLOTS</span>
                                <span>{recordedSlots.length} / MAX</span>
                            </div>
                            <div className="w-full bg-blue-900/30 h-1.5 rounded-full overflow-hidden">
                                <div className="bg-blue-400 h-full transition-all duration-300" style={{ width: `${Math.min(100, (recordedSlots.length / 100) * 100)}%` }} />
                            </div>
                            <div className="flex gap-2 text-[10px]">
                                <button 
                                    onClick={exportEvolutionCSV}
                                    className="flex-1 py-1 flex items-center justify-center gap-1 border border-blue-400/50 bg-blue-400/10 text-blue-400 hover:bg-blue-400 hover:text-black transition-colors"
                                >
                                    <Download className="w-3 h-3" /> СКАЧАТЬ CSV (ХВОСТЫ)
                                </button>
                                <button 
                                    onClick={() => {
                                        setRecordedSlots([]);
                                        localStorage.removeItem('twopass_evolution_logs');
                                    }}
                                    className="flex-1 py-1 flex items-center justify-center gap-1 border border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-red-100 transition-colors"
                                >
                                    ОЧИСТИТЬ (L.S.)
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
                            <div className="flex flex-col border border-[#00FF41]/20 p-2">
                                <span className="text-[9px] opacity-60">Scouts (Pass 1)</span>
                                <span className="font-bold">{stats.pass1Hdr.toLocaleString()}</span>
                            </div>
                            <div className="flex flex-col border border-[#00FF41]/20 p-2">
                                <span className="text-[9px] opacity-60">Stormtroopers (Pass 2)</span>
                                <span className="font-bold">{stats.pass2Hdr.toLocaleString()}</span>
                            </div>
                            <div className="flex flex-col border border-[#00FF41]/20 p-2">
                                <span className="text-[9px] opacity-60">Апоптоз (Убито ветвей)</span>
                                <span className="font-bold text-[#FF3E3E]">{stats.apoptosis.toLocaleString()}</span>
                            </div>
                            <div className="flex flex-col border border-[#00FF41]/20 p-2">
                                <span className="text-[9px] opacity-60">ML Threshold (Auto)</span>
                                <span className="font-bold text-[#00FFFF]">{mlStateRef.current.threshold.toFixed(4)}</span>
                            </div>
                            <div className="flex flex-col border border-[#00FF41]/20 p-2">
                                <span className="text-[9px] opacity-60">Recent Checkpoints</span>
                                <span className="font-bold text-yellow-400">{stats.cps}</span>
                            </div>
                            <div className="flex flex-col border border-[#00FF41]/20 p-2">
                                <span className="text-[9px] opacity-60">Successes</span>
                                <span className="font-bold text-[#00FF41] animate-pulse">{winnersList.length}</span>
                            </div>
                        </div>
                        {stats.viralMask !== 0 && (
                            <div className="mt-2 text-center text-xs font-bold bg-[#FF3E3E]/20 text-[#FF3E3E] animate-pulse border border-[#FF3E3E] p-1">
                                ☣️ STATUS: VIRAL OUTBREAK
                            </div>
                        )}
                    </div>

                    <div className="p-4 border border-[#00FF41]/30 bg-black/80 flex flex-col h-64 shrink-0 overflow-hidden relative">
                        <div className="flex justify-between items-center border-b border-[#00FF41]/30 pb-2 mb-2 sticky top-0 bg-black z-10">
                            <div className="flex gap-4 items-center">
                                <span className="text-sm font-bold uppercase text-[#00FF41]">ЖУРНАЛ СКАНИРОВАНИЯ (ВСЕ БЛОКИ)</span>
                            </div>
                            <button 
                                onClick={() => {
                                    const textBytes = logLines.filter(l => l.type !== 'evo').map(l => `[${l.time}] ${l.msg}`).join('\n');
                                    navigator.clipboard.writeText(textBytes);
                                }} 
                                className="text-[10px] hover:text-white px-2 py-1 border border-[#00FF41]/30 flex items-center gap-1 transition-colors hover:bg-[#00FF41]/20">
                                <Download size={10} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto text-[10px] space-y-1 opacity-80 pb-2">
                            {logLines.filter(l => l.type !== 'evo').map((l, i) => <div key={i} className={l.type === 'system' ? 'text-red-400' : ''}><span className="opacity-50">[{l.time}]</span> {l.msg}</div>)}
                        </div>
                    </div>
                </div>

                {/* Main Log/View */}
                <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                    {/* LEADERBOARD */}
                    <div className="flex-1 flex flex-col border border-[#00FF41]/30 bg-black/80 overflow-hidden">
                         <h2 className="text-sm font-bold uppercase border-b border-[#00FF41]/30 p-4 bg-black/80 sticky top-0 flex items-center gap-2 z-10">
                             <Layout className="w-4 h-4" /> LEADERBOARD (TOP-10 БЛОКОВ)
                         </h2>
                         <div className="p-4 overflow-y-auto flex-1 text-xs">
                             {winnersList.length === 0 ? (
                                 <div className="opacity-50 text-center mt-10">Ожидание совпадений (Target Zeros: 17)...</div>
                             ) : (
                                 <table className="w-full text-left">
                                     <thead>
                                         <tr className="border-b border-[#00FF41]/30 opacity-60 text-[10px]">
                                             <th className="pb-2">Zeros</th>
                                             <th className="pb-2">Mutant Nonce</th>
                                             <th className="pb-2">Hash Output</th>
                                         </tr>
                                     </thead>
                                     <tbody>
                                         {winnersList.map((w, i) => (
                                             <tr key={i} className="border-b border-[#00FF41]/10 hover:bg-[#00FF41]/5 transition-colors">
                                                 <td className="py-2 text-[10px] font-bold text-white">{w.zeros}</td>
                                                 <td className="py-2 text-[10px]">0x{w.mutant.toString(16).padStart(8, '0')}</td>
                                                 <td className="py-2 font-bold text-yellow-400 glow-text">
                                                     {w.hash0.toString(16).padStart(8, '0')}
                                                     {w.hash1.toString(16).padStart(8, '0')}...
                                                 </td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             )}
                         </div>
                    </div>

                    {/* EVOLUTION LOG */}
                    <div className="h-64 flex flex-col border border-blue-500/30 bg-[#001020]/90 overflow-hidden shrink-0">
                        <div className="flex justify-between items-center border-b border-blue-500/30 p-2 pl-4 bg-black/80 sticky top-0 z-10">
                            <h2 className="text-sm font-bold uppercase text-blue-400 flex items-center gap-2">
                                <Activity className="w-4 h-4" /> ЛОГ ЛИФТОВ ЭВОЛЮЦИИ
                            </h2>
                            <button 
                                onClick={() => {
                                    const textBytes = logLines.filter(l => l.type === 'evo').map(l => `[${l.time}] ${l.msg}`).join('\n');
                                    navigator.clipboard.writeText(textBytes);
                                }} 
                                className="text-[10px] text-blue-400 hover:text-blue-100 px-2 py-1 border border-blue-500/30 flex items-center gap-1 transition-colors hover:bg-blue-500/20">
                                <Download size={10} /> Копировать
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto flex-1 text-[10px] space-y-1">
                            {logLines.filter(l => l.type === 'evo').map((l, i) => (
                                <div key={i} className="text-blue-300">
                                    <span className="opacity-50 mr-2">[{l.time}]</span>
                                    {l.msg}
                                </div>
                            ))}
                            {logLines.filter(l => l.type === 'evo').length === 0 && (
                                <div className="opacity-50 text-blue-300/50 text-center mt-4">Ожидание событий эволюции...</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
