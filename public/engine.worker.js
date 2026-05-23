// Экстремально оптимизированный Asm.js / WASM-подобный код
// V8 компилирует этот цикл прямо в нативные инструкции. 
// Никакого event loop оверхеда, голая математика.

function crypto_hash(val, seed) {
    // 32-bit integer math (Math.imul is compiled to native MUL)
    let x = (val ^ seed) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x85ebca6b) >>> 0;
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
}

self.onmessage = function(e) {
    if (e.data.type === 'START_ENGINE') {
        const seed = e.data.seed >>> 0;
        let nonce = 0; // Начинаем брутфорс
        
        const timestamp = performance.now();
        
        while (true) {
            const hash = crypto_hash(nonce, seed);
            
            // Ищем прокол (Proof of Work)
            if (hash <= 0x00000FFF) {
                const timeTaken = performance.now() - timestamp;
                
                self.postMessage({
                    type: 'SOLUTION_FOUND',
                    nonce: nonce >>> 0,
                    seed: seed,
                    hash: hash,
                    timeMs: timeTaken,
                    hashRate: (nonce / (timeTaken / 1000))
                });
                break; 
            }
            
            nonce = (nonce + 1) >>> 0;
        }
    }
};
