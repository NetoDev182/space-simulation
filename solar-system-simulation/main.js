import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Setup Base Scene
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020204);
scene.fog = new THREE.FogExp2(0x020204, 0.0003);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 10, 20000);
camera.position.set(0, 800, 1800);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 8000;
controls.minDistance = 200;

// Postprocessing Bloom Effect
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.8, 0.6, 0.85);
bloomPass.threshold = 0.05;
bloomPass.strength = 1.6;
bloomPass.radius = 0.4;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// Constants & References
const PARTICLE_COUNT = 70000;
const G = 0.4; // Gravitational constant for the simulation
const sunMassElem = document.getElementById('sun-mass');
const bhMassElem = document.getElementById('bh-mass');
const resetBtn = document.getElementById('reset-btn');

// Particles Setup
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(PARTICLE_COUNT * 3);
const velocities = new Float32Array(PARTICLE_COUNT * 3);
const colors = new Float32Array(PARTICLE_COUNT * 3);
const statusArray = new Float32Array(PARTICLE_COUNT); // 1.0 = alive, 0.0 = erased

// The Sun
const sunPos = new THREE.Vector3(0, 0, 0);
const colorSunCore = new THREE.Color(0xffe6aa);
const colorOuter = new THREE.Color(0x3355ff);
const colorAsteroid = new THREE.Color(0x888899);

function initParticles() {
    const currentSunMass = parseFloat(sunMassElem.value);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        statusArray[i] = 1.0; // Reset as alive
        
        // Distribute particles in a flat disk
        const radius = 100 + Math.pow(Math.random(), 1.5) * 1800;
        const theta = Math.random() * Math.PI * 2;
        const thickness = Math.max(0.1, 1 - (radius / 2000)) * 60;
        const y = (Math.random() - 0.5) * thickness;
        
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius;
        
        positions[i3] = x;
        positions[i3+1] = y;
        positions[i3+2] = z;
        
        // Orbital velocity calculation: v = sqrt(G * M / r)
        const vOrbital = Math.sqrt(G * currentSunMass / radius);
        
        const vx = -Math.sin(theta) * vOrbital;
        const vz = Math.cos(theta) * vOrbital;
        
        velocities[i3] = vx;
        velocities[i3+1] = 0;
        velocities[i3+2] = vz;

        // Color based on distance
        let particleColor = new THREE.Color();
        if (radius < 400) {
            particleColor.copy(colorSunCore).lerp(new THREE.Color(0xff6b33), radius / 400);
        } else if (radius > 1200) {
            particleColor.copy(colorAsteroid).lerp(colorOuter, (radius - 1200) / 800);
        } else {
            particleColor.set(0xffffff).lerp(new THREE.Color(0xaabbff), Math.random());
        }
        
        const intensity = 0.5 + Math.random() * 0.5;
        colors[i3] = particleColor.r * intensity;
        colors[i3+1] = particleColor.g * intensity;
        colors[i3+2] = particleColor.b * intensity;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('particleStatus', new THREE.BufferAttribute(statusArray, 1));
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.particleStatus.needsUpdate = true;
}

initParticles();

// Shader parameters setup
const particleUniforms = {
    uBlackHolePos: { value: new THREE.Vector3(0, 0, 0) },
    uBhMass: { value: 0 },
    uTime: { value: 0 }
};

const vertexShader = `
    attribute float particleStatus;
    uniform vec3 uBlackHolePos;
    uniform float uBhMass;
    varying vec3 vColor;

    void main() {
        vColor = color;
        
        // Calculate distance to black hole
        float dist = distance(position, uBlackHolePos);
        
        // Dynamic event horizon based on mass
        float horizon = 25.0 + (uBhMass / 25000.0) * 30.0;
        
        // Redshift and fading
        float lightEscape = smoothstep(horizon * 0.5, horizon * 4.0, dist);
        vColor = mix(vec3(0.05, 0.0, 0.0), vColor, vec3(lightEscape));
        vColor *= lightEscape;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        // Points disappear if 'erased' or deeply swallowed
        float visibility = particleStatus * mix(0.0, 1.0, lightEscape);
        gl_PointSize = 2.5 * visibility * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying vec3 vColor;
    void main() {
        // Make it circular
        float distToCenter = distance(gl_PointCoord, vec2(0.5));
        if (distToCenter > 0.5) discard;
        
        // Soft edge
        float alpha = smoothstep(0.5, 0.2, distToCenter);
        gl_FragColor = vec4(vColor, alpha);
    }
`;

// Optimized Custom Shader Material
const particleMaterial = new THREE.ShaderMaterial({
    uniforms: particleUniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    vertexColors: true
});

const particleSystem = new THREE.Points(geometry, particleMaterial);
scene.add(particleSystem);

// --- Entities: Sun ---
const sunGeo = new THREE.SphereGeometry(35, 32, 32);
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffddaa });
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
scene.add(sunMesh);

const sunGlowGeo = new THREE.SphereGeometry(45, 32, 32);
const sunGlowMat = new THREE.MeshBasicMaterial({ 
    color: 0xffaa00, 
    transparent: true, 
    opacity: 0.2, 
    blending: THREE.AdditiveBlending 
});
const sunGlow = new THREE.Mesh(sunGlowGeo, sunGlowMat);
scene.add(sunGlow);

const sunLight = new THREE.PointLight(0xffaa33, 4, 3000);
scene.add(sunLight);

// --- Entities: Black Hole ---
const bhGeo = new THREE.SphereGeometry(25, 32, 32);
const bhMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const bhMesh = new THREE.Mesh(bhGeo, bhMat);
scene.add(bhMesh);

// Accretion disk visual for black hole
const bhRingGeo = new THREE.RingGeometry(35, 60, 64);
const bhRotGeo = new THREE.BufferGeometry();
const uvs = bhRingGeo.attributes.uv.array;
const ringColors = [];
for (let i = 0; i < uvs.length; i+=2) {
    const r = uvs[i];
    const drop = Math.pow(1 - Math.abs(r - 0.5) * 2, 2.0);
    ringColors.push(0.5 * drop, 0.1 * drop, 1.0 * drop);
}
bhRingGeo.setAttribute('color', new THREE.Float32BufferAttribute(ringColors, 3));

const bhRingMat = new THREE.MeshBasicMaterial({ 
    vertexColors: true, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const bhRing = new THREE.Mesh(bhRingGeo, bhRingMat);
bhRing.rotation.x = Math.PI / 2;
scene.add(bhRing);

const blackHolePos = new THREE.Vector3(0, 0, 0);
let bhAngle = 0;

// Resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// UI Interactivity
resetBtn.addEventListener('click', initParticles);

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    // Using a fixed step to prevent explosive glitches if frame drops
    const dt = 0.016; 
    const time = clock.getElapsedTime();
    
    controls.update();
    
    // Black Hole movement (drifting through the system, crossing the plane)
    bhAngle += dt * 0.15;
    blackHolePos.x = Math.cos(bhAngle) * 900;
    blackHolePos.z = Math.sin(bhAngle) * 600;
    blackHolePos.y = Math.sin(bhAngle * 0.7) * 200;
    
    bhMesh.position.copy(blackHolePos);
    bhRing.position.copy(blackHolePos);
    bhRing.lookAt(camera.position);
    bhRing.rotation.z += 0.02;

    const posArray = geometry.attributes.position.array;
    const currentSunMass = parseFloat(sunMassElem.value);
    const currentBhMass = parseFloat(bhMassElem.value);
    
    // Update Shader Uniforms
    particleUniforms.uBlackHolePos.value.copy(blackHolePos);
    particleUniforms.uBhMass.value = currentBhMass;
    particleUniforms.uTime.value = time;
    
    // Physics CPU Loop
    const statuses = geometry.attributes.particleStatus.array;
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        if (statuses[i] === 0.0) continue; // It's erased

        const i3 = i * 3;
        const px = posArray[i3];
        const py = posArray[i3+1];
        const pz = posArray[i3+2];
        
        // ---------------- Gravitational Pull: Sun ----------------
        const dxSun = sunPos.x - px;
        const dySun = sunPos.y - py;
        const dzSun = sunPos.z - pz;
        const distSqSun = dxSun*dxSun + dySun*dySun + dzSun*dzSun + 500;
        const distSun = Math.sqrt(distSqSun);
        const forceSun = (G * currentSunMass) / distSqSun;
        const axSun = (dxSun / distSun) * forceSun;
        const aySun = (dySun / distSun) * forceSun;
        const azSun = (dzSun / distSun) * forceSun;
        
        // ---------------- Gravitational Pull: Black Hole + Spiral Vortex ----------------
        const dxBh = blackHolePos.x - px;
        const dyBh = blackHolePos.y - py;
        const dzBh = blackHolePos.z - pz;
        const distSqBh = dxBh*dxBh + dyBh*dyBh + dzBh*dzBh + 150; 
        const distBh = Math.sqrt(distSqBh);
        
        let axBh = 0, ayBh = 0, azBh = 0;
        if (currentBhMass > 0) {
            const forceBh = (G * currentBhMass) / distSqBh;
            axBh = (dxBh / distBh) * forceBh;
            ayBh = (dyBh / distBh) * forceBh;
            azBh = (dzBh / distBh) * forceBh;
            
            // Vortex force (drag them in a circle as they fall)
            const vortexFac = (currentBhMass / 15000.0) * Math.max(0, 1.0 - distBh / 600);
            axBh += (-dzBh / distBh) * vortexFac * 2.0;
            azBh += (dxBh / distBh) * vortexFac * 2.0;
        }

        // --- Event Horizon: ENGOLIDAS (APAGADAS) ---
        if (distBh < 22.0 || distSun < 38) {
            statuses[i] = 0.0; // Mark as erased
            posArray[i3] = 0;
            posArray[i3+1] = 0;
            posArray[i3+2] = 0;
            continue;
        }

        // ---------------- Update & Integrate ----------------
        velocities[i3] += (axSun + axBh);
        velocities[i3+1] += (aySun + ayBh);
        velocities[i3+2] += (azSun + azBh);
        
        velocities[i3] *= 0.9997;
        velocities[i3+1] *= 0.9997;
        velocities[i3+2] *= 0.9997;

        posArray[i3] += velocities[i3] * (dt * 60);
        posArray[i3+1] += velocities[i3+1] * (dt * 60);
        posArray[i3+2] += velocities[i3+2] * (dt * 60);
    }
    
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.particleStatus.needsUpdate = true;
    
    // Dynamic aesthetics updates
    const scale = 1.0 + Math.sin(time * 3) * 0.03;
    sunMesh.scale.set(scale, scale, scale);
    sunGlow.scale.set(scale * 1.05, scale * 1.05, scale * 1.05);

    // Event Horizon Visuals update based on mass
    const bhScale = 1.0 + (currentBhMass / 25000) * 1.5;
    bhMesh.scale.set(bhScale, bhScale, bhScale);
    bhRing.scale.set(bhScale, bhScale, bhScale);
    
    // Render loop using composer (so bloom is applied)
    composer.render();
}

animate();
