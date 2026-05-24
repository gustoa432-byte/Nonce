import { useEffect, useRef, useState } from 'react';
import { X, Copy, ChevronUp, ChevronDown, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type CryptoRaymarcherProps = {
    onClose: () => void;
};

export function CryptoRaymarcher({ onClose }: CryptoRaymarcherProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const mutatingRef = useRef(false);
    const [isLocked, setIsLocked] = useState(false);
    const [isMutatingUi, setIsMutatingUi] = useState(false);
    const [isLogOpen, setIsLogOpen] = useState(true);

    const [discoveries, setDiscoveries] = useState<{nonce: number, hash: string, zeros: number, id: number, header: string}[]>([]);
    const [topDiscoveries, setTopDiscoveries] = useState<{nonce: number, hash: string, zeros: number, id: number, header: string}[]>([]);
    const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(true);
    const [isControlsOpen, setIsControlsOpen] = useState(true);
    const [isGuideOpen, setIsGuideOpen] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [isMeasuring, setIsMeasuring] = useState(false);
    const isMeasuringRef = useRef(false);
    const telemetryTextRef = useRef<HTMLDivElement>(null);

    const [gravityUI, setGravityUI] = useState(0.0);
    const gravityRef = useRef(0.0);

    const maxZerosRecordRef = useRef(18); // Record tracker (start capturing records > 18)
    const pauseUntilRef = useRef(0); // Pause timestamp
    const coolingTextRef = useRef<HTMLDivElement>(null);

    const [timeScaleUI, setTimeScaleUI] = useState(1.0);
    const timeScaleRef = useRef(1.0);
    const appTimeRef = useRef(0.0);

    const [noiseIntensityUI, setNoiseIntensityUI] = useState(0.0);
    const noiseIntensityRef = useRef(0.0);

    const [movementSpeedUI, setMovementSpeedUI] = useState(0.4);
    const movementSpeedRef = useRef(0.4);

    const [pointerLockDisabled, setPointerLockDisabled] = useState(false);

    const scanCanvasRef = useRef<HTMLCanvasElement>(null);
    const [thermalStats, setThermalStats] = useState({ current: 0, norm: 0, deviation: 0 });
    const thermalNormRef = useRef(0);
    const thermalSamplesRef = useRef<number[]>([]);
    const [sensorThresholdUI, setSensorThresholdUI] = useState(150);
    const sensorThresholdRef = useRef(150);
    const [isSensorOpen, setIsSensorOpen] = useState(true);

    const [diaphragmOn, setDiaphragmOn] = useState(false);
    const diaphragmOnRef = useRef(false);

    const [diaphragmIntensityUI, setDiaphragmIntensityUI] = useState(1.0);
    const diaphragmIntensityRef = useRef(1.0);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const newVal = !diaphragmOnRef.current;
        diaphragmOnRef.current = newVal;
        setDiaphragmOn(newVal);
    };

    const handleWheel = (e: React.WheelEvent) => {
        let speed = movementSpeedRef.current;
        if (e.deltaY < 0) {
            speed *= 1.2;
        } else {
            speed /= 1.2;
        }
        speed = Math.max(0.01, Math.min(speed, 50.0));
        movementSpeedRef.current = speed;
        setMovementSpeedUI(speed);
    };

    const toggleMutations = () => {
        mutatingRef.current = !mutatingRef.current;
        setIsMutatingUi(mutatingRef.current);
    };

    useEffect(() => {
        const init = async () => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const gpu = (navigator as any).gpu;
            if (!gpu) {
                setError("WebGPU не поддерживается.");
                return;
            }

            const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
            if (!adapter) {
                setError("Не удалось получить GPU адаптер.");
                return;
            }

            const device = await adapter.requestDevice();
            const format = (navigator as any).gpu.getPreferredCanvasFormat();
            
            const context = canvas.getContext('webgpu') as any;
            const GPUTextureUsage = (window as any).GPUTextureUsage;
            context.configure({
                device,
                format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
                alphaMode: 'opaque'
            });

            // WGSL Shader
            const shaderCode = `
                struct Uniforms {
                    eye: vec4<f32>,
                    forward: vec4<f32>,
                    right: vec4<f32>,
                    up: vec4<f32>,
                    params: vec4<f32>, // x: time, y: resX, z: resY, w: pad
                    params2: vec4<f32>, // x: diaphragmOn
                };

                @group(0) @binding(0) var<uniform> u: Uniforms;
                @group(0) @binding(1) var<storage, read> entropyBuffer: array<u32>;

                struct MapRes {
                    dist: f32,
                    color: vec3<f32>,
                    mat: f32 // 0 = default, 1 = singularity
                }

                fn sdSphere(p: vec3<f32>, r: f32) -> f32 {
                    return length(p) - r;
                }

                fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
                    let q = abs(p) - b;
                    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
                }

                fn sdTetrahedron(p: vec3<f32>, r: f32) -> f32 {
                    let md = max(
                        max(-p.x - p.y - p.z, p.x + p.y - p.z),
                        max(-p.x + p.y + p.z, p.x - p.y + p.z)
                    );
                    return (md - r) / sqrt(3.0);
                }

                fn opSmoothSub(d1: f32, d2: f32, k: f32) -> f32 {
                    let h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
                    return mix(d2, -d1, h) + k * h * (1.0 - h);
                }

                fn hash3(p: vec3<f32>) -> u32 {
                    var x = bitcast<u32>(p.x) * 114514u;
                    var y = bitcast<u32>(p.y) * 1919810u;
                    var z = bitcast<u32>(p.z) * 1337u;
                    var h = x ^ (y << 1u) ^ (z << 2u);
                    h ^= h >> 16u;
                    h *= 0x85ebca6bu;
                    h ^= h >> 13u;
                    return h;
                }

                fn getGeometry(pos: vec3<f32>) -> MapRes {
                    let intensity = u.params.w;
                    let t = u.params.x;

                    let c = 6.0;
                    let cell = floor((pos + vec3<f32>(c*0.5)) / c);
                    let p_base = pos - cell * c;

                    let p = p_base + vec3<f32>(
                        sin(p_base.y * 3.0 + t * 2.0),
                        cos(p_base.z * 3.0 + t * 2.0),
                        sin(p_base.x * 3.0 + t * 2.0)
                    ) * intensity * 1.5;

                    let idx = u32(abs(cell.x + cell.y * 32.0 + cell.z * 1024.0)) % 1024u;
                    let seed = hash3(cell);
                    let nzeros = entropyBuffer[idx];

                    let offset = vec3<f32>(
                        sin(t*2.0 + f32(seed)), 
                        cos(t*3.0 + f32(seed)), 
                        sin(t*1.5 - f32(seed))
                    ) * 0.5 * (1.0 + intensity);
                    
                    let rad = 0.6 + intensity * 0.3 + min(f32(nzeros) * 0.05, 1.5);
                    let d = sdSphere(p - offset, rad);
                    
                    let intensityColor = clamp(f32(nzeros) / 100.0, 0.05, 1.0);
                    let col = vec3<f32>(intensityColor, intensityColor, 0.0);

                    return MapRes(d, col, 0.0);
                }

                fn map(pos: vec3<f32>) -> MapRes {
                    var base = getGeometry(pos);
                    let c = 6.0;
                    let centerCell = floor((pos + vec3<f32>(c*0.5)) / c);
                    
                    var singDist = 1000.0;
                    
                    // Look for black hole singularities in adjacent cells
                    for(var kz = -1; kz <= 1; kz++) {
                        for(var ky = -1; ky <= 1; ky++) {
                            for(var kx = -1; kx <= 1; kx++) {
                                let ncell = centerCell + vec3<f32>(f32(kx), f32(ky), f32(kz));
                                let idx = u32(abs(ncell.x + ncell.y * 32.0 + ncell.z * 1024.0)) % 1024u;
                                let nzeros = entropyBuffer[idx];
                                
                                if (nzeros >= 18u) {
                                    let np = pos - ncell * c;
                                    // Rad grows exponentially with leading zeros
                                    let rad = min(5.5, pow(1.5, f32(nzeros) - 17.0) * 0.25);
                                    let d = sdSphere(np, rad);
                                    singDist = min(singDist, d);
                                }
                            }
                        }
                    }

                    if (singDist < 100.0) {
                        let k = 1.0; // Smoothness factor
                        let smoothed = opSmoothSub(singDist, base.dist, k);
                        
                        // If we are strictly inside the singularity core, render it black
                        if (singDist < smoothed) {
                            return MapRes(singDist, vec3<f32>(0.0), 1.0);
                        } else {
                            return MapRes(smoothed, base.color, 0.0);
                        }
                    }

                    return base;
                }

                fn calcNormal(p: vec3<f32>) -> vec3<f32> {
                    let e = vec2<f32>(0.005, 0.0);
                    return normalize(vec3<f32>(
                        map(p + e.xyy).dist - map(p - e.xyy).dist,
                        map(p + e.yxy).dist - map(p - e.yxy).dist,
                        map(p + e.yyx).dist - map(p - e.yyx).dist
                    ));
                }

                @vertex 
                fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
                    var pos = array<vec2<f32>, 3>(
                        vec2<f32>(-1.0, -1.0), 
                        vec2<f32>(3.0, -1.0), 
                        vec2<f32>(-1.0, 3.0)
                    );
                    return vec4<f32>(pos[vi], 0.0, 1.0);
                }

                @fragment 
                fn fs(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
                    let uv = (fragCoord.xy / vec2<f32>(u.params.y, u.params.z)) * 2.0 - 1.0;
                    let aspect = u.params.y / u.params.z;
                    
                    let rayDir = normalize(u.forward.xyz + u.right.xyz * uv.x * aspect - u.up.xyz * uv.y);
                    let rayOrigin = u.eye.xyz;

                    var t = 0.0;
                    var res = MapRes(0.0, vec3<f32>(0.0), 0.0);
                    
                    for(var i=0; i<100; i++) {
                        let p = rayOrigin + rayDir * t;
                        res = map(p);
                        if(res.dist < 0.005 || t > 120.0) { break; }
                        t += res.dist;
                    }

                    let sunDir = normalize(vec3<f32>(0.4, 0.9, -0.3));
                    let fogCol = vec3<f32>(0.0, 0.0, 0.0); // Black background

                    if (t > 120.0) {
                        return vec4<f32>(fogCol, 1.0);
                    }

                    if (res.mat > 0.5) {
                        return vec4<f32>(0.0, 0.0, 0.0, 1.0); 
                    }

                    let p = rayOrigin + rayDir * t;
                    let n = calcNormal(p);
                    let sunDot = max(dot(n, sunDir), 0.0);
                    
                    let ambient = vec3<f32>(0.5, 0.5, 0.5);
                    let c = res.color * (ambient + sunDot * vec3<f32>(0.8, 0.8, 0.8));

                    let fogDist = clamp((t - 15.0) / 105.0, 0.0, 1.0);
                    var finalColor = mix(c, fogCol, fogDist);

                    // Thermal Diaphragm
                    if (u.params2.x > 0.5) {
                        let lum = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114));
                        let intensityLevel = u.params2.y;
                        let thermalRed = mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(1.0, 0.0, 0.0), clamp(lum * 2.0 * intensityLevel, 0.0, 1.0));
                        let thermalFinal = mix(thermalRed, vec3<f32>(1.0, 1.0, 0.0), clamp((lum * 2.0 - 1.0) * intensityLevel, 0.0, 1.0));
                        
                        let distFromCenter = length(uv);
                        let vignette = smoothstep(1.5, 0.3 * intensityLevel, distFromCenter);

                        finalColor = mix(finalColor, thermalFinal * vignette, clamp(intensityLevel, 0.0, 1.0));
                    }

                    return vec4<f32>(finalColor, 1.0);
                }
            `;

            const module = device.createShaderModule({ code: shaderCode });

            const pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: { module, entryPoint: 'vs' },
                fragment: {
                    module,
                    entryPoint: 'fs',
                    targets: [{ format }]
                },
                primitive: { topology: 'triangle-list' }
            });

            const GPUBufferUsage = (window as any).GPUBufferUsage;

            // Buffers
            const uniformBuffer = device.createBuffer({
                size: 96, // 6 * 16 bytes (6 vec4s)
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            const bufferSize = 1024;
            const entropyBuffer = device.createBuffer({
                size: bufferSize * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            const cpuEntropy = new Uint32Array(bufferSize);
            for (let i = 0; i < bufferSize; i++) {
                cpuEntropy[i] = Math.floor(Math.random() * 5); 
            }
            device.queue.writeBuffer(entropyBuffer, 0, cpuEntropy);

            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: entropyBuffer } }
                ]
            });

            const cross = (a: number[], b: number[]) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
            const normalize = (v: number[]) => { let l = Math.hypot(v[0], v[1], v[2]); return [v[0]/l, v[1]/l, v[2]/l]; };
            const rotateVec = (v: number[], k: number[], theta: number) => {
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);
                const dot = v[0]*k[0] + v[1]*k[1] + v[2]*k[2];
                const cr = cross(k, v);
                return [
                    v[0]*cosT + cr[0]*sinT + k[0]*dot*(1-cosT),
                    v[1]*cosT + cr[1]*sinT + k[1]*dot*(1-cosT),
                    v[2]*cosT + cr[2]*sinT + k[2]*dot*(1-cosT)
                ];
            };

            // Camera Setup
            let posX = 0, posY = 0, posZ = -10;
            let camForward = [0, 0, 1];
            let camUp = [0, 1, 0];
            let camRight = [-1, 0, 0];

            const keys = { w: false, a: false, s: false, d: false, q: false, e: false, shift: false, ' ': false };
            
            const onKeyDown = (e: KeyboardEvent) => { 
                const k = e.key.toLowerCase();
                if (keys.hasOwnProperty(k)) keys[k as keyof typeof keys] = true; 
                if (e.key === 'Shift') keys.shift = true;
                if (e.key === ' ') keys[' '] = true;
                if (k === 'f') {
                    toggleMutations();
                }
            };
            const onKeyUp = (e: KeyboardEvent) => { 
                const k = e.key.toLowerCase();
                if (keys.hasOwnProperty(k)) keys[k as keyof typeof keys] = false; 
                if (e.key === 'Shift') keys.shift = false;
                if (e.key === ' ') keys[' '] = false;
            };
            const onMouseMove = (e: MouseEvent) => {
                if (document.pointerLockElement !== canvas) return;
                
                const dx = e.movementX * 0.002;
                const dy = -e.movementY * 0.002;

                camForward = rotateVec(camForward, camUp, -dx);
                camRight = rotateVec(camRight, camUp, -dx);
                
                camForward = rotateVec(camForward, camRight, dy);
                camUp = rotateVec(camUp, camRight, dy);

                camForward = normalize(camForward);
                camRight = normalize(camRight);
                camUp = normalize(camUp);
            };

            let touchMoveId: number | null = null;
            let touchLookId: number | null = null;
            let touchMoveStartX = 0, touchMoveStartY = 0;
            let touchLookLastX = 0, touchLookLastY = 0;
            let moveX = 0, moveY = 0;

            const onTouchStart = (e: TouchEvent) => {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const touch = e.changedTouches[i];
                    if (touch.clientX < window.innerWidth / 2) {
                        if (touchMoveId === null) {
                            touchMoveId = touch.identifier;
                            touchMoveStartX = touch.clientX;
                            touchMoveStartY = touch.clientY;
                            moveX = 0; moveY = 0;
                        }
                    } else {
                        if (touchLookId === null) {
                            touchLookId = touch.identifier;
                            touchLookLastX = touch.clientX;
                            touchLookLastY = touch.clientY;
                        }
                    }
                }
            };

            const onTouchMove = (e: TouchEvent) => {
                if (e.cancelable) e.preventDefault();
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const touch = e.changedTouches[i];
                    if (touch.identifier === touchMoveId) {
                        moveX = Math.max(-1, Math.min(1, (touch.clientX - touchMoveStartX) / 50));
                        moveY = Math.max(-1, Math.min(1, (touch.clientY - touchMoveStartY) / 50));
                    } else if (touch.identifier === touchLookId) {
                        const dx = (touch.clientX - touchLookLastX) * 0.005;
                        const dy = -(touch.clientY - touchLookLastY) * 0.005;
                        
                        camForward = rotateVec(camForward, camUp, -dx);
                        camRight = rotateVec(camRight, camUp, -dx);
                        
                        camForward = rotateVec(camForward, camRight, dy);
                        camUp = rotateVec(camUp, camRight, dy);

                        camForward = normalize(camForward);
                        camRight = normalize(camRight);
                        camUp = normalize(camUp);

                        touchLookLastX = touch.clientX;
                        touchLookLastY = touch.clientY;
                    }
                }
            };

            const onTouchEnd = (e: TouchEvent) => {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const touch = e.changedTouches[i];
                    if (touch.identifier === touchMoveId) {
                        touchMoveId = null;
                        moveX = 0; moveY = 0;
                    } else if (touch.identifier === touchLookId) {
                        touchLookId = null;
                    }
                }
            };

            window.addEventListener('keydown', onKeyDown);
            window.addEventListener('keyup', onKeyUp);
            window.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('touchstart', onTouchStart, { passive: false });
            canvas.addEventListener('touchmove', onTouchMove, { passive: false });
            canvas.addEventListener('touchend', onTouchEnd);
            canvas.addEventListener('touchcancel', onTouchEnd);

            let animationId: number;

            const K = new Uint32Array([
                0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
                0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
                0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
                0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
                0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
                0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
                0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
                0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
            ]);
            const H_INIT = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

            class FastSHA256 {
                w = new Uint32Array(64);
                h = new Uint32Array(8);

                public hash80(header80: Uint32Array, output32: Uint32Array): boolean {
                    this.h.set(H_INIT);
                    for(let i=0;i<16;i++) this.w[i]=header80[i];
                    if (!this.processChunk()) return false;

                    this.w.fill(0);
                    this.w[0]=header80[16]; this.w[1]=header80[17]; this.w[2]=header80[18]; this.w[3]=header80[19];
                    this.w[4]=0x80000000; this.w[15]=80*8;
                    if (!this.processChunk()) return false;

                    for(let i=0;i<8;i++) output32[i]=this.h[i];
                    return true;
                }
                public hash32(input32: Uint32Array, output32: Uint32Array): boolean {
                    this.h.set(H_INIT);
                    this.w.fill(0);
                    for(let i=0;i<8;i++) this.w[i]=input32[i];
                    this.w[8]=0x80000000; this.w[15]=32*8;
                    if (!this.processChunk()) return false;
                    for(let i=0;i<8;i++) output32[i]=this.h[i];
                    return true;
                }
                private processChunk(): boolean {
                    for(let j=16;j<64;j++) {
                        let w15=this.w[j-15], w2=this.w[j-2];
                        let s0=(w15>>>7|w15<<25)^(w15>>>18|w15<<14)^(w15>>>3);
                        let s1=(w2>>>17|w2<<15)^(w2>>>19|w2<<13)^(w2>>>10);
                        this.w[j]=(this.w[j-16]+s0+this.w[j-7]+s1)>>>0;
                    }
                    let a=this.h[0],b=this.h[1],c=this.h[2],d=this.h[3],e=this.h[4],f=this.h[5],g=this.h[6],h=this.h[7];
                    for(let j=0;j<64;j++) {
                        let S1=(e>>>6|e<<26)^(e>>>11|e<<21)^(e>>>25|e<<7);
                        let ch=(e&f)^(~e&g);
                        let temp1=(h+S1+ch+K[j]+this.w[j])>>>0;
                        let S0=(a>>>2|a<<30)^(a>>>13|a<<19)^(a>>>22|a<<10);
                        let maj=(a&b)^(a&c)^(b&c);
                        let temp2=(S0+maj)>>>0;
                        h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0;

                        // [ ГЕОМЕТРИЧЕСКИЙ ФИЛЬТР: СКАЛЯРНОЕ ПРОИЗВЕДЕНИЕ ГРАНЕЙ (24-Й ТАКТ) ]
                        if (j === 24) {
                            // 1. Проекция регистров в 3D-пространство
                            let scale = 1.0 / 4294967295.0; 
                            
                            // Вектор 1 (Голова вычислений)
                            let v1x = a * scale;
                            let v1y = b * scale;
                            let v1z = c * scale;
                            // Вектор 2 (Тело/Хвост вычислений)
                            let v2x = e * scale;
                            let v2y = f * scale;
                            let v2z = g * scale;
                            
                            // 2. Нормализация с микро-эпсилоном
                            v1x += 0.0001; v1y += 0.0001; v1z += 0.0001;
                            v2x += 0.0001; v2y += 0.0001; v2z += 0.0001;
                            
                            let len1 = Math.sqrt(v1x*v1x + v1y*v1y + v1z*v1z);
                            let len2 = Math.sqrt(v2x*v2x + v2y*v2y + v2z*v2z);
                            
                            let dir1x = v1x / len1; let dir1y = v1y / len1; let dir1z = v1z / len1;
                            let dir2x = v2x / len2; let dir2y = v2y / len2; let dir2z = v2z / len2;
                            
                            // 3. Вычисление топологического натяжения (Dot Product)
                            let alignment = dir1x * dir2x + dir1y * dir2y + dir1z * dir2z;
                            
                            // 4. Гильотина
                            if (Math.abs(alignment) < 0.85) {
                                this.h[0] = 0xFFFFFFFF;
                                return false;
                            }
                        }
                    }
                    this.h[0]=(this.h[0]+a)>>>0; this.h[1]=(this.h[1]+b)>>>0;
                    this.h[2]=(this.h[2]+c)>>>0; this.h[3]=(this.h[3]+d)>>>0;
                    this.h[4]=(this.h[4]+e)>>>0; this.h[5]=(this.h[5]+f)>>>0;
                    this.h[6]=(this.h[6]+g)>>>0; this.h[7]=(this.h[7]+h)>>>0;
                    return true;
                }
            }

            const hasher = new FastSHA256();
            const out1 = new Uint32Array(8);
            const out2 = new Uint32Array(8);

            // Generate "Real" initial header template
            const genesisHeader = new Uint32Array(20);
            genesisHeader[0] = 0x200000e3; // Ver
            for (let i=1; i<9; i++) genesisHeader[i] = Math.floor(Math.random() * 0xffffffff); // Prev
            for (let i=9; i<17; i++) genesisHeader[i] = Math.floor(Math.random() * 0xffffffff); // Merkle
            genesisHeader[17] = Math.floor(Date.now() / 1000); // Time
            genesisHeader[18] = 0x1d00ffff; // Bits
            genesisHeader[19] = 0; // Nonce
            
            let nonce = 0;
            let lastFrameTime = performance.now();
            let lastPhysicsTime = performance.now();
            const fpsInterval = 1000 / 24;

            let velocityY = 0;
            let telemetryCounter = 0;
            let hashrateAccumulator = 0;
            let lastTelemetryTime = performance.now();

            // Фрактальная Память (Генетические Мозги)
            const memoryBrain = {
                L1_BASE: { minFloor: 1, maxFloor: 10, limit: 128, nodes: [] as {minNonce: number, maxNonce: number, weight: number}[] },
                L2_MID: { minFloor: 11, maxFloor: 25, limit: 64, nodes: [] as {minNonce: number, maxNonce: number, weight: number}[] },
                L3_DEEP: { minFloor: 26, maxFloor: 40, limit: 32, nodes: [] as {minNonce: number, maxNonce: number, weight: number}[] },
                L4_SINGULARITY: { minFloor: 41, maxFloor: 999999, limit: 32, nodes: [] as {minNonce: number, maxNonce: number, weight: number}[] }
            };

            let lastThermalScanTime = performance.now();

            const render = (time: number) => {
                animationId = requestAnimationFrame(render);
                
                const elapsed = time - lastFrameTime;
                if (elapsed < fpsInterval) return;
                lastFrameTime = time - (elapsed % fpsInterval);

                const now = performance.now();
                const dt = now - lastPhysicsTime;
                lastPhysicsTime = now;
                appTimeRef.current += dt * timeScaleRef.current;

                if (mutatingRef.current) {
                    if (now >= pauseUntilRef.current) {
                        let batchMaxZeros = 0;
                        let batchBestNonce = 0;
                        let batchBestHashData = new Uint32Array(8);

                        // Inject Camera coordinates into header entropy
                        const camXBits = new Float32Array([posX])[0];
                        const camZBits = new Float32Array([posZ])[0];
                        const camFwdBits = new Float32Array([camForward[0]])[0];
                        genesisHeader[14] = new Uint32Array(new Float32Array([camXBits]).buffer)[0];
                        genesisHeader[15] = new Uint32Array(new Float32Array([camZBits]).buffer)[0];
                        genesisHeader[16] = new Uint32Array(new Float32Array([camFwdBits]).buffer)[0];

                        const cryptoRand = new Uint32Array(2);
                        window.crypto.getRandomValues(cryptoRand);
                        genesisHeader[17] = cryptoRand[0];
                        genesisHeader[18] = cryptoRand[1];

                        // ФРАКТАЛЬНАЯ НАВИГАЦИЯ (МОЗГИ РОЯ)
                        let navigated = false;
                        if (Math.random() < 0.3) {
                            const levels = [memoryBrain.L1_BASE, memoryBrain.L2_MID, memoryBrain.L3_DEEP, memoryBrain.L4_SINGULARITY];
                            for (let level of levels) {
                                if (level.nodes.length > 0) {
                                    // Прыжок в самую перспективную зону
                                    let bestNode = level.nodes[Math.floor(Math.random() * level.nodes.length)];
                                    nonce = bestNode.maxNonce + 1000;
                                    navigated = true;
                                    break;
                                }
                            }
                        }

                        const AVALANCHE = 32768; // Boost to 800k H/s
                        for (let i = 0; i < AVALANCHE; i++) {
                            nonce = (nonce + 1) >>> 0;
                            genesisHeader[19] = nonce;
                            
                            const s1 = hasher.hash80(genesisHeader, out1);
                            if (!s1) {
                                genesisHeader[1] = (genesisHeader[1] + 1) >>> 0;
                                continue;
                            }
                            const s2 = hasher.hash32(out1, out2);
                            if (!s2) continue;
                            
                            let zeros = Math.clz32(out2[0]);
                            if (zeros === 32) zeros += Math.clz32(out2[1]);
                            
                            cpuEntropy[i % 1024] = zeros;
                            
                            if (zeros > batchMaxZeros) {
                                batchMaxZeros = zeros;
                                batchBestNonce = nonce;
                                batchBestHashData.set(out2);
                            }
                        }

                        hashrateAccumulator += AVALANCHE;

                        device.queue.writeBuffer(entropyBuffer, 0, cpuEntropy);

                        // ЧЕКПОИНТ В ПАМЯТЬ
                        if (batchMaxZeros >= 14) {
                            if (batchMaxZeros <= memoryBrain.L1_BASE.maxFloor) {
                                memoryBrain.L1_BASE.nodes.push({minNonce: batchBestNonce - 5000, maxNonce: batchBestNonce, weight: 1});
                                if (memoryBrain.L1_BASE.nodes.length > memoryBrain.L1_BASE.limit) memoryBrain.L1_BASE.nodes.shift();
                            } else if (batchMaxZeros <= memoryBrain.L2_MID.maxFloor) {
                                memoryBrain.L2_MID.nodes.push({minNonce: batchBestNonce - 5000, maxNonce: batchBestNonce, weight: 2});
                                if (memoryBrain.L2_MID.nodes.length > memoryBrain.L2_MID.limit) memoryBrain.L2_MID.nodes.shift();
                            } else {
                                memoryBrain.L3_DEEP.nodes.push({minNonce: batchBestNonce - 5000, maxNonce: batchBestNonce, weight: 3});
                                if (memoryBrain.L3_DEEP.nodes.length > memoryBrain.L3_DEEP.limit) memoryBrain.L3_DEEP.nodes.shift();
                            }
                        }

                        if (batchMaxZeros >= 18) {
                            const hashHex = Array.from(batchBestHashData).map(w => w.toString(16).padStart(8, '0')).join('');
                            genesisHeader[19] = batchBestNonce;
                            const headerHex = Array.from(genesisHeader).map(w => w.toString(16).padStart(8, '0')).join('');
                            
                            const newDisc = { 
                                nonce: batchBestNonce, 
                                hash: hashHex, 
                                zeros: batchMaxZeros, 
                                header: headerHex,
                                id: Date.now() + Math.random() 
                            };

                            if (batchMaxZeros > maxZerosRecordRef.current) {
                                maxZerosRecordRef.current = batchMaxZeros;
                                pauseUntilRef.current = performance.now() + 2000; // 2s pause
                                
                                // Auto CSV Export
                                const hexZerosCount = Math.floor(batchMaxZeros / 4);
                                const csvContent = "data:text/csv;charset=utf-8," 
                                    + "Timestamp,Nonce,BinaryZeros,HexZeros,Hash,Header\n"
                                    + `${new Date().toISOString()},${batchBestNonce},${batchMaxZeros},${hexZerosCount},0x${hashHex},${headerHex}\n`;
                                
                                const encodedUri = encodeURI(csvContent);
                                const link = document.createElement("a");
                                link.setAttribute("href", encodedUri);
                                link.setAttribute("download", `singularity_block_H${hexZerosCount}_B${batchMaxZeros}.csv`);
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                            }

                            setDiscoveries(prev => {
                            const newArr = [...prev, newDisc];
                            return newArr.slice(-50);
                        });

                        setTopDiscoveries(prev => {
                            const newTop = [...prev, newDisc];
                            newTop.sort((a, b) => b.zeros - a.zeros);
                            
                            // Remove lowest hash value clones if they are the exact same? 
                            // Using a simple top 3 slice and simple deduplication
                            const uniqueTop = newTop.filter((item, index, self) =>
                                index === self.findIndex((t) => (
                                    t.hash === item.hash
                                ))
                            );
                            
                            return uniqueTop.slice(0, 3);
                        });
                        }
                    }
                }

                // Update sizes
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;

                // Input handling
                if (gravityRef.current > 0 || gravityRef.current < 0) {
                    velocityY -= gravityRef.current * (dt * 0.001);
                    posY += velocityY * (dt * 0.1);
                } else {
                    velocityY = 0;
                }

                const speed = movementSpeedRef.current;
                if (keys.w) { posX += camForward[0]*speed; posY += camForward[1]*speed; posZ += camForward[2]*speed; }
                if (keys.s) { posX -= camForward[0]*speed; posY -= camForward[1]*speed; posZ -= camForward[2]*speed; }
                if (keys.a) { posX -= camRight[0]*speed; posY -= camRight[1]*speed; posZ -= camRight[2]*speed; }
                if (keys.d) { posX += camRight[0]*speed; posY += camRight[1]*speed; posZ += camRight[2]*speed; }
                
                if (keys[' ']) { 
                    if (gravityRef.current === 0) {
                        posX += camUp[0]*speed; posY += camUp[1]*speed; posZ += camUp[2]*speed; 
                    } else {
                        velocityY += 0.02 * timeScaleRef.current; // jump pulse
                    }
                }
                if (keys.shift) { 
                    if (gravityRef.current === 0) {
                        posX -= camUp[0]*speed; posY -= camUp[1]*speed; posZ -= camUp[2]*speed; 
                    } else {
                        velocityY -= 0.02 * timeScaleRef.current;
                    }
                }
                
                if (keys.q) { 
                    const dr = -0.05;
                    camUp = rotateVec(camUp, camForward, dr);
                    camRight = rotateVec(camRight, camForward, dr);
                    camUp = normalize(camUp);
                    camRight = normalize(camRight);
                }
                if (keys.e) { 
                    const dr = 0.05;
                    camUp = rotateVec(camUp, camForward, dr);
                    camRight = rotateVec(camRight, camForward, dr);
                    camUp = normalize(camUp);
                    camRight = normalize(camRight);
                }

                if (moveX !== 0 || moveY !== 0) {
                    const mForward = -moveY; 
                    const mRight = moveX;
                    posX += (camForward[0] * mForward + camRight[0] * mRight) * speed;
                    posY += (camForward[1] * mForward + camRight[1] * mRight) * speed;
                    posZ += (camForward[2] * mForward + camRight[2] * mRight) * speed;
                }

                if (isMeasuringRef.current) {
                    telemetryCounter++;
                    if (now - lastTelemetryTime > 500) {
                        const elapsedSec = (now - lastTelemetryTime) / 1000;
                        const fps = Math.round(telemetryCounter / elapsedSec);
                        const hr = Math.round(hashrateAccumulator / elapsedSec);
                        
                        if (telemetryTextRef.current) {
                            telemetryTextRef.current.innerText = `
FPS: ${fps}
H/s: ${hr}
X: ${posX.toFixed(2)}
Y: ${posY.toFixed(2)}
Z: ${posZ.toFixed(2)}
Fwd: [${camForward[0].toFixed(2)}, ${camForward[1].toFixed(2)}, ${camForward[2].toFixed(2)}]
Vel.Y: ${velocityY.toFixed(4)}
`                           .trim();
                        }
                        
                        telemetryCounter = 0;
                        hashrateAccumulator = 0;
                        lastTelemetryTime = now;
                    }
                }

                if (coolingTextRef.current) {
                    if (now < pauseUntilRef.current) {
                        coolingTextRef.current.innerText = `> ОХЛАЖДЕНИЕ: ${Math.ceil((pauseUntilRef.current - now) / 1000)}с...`;
                        coolingTextRef.current.className = "text-[#FF3E3E] font-mono text-[9px] uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,1)] animate-pulse";
                    } else {
                        coolingTextRef.current.innerText = "";
                        coolingTextRef.current.className = "hidden";
                    }
                }

                const uniforms = new Float32Array([
                    posX, posY, posZ, 0,
                    camForward[0], camForward[1], camForward[2], 0,
                    camRight[0], camRight[1], camRight[2], 0,
                    camUp[0], camUp[1], camUp[2], 0,
                    appTimeRef.current * 0.001, canvas.width, canvas.height, noiseIntensityRef.current,
                    diaphragmOnRef.current ? 1.0 : 0.0, diaphragmIntensityRef.current, 0, 0
                ]);
                device.queue.writeBuffer(uniformBuffer, 0, uniforms);

                const commandEncoder = device.createCommandEncoder();
                const passEncoder = commandEncoder.beginRenderPass({
                    colorAttachments: [{
                        view: context.getCurrentTexture().createView(),
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'store',
                    }]
                });

                passEncoder.setPipeline(pipeline);
                passEncoder.setBindGroup(0, bindGroup);
                passEncoder.draw(3, 1, 0, 0);
                passEncoder.end();

                device.queue.submit([commandEncoder.finish()]);

                // Тепловой датчик (Сканирование)
                if (now - lastThermalScanTime > 200) {
                    lastThermalScanTime = now;
                    const scanCanvas = scanCanvasRef.current;
                    if (scanCanvas && canvas) {
                        const w = canvas.width;
                        const h = canvas.height;
                        const scanW = Math.floor(w / 4);
                        const scanH = h;
                        
                        scanCanvas.width = scanW;
                        scanCanvas.height = scanH;
                        const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
                        if (scanCtx) {
                            try {
                                scanCtx.drawImage(canvas, w - scanW, 0, scanW, scanH, 0, 0, scanW, scanH);
                                const imgData = scanCtx.getImageData(0, 0, scanW, scanH);
                                const data = imgData.data;
                                
                                let yellowScore = 0;
                                const thresh = sensorThresholdRef.current;
                                
                                for (let i = 0; i < data.length; i += 4) {
                                    let r = data[i];
                                    let g = data[i+1];
                                    let b = data[i+2];
                                    
                                    if (r > thresh && g > thresh && b < 150) {
                                        yellowScore += (r + g) / 2;
                                    }
                                }
                                
                                let currentScore = yellowScore / (scanW * scanH);
                                
                                if (thermalNormRef.current === 0) {
                                    thermalSamplesRef.current.push(currentScore);
                                    if (thermalSamplesRef.current.length >= 20) {
                                        const sum = thermalSamplesRef.current.reduce((a, b) => a + b, 0);
                                        thermalNormRef.current = sum / thermalSamplesRef.current.length;
                                    }
                                }
                                
                                setThermalStats({
                                    current: currentScore,
                                    norm: thermalNormRef.current,
                                    deviation: thermalNormRef.current > 0 ? (currentScore - thermalNormRef.current) : 0
                                });
                            } catch (err) {
                                // Ignore Canvas taint errors if any
                            }
                        }
                    }
                }
            };

            animationId = requestAnimationFrame(render);

            return () => {
                cancelAnimationFrame(animationId);
                window.removeEventListener('keydown', onKeyDown);
                window.removeEventListener('keyup', onKeyUp);
                window.removeEventListener('mousemove', onMouseMove);
                if (canvas) {
                    canvas.removeEventListener('touchstart', onTouchStart);
                    canvas.removeEventListener('touchmove', onTouchMove);
                    canvas.removeEventListener('touchend', onTouchEnd);
                    canvas.removeEventListener('touchcancel', onTouchEnd);
                }
            };
        };

        const cleanup = init();
        return () => {
            cleanup.then(cleanFn => {
                if (cleanFn) cleanFn();
            });
        };
    }, []);

    useEffect(() => {
        const onLockChange = () => setIsLocked(document.pointerLockElement === canvasRef.current);
        document.addEventListener('pointerlockchange', onLockChange);
        return () => document.removeEventListener('pointerlockchange', onLockChange);
    }, []);

    const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    if (error) {
        return (
            <div className="fixed inset-0 z-50 bg-[#050505] text-[#FF3E3E] flex items-center justify-center font-mono p-4">
                <div className="text-center border border-[#FF3E3E] p-8 max-w-md">
                    <p className="mb-4">CRITICAL ERROR</p>
                    <p className="text-sm opacity-80">{error}</p>
                    <button onClick={onClose} className="mt-6 px-4 py-2 bg-[#FF3E3E] text-white">Вернуться</button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 bg-black overflow-hidden select-none touch-none">
            <canvas ref={scanCanvasRef} className="hidden" />
            <canvas 
                ref={canvasRef} 
                className="w-full h-full block cursor-crosshair touch-none"
                onClick={() => {
                    if (!isLocked && !isMobile && !pointerLockDisabled) canvasRef.current?.requestPointerLock();
                }}
                onContextMenu={handleContextMenu}
                onWheel={handleWheel}
            />
            
            {!isLocked && !isMobile && !pointerLockDisabled && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black z-[55]">
                    <div className="text-center font-mono animate-pulse">
                        <div className="text-[#00FF41] text-2xl font-bold mb-4 tracking-[0.2em]">ТЕРМОДИНАМИЧЕСКИЙ ДЕШИФРАТОР SHA-256</div>
                        <div className="text-white opacity-70 text-sm">Кликните по экрану для погружения (Pointer Lock)</div>
                    </div>
                </div>
            )}

            {/* HUD: Ультра-минималистичный боковой интерфейс */}
            <div className="absolute top-2 left-2 z-[75] flex flex-col gap-4 pointer-events-auto w-[230px] bg-black/60 backdrop-blur-md p-3 rounded-md border border-[#00FF41]/20">
                
                {/* 1. Измерения */}
                <div className="flex flex-col items-start gap-1">
                    <button 
                        onClick={() => {
                            setIsMeasuring(!isMeasuring);
                            isMeasuringRef.current = !isMeasuring;
                        }}
                        className={`text-[9px] font-mono transition-colors tracking-widest drop-shadow-[0_1px_2px_rgba(0,0,0,1)] text-left ${
                            isMeasuring ? 'text-[#00FF41]' : 'text-white/50 hover:text-white'
                        }`}
                    >
                        {isMeasuring ? '[-] ИЗМЕРЕНИЯ' : '[+] ИЗМЕРЕНИЯ'}
                    </button>
                    <AnimatePresence>
                    {isMeasuring && (
                        <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                        >
                            <div 
                                ref={telemetryTextRef} 
                                className="text-[#00FF41] font-mono text-[9px] whitespace-pre drop-shadow-[0_1px_1px_rgba(0,0,0,1)] border-l border-[#00FF41]/30 pl-2 ml-1"
                            >
                                Загрузка...
                            </div>
                        </motion.div>
                    )}
                    </AnimatePresence>
                </div>

                {/* 2. Управление */}
                <div className="flex flex-col items-start gap-1">
                    <button 
                        onClick={() => setIsControlsOpen(!isControlsOpen)}
                        className={`text-[9px] font-mono transition-colors tracking-widest drop-shadow-[0_1px_2px_rgba(0,0,0,1)] text-left ${
                            isControlsOpen ? 'text-[#00FF41]' : 'text-white/50 hover:text-white'
                        }`}
                    >
                        {isControlsOpen ? '[-] УПРАВЛЕНИЕ' : '[+] УПРАВЛЕНИЕ'}
                    </button>
                    
                    <AnimatePresence>
                        {isControlsOpen && (
                            <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="flex flex-col gap-3 overflow-hidden ml-1 pl-2 border-l border-[#00FF41]/30 w-full"
                            >
                                <button 
                                    onClick={toggleMutations}
                                    className={`text-[9px] text-left font-mono uppercase transition-colors drop-shadow-[0_1px_1px_rgba(0,0,0,1)] ${isMutatingUi ? 'text-[#00FF41]' : 'text-[#FF3E3E] animate-pulse'}`}
                                >
                                    {isMutatingUi ? '> Энтропия Активна [F]' : '> Энтропия Пауза [F]'}
                                </button>
                                <div ref={coolingTextRef} className="empty:hidden" />

                                <div className="flex flex-col gap-1 w-full relative">
                                    <label className="text-[#00FF41] font-mono text-[9px] uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
                                        Шум: {(noiseIntensityUI * 100).toFixed(0)}%
                                    </label>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max="1" 
                                        step="0.01" 
                                        value={noiseIntensityUI} 
                                        onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            setNoiseIntensityUI(val);
                                            noiseIntensityRef.current = val;
                                        }}
                                        className="w-full h-0.5 appearance-none bg-white/20 accent-[#00FF41] outline-none cursor-pointer"
                                    />
                                </div>

                                <div className="flex flex-col gap-1 w-full relative">
                                    <label className="text-[#00FF41] font-mono text-[9px] uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
                                        Время (x): {timeScaleUI.toFixed(5)}
                                    </label>
                                    <input 
                                        type="range" 
                                        min="-2" 
                                        max="2" 
                                        step="0.00001" 
                                        value={timeScaleUI} 
                                        onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            setTimeScaleUI(val);
                                            timeScaleRef.current = val;
                                        }}
                                        className="w-full h-0.5 appearance-none bg-white/20 accent-[#00FF41] outline-none cursor-pointer"
                                    />
                                </div>

                                <div className="flex flex-col gap-1 w-full relative">
                                    <label className="text-[#00FF41] font-mono text-[9px] uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
                                        Гравитация: {gravityUI.toFixed(2)}
                                    </label>
                                    <input 
                                        type="range" 
                                        min="-10" 
                                        max="10" 
                                        step="0.1" 
                                        value={gravityUI} 
                                        onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            setGravityUI(val);
                                            gravityRef.current = val;
                                        }}
                                        className="w-full h-0.5 appearance-none bg-white/20 accent-[#00FF41] outline-none cursor-pointer"
                                    />
                                </div>

                                <div className="flex flex-col gap-1 w-full relative">
                                    <label className="text-[#00FF41] font-mono text-[9px] uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
                                        Скорость Полета
                                    </label>
                                    <input 
                                        type="number" 
                                        step="0.1" 
                                        value={movementSpeedUI} 
                                        onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) {
                                                setMovementSpeedUI(val);
                                                movementSpeedRef.current = val;
                                            }
                                        }}
                                        className="w-full bg-black/50 border border-[#00FF41]/30 text-[#00FF41] text-[10px] p-1 font-mono outline-none"
                                    />
                                </div>

                                <div className="flex flex-col gap-1 w-full relative">
                                    <label className="text-[#00FF41] font-mono text-[9px] uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,1)] flex justify-between">
                                        <span>Тепловая Диафрагма (ПКМ)</span>
                                        <span>{diaphragmOn ? "ВКЛ" : "ВЫКЛ"}</span>
                                    </label>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max="2" 
                                        step="0.05" 
                                        value={diaphragmIntensityUI} 
                                        onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            setDiaphragmIntensityUI(val);
                                            diaphragmIntensityRef.current = val;
                                        }}
                                        className="w-full h-0.5 appearance-none bg-white/20 accent-[#FF3E3E] outline-none cursor-pointer mt-1"
                                    />
                                </div>

                                <button 
                                    onClick={() => {
                                        setPointerLockDisabled(!pointerLockDisabled);
                                        if (document.pointerLockElement) {
                                            document.exitPointerLock();
                                        }
                                    }}
                                    className={`text-[9px] text-left font-mono uppercase transition-colors drop-shadow-[0_1px_1px_rgba(0,0,0,1)] border px-1 py-0.5 mt-2 ${pointerLockDisabled ? 'text-black bg-[#FF3E3E] border-[#FF3E3E]' : 'text-[#00FF41] border-[#00FF41]/30 hover:bg-[#00FF41]/10'}`}
                                >
                                    {pointerLockDisabled ? 'МЫШЬ ОСВОБОЖДЕНА (ПК)' : 'ОСВОБОДИТЬ МЫШЬ (ПК)'}
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* 3. Журнал */}
                <div className="flex flex-col items-start gap-1 w-[220px]">
                    <button 
                        onClick={() => setIsLogOpen(!isLogOpen)}
                        className={`text-[9px] font-mono transition-colors tracking-widest drop-shadow-[0_1px_2px_rgba(0,0,0,1)] text-left ${
                            isLogOpen ? 'text-[#00FF41]' : 'text-white/50 hover:text-white'
                        }`}
                    >
                        {isLogOpen ? '[-] ЖУРНАЛ СИНГУЛЯРНОСТЕЙ (18+ b0)' : '[+] ЖУРНАЛ СИНГУЛЯРНОСТЕЙ'}
                    </button>
                    <AnimatePresence>
                        {isLogOpen && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden w-full ml-1"
                            >
                                <div 
                                    className="flex flex-col gap-1 max-h-[30vh] overflow-y-auto pl-2 border-l border-[#00FF41]/30 pr-2 scrollbar-thin scrollbar-thumb-[#00FF41]/30 scrollbar-track-transparent"
                                    ref={(el) => {
                                        if (el && isMutatingUi) el.scrollTop = el.scrollHeight;
                                    }}
                                >
                                    {discoveries.length === 0 && (
                                        <div className="text-[#00FF41]/50 text-[9px] font-mono animate-pulse drop-shadow-md">
                                            {'>'} Ожидание сингулярностей...
                                        </div>
                                    )}
                                    {discoveries.map(d => {
                                        const hexZerosCount = Math.floor(d.zeros / 4);
                                        return (
                                            <div key={d.id} className="flex justify-between items-start group relative pb-1">
                                                <div className="font-mono text-[9px] leading-tight flex flex-col gap-0.5">
                                                    <div className="text-[#00FF41] drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">{'>'}{d.zeros}b0</div>
                                                    <div className="text-white/60 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]"
                                                        dangerouslySetInnerHTML={{
                                                            __html: parseInt(d.hash.substring(0, 8), 16)
                                                                        .toString(2).padStart(32, '0')
                                                                        .replace(/^0+/, (match) => `<span class="text-[#00FF41] font-bold">${match}</span>`)
                                                                        .substring(0, 24)
                                                        }} 
                                                    />
                                                </div>
                                                <button 
                                                    className="text-[#00FF41]/60 hover:text-[#00FF41] transition-opacity p-1"
                                                    onClick={() => {
                                                        const n = d.nonce;
                                                        const nonceHexLE = [(n & 0xff).toString(16).padStart(2, '0'), ((n >> 8) & 0xff).toString(16).padStart(2, '0'), ((n >> 16) & 0xff).toString(16).padStart(2, '0'), ((n >>> 24) & 0xff).toString(16).padStart(2, '0')].join('');
                                                        const hashFull = d.hash.length === 64 ? d.hash : (d.hash + '8b2c4d9a1f8b2c4d9a1f8b2c4d9a1f8b2c4d9a1f8b2c4d9a1f8b2c4d9a1f').substring(0, 64);
                                                        navigator.clipboard.writeText(`[ СИНГУЛЯРНОСТЬ ОБНАРУЖЕНА ]\nБинарных Нулей: ${d.zeros} (Hex нулей: ${hexZerosCount})\nHash:  0x${hashFull}\nNonce: ${d.nonce} (LE: 0x${nonceHexLE})\n\n[ ВХОДНЫЕ ДАННЫЕ : 80-BYTE BLOCK HEADER ]\n${d.header}`);
                                                    }}
                                                    title="Копировать Хедер"
                                                >
                                                    <Copy className="w-3 h-3 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]" />
                                                </button>
                                            </div>
                                        )
                                    })}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* 4. Рекорды */}
                {topDiscoveries.length > 0 && (
                <div className="flex flex-col items-start gap-1 w-[220px]">
                    <button 
                        onClick={() => setIsLeaderboardOpen(!isLeaderboardOpen)}
                        className={`text-[9px] font-mono transition-colors tracking-widest drop-shadow-[0_1px_2px_rgba(0,0,0,1)] text-left ${
                            isLeaderboardOpen ? 'text-[#00FF41]' : 'text-white/50 hover:text-white'
                        }`}
                    >
                        {isLeaderboardOpen ? '[-] АБСОЛЮТНЫЕ РЕКОРДЫ' : '[+] АБСОЛЮТНЫЕ РЕКОРДЫ'}
                    </button>
                    <AnimatePresence>
                    {isLeaderboardOpen && (
                        <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="flex flex-col gap-1 overflow-hidden items-start ml-1 pl-2 border-l border-[#00FF41]/30 w-full"
                        >
                            {topDiscoveries.map((d, idx) => (
                                <div key={d.id} className="flex justify-between items-center w-full text-[9px] font-mono group drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                                    <div className="text-[#00FF41]">#{idx + 1} ({d.zeros}b0)</div>
                                    <div className="text-white/50" 
                                        dangerouslySetInnerHTML={{
                                            __html: parseInt(d.hash.substring(0, 8), 16)
                                                        .toString(2).padStart(32, '0')
                                                        .replace(/^0+/, (match) => `<span class="text-[#00FF41] font-bold">${match}</span>`)
                                                        .substring(0, 24) + ".."
                                        }} 
                                    />
                                    <button 
                                        className="text-[#00FF41]/60 hover:text-[#00FF41] transition-opacity p-1"
                                        onClick={() => {
                                            const n = d.nonce;
                                            const hexZerosCount = Math.floor(d.zeros / 4);
                                            const nonceHexLE = [(n & 0xff).toString(16).padStart(2, '0'), ((n >> 8) & 0xff).toString(16).padStart(2, '0'), ((n >> 16) & 0xff).toString(16).padStart(2, '0'), ((n >>> 24) & 0xff).toString(16).padStart(2, '0')].join('');
                                            const hashFull = d.hash.length === 64 ? d.hash : (d.hash + '8b2c4d9a1f8b2c4d9a1f8b2c4d9a1f8b2c4d9a1f8b2c4d9a1f8b2c4d9a1f').substring(0, 64);
                                            navigator.clipboard.writeText(`[ АБСОЛЮТНАЯ СИНГУЛЯРНОСТЬ ]\nБинарных Нулей: ${d.zeros} (Hex нулей: ${hexZerosCount})\nHash:  0x${hashFull}\nNonce: ${d.nonce} (LE: 0x${nonceHexLE})\n\n[ ВХОДНЫЕ ДАННЫЕ : 80-BYTE BLOCK HEADER ]\n${d.header}`);
                                        }}
                                        title="Копировать Хедер"
                                    >
                                        <Copy className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </motion.div>
                    )}
                    </AnimatePresence>
                </div>
                )}
            </div>

            {/* Тепловой Датчик (Справа) */}
            <div className="absolute top-16 right-2 z-[75] flex flex-col gap-2 pointer-events-auto w-[230px] bg-black/60 backdrop-blur-md p-3 rounded-md border border-[#FFFB00]/20">
                <button 
                    onClick={() => setIsSensorOpen(!isSensorOpen)}
                    className={`text-[9px] font-mono transition-colors tracking-widest drop-shadow-[0_1px_2px_rgba(0,0,0,1)] text-right w-full uppercase ${
                        isSensorOpen ? 'text-[#FFFB00]' : 'text-white/50 hover:text-white'
                    }`}
                >
                    {isSensorOpen ? '[-] ТЕПЛОВОЙ ДАТЧИК' : '[+] ТЕПЛОВОЙ ДАТЧИК'}
                </button>
                
                <AnimatePresence>
                    {isSensorOpen && (
                        <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden flex flex-col gap-3 font-mono"
                        >
                            <div className="text-[10px] text-[#FFFB00] flex flex-col gap-1 mt-2">
                                <div className="flex justify-between">
                                    <span className="opacity-70">ФОН:</span>
                                    <span>{(thermalStats.norm * 100).toFixed(2)}%</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="opacity-70">СЕЙЧАС:</span>
                                    <span>{(thermalStats.current * 100).toFixed(2)}%</span>
                                </div>
                                <div className="flex justify-between pt-1 border-t border-[#FFFB00]/20 mt-1">
                                    <span className="opacity-70">Δ ОТКЛ:</span>
                                    <span className={thermalStats.deviation > 0.05 ? 'text-[#FF3E3E] font-bold' : (thermalStats.deviation > 0.01 ? 'text-[#FFFB00]' : 'text-[#00FF41]')}>
                                        {(thermalStats.deviation * 100).toFixed(2)}%
                                    </span>
                                </div>
                            </div>
                            
                            <div className="flex flex-col gap-1 w-full relative mt-2 text-[#FFFB00]">
                                <label className="font-mono text-[9px] uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,1)] flex justify-between">
                                    <span>ПОРОГ (RGB)</span>
                                    <span>{sensorThresholdUI}</span>
                                </label>
                                <input 
                                    type="range" 
                                    min="100" 
                                    max="250" 
                                    step="1" 
                                    value={sensorThresholdUI} 
                                    onChange={e => {
                                        const val = parseInt(e.target.value);
                                        setSensorThresholdUI(val);
                                        sensorThresholdRef.current = val;
                                    }}
                                    className="w-full h-0.5 appearance-none bg-white/20 accent-[#FFFB00] outline-none cursor-pointer mt-1"
                                />
                            </div>

                            <button 
                                onClick={() => {
                                    thermalNormRef.current = 0;
                                    thermalSamplesRef.current = [];
                                    setThermalStats({ current: 0, norm: 0, deviation: 0 });
                                }}
                                className="text-[9px] text-center font-mono uppercase transition-colors border border-[#FFFB00]/30 text-[#FFFB00] hover:bg-[#FFFB00]/10 py-1 mt-1"
                            >
                                СБРОС НОРМЫ
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Подсказки */}
            <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1 z-[60] pointer-events-auto bg-black/40 p-2 rounded-md border border-[#00FF41]/20 min-w-[160px]">
                <button 
                    onClick={() => setIsGuideOpen(!isGuideOpen)}
                    className={`text-[9px] font-mono transition-colors tracking-widest drop-shadow-[0_1px_2px_rgba(0,0,0,1)] uppercase text-right ${
                        isGuideOpen ? 'text-[#00FF41]' : 'text-white/50 hover:text-white'
                    }`}
                >
                    {isGuideOpen ? '[-] ПОДСКАЗКИ' : '[+] ПОДСКАЗКИ'}
                </button>
                <AnimatePresence>
                    {isGuideOpen && (
                        <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden flex flex-col text-right font-mono text-[9px] text-white/50 drop-shadow-[0_1px_2px_rgba(0,0,0,1)] pr-1 border-r border-[#00FF41]/30"
                        >
                            <div className="text-[#00FF41]/80 font-bold mb-1">RAYMARCHING</div>
                            {isMobile ? (
                                <>
                                    <div>Свайп Слева: Перемещение</div>
                                    <div>Свайп Справа: Осмотр</div>
                                </>
                            ) : (
                                <>
                                    <div>Навигация: WASD</div>
                                    <div>Взлет: Space/Shift</div>
                                    <div>Крен: Q/E</div>
                                    <div>Обзор: Мышь</div>
                                    <div>Клик - Захват мыши | ESC - Освободить</div>
                                </>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <button 
                onClick={onClose}
                className="absolute top-2 right-2 flex items-center gap-2 bg-black/60 p-2 px-3 text-[#FF3E3E] hover:text-white hover:bg-[#FF3E3E] transition-all pointer-events-auto z-[99] border border-[#FF3E3E]/50 rounded-md cursor-pointer font-mono text-xs font-bold uppercase"
            >
                <X className="w-4 h-4" /> ВЫХОД ИЗ МАТРИЦЫ
            </button>
        </div>
    );
}
