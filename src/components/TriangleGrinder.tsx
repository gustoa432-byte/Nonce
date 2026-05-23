import React, { useRef, useState, useMemo, useEffect } from 'react';
import { X, Play, Square, Activity, Download, Copy, Trophy } from 'lucide-react';

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

            // [ ГЕОМЕТРИЧЕСКИЙ ФИЛЬТР: СКАЛЯРНОЕ ПРОИЗВЕДЕНИЕ ГРАНЕЙ (24-Й ТАКТ) ]
            if (j === 24) {
                let scale = 1.0 / 4294967295.0; 
                let v1x = a * scale + 0.0001; let v1y = b * scale + 0.0001; let v1z = c * scale + 0.0001;
                let v2x = e * scale + 0.0001; let v2y = f * scale + 0.0001; let v2z = g * scale + 0.0001;
                
                let dot = v1x*v2x + v1y*v2y + v1z*v2z;
                if (dot > 0.8 || dot < 0.2) return false;
            }

            h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0;
        }
        this.h[0]=(this.h[0]+a)>>>0; this.h[1]=(this.h[1]+b)>>>0;
        this.h[2]=(this.h[2]+c)>>>0; this.h[3]=(this.h[3]+d)>>>0;
        this.h[4]=(this.h[4]+e)>>>0; this.h[5]=(this.h[5]+f)>>>0;
        this.h[6]=(this.h[6]+g)>>>0; this.h[7]=(this.h[7]+h)>>>0;
        return true;
    }
}

export function TriangleGrinder({ onClose }: { onClose: () => void }) {
    const [hashes, setHashes] = useState<string[]>([]);
    const [blocks, setBlocks] = useState<{hash: string, zeros: number, time: string}[]>([]);
    const [active, setActive] = useState(false);
    
    // We use a ref for hashes to prevent massive re-renders blocking the animation frame
    const hashesRef = useRef<string[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const shaderBestOut1 = useRef(new Uint32Array(8));
    
    const sortedBlocks = useMemo(() => {
        return [...blocks].sort((a, b) => b.zeros - a.zeros);
    }, [blocks]);

    const handleExportCSV = () => {
        if (sortedBlocks.length === 0) return;
        const csvContent = "data:text/csv;charset=utf-8," 
            + "Time,Zeros,Hash\n" 
            + sortedBlocks.map(b => `${b.time},${b.zeros},${b.hash}`).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "math_top_blocks.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleCopy = (hash: string) => {
        navigator.clipboard.writeText(hash);
    };

    useEffect(() => {
        if (!active) return;
        
        let animationFrameId: number;
        let lastTime = performance.now();
        
        let actTime = 0;
        let actBestZeros = 0;
        let actBestHash = "";
        let actId = 0;

        let globalTopZeros = 17; // Blocks > 17 trigger memory logic
        const topH = new Uint32Array(16);
        const actBestH = new Uint32Array(16);
        const confMemory = new Uint32Array(8); // 256 bits of confidence points for ID1

        const hasher = new FastSHA256();
        const header = new Uint32Array(20);
        const out1 = new Uint32Array(8);
        const out2 = new Uint32Array(8);
        let nonce = 0;

        header[0] = 0x200000e3;
        header[17] = Math.floor(Date.now() / 1000);
        header[18] = 0x1d00ffff;

        const loop = (time: number) => {
            const delta = (time - lastTime) / 1000;
            lastTime = time;

            actTime += delta;
            
            if (actTime >= 4.0) {
                actTime -= 4.0;
                actId += 1;
                
                // Перед тем как залезть в щель SHA-256 (слот после 64 байт/16 слов)
                // берем рандомный ключ и кидаем следом в акт
                const cryptoRand = new Uint32Array(2);
                window.crypto.getRandomValues(cryptoRand);
                header[17] = cryptoRand[0];
                header[18] = cryptoRand[1];
                
                if (actBestZeros >= 18) {
                    if (actBestZeros > globalTopZeros) {
                        if (globalTopZeros > 17) {
                            // Extract surviving bits (chronology) across ID1
                            for (let c = 0; c < 8; c++) {
                                const survived = ~(topH[c] ^ actBestH[c]) >>> 0;
                                confMemory[c] = survived;
                            }
                        }
                        globalTopZeros = actBestZeros;
                        for (let c = 0; c < 16; c++) topH[c] = actBestH[c];
                    }

                    const blockHash = actBestHash;
                    const blockZeros = actBestZeros;
                    setBlocks(prev => {
                        const newBlocks = [{hash: blockHash, zeros: blockZeros, time: new Date().toLocaleTimeString()}, ...prev];
                        return newBlocks.sort((a, b) => b.zeros - a.zeros).slice(0, 50);
                    });
                    
                    let memoryHex = "";
                    for(let c=0; c<8; c++) memoryHex += confMemory[c].toString(16).padStart(8, '0');
                    const cBits = memoryHex.split('').map(char => parseInt(char, 16).toString(2).padStart(4, '0').split('1').length - 1).reduce((a, b) => a + b, 0);

                    const finalStr = `ACT [ID: #${actId}] УСПЕХ! [${actBestZeros} zeros] MEMORY: ${cBits}/256 POINTS`;
                    hashesRef.current = [finalStr, ...hashesRef.current].slice(0, 10);
                    setHashes([...hashesRef.current]);
                }
                
                actBestZeros = 0;
                actBestHash = "";
            }

            const tactIndex = Math.floor(actTime);
            const tactProgress = actTime % 1.0;
            const angle = tactProgress * (Math.PI * 2);

            // Calculate 256-bit (8 x 32-bit) entropy for ID #1 (X-axis)
            const g1_0 = (Math.sin(angle + tactIndex) * 0xffffffff) >>> 0;
            const g1_1 = (Math.cos(angle - tactIndex) * 0xffffffff) >>> 0;
            const g1_2 = (Math.sin(angle * 2.0) * 0xffffffff) >>> 0;
            const g1_3 = (Math.cos(angle * 2.0) * 0xffffffff) >>> 0;
            const g1_4 = (Math.tan(tactProgress) * 0xffffffff) >>> 0;
            const g1_5 = ((g1_0 ^ g1_2) + tactIndex) >>> 0;
            const g1_6 = ((g1_1 ^ g1_3) - tactIndex) >>> 0;
            const g1_7 = (g1_4 ^ 0xdeadbeef) >>> 0;

            // Generate mutation mask (biased to keep more bits from topH)
            const getMutMask = () => ((Math.random() * 4294967296) | (Math.random() * 4294967296)) >>> 0;
            const c0 = confMemory[0] | getMutMask();
            const c1 = confMemory[1] | getMutMask();
            const c2 = confMemory[2] | getMutMask();
            const c3 = confMemory[3] | getMutMask();
            const c4 = confMemory[4] | getMutMask();
            const c5 = confMemory[5] | getMutMask();
            const c6 = confMemory[6] | getMutMask();
            const c7 = confMemory[7] | getMutMask();

            const id1_0 = (globalTopZeros > 17) ? ((topH[0] & c0) | (g1_0 & ~c0)) : g1_0;
            const id1_1 = (globalTopZeros > 17) ? ((topH[1] & c1) | (g1_1 & ~c1)) : g1_1;
            const id1_2 = (globalTopZeros > 17) ? ((topH[2] & c2) | (g1_2 & ~c2)) : g1_2;
            const id1_3 = (globalTopZeros > 17) ? ((topH[3] & c3) | (g1_3 & ~c3)) : g1_3;
            const id1_4 = (globalTopZeros > 17) ? ((topH[4] & c4) | (g1_4 & ~c4)) : g1_4;
            const id1_5 = (globalTopZeros > 17) ? ((topH[5] & c5) | (g1_5 & ~c5)) : g1_5;
            const id1_6 = (globalTopZeros > 17) ? ((topH[6] & c6) | (g1_6 & ~c6)) : g1_6;
            const id1_7 = (globalTopZeros > 17) ? ((topH[7] & c7) | (g1_7 & ~c7)) : g1_7;

            // Calculate 256-bit (8 x 32-bit) entropy for ID #2 (Y-axis)
            const id2_0 = (Math.cos(angle * tactIndex) * 0xffffffff) >>> 0;
            const id2_1 = (Math.sin(angle * tactIndex) * 0xffffffff) >>> 0;
            const id2_2 = (Math.cos(angle * 3.0) * 0xffffffff) >>> 0;
            const id2_3 = (Math.sin(angle * 3.0) * 0xffffffff) >>> 0;
            const id2_4 = (Math.cos(tactProgress * Math.PI) * 0xffffffff) >>> 0;
            const id2_5 = ((id2_0 ^ id2_2) * tactIndex) >>> 0;
            const id2_6 = ((id2_1 ^ id2_3) + 0xbadc0fee) >>> 0;
            const id2_7 = (id2_4 ^ 0x1337cafe) >>> 0;

            header[1] = id1_0; header[2] = id1_1; header[3] = id1_2; header[4] = id1_3;
            header[5] = id1_4; header[6] = id1_5; header[7] = id1_6; header[8] = id1_7;

            header[9] = id2_0; header[10] = id2_1; header[11] = id2_2; header[12] = id2_3;
            header[13] = id2_4; header[14] = id2_5; header[15] = id2_6; header[16] = id2_7;

            let localMaxZeros = 0;
            let localBestHashHex = "";

            const AVALANCHE_SIZE = 65536;
            for (let i = 0; i < AVALANCHE_SIZE; i++) {
                nonce = (nonce + 1) >>> 0;
                header[19] = nonce;

                const s1 = hasher.hash80(header, out1);
                if (!s1) {
                    header[1] = (header[1] + 1) >>> 0;
                    continue; 
                }
                const s2 = hasher.hash32(out1, out2);
                if (!s2) continue;
                
                let zeros = Math.clz32(out2[0]);
                if (zeros === 32) zeros += Math.clz32(out2[1]);

                if (zeros > actBestZeros) {
                    actBestZeros = zeros;
                    let hex = "";
                    for(let k=0; k<8; k++) hex += out2[k].toString(16).padStart(8, '0');
                    actBestHash = hex;
                    for (let c = 0; c < 16; c++) actBestH[c] = header[c + 1];
                    for (let c = 0; c < 8; c++) shaderBestOut1.current[c] = out1[c];
                }
                
                if (zeros > localMaxZeros) {
                    localMaxZeros = zeros;
                    let hex = "";
                    for(let k=0; k<8; k++) hex += out2[k].toString(16).padStart(8, '0');
                    localBestHashHex = hex;
                }
            }

            // We do not pollute the stream unless a block is found (handled above)
            
            // Renderer for shaderBestOut1
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    const { width, height } = canvas;
                    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
                    ctx.fillRect(0, 0, width, height);

                    const cx = width / 2;
                    const cy = height / 2;
                    const radius = Math.min(width, height) / 2 * 0.7;

                    ctx.strokeStyle = `rgba(0, 255, 65, ${0.1 + (globalTopZeros / 64)})`;
                    
                    const activePoints = [];
                    for (let i = 0; i < 8; i++) {
                        const word = shaderBestOut1.current[i];
                        for (let b = 0; b < 32; b++) {
                            const bit = (word >>> (31 - b)) & 1;
                            if (bit) {
                                const idx = i * 32 + b;
                                const angle = (idx / 256) * Math.PI * 2;
                                const finalAngle = angle + (time / 1000) * 0.2;
                                const x = cx + Math.cos(finalAngle) * radius;
                                const y = cy + Math.sin(finalAngle) * radius;
                                activePoints.push({x, y});
                            }
                        }
                    }
                    
                    for (let i = 0; i < activePoints.length; i += 3) {
                        if (i + 2 < activePoints.length) {
                            ctx.beginPath();
                            ctx.moveTo(activePoints[i].x, activePoints[i].y);
                            ctx.lineTo(activePoints[i+1].x, activePoints[i+1].y);
                            ctx.lineTo(activePoints[i+2].x, activePoints[i+2].y);
                            ctx.closePath();
                            ctx.stroke();
                            
                            if (i % 7 === 0) {
                                ctx.fillStyle = "rgba(0, 255, 65, 0.05)";
                                ctx.fill();
                            }
                        }
                    }
                }
            }

            animationFrameId = requestAnimationFrame(loop);
        };
        
        animationFrameId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(animationFrameId);
    }, [active]);

    return (
        <div className="fixed inset-0 z-50 bg-[#050505] text-[#00FF41] font-mono flex flex-col overflow-y-auto">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 p-3 md:p-4 flex justify-between items-start md:items-center z-20 border-b border-[#00FF41]/30 bg-black/80 backdrop-blur-md">
                <div className="flex items-center gap-2 md:gap-4 flex-1">
                    <Activity className="w-5 h-5 min-w-[20px] animate-pulse hidden sm:block" />
                    <div className="flex-1">
                        <h1 className="text-sm md:text-xl font-black tracking-tighter leading-tight">МЯСОРУБКА: MATH POLYGONS</h1>
                        <p className="text-[8px] md:text-[10px] opacity-60 leading-tight mt-1">Виртуальное математическое пересечение плоскостей SHA-256 (С РЕНДЕРОМ)</p>
                    </div>
                </div>
                <button 
                    onClick={onClose}
                    className="p-2 border border-[#00FF41]/50 hover:bg-[#00FF41]/20 transition-colors shrink-0 ml-2"
                >
                    <X className="w-4 h-4 md:w-5 md:h-5" />
                </button>
            </header>

            {/* Main Area: HUDs aligned cleanly */}
            <div className="flex-1 mt-20 md:mt-24 w-full min-h-max p-4 flex flex-col md:flex-col gap-4 items-stretch justify-start max-w-6xl mx-auto pb-20">
                
                {/* Visualizer */}
                <div className="w-full h-64 md:h-80 border border-[#00FF41]/30 bg-black/80 flex flex-col relative overflow-hidden">
                    <h2 className="text-xs md:text-sm font-bold border-b border-[#00FF41]/30 p-2 bg-black/80 z-10 flex justify-between absolute top-0 left-0 right-0">
                        <span>ГЕОМЕТРИЯ HASH 1 (ПРОМЕЖУТОЧНЫЙ 256-BIT ШЕЙДЕР)</span>
                    </h2>
                    <canvas 
                        ref={canvasRef} 
                        width={600} 
                        height={400} 
                        className="w-full h-full object-cover"
                    />
                </div>

                {/* Block Log UI */}
                <div className="w-full p-3 md:p-4 border border-[#00FF41]/30 bg-black/80 flex flex-col">
                    <h2 className="text-xs md:text-sm font-bold border-b border-[#00FF41]/30 pb-2 mb-2 flex justify-between items-center">
                        <span className="flex items-center gap-2"><Trophy className="w-4 h-4" /> РЕЙТИНГ БЛОКОВ (18+)</span>
                        <div className="flex items-center gap-2">
                            <span className="text-[#00FF41]/50 text-[10px] hidden sm:inline">{blocks.length} НАЙДЕНО</span>
                            <button 
                                onClick={handleExportCSV}
                                className="px-2 py-1 border border-[#00FF41]/50 hover:bg-[#00FF41]/20 flex items-center gap-1 transition-colors group text-[10px]"
                            >
                                <Download className="w-3 h-3 group-hover:animate-bounce" /> CSV
                            </button>
                        </div>
                    </h2>
                    <div className="flex flex-col space-y-2 text-[10px] md:text-[11px] font-mono select-text">
                        {sortedBlocks.length === 0 && (
                            <div className="flex items-center justify-center opacity-50 text-center py-4">ЖДЕМ БЛОКИ С 18+ ВЕДУЩИМИ НУЛЯМИ...</div>
                        )}
                        {sortedBlocks.map((b, i) => (
                            <div key={i} className={`p-2 border transition-colors ${i === 0 ? 'border-[#00FF41] bg-[#00FF41]/10' : 'border-[#00FF41]/20 bg-[#00FF41]/5 hover:bg-[#00FF41]/20'}`}>
                                <div className="flex justify-between items-center text-[#00FF41]/50 mb-1">
                                    <span className="flex items-center gap-2">
                                        {i === 0 && <span className="text-[#00FF41] font-bold">#1</span>}
                                        <span>{b.time}</span>
                                    </span>
                                    <span className={i === 0 ? "text-[#00FF41] font-bold" : ""}>Z: {b.zeros}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 break-all text-white select-all font-bold opacity-90 truncate">
                                        {b.hash}
                                    </div>
                                    <button 
                                        onClick={() => handleCopy(b.hash)}
                                        className="p-1.5 border border-[#00FF41]/30 hover:bg-[#00FF41] hover:text-black transition-colors shrink-0"
                                        title="Копировать хэш"
                                    >
                                        <Copy className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* HUD: Entropy Flow */}
                <div className="w-full p-4 border border-[#00FF41]/30 bg-black/60 flex flex-col">
                    <h2 className="text-sm font-bold border-b border-[#00FF41]/30 pb-2 mb-2 flex justify-between">
                        <span>ПОТОК ЭНТРОПИИ</span>
                        <button 
                            onClick={() => {
                                hashesRef.current = [];
                                setHashes([]);
                                setActive(!active);
                            }}
                            className={`px-3 py-1 text-xs border transition-colors flex items-center gap-2 ${active ? 'bg-[#ff0044]/20 border-[#ff0044] text-[#ff0044]' : 'bg-[#00FF41]/20 border-[#00FF41] hover:bg-[#00FF41]/40'}`}
                        >
                            {active ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            <span>{active ? 'СТОП' : 'ПУСК'}</span>
                        </button>
                    </h2>
                    <div className="space-y-1 font-mono text-[10px] opacity-80 flex-1">
                        {!active && hashes.length === 0 && (
                            <div className="flex items-center justify-center opacity-50 text-center py-4">
                                ОЖИДАНИЕ ПУСКА...
                            </div>
                        )}
                        {hashes.map((h, i) => (
                            <div key={i} className={i === 0 ? "text-white font-bold" : ""}>
                                {h}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            
            <footer className="fixed bottom-0 left-0 right-0 p-2 border-t border-[#00FF41]/30 bg-black/90 flex justify-center gap-4 text-[8px] md:text-[10px] opacity-70 z-20 pointer-events-none">
                <span>VIRTUAL MATH ENGINE ACTIVE</span>
                <span className="hidden sm:inline">|</span>
                <span>ACT AVALANCHE: 65,536 H/f</span>
                <span className="hidden sm:inline">|</span>
                <span className="text-[#ff0044] font-bold">256-BIT GENETIC MEMORY: ON</span>
            </footer>
        </div>
    );
}
