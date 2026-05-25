/// <reference types="@webgpu/types" />
import React, { useEffect, useRef, useState } from 'react';
import { Activity, Shield, Zap, ChevronLeft, Layout, MousePointer2, Download, Settings, Trophy, Trash2, Database } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, CuboidCollider, InstancedRigidBodies } from '@react-three/rapier';
import { RaymarcherBackground } from './RaymarcherBackground';
import { useMinerStore } from '../store/minerStore';

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

export const PASS1_WGSL = `
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
    let nonce = params1.base_offset + (global_flat_x * 1000u);
    
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

export const PASS2_WGSL = `
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
    hybrid_mask: u32,
    pad1: u32,
    pad2: u32,
}

struct MLWeights {
    apoptosis_threshold: f32,
    cut_round: u32,
    current_floor: u32,
    viral_mask_alpha: u32,
    viral_mask_beta: u32,
    surgery_mode: u32,
    pad1: u32,
    pad2: u32,
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
    var hybrid_mask = 0u;

    if (ml_weights.surgery_mode != 0u) {
        if (local_id.x >= 32u) { return; }
        hybrid_mask = 1u << local_id.x;
        mutant_nonce = mutant_nonce ^ hybrid_mask;
    } else if (ml_weights.viral_mask_alpha != 0u || ml_weights.viral_mask_beta != 0u) {
        let shift_factor = global_id.x % 4u;
        let hybrid_gene_beta = ml_weights.viral_mask_beta << shift_factor;
        hybrid_mask = ml_weights.viral_mask_alpha ^ hybrid_gene_beta;
        mutant_nonce = mutant_nonce ^ hybrid_mask;
    } else {
        // Обычный симбиоз
        mutant_nonce = mutant_nonce ^ (1u << (local_id.x % 32u));
    }
    
    // Флаг для отслеживания читера до самого финиша
    var is_phantom = false;

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
                
                // КОЛЕСО КАРМЫ (Реакция Вселенной на Сингулярность)
                if (mutant_nonce == 0u) {
                    is_phantom = true;
                    
                    // Используем ID потока как 4-гранный кубик
                    let karma = global_id.x % 4u; 
                    
                    if (karma == 0u) {
                        mutant_nonce = 0xDEADBEEFu; // 1. Мертвая говядина (Стань куском мяса)
                    } else if (karma == 1u) {
                        mutant_nonce = 0xFFFFFFFFu; // 2. Абсолютный Свет (Встречная крайность)
                    } else if (karma == 2u) {
                        mutant_nonce = 42u;         // 3. Ответ на Главный Вопрос
                    } else {
                        // karma == 3u: Троянский Бит (Иллюзия Победы)
                        // Мы оставляем ноль! Даем ему пролететь сквозь лабиринт без сопротивления.
                        mutant_nonce = 0u; 
                    }
                }

                // Синхронизируем спин победителя с новым геномом
                e = e ^ analytic_correction;
                // Защита спина
                if (e == 0u) { e = 42u; }

                w[15] = mutant_nonce;
            }
        }
    }

    // Pseudo-finalisation (Вычисляем финальный хэш)
    var final_h0 = a + cp.s0;
    var final_h1 = b + cp.s1;
    var final_h2 = c + cp.s2;
    var final_h3 = d + cp.s3;
    var final_h4 = e + cp.s4;
    var final_h5 = f + cp.s5;
    var final_h6 = g + cp.s6;
    var final_h7 = h + cp.s7;

    // === ТРОЯНСКИЙ БИТ ===
    // Если это был Призрак, и ему выпала карма пролететь до конца в виде нуля...
    if (is_phantom && mutant_nonce == 0u) {
        // Он ожидает получить идеальные 64 нуля. 
        // Щелчок Архитектора: инвертируем самый младший бит последнего регистра.
        // На выходе будет 63 нуля и единица в конце (0x00000001).
        final_h7 = final_h7 ^ 1u; 
    }

    var total_zeros = countLeadingZeros(final_h0);
    if (total_zeros == 32u) {
        total_zeros += countLeadingZeros(final_h1);
        if (total_zeros == 64u) {
            total_zeros += countLeadingZeros(final_h2);
            if (total_zeros == 96u) {
                total_zeros += countLeadingZeros(final_h3);
                if (total_zeros == 128u) {
                    total_zeros += countLeadingZeros(final_h4);
                    if (total_zeros == 160u) {
                        total_zeros += countLeadingZeros(final_h5);
                        if (total_zeros == 192u) {
                            total_zeros += countLeadingZeros(final_h6);
                            if (total_zeros == 224u) {
                                total_zeros += countLeadingZeros(final_h7);
                            }
                        }
                    }
                }
            }
        }
    }

    // Проверка порога и запись победителей
    if (total_zeros >= ml_weights.current_floor) {
        let w_idx = atomicAdd(&counters.successes_found, 1u);
        if (w_idx < params2.max_winners) {
            winners[w_idx] = SuccessWinner(cp.nonce, mutant_nonce, final_h0, final_h1, final_diff_distance, hybrid_mask, 0u, 0u);
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
    const superWinnersList = useMinerStore(state => state.superWinners);
    const clearSuperWinners = useMinerStore(state => state.clearSuperWinners);

    const [winnersList, setWinnersList] = useState<{mutant: number, hash0: number, hash1: number, zeros: number}[]>([]);
    const winnersListRef = useRef<{mutant: number, hash0: number, hash1: number, zeros: number}[]>([]);
    const statsAccRef = useRef({ pass1Hdr: 0, pass2Hdr: 0, apoptosis: 0 });
    type FractalNode = { centerNonce: number, minNonce: number, maxNonce: number, maxFloor: number, mask: number, weight: number };
    type FractalLevel = { minFloor: number, maxFloor: number, limit: number, nodes: FractalNode[] };
    const TOTAL_MEMORY_NODES = 100000;

    const timePressureRef = useRef({
        previousDeltaT: 750,
        stuckTicks: 0,
        lastFloor: 0,
        lastDispatchTime: 0,
        forceVirusMutation: false,
        anchorChain: [] as {nonce: number, floor: number, mask: number}[],
        currentAnchorIndex: -1,
        fractalMemory: {
            L1_BASE: { minFloor: 17, maxFloor: 19, limit: TOTAL_MEMORY_NODES * 0.50, nodes: [] } as FractalLevel,
            L2_MID:  { minFloor: 20, maxFloor: 25, limit: TOTAL_MEMORY_NODES * 0.25, nodes: [] } as FractalLevel,
            L3_DEEP: { minFloor: 26, maxFloor: 40, limit: TOTAL_MEMORY_NODES * 0.125, nodes: [] } as FractalLevel,
            L4_SINGULARITY: { minFloor: 41, maxFloor: 64, limit: TOTAL_MEMORY_NODES * 0.125, nodes: [] } as FractalLevel
        }
    });
    
    const gpuRef = useRef<{ جهاز: GPUDevice | null } | null>(null);
    const loopEnabled = useRef(false);
    const drillingStartNonceRef = useRef<number>(0);
    const metaCheckpointRef = useRef({ baseNonce: 0 });
    const mlStateRef = useRef({
        threshold: 0.5,
        cutRound: 30,
        currentFloor: 22,
        floorMemory: new Map<number, number>(),
        stagnationCounter: 0,
        viralMaskAlpha: 0,
        viralMaskBeta: 0,
        viralStrikes: 0,
        safeVectors: [] as number[],
        lastFloorBreakTime: Date.now(),
        surgeryActive: true,
        anchorStartNonce: 0,
        anchorMask: 0,
        failures: 0,
        successes: 0,
        currentH: 19.0,
        totalGlobalCurvature: 0,
        globalCurvatureSamples: 0
    });

    const [epoch, setEpoch] = useState(1);
    const [hashRate, setHashRate] = useState(0);
    const hashMetricsRef = useRef({ count: 0, lastTime: 0 });

    const [benchmarkStatus, setBenchmarkStatus] = useState<{ active: boolean, elapsed: number, hashes: number, result?: number } | null>(null);
    const benchmarkRef = useRef({ active: false, start: 0, hashes: 0 });

    const toggleBenchmark = () => {
        if (benchmarkRef.current.active) {
            // Stop early
            benchmarkRef.current.active = false;
            setBenchmarkStatus({ active: false, elapsed: performance.now() - benchmarkRef.current.start, hashes: benchmarkRef.current.hashes, result: benchmarkRef.current.hashes });
        } else {
            benchmarkRef.current.active = true;
            benchmarkRef.current.start = performance.now();
            benchmarkRef.current.hashes = 0;
            setBenchmarkStatus({ active: true, elapsed: 0, hashes: 0 });
        }
    };
    
    const [showSettings, setShowSettings] = useState(false);
    const [logsTab, setLogsTab] = useState<'scan' | '20plus' | 'cache'>('scan');
    
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

    const launchPipelineRef = useRef<(() => void) | undefined>(undefined);

    const compressBrainToDNA = () => {
        let dna = {
            r: useMinerStore.getState().maskPageRank,
            f: [] as number[][]
        };
        for (let levelKey in timePressureRef.current.fractalMemory) {
            let level = timePressureRef.current.fractalMemory[levelKey as keyof typeof timePressureRef.current.fractalMemory];
            for (let node of level.nodes) {
                dna.f.push([node.maxFloor, node.minNonce, node.maxNonce, node.mask, Math.round(node.weight * 100) / 100]);
            }
        }
        return JSON.stringify(dna);
    };

    const loadBrainFromDNA = (dnaString: string) => {
        if (!dnaString) return false;
        try {
            let dna = JSON.parse(dnaString);
            if (dna.r) {
                useMinerStore.setState({ maskPageRank: dna.r });
            }
            
            for (let k in timePressureRef.current.fractalMemory) {
                timePressureRef.current.fractalMemory[k as keyof typeof timePressureRef.current.fractalMemory].nodes = [];
            }
            
            const getFractalLevel = (floor: number) => {
                if (floor <= timePressureRef.current.fractalMemory.L1_BASE.maxFloor) return timePressureRef.current.fractalMemory.L1_BASE;
                if (floor <= timePressureRef.current.fractalMemory.L2_MID.maxFloor) return timePressureRef.current.fractalMemory.L2_MID;
                if (floor <= timePressureRef.current.fractalMemory.L3_DEEP.maxFloor) return timePressureRef.current.fractalMemory.L3_DEEP;
                return timePressureRef.current.fractalMemory.L4_SINGULARITY;
            };

            for (let gene of (dna.f || [])) {
                let floor = gene[0];
                let level = getFractalLevel(floor);
                level.nodes.push({
                    centerNonce: gene[1] + Math.floor((gene[2] - gene[1])/2),
                    minNonce: gene[1],
                    maxNonce: gene[2],
                    maxFloor: gene[0],
                    mask: gene[3],
                    weight: gene[4]
                });
            }
            addLog(`🧬 ДНК УСПЕШНО ИМПЛАНТИРОВАНА. Восстановлено ${dna.f?.length || 0} синапсов.`, 'system');
            return true;
        } catch (e) {
            console.error("Ошибка имплантации ДНК:", e);
            return false;
        }
    };

    const exportDNA = () => {
        let dnaString = compressBrainToDNA();
        navigator.clipboard.writeText(dnaString);
        alert("ДНК скопирована в буфер обмена. Сохраните этот текст в блокнот или Telegram!");
    };

    const importDNA = () => {
        let input = prompt("Вставьте строку ДНК Роя:");
        if (input) {
            loadBrainFromDNA(input);
        }
    };

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
        const savedDNA = localStorage.getItem('QuantumMinerDNA');
        if (savedDNA) {
            loadBrainFromDNA(savedDNA);
        }
        
        const autoSaveTimer = setInterval(() => {
            let dnaString = compressBrainToDNA();
            localStorage.setItem('QuantumMinerDNA', dnaString);
        }, 30000);
        
        if (launchPipelineRef.current) launchPipelineRef.current();

        return () => {
            loopEnabled.current = false;
            clearInterval(autoSaveTimer);
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
            const mlWeightsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

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
            drillingStartNonceRef.current = baseNonce;
            let iterCounter = 0;
            const ZERO_TARGET = 17; // Adjust here for difficulty

            const getFractalLevel = (floor: number) => {
                if (floor <= timePressureRef.current.fractalMemory.L1_BASE.maxFloor) return timePressureRef.current.fractalMemory.L1_BASE;
                if (floor <= timePressureRef.current.fractalMemory.L2_MID.maxFloor) return timePressureRef.current.fractalMemory.L2_MID;
                if (floor <= timePressureRef.current.fractalMemory.L3_DEEP.maxFloor) return timePressureRef.current.fractalMemory.L3_DEEP;
                return timePressureRef.current.fractalMemory.L4_SINGULARITY;
            };

            const addSynapticLink = (nonce: number, floor: number, mask: number, weight: number) => {
                let level = getFractalLevel(floor);
                
                let consolidated = false;
                for (let node of level.nodes) {
                    if (node.mask === mask && Math.abs(node.centerNonce - nonce) < 1000000) {
                        node.minNonce = Math.min(node.minNonce, nonce);
                        node.maxNonce = Math.max(node.maxNonce, nonce);
                        node.weight += weight;
                        if (floor > node.maxFloor) node.maxFloor = floor;
                        consolidated = true;
                        break;
                    }
                }
                
                if (!consolidated) {
                    if (level.nodes.length >= level.limit) {
                        level.nodes.sort((a, b) => a.weight - b.weight);
                        level.nodes.shift(); 
                    }
                    level.nodes.push({
                        centerNonce: nonce,
                        minNonce: nonce,
                        maxNonce: nonce,
                        maxFloor: floor,
                        mask: mask,
                        weight: weight
                    });
                }
            };

            const updateMaskRank = (mask: number, isSuccess: boolean, isDeadZone: boolean) => {
                useMinerStore.getState().updateMaskRank(mask, isSuccess, isDeadZone);
            };
            
            const getTopTwoMasks = () => {
                const globalRank = useMinerStore.getState().maskPageRank;
                let masks = Object.keys(globalRank);
                
                if (masks.length < 2) {
                    if (masks.length === 1) {
                        return [Number(masks[0]), Math.floor(Math.random() * 0xFFFFFFFF) >>> 0];
                    }
                    return [Math.floor(Math.random() * 0xFFFFFFFF) >>> 0, Math.floor(Math.random() * 0xFFFFFFFF) >>> 0];
                }
                
                const getScore = (m: string) => globalRank[Number(m)].weight - (globalRank[Number(m)].deadEnds * 50);
                masks.sort((a, b) => getScore(b) - getScore(a));
                return [Number(masks[0]), Number(masks[1])];
            };

            const [initAlpha, initBeta] = getTopTwoMasks();
            mlStateRef.current.viralMaskAlpha = initAlpha;
            mlStateRef.current.viralMaskBeta = initBeta;
            mlStateRef.current.anchorMask = initAlpha;
            mlStateRef.current.anchorStartNonce = baseNonce;

            const loop = async () => {
                if (!loopEnabled.current) return;

                const isSurgery = mlStateRef.current.surgeryActive;
                const PASS1_WORKGROUPS = isSurgery ? 1 : 1024 * configRef.current.intensity;
                const pass1WgX = Math.min(PASS1_WORKGROUPS, 65535);
                const pass1WgY = Math.ceil(PASS1_WORKGROUPS / pass1WgX);
                const pass1BatchSize = pass1WgX * pass1WgY * 256;
                const p1Data = new Uint32Array([baseNonce, MAX_CHECKPOINTS, pass1WgX, 0]);
                device.queue.writeBuffer(params1Buffer, 0, p1Data);
                
                const pass2WgX = isSurgery ? 1 : Math.min(MAX_CHECKPOINTS, 65535);
                const pass2WgY = Math.ceil((isSurgery ? 1 : MAX_CHECKPOINTS) / pass2WgX);
                const p2Data = new Uint32Array([MAX_CHECKPOINTS, MAX_WINNERS, ZERO_TARGET, pass2WgX]);
                device.queue.writeBuffer(params2Buffer, 0, p2Data);

                const mlDataBuf = new ArrayBuffer(32);
                const mlDataFloat = new Float32Array(mlDataBuf);
                const mlDataUint = new Uint32Array(mlDataBuf);
                
                const FIXED_CUT_ROUND = 30;
                // Идеальный горизонт событий. Абсолютное равновесие.
                const FIXED_THRESHOLD = 0.5; 
                mlDataFloat[0] = FIXED_THRESHOLD;
                mlDataUint[1] = FIXED_CUT_ROUND;
                mlDataUint[2] = mlStateRef.current.currentFloor;
                mlDataUint[3] = mlStateRef.current.viralMaskAlpha;
                mlDataUint[4] = mlStateRef.current.viralMaskBeta;
                mlDataUint[5] = isSurgery ? 1 : 0;
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
                        const hybridMask = winBufUint[i * 8 + 5];
                        const zeros = h0 === 0 ? 32 + Math.clz32(h1) : Math.clz32(h0);
                        
                        let targetFloor = mlStateRef.current.currentFloor;
                        
                        if (mlStateRef.current.surgeryActive) {
                            if (zeros >= targetFloor - 1 && hybridMask !== 0) {
                                if (!mlStateRef.current.safeVectors.includes(hybridMask)) {
                                    mlStateRef.current.safeVectors.push(hybridMask);
                                }
                            }
                            if (zeros >= targetFloor) {
                                newFloorReached = true;
                                mlStateRef.current.currentFloor = zeros + 1;
                                nextBaseNonce = mut;
                                mlStateRef.current.stagnationCounter = 0;
                                mlStateRef.current.viralStrikes = 0;
                                if (hybridMask !== 0) updateMaskRank(hybridMask, true, false);
                            }
                        } else if (zeros >= targetFloor) {
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
                            
                            if (hybridMask !== 0) {
                                updateMaskRank(hybridMask, true, false);
                            }
                            
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
                        } else if (zeros === targetFloor - 1 && zeros > 15) {
                            // ПОЧТИ ПРОБОЙ (Near Miss). 
                            // Этаж не повышаем, но бросаем Якорь и прыгаем сюда, чтобы добить этот сектор!
                            console.log(`⚓ ПЕРСПЕКТИВА: Найден мутант с ${zeros} нулями. Смещение фокуса.`);
                            nextBaseNonce = mut;
                        }

                        const exists = winnersListRef.current.some(p => p.mutant === mut);
                        if (!exists) {
                            anyNew = true;
                            if (bestDist === 0 || dist < bestDist) bestDist = dist;
                            winnersListRef.current.push({mutant: mut, hash0: h0, hash1: h1, zeros});
                            winnersListRef.current.sort((a, b) => b.zeros - a.zeros);
                            winnersListRef.current = winnersListRef.current.slice(0, 10); // Keep ONLY top 10

                            const minerStore = useMinerStore.getState();
                            minerStore.addWinner({mutant: mut, hash0: h0, hash1: h1, zeros});
                            
                            // Synchronize PageRank with Global Store
                            if (minerStore.lastParentNode) {
                                minerStore.incrementPageRank(minerStore.lastParentNode.id);
                            }
                            
                            // Build Real Topology (Data Bridge)
                            const parent = minerStore.lastParentNode;
                            
                            // 1. ПОКОЛЕНИЕ (Ось X): Сдвигаемся строго вперед от родителя
                            let gen = parent ? parent.generation + 1 : 0;
                            let posX = parent ? parent.posX + 5.0 : 0;
                            
                            // 2. ВЕКТОР (Ось Y): Вычисляем разницу между масками (XOR)
                            let currentMask = hybridMask;
                            let shiftY = 0;
                            if (parent) {
                                let maskDelta = (currentMask ^ parent.mask) >>> 0; 
                                shiftY = (maskDelta % 100) / 10.0; 
                            }
                            let direction = (mut % 2 === 0) ? 1 : -1;
                            let posY = parent ? parent.posY + (shiftY * direction) : 0;
                            
                            // 3. ГЛУБИНА (Ось Z): Жесткая привязка к этажу
                            let posZ = -zeros * 10;
                            
                            let startNonce = drillingStartNonceRef.current;
                            let distance = Math.abs(mut - startNonce);
                            let trueWeight = distance > 0 ? distance : 1; 
                            
                            const newNode = {
                                id: Date.now() + Math.random(),
                                parentId: parent ? parent.id : null,
                                minNonce: Math.min(startNonce, mut),
                                maxNonce: Math.max(startNonce, mut),
                                weight: trueWeight,
                                mask: currentMask,
                                maxFloor: zeros,
                                posX,
                                posY,
                                posZ,
                                parentPosX: parent ? parent.posX : undefined,
                                parentPosY: parent ? parent.posY : undefined,
                                parentPosZ: parent ? parent.posZ : undefined,
                                parentMaxFloor: parent ? parent.maxFloor : undefined,
                                generation: gen
                            };
                            
                            minerStore.addNode(newNode);
                            minerStore.setLastParentNode(newNode);
                            drillingStartNonceRef.current = mut;

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

                const now = Date.now();
                const currentDeltaT = timePressureRef.current.lastDispatchTime > 0 ? (now - timePressureRef.current.lastDispatchTime) : 750;
                const dT = currentDeltaT - timePressureRef.current.previousDeltaT;

                if (!newFloorReached && mlStateRef.current.currentFloor < 25) {
                    timePressureRef.current.stuckTicks++;
                } else {
                    timePressureRef.current.stuckTicks = 0;
                }
                
                // Фиксация Крюка (Чекпоинт в цепь)
                if (newFloorReached || (dT < -80 && mlStateRef.current.currentFloor >= 20)) {
                    if (newFloorReached) {
                        const msg = `⚓ ЧЕКПОИНТ: Зафиксирован этаж ${mlStateRef.current.currentFloor}. Сохраняем в цепь.`;
                        addLog(msg, 'evo');
                        timePressureRef.current.anchorChain.push({
                            nonce: baseNonce,
                            floor: mlStateRef.current.currentFloor,
                            mask: mlStateRef.current.viralMaskAlpha
                        });
                        timePressureRef.current.currentAnchorIndex = timePressureRef.current.anchorChain.length - 1;
                        timePressureRef.current.stuckTicks = 0;
                        updateMaskRank(mlStateRef.current.viralMaskAlpha, true, false);
                        addSynapticLink(baseNonce, mlStateRef.current.currentFloor, mlStateRef.current.viralMaskAlpha, 1.0);
                    }

                    if (dT < -80 && mlStateRef.current.currentFloor >= 20) {
                        const msg = `⚡ АНОМАЛИЯ (NDR): ${timePressureRef.current.previousDeltaT}ms -> ${currentDeltaT}ms!`;
                        addLog(msg, 'evo');
                    }
                    mlStateRef.current.stagnationCounter = 9999;
                }

                timePressureRef.current.previousDeltaT = currentDeltaT;
                timePressureRef.current.lastDispatchTime = now;

                if (mlStateRef.current.surgeryActive && mlStateRef.current.safeVectors.length >= 2) {
                    mlStateRef.current.surgeryActive = false; // Switch to Ricci Flow
                }
                
                if (newFloorReached) {
                    mlStateRef.current.successes++;
                } else {
                    mlStateRef.current.failures++;
                }

                const totalProbes = mlStateRef.current.failures + mlStateRef.current.successes;
                const curvature = mlStateRef.current.failures / (mlStateRef.current.successes + 1);

                let surgeryExecuted = false;

                // Сбор статистики глобальной кривизны (Ricci Heatmap)
                if (totalProbes >= 50) {
                    surgeryExecuted = true;
                    const msg = `🔪 ТРУБА: Сжатие отрезка [${mlStateRef.current.anchorStartNonce} ... ${baseNonce}]. (маска 0x${mlStateRef.current.anchorMask.toString(16)})`;
                    console.log(msg);
                    addLog(msg, 'evo');
                        
                        useMinerStore.getState().addDeadZonePipe({
                            id: crypto.randomUUID(),
                            startNonce: mlStateRef.current.anchorStartNonce,
                            endNonce: baseNonce,
                            hashTrack: pass1BatchSize * totalProbes * 1000,
                            peakZeros: mlStateRef.current.currentFloor,
                            peakMask: mlStateRef.current.anchorMask
                        });
                        
                        useMinerStore.getState().penalizeMask(mlStateRef.current.anchorMask);
                         
                        // Hard Reset (прыжок на другой узел)
                        let store = useMinerStore.getState();
                        let globalNodes = [
                            ...store.quotas.L1_BASE.nodes,
                            ...store.quotas.L2_MID.nodes,
                            ...store.quotas.L3_DEEP.nodes,
                            ...store.quotas.L4_SINGULARITY.nodes
                        ];
                        if (globalNodes.length > 0) {
                            globalNodes.sort((a, b) => b.maxFloor - a.maxFloor);
                            const topCount = Math.max(3, Math.ceil(globalNodes.length * 0.05));
                            const topNodes = globalNodes.slice(0, topCount);
                            let randomNode = topNodes[Math.floor(Math.random() * topNodes.length)];
                            nextBaseNonce = randomNode.minNonce;
                            mlStateRef.current.currentFloor = randomNode.maxFloor;
                        } else {
                            nextBaseNonce = baseNonce + 1000000000; // Jump away if empty
                        }
                        
                        // Меняем маску для отталкивания на основе PageRank
                        const [alpha, beta] = getTopTwoMasks();
                        mlStateRef.current.viralMaskAlpha = alpha;
                        mlStateRef.current.viralMaskBeta = beta;
                        mlStateRef.current.anchorMask = alpha; // Сохраняем Якорь
                        mlStateRef.current.anchorStartNonce = nextBaseNonce;
                        
                        mlStateRef.current.lastFloorBreakTime = now;
                        mlStateRef.current.safeVectors = [];
                        mlStateRef.current.surgeryActive = true; // Reboot scanning
                        mlStateRef.current.failures = 0;
                        mlStateRef.current.successes = 0;
                        drillingStartNonceRef.current = nextBaseNonce;
                    }

                    if (!surgeryExecuted && mlStateRef.current.safeVectors.length >= 2) {
                        const safePool = mlStateRef.current.safeVectors;
                        let poolCopy = [...safePool];
                        // Перемешиваем массив (Fisher-Yates)
                        for (let i = poolCopy.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [poolCopy[i], poolCopy[j]] = [poolCopy[j], poolCopy[i]];
                        }
                        const m1 = poolCopy[0];
                        const m2 = poolCopy[1];
                        const m3 = poolCopy.length > 2 ? poolCopy[2] : 0;
                        mlStateRef.current.viralMaskAlpha = m1 | m2 | m3;
                        mlStateRef.current.viralMaskBeta = 0;
                    }

                if (newFloorReached) {
                    mlStateRef.current.lastFloorBreakTime = now;
                    mlStateRef.current.safeVectors = [];
                    mlStateRef.current.surgeryActive = true;
                    mlStateRef.current.stagnationCounter = 0;
                    mlStateRef.current.viralMaskAlpha = 0;
                    mlStateRef.current.viralMaskBeta = 0;
                    mlStateRef.current.failures = 0;
                    mlStateRef.current.successes = 0;
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
                    viralMask: mlStateRef.current.viralMaskAlpha,
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
                    viralMask: mlStateRef.current.viralMaskAlpha
                }));

                if (nextBaseNonce !== null) {
                    baseNonce = nextBaseNonce;
                    drillingStartNonceRef.current = baseNonce;
                } else {
                    let navigated = false;
                    // Фрактальная Навигация
                    if (Math.random() < 0.3) {
                        const levels = [
                            timePressureRef.current.fractalMemory.L1_BASE,
                            timePressureRef.current.fractalMemory.L2_MID,
                            timePressureRef.current.fractalMemory.L3_DEEP,
                            timePressureRef.current.fractalMemory.L4_SINGULARITY
                        ];
                        
                        let currentRange = { min: 0, max: 0xFFFFFFFF };
                        let targetNode: { centerNonce: number, minNonce: number, maxNonce: number, maxFloor: number, mask: number, weight: number } | null = null;
                        
                        for (let level of levels) {
                            let bestNode: typeof targetNode = null;
                            for (let node of level.nodes) {
                                if (node.minNonce >= currentRange.min && node.maxNonce <= currentRange.max) {
                                    if (!bestNode || node.weight > bestNode.weight) {
                                        bestNode = node;
                                    }
                                }
                            }
                            if (bestNode) {
                                targetNode = bestNode;
                                currentRange.min = bestNode.minNonce - 1000000;
                                currentRange.max = bestNode.maxNonce + 1000000;
                            } else {
                                break;
                            }
                        }
                        
                        if (targetNode && (baseNonce < targetNode.minNonce || baseNonce > targetNode.maxNonce)) {
                            const targetNonce = targetNode.maxNonce; // прыгаем на край диапазона, чтобы углубить его
                            if (targetNonce > baseNonce) { // двигаемся только вперед
                                const msg = `🌌 ФРАКТАЛЬНЫЙ СКАЧОК: Переход к узлу ${targetNode.maxFloor}-го этажа (Нонс: ${targetNonce})`;
                                console.log(msg);
                                addLog(msg, 'evo');
                                baseNonce = targetNonce;
                                drillingStartNonceRef.current = baseNonce;
                                navigated = true;
                            }
                        }
                    }

                    if (!navigated) {
                        baseNonce += (pass1BatchSize * 1000);
                    }
                }

                // Предиктивный фильтр: Квантовый прыжок через диапазоны
                let isValid = false;
                while (!isValid) {
                    isValid = true;
                    const deadPipes = useMinerStore.getState().deadZonePipes;
                    for (let i = 0; i < deadPipes.length; i++) {
                        let zone = deadPipes[i];
                        if (mlStateRef.current.viralMaskAlpha === zone.peakMask && baseNonce >= zone.startNonce && baseNonce <= zone.endNonce) {
                            const msg = `⚡ ПРЫЖОК СКВОЗЬ ПРОСТРАНСТВО: Пропуск мертвой зоны. Сдвиг на границу.`;
                            console.log(msg);
                            addLog(msg, 'evo');
                            baseNonce = zone.endNonce + 1;
                            drillingStartNonceRef.current = baseNonce;
                            isValid = false;
                            break;
                        }
                    }
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

                hashMetricsRef.current.count += pass1BatchSize;
                
                if (benchmarkRef.current.active) {
                    benchmarkRef.current.hashes += pass1BatchSize;
                }

                const _now = performance.now();
                if (_now - hashMetricsRef.current.lastTime >= 1000) {
                    setHashRate(hashMetricsRef.current.count / ((_now - hashMetricsRef.current.lastTime) / 1000));
                    hashMetricsRef.current.count = 0;
                    hashMetricsRef.current.lastTime = _now;
                    
                    if (benchmarkRef.current.active) {
                        const elapsedMs = _now - benchmarkRef.current.start;
                        if (elapsedMs >= 600_000) { // 10 mins
                            benchmarkRef.current.active = false;
                            setBenchmarkStatus({ active: false, elapsed: 600_000, hashes: benchmarkRef.current.hashes, result: benchmarkRef.current.hashes });
                        } else {
                            setBenchmarkStatus({ active: true, elapsed: elapsedMs, hashes: benchmarkRef.current.hashes });
                        }
                    }
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
            <RaymarcherBackground winnersList={winnersList} />
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 p-3 md:p-4 flex justify-between items-start md:items-center z-20 border-b border-[#00FF41]/30 bg-black/80 backdrop-blur-md">
                <div className="flex items-center gap-2 md:gap-4 flex-1">
                    <Activity className="w-5 h-5 min-w-[20px] animate-pulse hidden sm:block" />
                    <div className="flex-1">
                        <h1 className="text-sm md:text-xl font-black tracking-tighter leading-tight uppercase flex items-center gap-2 flex-wrap min-w-0">
                            <Zap className="w-4 h-4 shrink-0" /> <span className="truncate">Two-Pass Shader Architecture</span>
                            <span className="ml-1 px-2 py-0.5 bg-[#FF00FF]/20 text-[#FF00FF] text-xs max-sm:text-[10px] rounded border border-[#FF00FF]/50 whitespace-nowrap shrink-0">{(hashRate / 1000).toFixed(1)} kH/s</span>
                            {benchmarkStatus?.active ? (
                                <button onClick={toggleBenchmark} className="ml-1 px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs max-sm:text-[10px] rounded border border-yellow-500/50 flex items-center justify-center gap-1 transition-colors hover:bg-yellow-500 hover:text-black shrink-0 whitespace-nowrap flex-1 lg:flex-none">
                                    ⏱️ {Math.floor(benchmarkStatus.elapsed / 60000)}:{(Math.floor(benchmarkStatus.elapsed / 1000) % 60).toString().padStart(2, '0')} | {benchmarkStatus.hashes.toLocaleString()}
                                </button>
                            ) : (
                                <button onClick={toggleBenchmark} className="ml-1 px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs max-sm:text-[10px] rounded border border-gray-500/50 flex items-center justify-center gap-1 transition-colors hover:bg-yellow-500/20 hover:text-yellow-400 hover:border-yellow-500/50 shrink-0 whitespace-nowrap flex-1 lg:flex-none">
                                    ⏱️ {benchmarkStatus?.result ? `10m: ${benchmarkStatus.result.toLocaleString()}` : "10m Bench"}
                                </button>
                            )}
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
                            <div className="flex items-center gap-2">
                                <span className="text-[#FF00FF]">EPOCH {epoch}</span>
                                <button 
                                    onClick={() => setEpoch(e => e + 1)}
                                    className="px-2 py-0.5 text-[10px] border border-[#FF00FF]/50 bg-[#FF00FF]/10 text-[#FF00FF] hover:bg-[#FF00FF] hover:text-white transition-colors uppercase"
                                >
                                    Смена Эпохи
                                </button>
                            </div>
                        </h2>
                        {error && <div className="text-[#FF3E3E] text-xs p-2 bg-[#FF3E3E]/10 border border-[#FF3E3E]/30">{error}</div>}
                        
                        <button 
                            onClick={toggleMiner}
                            className={`w-full py-3 font-bold uppercase transition-colors flex justify-center items-center gap-2 border ${running ? 'bg-[#00FF41] text-black border-[#00FF41] shadow-[0_0_10px_#00FF41]' : 'bg-transparent text-[#00FF41] border-[#00FF41] hover:bg-[#00FF41]/10'}`}
                        >
                            {running ? 'STOP PIPELINE' : 'LAUNCH PIPELINE'}
                        </button>

                        <button
                            onClick={() => setShowSettings(true)}
                            className="w-full py-2 mt-2 text-[10px] uppercase transition-colors flex justify-center items-center gap-2 border border-gray-600 bg-[#1a1b1e] text-gray-400 hover:bg-[#2a2b2e] hover:text-white"
                        >
                            <Settings className="w-3 h-3" /> Настройки железа
                        </button>

                        {showSettings && (
                            <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex justify-center items-center p-4">
                                <div className="bg-[#1f2022] border border-[#3b3c3e] rounded-xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-6 font-sans text-gray-200">
                                    <div className="flex justify-between items-center text-gray-100 border-b border-[#3b3c3e] pb-3">
                                        <h3 className="font-bold text-lg flex items-center gap-2">
                                            <Settings className="w-5 h-5" /> Настройки железа
                                        </h3>
                                        <button 
                                            onClick={() => setShowSettings(false)}
                                            className="text-gray-400 hover:text-white transition-colors"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    
                                    <div className="flex flex-col gap-5">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-medium">GPU: Хеш-воркеры</span>
                                                <span className="text-xs bg-[#2a2b2e] px-2 py-1 rounded border border-[#3b3c3e] text-gray-300">{intensity}x</span>
                                            </div>
                                            <input 
                                                type="range" min="1" max="1000" step="1" 
                                                value={intensity} 
                                                onChange={(e) => updateIntensity(parseInt(e.target.value))}
                                                className="w-full h-1 bg-[#3b3c3e] rounded-lg appearance-none cursor-pointer"
                                            />
                                            <span className="text-xs text-gray-400">~ {(262144 * intensity).toLocaleString()} хешей/кадр</span>
                                        </div>

                                        <div className="flex flex-col gap-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-medium">VRAM: Выделение памяти</span>
                                                <span className="text-xs bg-[#2a2b2e] px-2 py-1 rounded border border-[#3b3c3e] text-gray-300">{vramScale}x</span>
                                            </div>
                                            <input 
                                                type="range" min="1" max="200" step="1" 
                                                value={vramScale} 
                                                onChange={(e) => updateConfig('vramScale', parseInt(e.target.value))}
                                                className="w-full h-1 bg-[#3b3c3e] rounded-lg appearance-none cursor-pointer"
                                            />
                                            <span className="text-xs text-gray-400">Объем буферов: {8192 * vramScale} слотов (требует рестарт)</span>
                                        </div>

                                        <div className="flex flex-col gap-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-medium">RAM: Размер хвостов</span>
                                                <span className="text-xs bg-[#2a2b2e] px-2 py-1 rounded border border-[#3b3c3e] text-gray-300">{memoryScale}x</span>
                                            </div>
                                            <input 
                                                type="range" min="1" max="2000" step="1" 
                                                value={memoryScale} 
                                                onChange={(e) => updateConfig('memoryScale', parseInt(e.target.value))}
                                                className="w-full h-1 bg-[#3b3c3e] rounded-lg appearance-none cursor-pointer"
                                            />
                                            <span className="text-xs text-gray-400">{50 * memoryScale} записей в хвосте</span>
                                        </div>

                                        <div className="flex flex-col gap-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-medium">I/O: Частота записи</span>
                                                <span className="text-xs bg-[#2a2b2e] px-2 py-1 rounded border border-[#3b3c3e] text-gray-300">{lsWriteRate}x</span>
                                            </div>
                                            <input 
                                                type="range" min="1" max="60" step="1" 
                                                value={lsWriteRate} 
                                                onChange={(e) => updateConfig('lsWriteRate', parseInt(e.target.value))}
                                                className="w-full h-1 bg-[#3b3c3e] rounded-lg appearance-none cursor-pointer"
                                            />
                                            <span className="text-xs text-gray-400">Запись каждые {Math.max(1, Math.floor(60 / lsWriteRate))} итераций</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button 
                            onClick={exportCSV}
                            className="w-full py-2 font-bold uppercase transition-colors flex justify-center items-center gap-2 border border-[#00FF41]/50 bg-[#00FF41]/10 text-[#00FF41] hover:bg-[#00FF41]/30 text-xs"
                        >
                            <Download className="w-3 h-3" /> ВЫГРУЗИТЬ ЧЕКПОИНТ И ЛИДЕРБОРД (CSV)
                        </button>

                        <div className="flex gap-2 w-full mt-2">
                            <button 
                                onClick={exportDNA}
                                className="w-1/2 py-2 font-bold uppercase transition-colors flex justify-center items-center gap-2 border border-[#FF00FF]/50 bg-[#FF00FF]/10 text-[#FF00FF] hover:bg-[#FF00FF]/30 text-xs"
                            >
                                СКОПИРОВАТЬ ДНК
                            </button>
                            <button 
                                onClick={importDNA}
                                className="w-1/2 py-2 font-bold uppercase transition-colors flex justify-center items-center gap-2 border border-[#FF00FF]/50 bg-[#FF00FF]/10 text-[#FF00FF] hover:bg-[#FF00FF]/30 text-xs"
                            >
                                ИМПЛАНТИРОВАТЬ
                            </button>
                        </div>

                        <div className="mt-4 border border-blue-500/30 bg-blue-900/10 p-2 flex flex-col gap-2">
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
                                    className="w-full py-1 flex items-center justify-center gap-1 border border-blue-400/50 bg-blue-400/10 text-blue-400 hover:bg-blue-400 hover:text-black transition-colors"
                                >
                                    <Download className="w-3 h-3" /> СКАЧАТЬ CSV (ХВОСТЫ)
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
                                <button 
                                    onClick={() => setLogsTab('scan')} 
                                    className={`text-sm font-bold uppercase transition-colors ${logsTab === 'scan' ? 'text-[#00FF41]' : 'text-gray-500 hover:text-[#00FF41]/70'}`}
                                >
                                    ЖУРНАЛ СКАНИРОВАНИЯ
                                </button>
                                <button 
                                    onClick={() => setLogsTab('20plus')} 
                                    className={`text-sm font-bold uppercase transition-colors flex items-center gap-2 ${logsTab === '20plus' ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400/70'}`}
                                >
                                    <Trophy size={14} /> 20+ ПРОБИТИЕ ({superWinnersList.length})
                                </button>
                                <button 
                                    onClick={() => setLogsTab('cache')} 
                                    className={`text-sm font-bold uppercase transition-colors flex items-center gap-2 ${logsTab === 'cache' ? 'text-blue-400' : 'text-gray-500 hover:text-blue-400/70'}`}
                                >
                                    <Database size={14} /> УПРАВЛЕНИЕ КЭШОМ
                                </button>
                            </div>
                            <div className="flex gap-2">
                                {logsTab === '20plus' && superWinnersList.length > 0 && (
                                    <button 
                                        onClick={clearSuperWinners}
                                        className="text-[10px] text-red-500 hover:text-red-300 px-2 py-1 border border-red-500/30 flex items-center gap-1 transition-colors hover:bg-red-500/20">
                                        <Trash2 size={10} />
                                    </button>
                                )}
                                {logsTab !== 'cache' && (
                                    <button 
                                        onClick={() => {
                                            if (logsTab === 'scan') {
                                                const textBytes = logLines.filter(l => l.type !== 'evo').map(l => `[${l.time}] ${l.msg}`).join('\n');
                                                navigator.clipboard.writeText(textBytes);
                                            } else {
                                                const textBytes = superWinnersList.map(w => `[${w.time}] Z: ${w.zeros} | Nonce: ${w.mutant} | H0: ${w.hash0.toString(16).padStart(8,'0')} | H1: ${w.hash1.toString(16).padStart(8,'0')}`).join('\n');
                                                navigator.clipboard.writeText(textBytes);
                                            }
                                        }} 
                                        className="text-[10px] hover:text-white px-2 py-1 border border-[#00FF41]/30 flex items-center gap-1 transition-colors hover:bg-[#00FF41]/20">
                                        <Download size={10} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto text-[10px] space-y-1 opacity-80 pb-2">
                            {logsTab === 'cache' ? (
                                <div className="space-y-2 p-2 mt-2 w-full max-w-sm">
                                    <button 
                                        onClick={() => {
                                            setRecordedSlots([]);
                                            localStorage.removeItem('twopass_evolution_logs');
                                        }}
                                        className="w-full py-2 px-3 flex items-center justify-between border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-red-100 transition-colors"
                                    >
                                        <span>СБРОС ЭВОЛЮЦИИ ДНК (L.S.)</span>
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setWinnersList([]);
                                            localStorage.removeItem('twopass_meta_state');
                                            localStorage.removeItem('miner_super_winners');
                                            clearSuperWinners();
                                        }}
                                        className="w-full py-2 px-3 flex items-center justify-between border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-red-100 transition-colors"
                                    >
                                        <span>УДАЛИТЬ ЧЕКПОИНТЫ & ПОБЕДИТЕЛЕЙ (L.S.)</span>
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setLogLines([]);
                                        }}
                                        className="w-full py-2 px-3 flex items-center justify-between border border-orange-500/50 bg-orange-500/10 text-orange-400 hover:bg-orange-500 hover:text-orange-100 transition-colors"
                                    >
                                        <span>ОЧИСТИТЬ ЖУРНАЛ СКАНИРОВАНИЯ</span>
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                    <div className="text-[10px] text-gray-400 mt-4 p-2 border border-blue-500/20 bg-blue-500/5">
                                        <span className="text-blue-400 font-bold">INFO:</span> Сброс глобальной базы памяти узлов фрактала выполняется процессом Hard Reset, кэш очищается автоматически.
                                    </div>
                                </div>
                            ) : logsTab === 'scan' ? (
                                logLines.filter(l => l.type !== 'evo').map((l, i) => <div key={i} className={l.type === 'system' ? 'text-red-400' : ''}><span className="opacity-50">[{l.time}]</span> {l.msg}</div>)
                            ) : (
                                superWinnersList.length === 0 ? (
                                    <div className="opacity-50 text-center mt-6 text-yellow-500/50">Ожидание пробитий 20+ нулей...</div>
                                ) : (
                                    <div className="space-y-1 w-full text-yellow-200">
                                        {superWinnersList.map((w, i) => (
                                            <div key={i} className="flex gap-4 border-b border-yellow-500/20 pb-1">
                                                <span className="opacity-50">[{w.time}]</span>
                                                <span className="text-yellow-400 font-bold w-12">Z: {w.zeros}</span>
                                                <span className="font-mono">Mut: {w.mutant}</span>
                                                <span className="font-mono opacity-70 ml-auto">
                                                    {w.hash0.toString(16).padStart(8, '0')}{w.hash1.toString(16).padStart(8, '0')}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )
                            )}
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
