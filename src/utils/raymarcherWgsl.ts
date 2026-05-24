export const RAYMARCHER_WGSL = `
struct Uniforms {
    eye: vec4<f32>,
    forward: vec4<f32>,
    right: vec4<f32>,
    up: vec4<f32>,
    params: vec4<f32>,
    params2: vec4<f32>,
};

struct EntropyBuffer {
    data: array<u32>,
};
struct VoxelsBuffer {
    data: array<vec4<f32>>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> entropyBuffer: EntropyBuffer;
@group(0) @binding(2) var<storage, read> voxelsBuffer: VoxelsBuffer;

struct MapRes {
    dist: f32,
    color: vec3<f32>,
    mat: f32 // 0 = default, 1 = singularity
};

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

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
    let p = abs(fract(vec3<f32>(c.x) + vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3<f32>(3.0));
    let rgb = clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
    return c.z * mix(vec3<f32>(1.0), rgb, vec3<f32>(c.y));
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

fn sdCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

fn getCellData(cell: vec3<f32>, t: f32, intensity: f32) -> vec4<f32> {
    let c = 6.0;
    let idx = u32(abs(cell.x + cell.y * 32.0 + cell.z * 1024.0)) % 1024u;
    let seed = hash3(cell);
    let nzeros = entropyBuffer.data[idx];
    let nz = f32(nzeros);

    let original_pos = cell * c;
    
    var wobble = vec3<f32>(
        sin(original_pos.y * 3.0 + t * 2.0),
        cos(original_pos.z * 3.0 + t * 2.0),
        sin(original_pos.x * 3.0 + t * 2.0)
    ) * intensity * 1.5;

    var offset = vec3<f32>(
        sin(t*2.0 + f32(seed)), 
        cos(t*3.0 + f32(seed)), 
        sin(t*1.5 - f32(seed))
    ) * 0.5 * (1.0 + intensity);

    return vec4<f32>(original_pos + wobble + offset, nz);
}

fn getGeometry(pos: vec3<f32>) -> MapRes {
    let intensity = u.params.w;
    let t = u.params.x;

    let c = 6.0;
    let cell = floor((pos + vec3<f32>(c*0.5)) / c);
    
    var minDist = 1000.0;
    var finalCol = vec3<f32>(0.0);
    
    // Evaluate 2x2x2 neighborhood to form the mesh
    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            for(var dz = -1; dz <= 1; dz++) {
                let nc = cell + vec3<f32>(f32(dx), f32(dy), f32(dz));
                let dData = getCellData(nc, t, intensity);
                let nz = dData.w;
                
                if (nz > 0.0) {
                    var rad = 0.6 + intensity * 0.3;
                    if (nz <= 17.0) {
                        rad += nz * 0.1;
                    } else {
                        rad += 17.0 * 0.1 + (nz - 17.0) * 0.05;
                    }
                    
                    let nodeDist = sdSphere(pos - dData.xyz, rad);
                    
                    var col = vec3<f32>(0.0);
                    if (nz <= 7.0) {
                        let intC = clamp(nz / 7.0, 0.0, 1.0) * 0.6 + 0.1;
                        col = vec3<f32>(intC * 0.2, intC, intC * 0.3 + 0.1);
                    } else {
                        let hue = mix(0.16, 0.5, clamp((nz - 7.0) / 10.0, 0.0, 1.0));
                        col = hsv2rgb(vec3<f32>(hue, 1.0, 1.0));
                    }

                    if (nodeDist < minDist) {
                        minDist = nodeDist;
                        finalCol = col;
                    }

                    // Link X
                    let xData = getCellData(nc + vec3<f32>(1.0, 0.0, 0.0), t, intensity);
                    if (xData.w > 0.0) {
                        let linkWeight = (nz + xData.w) * 0.02;
                        let linkDist = sdCapsule(pos, dData.xyz, xData.xyz, 0.1 + linkWeight);
                        if (linkDist < minDist) {
                            minDist = linkDist;
                            finalCol = mix(col, vec3<f32>(0.0, 1.0, 0.5), 0.5);
                        }
                    }
                    // Link Y
                    let yData = getCellData(nc + vec3<f32>(0.0, 1.0, 0.0), t, intensity);
                    if (yData.w > 0.0) {
                        let linkWeight = (nz + yData.w) * 0.02;
                        let linkDist = sdCapsule(pos, dData.xyz, yData.xyz, 0.1 + linkWeight);
                        if (linkDist < minDist) {
                            minDist = linkDist;
                            finalCol = mix(col, vec3<f32>(0.0, 1.0, 0.5), 0.5);
                        }
                    }
                    // Link Z
                    let zData = getCellData(nc + vec3<f32>(0.0, 0.0, 1.0), t, intensity);
                    if (zData.w > 0.0) {
                        let linkWeight = (nz + zData.w) * 0.02;
                        let linkDist = sdCapsule(pos, dData.xyz, zData.xyz, 0.1 + linkWeight);
                        if (linkDist < minDist) {
                            minDist = linkDist;
                            finalCol = mix(col, vec3<f32>(0.0, 1.0, 0.5), 0.5);
                        }
                    }
                }
            }
        }
    }

    return MapRes(minDist, finalCol, 0.0);
}

fn map(pos: vec3<f32>) -> MapRes {
    var base = getGeometry(pos);
    
    // Voxels for orientation
    for(var i = 0u; i < 64u; i++) {
        let vox = voxelsBuffer.data[i];
        if (vox.w > 0.5) {
            let vd = sdBox(pos - vox.xyz, vec3<f32>(0.48));
            if (vd < base.dist) {
                base = MapRes(vd, vec3<f32>(0.5, 0.5, 0.5), 0.0);
                // Optional edge highlight
                let vp = (pos - vox.xyz) * 2.0;
                let aw = abs(vp);
                if (max(max(aw.x, aw.y), aw.z) > 0.92) {
                    base.color = vec3<f32>(1.0, 1.0, 1.0);
                }
            }
        } else {
            break;
        }
    }

    // Grid Mode
    if (u.params2.w > 0.5) {
        let floorDist = pos.y + 8.0;
        if (floorDist < base.dist) {
            let gw = abs(fract(pos.x) - 0.5);
            let gz = abs(fract(pos.z) - 0.5);
            let gridLine = min(gw, gz);
            let gridPulse = sin(u.params.x * 5.0 - length(pos.xz) * 0.5) * 0.5 + 0.5;
            let lineCol = mix(vec3<f32>(0.0, 0.5, 0.0), vec3<f32>(0.0, 1.0, 0.2), vec3<f32>(gridPulse));
            let gridCol = mix(lineCol, vec3<f32>(0.0, 0.05, 0.0), vec3<f32>(smoothstep(0.01, 0.03, gridLine)));
            base = MapRes(floorDist, gridCol, 0.0);
        }
    }

    let c = 6.0;
    let centerCell = floor((pos + vec3<f32>(c*0.5)) / c);
    
    var singDist = 1000.0;
    
    // Look for black hole singularities in adjacent cells
    for(var kz = -1; kz <= 1; kz++) {
        for(var ky = -1; ky <= 1; ky++) {
            for(var kx = -1; kx <= 1; kx++) {
                let ncell = centerCell + vec3<f32>(f32(kx), f32(ky), f32(kz));
                let idx = u32(abs(ncell.x + ncell.y * 32.0 + ncell.z * 1024.0)) % 1024u;
                let nzeros = entropyBuffer.data[idx];
                
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
    var finalColor = mix(c, fogCol, vec3<f32>(fogDist));

    // Thermal Diaphragm
    if (u.params2.x > 0.5) {
        let intensityLevel = u.params2.y;
        let lum = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114)) * intensityLevel * 2.0;
        let thermalRed = mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(clamp(lum * 2.0, 0.0, 1.0)));
        var thermalFinal = mix(thermalRed, vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(clamp(lum * 2.0 - 1.0, 0.0, 1.0)));
        thermalFinal = mix(thermalFinal, vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(clamp(lum * 2.0 - 2.0, 0.0, 1.0)));
        
        let distFromCenter = length(uv);
        let vignette = smoothstep(1.5, 0.3 * intensityLevel, distFromCenter);

        finalColor = mix(finalColor, thermalFinal * vignette, vec3<f32>(clamp(intensityLevel, 0.0, 1.0)));
    }

    return vec4<f32>(finalColor, 1.0);
}
`;
