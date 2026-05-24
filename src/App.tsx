import { useState } from 'react';
import { TwoPassMiner } from './components/TwoPassMiner';
import { CryptoRaymarcher } from './components/CryptoRaymarcher';
import { TriangleGrinder } from './components/TriangleGrinder';

export default function App() {
  const [mode, setMode] = useState<string | null>(null);

  if (mode === 'two-pass') return <TwoPassMiner onClose={() => setMode(null)} />;
  if (mode === 'raymarcher') return <CryptoRaymarcher onClose={() => setMode(null)} />;
  if (mode === 'grinder') return <TriangleGrinder onClose={() => setMode(null)} />;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="max-w-2xl w-full flex flex-col gap-8 bg-[#050505] p-12 border border-[#00FF41]/30">
        <h1 className="text-3xl font-black text-[#00FF41] text-center tracking-widest font-mono">
          QUANTUM MINER SUITE
        </h1>
        
        <div className="flex flex-col gap-4">
          <button 
            onClick={() => setMode('two-pass')} 
            className="p-6 border border-[#00FF41]/50 bg-black hover:bg-[#00FF41]/10 text-white font-mono flex flex-col items-start transition-colors"
          >
            <span className="text-xl text-[#00FF41] font-bold tracking-tight mb-2">1. TWO-PASS MINER</span>
            <span className="text-xs opacity-60 text-left">GPU WebGPU 2-стадийный решатель. Топологический генератор, фрактальная память, авточекпоинты, нейромозг.</span>
          </button>
          
          <button 
            onClick={() => setMode('raymarcher')} 
            className="p-6 border border-[#00FFF0]/50 bg-black hover:bg-[#00FFF0]/10 text-white font-mono flex flex-col items-start transition-colors"
          >
            <span className="text-xl text-[#00FFF0] font-bold tracking-tight mb-2">2. RAYMARCHER (WITH BRAIN)</span>
            <span className="text-xs opacity-60 text-left">Реймарчинг визуализатор. WGSL Шейдер (Глаза) + CPU Мозги. 3D навигация. Сингулярности.</span>
          </button>

          <button 
            onClick={() => setMode('grinder')} 
            className="p-6 border border-[#FF0044]/50 bg-black hover:bg-[#FF0044]/10 text-white font-mono flex flex-col items-start transition-colors"
          >
            <span className="text-xl text-[#FF0044] font-bold tracking-tight mb-2">3. TRIANGLE GRINDER</span>
            <span className="text-xs opacity-60 text-left">Math Polygons - CPU/JS Хэшер визуализатор. 256-bit genetic memory.</span>
          </button>
        </div>
      </div>
    </div>
  );
}
