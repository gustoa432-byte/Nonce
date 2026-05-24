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

interface MinerState {
    quotas: FRACTAL_QUOTAS;
    winners: {mutant: number, hash0: number, hash1: number, zeros: number}[];
    lastParentNode: MemoryNode | null;
    addWinner: (winner: {mutant: number, hash0: number, hash1: number, zeros: number}) => void;
    addNode: (node: MemoryNode) => void;
    incrementPageRank: (parentId: number) => void;
    setLastParentNode: (node: MemoryNode) => void;
    setWinners: (winners: {mutant: number, hash0: number, hash1: number, zeros: number}[]) => void;
}

const initialQuotas: FRACTAL_QUOTAS = {
    updateCount: 0,
    L1_BASE: { minFloor: 1, maxFloor: 10, limit: 128, nodes: [] },
    L2_MID: { minFloor: 11, maxFloor: 25, limit: 64, nodes: [] },
    L3_DEEP: { minFloor: 26, maxFloor: 40, limit: 32, nodes: [] },
    L4_SINGULARITY: { minFloor: 41, maxFloor: 999999, limit: 32, nodes: [] }
};

export const useMinerStore = create<MinerState>((set) => ({
    quotas: JSON.parse(JSON.stringify(initialQuotas)),
    winners: [],
    lastParentNode: null,
    setWinners: (winners) => set({ winners }),
    addWinner: (winner) => set((state) => {
        const exists = state.winners.some(w => w.mutant === winner.mutant);
        if (exists) return state;
        return { winners: [...state.winners, winner].sort((a,b) => b.zeros - a.zeros).slice(0, 10) };
    }),
    addNode: (node) => set((state) => {
        const newQuotas = { ...state.quotas, updateCount: state.quotas.updateCount + 1 };
        
        let weight = 1;
        if (node.maxFloor <= newQuotas.L1_BASE.maxFloor) {
            newQuotas.L1_BASE.nodes = [...newQuotas.L1_BASE.nodes, {...node, weight: 1}];
            if (newQuotas.L1_BASE.nodes.length > newQuotas.L1_BASE.limit) newQuotas.L1_BASE.nodes.shift();
        } else if (node.maxFloor <= newQuotas.L2_MID.maxFloor) {
            newQuotas.L2_MID.nodes = [...newQuotas.L2_MID.nodes, {...node, weight: 2}];
            if (newQuotas.L2_MID.nodes.length > newQuotas.L2_MID.limit) newQuotas.L2_MID.nodes.shift();
        } else if (node.maxFloor <= newQuotas.L3_DEEP.maxFloor) {
            newQuotas.L3_DEEP.nodes = [...newQuotas.L3_DEEP.nodes, {...node, weight: 3}];
            if (newQuotas.L3_DEEP.nodes.length > newQuotas.L3_DEEP.limit) newQuotas.L3_DEEP.nodes.shift();
        } else {
            newQuotas.L4_SINGULARITY.nodes = [...newQuotas.L4_SINGULARITY.nodes, {...node, weight: 4}];
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
