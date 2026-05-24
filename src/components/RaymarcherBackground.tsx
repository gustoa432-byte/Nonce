import React, { useRef, useEffect } from 'react';
import { RAYMARCHER_WGSL } from '../utils/raymarcherWgsl';

export function RaymarcherBackground({ winnersList }: { winnersList: {mutant: number, hash0: number, hash1: number, zeros: number}[] }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const init = async () => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const gpu = (navigator as any).gpu;
            if (!gpu) return;
            const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
            if (!adapter) return;
            const device = await adapter.requestDevice();
            
            const format = gpu.getPreferredCanvasFormat();
            const context = canvas.getContext('webgpu') as any;
            const GPUTextureUsage = (window as any).GPUTextureUsage;
            context.configure({
                device, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, alphaMode: 'opaque'
            });

            const module = device.createShaderModule({ code: RAYMARCHER_WGSL });
            
            const uniformBuffer = device.createBuffer({
                size: 64, // 16 floats
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            const entropyBuffer = device.createBuffer({
                size: 1024 * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            const gpuVoxelsBuffer = device.createBuffer({
                size: 64 * 16, // 64 vec4
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            const bindGroupLayout = device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: (window as any).GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                    { binding: 1, visibility: (window as any).GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                    { binding: 2, visibility: (window as any).GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                ]
            });

            const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
            const pipeline = device.createRenderPipeline({
                layout: pipelineLayout,
                vertex: { module, entryPoint: 'vs' },
                fragment: { module, entryPoint: 'fs', targets: [{ format }] },
                primitive: { topology: 'triangle-list' }
            });

            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: entropyBuffer } },
                    { binding: 2, resource: { buffer: gpuVoxelsBuffer } },
                ]
            });

            let posX = 0, posY = 0, posZ = -10;
            let time = 0;
            
            // Generate some static CPU entropy representing the math landscape
            const cpuEntropy = new Uint32Array(1024);
            for (let i = 0; i < 1024; i++) {
                cpuEntropy[i] = Math.floor(Math.random() * 5); 
            }
            // Populate based on winners
            for (let i = 0; i < Math.min(winnersList.length, 1024); i++) {
                cpuEntropy[i] = winnersList[i].zeros;
            }
            device.queue.writeBuffer(entropyBuffer, 0, cpuEntropy);

            let animationId: number;
            const render = () => {
                time += 0.01;
                posX = Math.sin(time * 0.2) * 5;
                posZ = Math.cos(time * 0.2) * 5 - 10;
                
                // Set uniforms
                const uniforms = new Float32Array([
                    posX, posY, posZ, 0,
                    0, 0, 1, 0, // forward
                    1, 0, 0, 0, // right
                    0, 1, 0, 0, // up
                    time, canvas.width, canvas.height, 0.5,
                    0.0, 0.0, 1.0, 1.0 // params2
                ]);
                device.queue.writeBuffer(uniformBuffer, 0, uniforms);

                // Update voxels for winners
                const voxels = new Float32Array(64 * 4);
                winnersList.slice(0, 64).forEach((w, i) => {
                    voxels[i*4 + 0] = (w.mutant % 20) - 10;
                    voxels[i*4 + 1] = (w.hash0 % 20) - 10;
                    voxels[i*4 + 2] = (w.hash1 % 20) - 10;
                    voxels[i*4 + 3] = w.zeros > 10 ? 1 : 0;
                });
                device.queue.writeBuffer(gpuVoxelsBuffer, 0, voxels);

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

                animationId = requestAnimationFrame(render);
            };
            
            render();

            return () => {
                cancelAnimationFrame(animationId);
            };
        };
        init();
    }, [winnersList]);

    return (
        <canvas 
            ref={canvasRef} 
            className="fixed inset-0 z-0 w-full h-full opacity-60 pointer-events-none" 
            width={1024} 
            height={1024}
        />
    );
}
