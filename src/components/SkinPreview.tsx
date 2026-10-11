import { useEffect, useRef } from 'react';
import { SkinViewer, WalkingAnimation } from 'skinview3d';

interface SkinPreviewProps {
  skinUrl?: string;
  username?: string;
}

/** Three.js-backed skin renderer; pointer drag controls are provided by skinview3d. */
export function SkinPreview({ skinUrl, username }: SkinPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || !skinUrl) return;
    let viewer: SkinViewer | null = null;
    try {
      viewer = new SkinViewer({ canvas: canvasRef.current, width: 310, height: 330, skin: skinUrl });
      viewer.background = 0x18201a;
      viewer.autoRotate = true;
      viewer.animation = new WalkingAnimation();
      viewer.animation.speed = 0.55;
    } catch {
      // The placeholder underneath remains useful if WebGL is blocked by the graphics driver.
    }
    return () => viewer?.dispose();
  }, [skinUrl]);

  return (
    <div className={`skin-stage ${skinUrl ? 'skin-stage-loaded' : ''}`}>
      {skinUrl ? <canvas ref={canvasRef} className="skin-canvas" aria-label={`${username ?? 'Player'} 3D Minecraft skin`} /> : (
        <div className="skin-placeholder" aria-label="Offline player preview">
          <div className="skin-head"><span className="skin-hair" /><span className="skin-eyes" /></div>
          <div className="skin-body"><span className="skin-arm left" /><span className="skin-shirt" /><span className="skin-arm right" /></div>
          <div className="skin-legs"><span /><span /></div>
        </div>
      )}
      <div className="skin-stage-label"><span className="pulse-dot" />PLAYER MODEL <span className="drag-label">DRAG TO ROTATE</span></div>
    </div>
  );
}
