// A button that repeats while held: one press does it once; holding past a beat keeps
// doing it, about thirty times a second, until let go. A keyboard click does it once.
import { useEffect, useRef } from 'react';

const DELAY = 350;
const EVERY = 33;

export function useHold(act: () => void) {
  const actRef = useRef(act);
  actRef.current = act;
  const timers = useRef<{
    wait?: ReturnType<typeof setTimeout>;
    tick?: ReturnType<typeof setInterval>;
  }>({});
  const pressed = useRef(false);
  const stop = () => {
    clearTimeout(timers.current.wait);
    clearInterval(timers.current.tick);
    timers.current = {};
  };
  useEffect(() => stop, []);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      pressed.current = true;
      actRef.current();
      stop();
      timers.current.wait = setTimeout(() => {
        timers.current.tick = setInterval(() => actRef.current(), EVERY);
      }, DELAY);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (e: React.MouseEvent) => {
      // The pointer already acted; a click from the keyboard (no pointer) acts once.
      if (pressed.current && e.detail !== 0) {
        pressed.current = false;
        return;
      }
      pressed.current = false;
      actRef.current();
    },
  };
}
