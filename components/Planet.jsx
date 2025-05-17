import React, { useRef, useMemo } from 'react'
import { TextureLoader, Color } from 'three'
import { useLoader } from '@react-three/fiber'
import { useCamera } from '../context/Camera'

const Planet = ({ instances }) => {
    const mesh = useRef()
    const { handleFocus } = useCamera()

    const texture = useLoader(TextureLoader, '/textures/planet.jpg')

    // Create a color for each instance based on its type
    const instanceColors = useMemo(() => {
        const numInstances = instances.length;
        const colors = new Float32Array(numInstances * 3);
        const whiteColor = new Color('white');
        const earthColor = new Color('#6fa8dc'); // A nice blue for Earth

        for (let i = 0; i < numInstances; i++) {
            if (instances[i].userData && instances[i].userData.type === 'Moon') {
                whiteColor.toArray(colors, i * 3);
            } else if (instances[i].userData && instances[i].userData.type === 'Earth') {
                earthColor.toArray(colors, i * 3);
            } else {
                // Random natural looking planet hue for Planets
                const hue = 250 + Math.random() * 50;
                const saturation = 40 + Math.random() * 60;
                const lightness = 60;
                const hslColor = new Color(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
                hslColor.toArray(colors, i * 3);
            }
        }
        return colors;
    }, [instances]);

    return (
        <instancedMesh ref={mesh} args={[null, null, instances.length]} onClick={handleFocus} castShadow receiveShadow>
            <sphereGeometry args={[2, 32, 32]}>
                <instancedBufferAttribute attach='attributes-color' args={[instanceColors, 3]} />
            </sphereGeometry>
            <meshStandardMaterial vertexColors map={texture} />
        </instancedMesh>
    )
}

export default Planet
