'use client';

import React, { useEffect, useState, type CSSProperties } from 'react';

const COLORS = ['#ff597c', '#ffc76b', '#73e6d4', '#9eb4ff', '#f995e5', '#ffffff'];

// Stable particle positions keep the scene identical across renders.
const particles = Array.from({ length: 44 }, (_, i) => {
  const angle = (i * 137.508 * Math.PI) / 180;
  const radius = 100 + (i % 7) * 36;
  return {
    '--x': `${Math.cos(angle) * radius}px`,
    '--y': `${Math.sin(angle) * radius * 0.72}px`,
    '--spin': `${(i % 2 ? 1 : -1) * (130 + (i % 5) * 45)}deg`,
    '--delay': `${(i % 6) * 34}ms`,
    '--color': COLORS[i % COLORS.length],
    '--size': `${4 + (i % 4) * 2}px`,
  } as CSSProperties;
});

export function WelcomeCelebration() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setVisible(false), reduced ? 2600 : 5000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <div className="sabi-welcome" aria-live="polite" role="status" dir="rtl">
      <div className="sabi-welcome-backdrop" aria-hidden="true" />
      <div className="sabi-welcome-burst" aria-hidden="true">
        <div className="sabi-welcome-halo" />
        <div className="sabi-welcome-ring sabi-welcome-ring-a" />
        <div className="sabi-welcome-ring sabi-welcome-ring-b" />
        {particles.map((style, index) => (
          <i key={index} className={`sabi-welcome-particle ${index % 4 === 0 ? 'is-star' : ''}`} style={style} />
        ))}
      </div>
      <div className="sabi-welcome-card">
        <span className="sabi-welcome-eyebrow" dir="ltr">A LITTLE MAGIC FOR YOU</span>
        <span className="sabi-welcome-line">رفیق، خوش اومدی <span className="sabi-welcome-heart">♥</span></span>
        <span className="sabi-welcome-subline">چه خوب که اینجایی</span>
      </div>
    </div>
  );
}
