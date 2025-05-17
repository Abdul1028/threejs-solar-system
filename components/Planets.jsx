import React, { useRef, useState, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedRigidBodies } from '@react-three/rapier'
import { Vector3 } from 'three'

import { calculateInitialPosition, calculateInitialVelocity } from '../utils/planetCalculations'
import { useExplosion } from '../context/Explosions'
import { useTrails } from '../context/Trails'

import Planet from './Planet'

// Planets component
const Planets = ({ count = 14 }) => {
    const { triggerExplosion } = useExplosion()
    const { addTrailPoint, clearTrail } = useTrails()

    const planetsRef = useRef()
    const [planetCount, setPlanetCount] = useState(count)

    // Planet props
    const newPlanet = (options = {}) => {
        const { respawn = false, typeOverride, scaleOverride } = options;
        const key = 'instance_' + Math.random()
        const position = calculateInitialPosition(respawn)
        const linearVelocity = calculateInitialVelocity(position, respawn)
        
        const scale = scaleOverride !== undefined ? scaleOverride : 0.5 + Math.random() * 1.5;
        // If typeOverride is not provided, default to 'Planet'. This ensures new bodies from collisions are Planets.
        const type = typeOverride || 'Planet'; 

        return { key, position, linearVelocity, scale, userData: { type, key } }
    }

    // Set up the initial planet data
    const planetData = useMemo(() => {
        const bodies = [];
        if (count > 0) {
            // Create one large white moon
            bodies.push(newPlanet({ typeOverride: 'Moon', scaleOverride: 5 }));

            // Create Earth if there's space (count should be at least 2 for Moon + Earth)
            if (count > 1) {
                bodies.push(newPlanet({ typeOverride: 'Earth', scaleOverride: 2.5 }));
            }

            // Create remaining planets
            // count - 2 because one body is Moon, one is Earth (if count allows)
            const remainingPlanetsCount = Math.max(0, count - (bodies.length)); // Ensure we don't go negative
            for (let i = 0; i < remainingPlanetsCount; i++) {
                bodies.push(newPlanet({ typeOverride: 'Planet' })); // Ensures these are planets
            }
        }
        return bodies;
    }, [count])

    // Update the planet count
    useEffect(() => {
        // Set the planet count
        setPlanetCount(planetsRef.current.length)

        // add some initial spin to the planets
        planetsRef.current.forEach((planet) => {
            planet.setAngvel(new Vector3(0, Math.random() - 0.5, 0))
        })
    }, [planetsRef.current])

    // Add a trail point for each planet
    useFrame(() => {
        planetsRef.current?.forEach((planet) => {
            const position = planet.translation()
            addTrailPoint(planet.userData.key, new Vector3(position.x, position.y, position.z))
        })
    })

    // Handle collisions
    const handleCollision = ({ manifold, target, other }) => {
        console.log('Planet collision'); 

        const targetRigidBody = target.rigidBody;
        const otherRigidBody = other.rigidBody;

        if (!targetRigidBody || !otherRigidBody) {
            console.warn('Collision event missing rigidBody for target or other.');
            return;
        }

        const targetMass = targetRigidBody.mass();
        const otherMass = otherRigidBody.mass();

        // If 'other' object is more massive than 'target' object
        if (otherMass > targetMass) {
            const collisionPointVec = manifold.solverContactPoint(0);
            const collisionPoint = new Vector3(collisionPointVec.x, collisionPointVec.y, collisionPointVec.z);

            const targetPositionVec = targetRigidBody.translation();
            const targetPosition = new Vector3(targetPositionVec.x, targetPositionVec.y, targetPositionVec.z);
            
            const otherPositionVec = otherRigidBody.translation();
            const otherPosition = new Vector3(otherPositionVec.x, otherPositionVec.y, otherPositionVec.z);

            const targetVelocity = targetRigidBody.linvel(); // Rapier velocity {x,y,z}
            const otherVelocity = otherRigidBody.linvel(); // Rapier velocity {x,y,z}

            // Calculate the combined velocity using conservation of momentum
            const combinedMass = targetMass + otherMass;
            const combinedVelocity = new Vector3()
                .addScaledVector(new Vector3(targetVelocity.x, targetVelocity.y, targetVelocity.z), targetMass)
                .addScaledVector(new Vector3(otherVelocity.x, otherVelocity.y, otherVelocity.z), otherMass)
                .divideScalar(combinedMass);

            // Set the combined velocity to the 'other' (larger, surviving) body, 
            // if it's a dynamic type we manage (Planet, Moon, Earth). Sun is kinematic.
            const validDynamicTypes = ['Planet', 'Moon', 'Earth'];
            if (validDynamicTypes.includes(otherRigidBody.userData.type)) {
                otherRigidBody.setLinvel({ x: combinedVelocity.x, y: combinedVelocity.y, z: combinedVelocity.z });
            }

            // Trigger explosion for the 'target' (smaller, destroyed) body.
            triggerExplosion(
                collisionPoint,
                targetPosition 
            );

            // If the 'other' (larger, surviving) body was the Moon, trigger an additional impact explosion on its surface.
            if (otherRigidBody.userData.type === 'Moon') {
                console.log('Moon was impacted by a smaller object. Triggering additional explosion on Moon surface.');
                triggerExplosion(
                    collisionPoint, // Explosion originates at the impact point
                    otherPosition   // Explosion effect orients relative to Moon's center (away from impact normal)
                );
            }

            // Clear trail of the 'target' (destroyed) body
            clearTrail(targetRigidBody.userData.key);

            // Respawn the 'target' (destroyed) body
            const newPlanetData = newPlanet({ respawn: true }); // Ensure respawned entities are planets by default

            targetRigidBody.userData.key = newPlanetData.key;
            targetRigidBody.setTranslation(newPlanetData.position); // Rapier's setTranslation takes {x,y,z}
            targetRigidBody.setLinvel(newPlanetData.linearVelocity); // Rapier's setLinvel takes {x,y,z}
        }
        // Note: Collisions where targetMass >= otherMass are not explicitly handled for destruction/respawn in this block.
        // This matches the original code's primary collision handling path. 
        // If Moon is 'target' and hits Sun ('other', more massive), 
        // Moon is destroyed and its explosion is handled by the first triggerExplosion call.
    };

    return (
        <InstancedRigidBodies ref={planetsRef} instances={planetData} colliders='ball' onCollisionEnter={handleCollision}>
            <Planet instances={planetData} />
        </InstancedRigidBodies>
    )
}

export default Planets
