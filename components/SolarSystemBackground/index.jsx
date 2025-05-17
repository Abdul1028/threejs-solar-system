"use client"; // Important for Next.js client-side components

import React from 'react';
// Update the import to point to the new SolarSystemCore.jsx
import SolarSystemCore from '../SolarSystemCore'; 
import styles from './SolarSystemBackground.module.css';

const SolarSystemBackground = () => {
  // This div will contain the Three.js canvas
  return (
    <div className={styles.canvasContainer}>
      <SolarSystemCore /> {/* Use the consolidated component */}
    </div>
  );
};

export default SolarSystemBackground; 