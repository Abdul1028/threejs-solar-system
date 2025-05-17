import SolarSystemBackground from '../components/SolarSystemBackground'; 
export default function HomePage() {
  return (
    <div>
      <SolarSystemBackground />
      <nav style={{
        position: 'fixed', // Fixed to stay on top
        top: 0,
        left: 0,
        width: '100%',
        padding: '1rem 2rem',
        backgroundColor: 'rgba(0, 0, 0, 0.5)', 
        color: 'white',
        zIndex: 10, // Ensure it's above the background
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>My Portfolio</span>
        <div>
          <a href="#about" style={{ color: 'white', marginLeft: '1rem' }}>About</a>
          <a href="#projects" style={{ color: 'white', marginLeft: '1rem' }}>Projects</a>
          <a href="#contact" style={{ color: 'white', marginLeft: '1rem' }}>Contact</a>
        </div>
      </nav>

      {/* Your Main Page Content */}
      <main style={{
        position: 'relative', // To allow z-index stacking
        zIndex: 1,          // Above background, below navbar
        paddingTop: '80px',   // To offset for the fixed navbar height
        minHeight: '200vh', // Make page scrollable to see background effect
        textAlign: 'center',
        color: 'white',     // Example text color
      }}>
        <section style={{ padding: '2rem', minHeight: '80vh' }}>
          <h1>Welcome to My Universe!</h1>
          <p style={{ fontSize: '1.2rem', maxWidth: '600px', margin: '1rem auto' }}>
            This is a demonstration of the solar system running as a cool, interactive background 
            for a Next.js application.
          </p>
          <p>Scroll down to see the effect!</p>
        </section>
        
        <section id="about" style={{ padding: '2rem', minHeight: '100vh', backgroundColor: 'rgba(20,20,50,0.3)' }}>
          <h2>About Me</h2>
          <p>More content would go here...</p>
        </section>

        <section id="projects" style={{ padding: '2rem', minHeight: '100vh', backgroundColor: 'rgba(50,20,20,0.3)' }}>
          <h2>My Projects</h2>
          <p>Portfolio items would be listed here...</p>
        </section>

      </main>
    </div>
  );
} 