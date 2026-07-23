import { useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  scene: string // asset base name, e.g. "kaji-foundry"
  mobileScene?: string // separately composed vertical plate for small screens
  className?: string
  children?: ReactNode // native HTML overlays positioned over the plate
}

const MOBILE_QUERY = '(max-width: 768px)'

/**
 * Full-bleed media plate: poster first, looping video once it can play.
 * Pauses when offscreen or when the tab is hidden. Reduced-motion users
 * get the poster only (see index.css).
 */
export default function ScenePlate({ scene, mobileScene, className, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    if (!mobileScene) return
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mobileScene])

  const base = mobileScene && isMobile ? mobileScene : scene

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.load() // pick up new sources when the plate variant changes

    const isInViewport = () => {
      const r = video.getBoundingClientRect()
      return r.bottom > 0 && r.top < window.innerHeight
    }
    const tryPlay = () => {
      if (isInViewport() && !document.hidden) video.play().catch(() => {})
      else video.pause()
    }

    const io = new IntersectionObserver(() => tryPlay(), { threshold: 0.1 })
    io.observe(video)

    video.addEventListener('canplay', tryPlay)
    document.addEventListener('visibilitychange', tryPlay)
    tryPlay()
    return () => {
      io.disconnect()
      video.removeEventListener('canplay', tryPlay)
      document.removeEventListener('visibilitychange', tryPlay)
    }
  }, [base])

  return (
    <div className={`scene-plate ${className ?? ''}`}>
      <img className="scene-plate__poster" src={`/assets/${base}-poster.webp`} alt="" aria-hidden="true" />
      <video
        key={base}
        ref={videoRef}
        className="scene-plate__video"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster={`/assets/${base}-poster.webp`}
        aria-hidden="true"
      >
        <source src={`/assets/${base}-loop.webm`} type="video/webm" />
        <source src={`/assets/${base}-loop.mp4`} type="video/mp4" />
      </video>
      {children}
    </div>
  )
}
