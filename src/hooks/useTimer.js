import { useState, useEffect, useRef } from 'react';
export default function useTimer(initialSeconds, onExpire) {
  const [timeLeft, setTimeLeft] = useState(null);
  const expiredRef = useRef(false);
  useEffect(() => { if (initialSeconds === null || initialSeconds === undefined) return; 
                setTimeLeft(initialSeconds); expiredRef.current = false; }, [initialSeconds]);
  useEffect(() => {
    if (timeLeft === null) return;
    if (timeLeft <= 0) { if (!expiredRef.current && onExpire) { expiredRef.current = true; onExpire(); } return; }
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t-1)), 1000);
    return () => clearInterval(id);
  }, [timeLeft, onExpire]);
  const format = () => {
    const h = Math.floor(timeLeft/3600), m = Math.floor((timeLeft%3600)/60), s = timeLeft%60;
    return { h: String(h).padStart(2,'0'), m: String(m).padStart(2,'0'), s: String(s).padStart(2,'0') };
  };
  return { timeLeft, format, isWarning: timeLeft !== null && timeLeft <= 300 && timeLeft > 60,
    isCritical: timeLeft !== null && timeLeft <= 60};
}
