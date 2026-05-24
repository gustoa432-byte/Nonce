import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useMinerStore, MemoryNode, FRACTAL_QUOTAS } from '../store/minerStore';

type OrbitalMapProps = {
    onTargetNode?: (nonce: number) => void;
};

const InstancedNodes = ({ onTargetNode }: OrbitalMapProps) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const linesRef = useRef<THREE.LineSegments>(null);
    const nodesRef = useRef<MemoryNode[]>([]);
    
    // Instead of taking memoryBrain as prop, read from store
    const { quotas } = useMinerStore();
    const memoryBrainData = quotas;
    const { camera } = useThree();

    useEffect(() => {
        camera.position.set(0, 500, 1000);
        camera.lookAt(0, 0, 0);
    }, [camera]);

    const lastUpdateCountRef = useRef(-1);

    useFrame(() => {
        if (!meshRef.current || !memoryBrainData) return;
        if (memoryBrainData.updateCount === lastUpdateCountRef.current) return;
        lastUpdateCountRef.current = memoryBrainData.updateCount;
        
        const allNodes = [
            ...memoryBrainData.L1_BASE.nodes,
            ...memoryBrainData.L2_MID.nodes,
            ...memoryBrainData.L3_DEEP.nodes,
            ...memoryBrainData.L4_SINGULARITY.nodes
        ];

        nodesRef.current = allNodes;

        const count = allNodes.length;
        meshRef.current.count = count;

        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        const positions = [];
        const colors = [];

        for (let i = 0; i < count; i++) {
            const node = allNodes[i];
            
            // Жесткие Абсолютные Координаты
            let posX = node.posX;
            let posY = node.posY;
            let posZ = node.posZ;
            
            // Размер сферы - это вес
            let scale = Math.log(node.weight + 2) * 2; 
            
            dummy.position.set(posX, posY, posZ);
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
            
            // Иерархия цветов по этажу (zeros)
            let r = 0, g = 0, b = 0;
            if (node.maxFloor <= 18) {
                // Темно Зеленое - до зелёного
                g = Math.max(0.3, node.maxFloor / 18.0);
            } else if (node.maxFloor <= 30) {
                // Желтый
                r = 1.0;
                g = 1.0;
            } else {
                // Красный
                r = 1.0;
            }
            color.setRGB(r, g, b);
            meshRef.current.setColorAt(i, color);

            // Create connections to parent node to form a fractal strand
            // (Only if parent position is available)
            if (node.parentPosX !== undefined && node.parentPosY !== undefined && node.parentPosZ !== undefined) {
                let px = node.parentPosX;
                let py = node.parentPosY;
                let pz = node.parentPosZ;
                
                // Add start and end points for the line
                positions.push(px, py, pz, posX, posY, posZ);
                
                let pr = 0, pg = 0, pb = 0;
                let parentMaxFloor = node.parentMaxFloor || 0;
                if (parentMaxFloor <= 18) {
                    pg = Math.max(0.3, parentMaxFloor / 18.0);
                } else if (parentMaxFloor <= 30) {
                    pr = 1.0; pg = 1.0;
                } else {
                    pr = 1.0;
                }
                
                colors.push(pr, pg, pb, r, g, b);
            }
        }

        meshRef.current.instanceMatrix.needsUpdate = true;
        if (meshRef.current.instanceColor) {
            meshRef.current.instanceColor.needsUpdate = true;
        }

        if (linesRef.current) {
            linesRef.current.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            linesRef.current.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        }
    });

    const handleClick = (e: any) => {
        e.stopPropagation();
        const instanceId = e.instanceId;
        if (instanceId !== undefined && nodesRef.current[instanceId]) {
            const node = nodesRef.current[instanceId];
            console.log(`🎯 ЦЕЛЕУКАЗАНИЕ С ОРБИТЫ: Установлен Воксель на глубину ${node.maxFloor}`);
            onTargetNode(node.minNonce);
        }
    };

    // Calculate maximum possible instances we might have
    const maxInstances = 128 + 64 + 32 + 32;

    return (
        <group>
            <instancedMesh 
                ref={meshRef} 
                args={[undefined, undefined, maxInstances]} 
                onClick={handleClick}
            >
                <sphereGeometry args={[1, 16, 16]} />
                <meshPhongMaterial />
            </instancedMesh>
            <lineSegments ref={linesRef}>
                <bufferGeometry />
                <lineBasicMaterial vertexColors={true} transparent opacity={0.6} />
            </lineSegments>
        </group>
    );
};

export const OrbitalMap = (props: OrbitalMapProps) => {
    return (
        <div className="absolute inset-0 z-40 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] bg-[#050505] pointer-events-auto flex items-center justify-center">
            <Canvas>
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} intensity={1.5} />
                <directionalLight position={[0, 100, 50]} intensity={1.0} color="#00ff00" />
                
                <InstancedNodes {...props} />
                <OrbitControls makeDefault />
                
                {/* Visual grid connecting nodes? We can add a simple grid helper for orientation */}
                <gridHelper args={[2000, 50, '#004400', '#002200']} position={[0,-200,0]} />
            </Canvas>
            
            <div className="absolute top-4 left-4 text-[#00FF41] font-mono text-xs z-50 drop-shadow-[0_1px_1px_rgba(0,0,0,1)] pointer-events-none">
                <div className="text-sm font-bold mb-2">ОРБИТАЛЬНЫЙ НАДЗОР (ФАЗА 27.0)</div>
                <div className="opacity-80">
                    * ЛКМ + Мышь для вращения<br/>
                    * ПКМ + Мышь для панорамирования<br/>
                    * Колесико для зума<br/>
                    * КЛИК ПО УЗЛУ для целеуказания Роя
                </div>
            </div>
            
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-[10px] uppercase font-mono pointer-events-none">
                Ожидание аномалий ДНК в Фрактальной Памяти...
            </div>
        </div>
    );
};
