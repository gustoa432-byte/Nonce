import { create } from 'zustand';

export type MemoryNode = {
    id: number;
    parentId: number | null;
    minNonce: number;
    maxNonce: number;
    weight: number;
    mask: number;
    maxFloor: number;
    posX: number;
    posY: number;
    posZ: number;
    parentPosX?: number;
    parentPosY?: number;
    parentPosZ?: number;
    parentMaxFloor?: number;
    generation: number;
};

export type FRACTAL_QUOTAS = {
    updateCount: number;
    L1_BASE: { minFloor: number, maxFloor: number, limit: number, nodes: MemoryNode[] };
    L2_MID: { minFloor: number, maxFloor: number, limit: number, nodes: MemoryNode[] };
    L3_DEEP: { minFloor: number, maxFloor: number, limit: number, nodes: MemoryNode[] };
    L4_SINGULARITY: { minFloor: number, maxFloor: number, limit: number, nodes: MemoryNode[] };
};

export type GlobalMaskPageRank = Record<number, {
    weight: number;
    successfulJumps: number;
    deadEnds: number;
}>;

export interface DeadZonePipe {
    id: string;
    startNonce: number;
    endNonce: number;
    hashTrack: number;
    peakZeros: number;
    peakMask: number;
}

export type PipelineSegment = {
    startNonce: number;
    endNonce: number;
    mass: number;
    peakMask: number;
    curvature: number;
};

export type TrunkLine = {
    topPeaks: number[];
};

export type SuperWinner = { mutant: number, hash0: number, hash1: number, zeros: number, time: string };

interface MinerState {
    quotas: FRACTAL_QUOTAS;
    winners: {mutant: number, hash0: number, hash1: number, zeros: number}[];
    superWinners: SuperWinner[];
    lastParentNode: MemoryNode | null;
    deadZonePipes: DeadZonePipe[];
    pipelines: PipelineSegment[];
    trunkLine: TrunkLine;
    maskPageRank: GlobalMaskPageRank;
    addWinner: (winner: {mutant: number, hash0: number, hash1: number, zeros: number}) => void;
    addNode: (node: MemoryNode) => void;
    incrementPageRank: (parentId: number) => void;
    setLastParentNode: (node: MemoryNode) => void;
    setWinners: (winners: {mutant: number, hash0: number, hash1: number, zeros: number}[]) => void;
    clearSuperWinners: () => void;
    addDeadZonePipe: (pipe: DeadZonePipe) => void;
    clearDeadZonePipes: () => void;
    updateMaskRank: (mask: number, isSuccess: boolean, isDeadZone: boolean) => void;
    penalizeMask: (mask: number) => void;
}

const initialQuotas: FRACTAL_QUOTAS = {
    updateCount: 0,
    L1_BASE: { minFloor: 1, maxFloor: 10, limit: 128, nodes: [] },
    L2_MID: { minFloor: 11, maxFloor: 25, limit: 64, nodes: [] },
    L3_DEEP: { minFloor: 26, maxFloor: 40, limit: 32, nodes: [] },
    L4_SINGULARITY: { minFloor: 41, maxFloor: 999999, limit: 32, nodes: [] }
};

let initPipelines: PipelineSegment[] = [];
let initTrunk: TrunkLine = { topPeaks: [] };
let initSuperWinners: SuperWinner[] = [];
try {
    const savedTrunk = localStorage.getItem('miner_trunkline');
    if (savedTrunk) {
        initTrunk = JSON.parse(savedTrunk);
    }
    const savedSuper = localStorage.getItem('miner_super_winners');
    if (savedSuper) {
        initSuperWinners = JSON.parse(savedSuper);
    }
} catch (e) {}

export const useMinerStore = create<MinerState>((set) => ({
    quotas: JSON.parse(JSON.stringify(initialQuotas)),
    winners: [],
    superWinners: initSuperWinners,
    lastParentNode: null,
    deadZonePipes: [],
    pipelines: initPipelines,
    trunkLine: initTrunk,
    maskPageRank: {},
    setWinners: (winners) => set({ winners }),
    clearSuperWinners: () => set(() => {
        try { localStorage.removeItem('miner_super_winners'); } catch(e) {}
        return { superWinners: [] };
    }),
    addDeadZonePipe: (pipe) => set((state) => {
        let newPipes = [...state.deadZonePipes, pipe];
        if (newPipes.length > 50) newPipes.shift(); // Keep UI from lagging
        return { deadZonePipes: newPipes };
    }),
    clearDeadZonePipes: () => set({ deadZonePipes: [] }),
    updateMaskRank: (mask, isSuccess, isDeadZone) => set((state) => {
        const newRank = { ...state.maskPageRank };
        if (!newRank[mask]) {
            newRank[mask] = { weight: 1, successfulJumps: 0, deadEnds: 0 };
        }
        let rankStats = newRank[mask];
        if (isSuccess) {
            rankStats.successfulJumps++;
            rankStats.weight *= 1.5;
        }
        if (isDeadZone) {
            rankStats.deadEnds++;
            rankStats.weight *= 0.5;
        }
        return { maskPageRank: newRank };
    }),
    penalizeMask: (mask) => set((state) => {
        const newRank = { ...state.maskPageRank };
        if (newRank[mask]) {
            newRank[mask].weight = -1000;
        } else {
            newRank[mask] = { weight: -1000, successfulJumps: 0, deadEnds: 0 };
        }
        return { maskPageRank: newRank };
    }),
    addWinner: (winner) => set((state) => {
        const exists = state.winners.some(w => w.mutant === winner.mutant);
        if (exists) return state;
        
        const newWinners = [...state.winners, winner].sort((a,b) => b.zeros - a.zeros).slice(0, 10);
        
        if (winner.zeros >= 20) {
            const superWin: SuperWinner = { ...winner, time: new Date().toLocaleTimeString() };
            const existsSuper = state.superWinners.some(w => w.mutant === winner.mutant);
            if (!existsSuper) {
                const newSuperWinners = [...state.superWinners, superWin].sort((a,b) => b.zeros - a.zeros);
                try {
                    localStorage.setItem('miner_super_winners', JSON.stringify(newSuperWinners));
                } catch(e) {}
                return { winners: newWinners, superWinners: newSuperWinners };
            }
        }
        
        return { winners: newWinners };
    }),
    addNode: (node) => set((state) => {
        const newQuotas = { ...state.quotas, updateCount: state.quotas.updateCount + 1 };
        
        if (node.maxFloor <= newQuotas.L1_BASE.maxFloor) {
            newQuotas.L1_BASE.nodes = [...newQuotas.L1_BASE.nodes, node];
            if (newQuotas.L1_BASE.nodes.length > newQuotas.L1_BASE.limit) newQuotas.L1_BASE.nodes.shift();
        } else if (node.maxFloor <= newQuotas.L2_MID.maxFloor) {
            newQuotas.L2_MID.nodes = [...newQuotas.L2_MID.nodes, node];
            if (newQuotas.L2_MID.nodes.length > newQuotas.L2_MID.limit) newQuotas.L2_MID.nodes.shift();
        } else if (node.maxFloor <= newQuotas.L3_DEEP.maxFloor) {
            newQuotas.L3_DEEP.nodes = [...newQuotas.L3_DEEP.nodes, node];
            if (newQuotas.L3_DEEP.nodes.length > newQuotas.L3_DEEP.limit) newQuotas.L3_DEEP.nodes.shift();
        } else {
            newQuotas.L4_SINGULARITY.nodes = [...newQuotas.L4_SINGULARITY.nodes, node];
            if (newQuotas.L4_SINGULARITY.nodes.length > newQuotas.L4_SINGULARITY.limit) newQuotas.L4_SINGULARITY.nodes.shift();
        }
        
        return { quotas: newQuotas };
    }),
    incrementPageRank: (parentId) => set((state) => {
        const newQuotas = { ...state.quotas, updateCount: state.quotas.updateCount + 1 };
        const levels = ['L1_BASE', 'L2_MID', 'L3_DEEP', 'L4_SINGULARITY'] as const;
        for (let key of levels) {
            let idx = newQuotas[key].nodes.findIndex(n => n.id === parentId);
            if (idx !== -1) {
                newQuotas[key].nodes[idx] = { ...newQuotas[key].nodes[idx], weight: newQuotas[key].nodes[idx].weight + 1 };
                break;
            }
        }
        return { quotas: newQuotas };
    }),
    setLastParentNode: (node) => set({ lastParentNode: node })
}));
