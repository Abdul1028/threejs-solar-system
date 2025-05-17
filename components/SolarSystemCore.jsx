"use client";

import React, { createContext, useContext, useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree, extend, useLoader } from '@react-three/fiber';
import { OrbitControls, shaderMaterial as dreiShaderMaterial, Line, InstancedRigidBodies } from '@react-three/drei';
import { Physics, RigidBody, useRapier, useBeforePhysicsStep } from '@react-three/rapier';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { 
    Vector3, 
    Matrix4, 
    Color, 
    TextureLoader, 
    BufferGeometry, 
    Float32BufferAttribute, 
    ShaderMaterial as ThreeShaderMaterial, // Aliased to avoid conflict with drei
    AdditiveBlending,
    Object3D,
    DodecahedronGeometry,
    MeshBasicMaterial,
    MeshStandardMaterial,
    SphereGeometry,
    PointLight,
    AmbientLight
} from 'three';

// Shader imports - assuming shaders folder is a sibling to this file in components/
// e.g., components/shaders/noise.glsl
import noiseShaderSource from './shaders/noise.glsl';

// --- Constants (formerly from config/constants.js) ---
const GRAVITATIONAL_CONSTANT = 6.6743e-11;
const SCALE_FACTOR = 0.0001;
const SPAWN_RADIUS = 250;
const SUN_RADIUS = 15;
const SUN_MASS = Math.round((4 / 3) * Math.PI * Math.pow(SUN_RADIUS, 3) * 1410) / 100;

// --- Utility Functions (formerly from utils/planetCalculations.js) ---
const calculateInitialPosition = (isEntry = false) => {
    const theta = Math.random() * Math.PI * 2;
    const radius = isEntry ? SPAWN_RADIUS * 1.5 : Math.random() * SPAWN_RADIUS + SUN_RADIUS * 3;
    const x = Math.cos(theta) * radius;
    const y = Math.random() * 10; // Keep some y variation
    const z = Math.sin(theta) * radius;
    return new Vector3(x, y, z);
};

const calculateInitialVelocity = (position, respawn) => {
    const radialVector = new Vector3().copy(position);
    const distance = radialVector.length();
    const orbitalSpeed = Math.sqrt((GRAVITATIONAL_CONSTANT * SUN_MASS) / distance);
    const upVector = new Vector3(0, 1, 0); // Assuming orbits roughly on XZ plane
    const velocity = new Vector3().crossVectors(radialVector, upVector).normalize().multiplyScalar(orbitalSpeed).multiplyScalar(20000); // Arbitrary multiplier for visual speed

    if (respawn) {
        velocity.multiplyScalar(0.75);
    }
    return velocity;
};

// --- Context Definitions ---

// Camera Context
const CameraContext = createContext();
const useCamera = () => useContext(CameraContext);

const CameraProvider = ({ children }) => {
    const { camera, controls } = useThree();
    const cameraTarget = useRef(new Vector3());
    const [focusedObject, setFocusedObject] = useState(null);

    useFrame(() => {
        if (focusedObject && controls) { // Check if controls exist
            let targetPositionVec;
            if (focusedObject.instanceId !== undefined && focusedObject.object?.getMatrixAt) {
                const instanceMatrix = new Matrix4();
                focusedObject.object.getMatrixAt(focusedObject.instanceId, instanceMatrix);
                targetPositionVec = new Vector3().setFromMatrixPosition(instanceMatrix);
            } else if (focusedObject.object?.position) {
                targetPositionVec = focusedObject.object.position.clone();
            }

            if (targetPositionVec) {
                const smoothness = 0.05;
                cameraTarget.current.lerp(targetPositionVec, smoothness);
                camera.lookAt(cameraTarget.current);
                if (controls.target) {
                    controls.target.copy(cameraTarget.current);
                }
                controls.update();
            }
        }
    });

    const handleFocus = (event) => {
        // console.log('handleFocus triggered:', event);
        const object = event.object;
        const instanceId = event.instanceId;

        if (instanceId !== undefined) {
            // console.log('Focusing on instanced mesh. Instance ID:', instanceId);
            setFocusedObject({ object, instanceId });
        } else {
            // console.log('Focusing on non-instanced mesh. Object Name:', object.name);
            setFocusedObject({ object });
        }
        event.stopPropagation(); // Prevent event from bubbling further if needed
    };
    return <CameraContext.Provider value={{ focusedObject, handleFocus }}>{children}</CameraContext.Provider>;
};

// Explosion Context
const ExplosionContext = createContext();
const useExplosion = () => useContext(ExplosionContext);

const ExplosionProvider = ({ children }) => {
    const [explosions, setExplosions] = useState([]);
    const triggerExplosion = useCallback((position, lookAt) => {
        setExplosions((prev) => [...prev, { position, lookAt, id: Math.random() }]);
    }, []);
    const handleExplosionComplete = useCallback((id) => {
        setExplosions((prev) => prev.filter((explosion) => explosion.id !== id));
    }, []);

    return (
        <ExplosionContext.Provider value={{ triggerExplosion }}>
            {children}
            {explosions.map(({ id, position, lookAt }) => (
                <Explosion key={id} position={position} lookAt={lookAt} onComplete={() => handleExplosionComplete(id)} />
            ))}
        </ExplosionContext.Provider>
    );
};

// Trail Context
const TrailContext = createContext();
const useTrails = () => useContext(TrailContext);

const TrailProvider = ({ children }) => {
    const [trails, setTrails] = useState({});
    const addTrailPoint = useCallback((key, position) => {
        setTrails((prevTrails) => {
            const trail = prevTrails[key] || [];
            const newTrail = trail.length >= 300 ? trail.slice(1) : trail; // Limit trail length
            const lastPoint = newTrail[newTrail.length - 1];
            if (!lastPoint || lastPoint.distanceToSquared(position) > 1) { // Add point if moved enough
                return { ...prevTrails, [key]: [...newTrail, position.clone()] };
            }
            return prevTrails;
        });
    }, []);
    const clearTrail = useCallback((key) => {
        setTrails((prevTrails) => {
            const { [key]: _, ...rest } = prevTrails;
            return rest;
        });
    }, []);

    return (
        <TrailContext.Provider value={{ addTrailPoint, clearTrail }}>
            {children}
            {Object.entries(trails).map(([key, positions]) => (
                <Line key={key} points={positions} color="rgba(30,30,30,1)" lineWidth={1} />
            ))}
        </TrailContext.Provider>
    );
};

// --- Hook Definitions ---
const useGravity = () => {
    const { world } = useRapier();
    useBeforePhysicsStep(() => {
        if (!world || !world.bodies) return;
        const impulseVector = new Vector3();
        world.bodies.forEach((currentBody) => {
            if (!currentBody || currentBody.isSleeping || !currentBody.isDynamic()) return; // Check if body exists and is dynamic
            const currentMass = currentBody.mass();
            if (currentMass === 0) return;

            const currentPositionVec = currentBody.translation();
            const currentPosition = new Vector3(currentPositionVec.x, currentPositionVec.y, currentPositionVec.z);

            world.bodies.forEach((otherBody) => {
                if (!otherBody || currentBody === otherBody || otherBody.isSleeping() || !otherBody.isDynamic()) return;
                const otherMass = otherBody.mass();
                if (otherMass === 0) return;
                
                const otherPositionVec = otherBody.translation();
                const otherPosition = new Vector3(otherPositionVec.x, otherPositionVec.y, otherPositionVec.z);
                const distance = currentPosition.distanceTo(otherPosition);
                if (distance === 0) return;

                const forceMagnitude = (GRAVITATIONAL_CONSTANT * currentMass * otherMass) / Math.pow(distance * SCALE_FACTOR, 2);
                impulseVector.subVectors(otherPosition, currentPosition).normalize().multiplyScalar(forceMagnitude);
                currentBody.applyImpulse(impulseVector, true);
            });
        });
    });
};

// --- Sub-Component Definitions ---

const Stars = ({ count = 5000 }) => {
    const meshRef = useRef();
    const positions = useMemo(() => {
        const pos = new Float32Array(count * 3);
        const minDistance = 500;
        for (let i = 0; i < count; i++) {
            const distance = minDistance + Math.random() * 4500;
            const theta = Math.random() * 2 * Math.PI;
            const phi = Math.acos(2 * Math.random() - 1); // More uniform sphere distribution
            pos[i * 3] = distance * Math.sin(phi) * Math.cos(theta);
            pos[i * 3 + 1] = distance * Math.sin(phi) * Math.sin(theta);
            pos[i * 3 + 2] = distance * Math.cos(phi);
        }
        return pos;
    }, [count]);

    useEffect(() => {
        if (!meshRef.current) return;
        const tempObject = new Object3D();
        for (let i = 0; i < count; i++) {
            tempObject.position.set(positions[i*3], positions[i*3+1], positions[i*3+2]);
            tempObject.updateMatrix();
            meshRef.current.setMatrixAt(i, tempObject.matrix);
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [count, positions]);
    
    useFrame(() => {
        if (meshRef.current) {
            meshRef.current.rotation.y += 0.00005; // Slower rotation
        }
    });

    return (
        <instancedMesh ref={meshRef} args={[null, null, count]} frustumCulled={false}>
            <dodecahedronGeometry args={[0.4, 0]} />
            <meshBasicMaterial color="white" />
        </instancedMesh>
    );
};

const SunCustomShader = dreiShaderMaterial(
    { emissiveIntensity: 1.0, time: 0, noiseMap: null }, // noiseMap can be used if you have a texture
    // Vertex Shader
    `
    varying vec2 vUv;
    varying vec3 vPosition;
    void main() {
        vUv = uv;
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
    // Fragment Shader
    `
    uniform float time;
    uniform float emissiveIntensity;
    varying vec2 vUv;
    varying vec3 vPosition;
    ${noiseShaderSource} // Injects the GLSL code string
    void main() {
        float noiseValue = snoise(vPosition * 0.1 + time * 0.1); // Adjust scaling and speed
        vec3 color = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.5, 0.0), noiseValue); // Brighter oranges
        float intensity = (noiseValue * 0.4 + 0.6) * emissiveIntensity; // Ensure it's always somewhat bright
        gl_FragColor = vec4(color * intensity, 1.0);
    }`
);
extend({ SunCustomShader });

const Sun = () => {
    const { handleFocus } = useCamera();
    const shaderRef = useRef();
    useFrame(({ clock }) => {
        if (shaderRef.current) {
            shaderRef.current.uniforms.time.value = clock.elapsedTime;
        }
    });
    return (
        <RigidBody colliders="ball" userData={{ type: 'Sun' }} type="kinematicPosition" onCollisionEnter={handleFocus /* Fix: Sun is kinematic, handleFocus might be better on mesh if desired */}>
            <mesh onClick={handleFocus} name="SunMesh">
                <sphereGeometry args={[SUN_RADIUS, 64, 64]} /> {/* Increased segments for smoother sun */}
                <sunCustomShader ref={shaderRef} emissiveIntensity={3} time={0} />
            </mesh>
            <pointLight position={[0, 0, 0]} intensity={100000} distance={SUN_RADIUS * 50} color="rgb(255, 220, 180)" />
        </RigidBody>
    );
};

const Planet = ({ instances }) => {
    const mesh = useRef();
    const { handleFocus } = useCamera();
    const texture = useLoader(TextureLoader, '/textures/planet.jpg'); // Ensure this path is correct from public folder

    const instanceColors = useMemo(() => {
        const numInstances = instances.length;
        const colors = new Float32Array(numInstances * 3);
        const whiteColor = new Color('white');
        const earthColor = new Color('#6fa8dc'); 

        for (let i = 0; i < numInstances; i++) {
            const type = instances[i].userData?.type;
            if (type === 'Moon') {
                whiteColor.toArray(colors, i * 3);
            } else if (type === 'Earth') {
                earthColor.toArray(colors, i * 3);
            } else { // Planet
                const hue = 200 + Math.random() * 100; // Wider range of planet colors
                const saturation = 50 + Math.random() * 50;
                const lightness = 50 + Math.random() * 20;
                new Color(`hsl(${hue}, ${saturation}%, ${lightness}%)`).toArray(colors, i * 3);
            }
        }
        return colors;
    }, [instances]);

    return (
        <instancedMesh ref={mesh} args={[null, null, instances.length]} onClick={handleFocus} castShadow receiveShadow frustumCulled={false}>
            <sphereGeometry args={[2, 32, 32]}>
                <instancedBufferAttribute attach="attributes-color" args={[instanceColors, 3]} />
            </sphereGeometry>
            <meshStandardMaterial vertexColors map={texture} roughness={0.7} metalness={0.1} />
        </instancedMesh>
    );
};

// Vertex shader for explosion
const explosionVertexShader = `
  uniform float uTime;
  uniform float uSpread;
  attribute vec3 aVelocity;
  attribute float aSize;
  void main() {
    vec3 pos = position;
    pos += aVelocity * uTime * (1.0 + uTime * 0.5); // Accelerate particles outward
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (1.0 - uTime * 0.5); // Particles shrink over time
  }
`;
// Fragment shader for explosion
const explosionFragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    float fade = smoothstep(0.5, 0.0, distanceToCenter); // Make particles round and fade at edges
    gl_FragColor = vec4(uColor, uOpacity * fade);
  }
`;

const Explosion = ({ position, lookAt, onComplete, spread = 10 }) => {
    const meshRef = useRef();
    const materialRef = useRef();

    useEffect(() => {
        if(meshRef.current && lookAt){ // Ensure lookAt is defined
             meshRef.current.lookAt(lookAt);
        }
    }, [lookAt]);

    useFrame((state, delta) => {
        if (!materialRef.current) return;
        materialRef.current.uniforms.uTime.value += delta * 2; // Faster explosion
        materialRef.current.uniforms.uOpacity.value -= delta * 1.5; // Faster fade
        if (materialRef.current.uniforms.uOpacity.value <= 0) {
            onComplete();
        }
    });

    const { geometry, material } = useMemo(() => {
        const count = 100 + Math.floor(Math.random() * 50); // Varied particle count
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const explosionColor = new Color().setHSL(Math.random() * 0.1 + 0.05, 0.9, 0.6); // Orange/Red hues

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const radius = Math.random() * spread;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1) * (0.3 + Math.random() * 0.4); // More directed cone

            positions[i3] = 0; // Start at origin (explosion position)
            positions[i3 + 1] = 0;
            positions[i3 + 2] = 0;
            
            const dirX = radius * Math.cos(theta) * Math.sin(phi);
            const dirY = radius * Math.sin(theta) * Math.sin(phi);
            const dirZ = radius * Math.cos(phi);

            const speed = (Math.random() * 0.8 + 0.2) * (spread * 0.2); // Scale speed with spread
            velocities[i3] = dirX * speed;
            velocities[i3 + 1] = dirY * speed;
            velocities[i3 + 2] = dirZ * speed;

            sizes[i] = Math.random() * 4 + 2; // Slightly larger particles
        }

        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geom.setAttribute('aVelocity', new Float32BufferAttribute(velocities, 3));
        geom.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));

        const mat = new ThreeShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSpread: { value: spread },
                uColor: { value: explosionColor },
                uOpacity: { value: 1.0 },
            },
            vertexShader: explosionVertexShader,
            fragmentShader: explosionFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        });
        return { geometry: geom, material: mat };
    }, [spread]);

    return <points ref={meshRef} position={position} geometry={geometry} material={material} frustumCulled={false} />;
};


const Planets = ({ count = 14 }) => {
    const { triggerExplosion } = useExplosion();
    const { addTrailPoint, clearTrail } = useTrails();
    const planetsRef = useRef();
    const [planetCount, setPlanetCount] = useState(count); // This state isn't directly used by Planet comp anymore

    const createBodyData = (options = {}) => {
        const { respawn = false, typeOverride, scaleOverride } = options;
        const key = 'instance_' + Math.random().toString(36).substr(2, 9);
        const position = calculateInitialPosition(respawn);
        const linearVelocity = calculateInitialVelocity(position, respawn);
        const scale = scaleOverride !== undefined ? scaleOverride : 0.5 + Math.random() * 1.5;
        const type = typeOverride || 'Planet';
        return { key, position, linearVelocity, scale, userData: { type, key } };
    };

    const initialInstances = useMemo(() => {
        const bodies = [];
        if (count > 0) {
            bodies.push(createBodyData({ typeOverride: 'Moon', scaleOverride: 5 }));
            if (count > 1) {
                bodies.push(createBodyData({ typeOverride: 'Earth', scaleOverride: 2.5 }));
            }
            const remainingPlanetsCount = Math.max(0, count - bodies.length);
            for (let i = 0; i < remainingPlanetsCount; i++) {
                bodies.push(createBodyData({ typeOverride: 'Planet' }));
            }
        }
        return bodies;
    }, [count]);
    
    useEffect(() => {
        if (planetsRef.current) {
           setPlanetCount(planetsRef.current.length); // Update count if needed elsewhere
            planetsRef.current.forEach((planetBody) => {
                planetBody.setAngvel(new Vector3(0, Math.random() - 0.5, 0).multiplyScalar(0.5), true); // Slower initial spin
            });
        }
    }, [initialInstances]); // Re-run if initialInstances change (e.g. count prop changes)

    useFrame(() => {
        planetsRef.current?.forEach((planet) => {
            if (planet && planet.userData) { // Ensure planet and userData exist
                 const position = planet.translation();
                 addTrailPoint(planet.userData.key, new Vector3(position.x, position.y, position.z));
            }
        });
    });

    const handleCollision = ({ manifold, target, other }) => {
        if (!manifold || !target?.rigidBody || !other?.rigidBody) return;

        const targetRigidBody = target.rigidBody;
        const otherRigidBody = other.rigidBody;
        
        if(!targetRigidBody.userData || !otherRigidBody.userData) return; // Ensure userData exists for type checks

        const targetMass = targetRigidBody.mass();
        const otherMass = otherRigidBody.mass();

        if (otherMass > targetMass && targetMass > 0) { // Ensure target has mass to be destroyed
            const collisionPointVec = manifold.solverContactPoint(0);
            if (!collisionPointVec) return;
            const collisionPoint = new Vector3(collisionPointVec.x, collisionPointVec.y, collisionPointVec.z);

            const targetPositionVec = targetRigidBody.translation();
            const targetPosition = new Vector3(targetPositionVec.x, targetPositionVec.y, targetPositionVec.z);
            
            const otherPositionVec = otherRigidBody.translation();
            const otherPosition = new Vector3(otherPositionVec.x, otherPositionVec.y, otherPositionVec.z);

            const targetVel = targetRigidBody.linvel();
            const otherVel = otherRigidBody.linvel();
            const targetVelocity = new Vector3(targetVel.x, targetVel.y, targetVel.z);
            const otherVelocity = new Vector3(otherVel.x, otherVel.y, otherVel.z);

            const combinedMass = targetMass + otherMass;
            const combinedVelocity = new Vector3()
                .addScaledVector(targetVelocity, targetMass)
                .addScaledVector(otherVelocity, otherMass)
                .divideScalar(combinedMass);

            const validDynamicTypes = ['Planet', 'Moon', 'Earth'];
            if (validDynamicTypes.includes(otherRigidBody.userData.type)) {
                otherRigidBody.setLinvel({ x: combinedVelocity.x, y: combinedVelocity.y, z: combinedVelocity.z }, true);
            }

            triggerExplosion(collisionPoint, targetPosition);

            if (otherRigidBody.userData.type === 'Moon') {
                triggerExplosion(collisionPoint, otherPosition);
            }

            clearTrail(targetRigidBody.userData.key);
            const newBodyData = createBodyData({ respawn: true, typeOverride: 'Planet' }); // Respawn as planet

            targetRigidBody.userData.key = newBodyData.key; // Update key for trail
            targetRigidBody.setTranslation(newBodyData.position, true);
            targetRigidBody.setLinvel(newBodyData.linearVelocity, true);
            // Reset angular velocity or apply a new small one
            targetRigidBody.setAngvel({ x: 0, y: Math.random() * 0.2 - 0.1, z: 0 }, true);
        }
    };

    return (
        <InstancedRigidBodies ref={planetsRef} instances={initialInstances} colliders="ball" onCollisionEnter={handleCollision}>
            <Planet instances={initialInstances} />
        </InstancedRigidBodies>
    );
};


const Scene = () => {
    useGravity(); // Applies gravity to all dynamic rigid bodies
    return (
        <CameraProvider>
            <ExplosionProvider>
                <Sun />
                <TrailProvider>
                    <Planets count={14} /> {/* Default count */}
                </TrailProvider>
                <Stars count={5000}/>
            </ExplosionProvider>
        </CameraProvider>
    );
};

// --- Main Exported Component ---
const SolarSystemCore = () => {
    return (
        <Canvas 
            camera={{ position: [0, 70, 180], fov: 55, far: 50000 }} // Adjusted camera
            gl={{ antialias: true, powerPreference: "high-performance" }} // Added antialias
            shadows // Enable shadows
        >
            <color attach="background" args={['#000005']} /> {/* Slightly off-black */}
            <AmbientLight intensity={0.15} /> {/* Softer ambient light */}
            
            <OrbitControls 
                maxDistance={1000} 
                minDistance={30} 
                enablePan={false} // Keep focus on center
                target={[0,0,0]} // Initial target
            />
            <Physics gravity={[0, 0, 0]} interpolation={true} /* Enable interpolation for smoother physics */ >
                <Scene />
            </Physics>
            <EffectComposer>
                <Bloom luminanceThreshold={0.3} luminanceSmoothing={0.6} intensity={0.8} height={400} />
            </EffectComposer>
        </Canvas>
    );
};

export default SolarSystemCore; 