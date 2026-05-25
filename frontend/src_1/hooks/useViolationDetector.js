import { useEffect, useRef, useCallback } from 'react';
import api from '../api/axiosConfig';

/**
 * useViolationDetector — reviewed and extended proctoring hook.
 *
 * PROCTORING TECHNIQUES IMPLEMENTED:
 *
 *   TAB_SWITCH       — document.visibilitychange (document.hidden = true)
 *   WINDOW_BLUR      — window blur ONLY when already in fullscreen (avoids false positives
 *                      from the initial fullscreen request dialog itself)
 *   FULLSCREEN_EXIT  — fullscreenchange when fullscreenElement becomes null
 *                      NOTE: does NOT auto-submit — backend returns graceSeconds
 *                      so the ExamPage can show a countdown modal (see onFullscreenExit cb)
 *   COPY_PASTE       — copy/cut/paste events, e.preventDefault() blocks data transfer
 *   CONTEXT_MENU     — right-click, e.preventDefault() blocks "Inspect" menu
 *   KEYBOARD_SHORTCUT— F12, Ctrl+Shift+I/J/C (DevTools), Ctrl+C/V/X/U/A/S blocked
 *   MOUSE_LEAVE      — mouseleave on document (user moved pointer off window)
 *                      debounced 2s to avoid false positives from normal use
 *   DEVTOOLS_OPEN    — window size heuristic: outerWidth - innerWidth > 160
 *                      OR outerHeight - innerHeight > 160 (docked DevTools)
 *                      Checked every 3 seconds while exam is active.
 *
 * CALLBACKS:
 *   onAutoSubmit     — called when backend returns autoSubmitted=true for hard violations
 *   onFullscreenExit — called with { graceSeconds, exitsRemaining, autoSubmitted }
 *                      for FULLSCREEN_EXIT — ExamPage shows the grace modal
 */
export default function useViolationDetector(
  attemptId,
  enabled,
  onAutoSubmit,
  onFullscreenExit,
showSnackbar
) {
  const reportingRef = useRef(false);
  const devtoolsCheckRef = useRef(null);
  const mouseLeaveTimerRef = useRef(null);
  const notify = useCallback((message) => {
    if (typeof showSnackbar === 'function') {
      showSnackbar(message);
    }
  }, [showSnackbar]);

  const report = useCallback(async (violationType, details = '') => {
    if (!enabled || !attemptId || reportingRef.current) return;
    reportingRef.current = true;
    try {
      const res = await api.post('/proctor/violation', { attemptId, violationType, details });
      const data = res.data?.data;
      if (!data) return;

      if (violationType === 'FULLSCREEN_EXIT') {
        // Backend sends graceSeconds — ExamPage handles the modal countdown
        if (onFullscreenExit) onFullscreenExit(data);
      } else {
        if (data.autoSubmitted && onAutoSubmit) onAutoSubmit();
      }
    } catch (e) {
      // Network errors during proctoring are silently ignored to avoid
      // disrupting the student. The frontend state still tracks violations.
    } finally {
      setTimeout(() => { reportingRef.current = false; }, 1500);
    }
  }, [attemptId, enabled, onAutoSubmit, onFullscreenExit, showSnackbar]);

  useEffect(() => {
    if (!enabled) return;

    // ── TAB SWITCH ─────────────────────────────────────────────
    const onVis = () => {
      if (document.hidden) report('TAB_SWITCH', 'Tab hidden / minimised');
    };

    // ── WINDOW BLUR (only while in fullscreen) ─────────────────
    const onBlur = () => {
      // Skip if we are not in fullscreen — blur fires during the initial
      // requestFullscreen() permission dialog and would create false violations
      if (!document.fullscreenElement) return;
      report('WINDOW_BLUR', 'Window lost focus while in fullscreen');
    };

    // ── FULLSCREEN EXIT ────────────────────────────────────────
    const onFs = () => {
      if (!document.fullscreenElement) {
        report('FULLSCREEN_EXIT', 'Exited fullscreen mode');
      }
    };

    // ── COPY / CUT / PASTE ─────────────────────────────────────
    const onCopy = (e) => { 
      e.preventDefault(); 
      notify("Cut/Copy/Paste is not allowed during the exam");
      //report('COPY_PASTE', 'Copy attempted'); 
    };
    const onCut  = (e) => { 
      e.preventDefault(); 
      notify("Cut/Copy/Paste is not allowed during the exam");
      //report('COPY_PASTE', 'Cut attempted');
     };
    const onPaste = (e) => { 
      e.preventDefault(); 
      notify("Cut/Copy/Paste is not allowed during the exam");
      //report('COPY_PASTE', 'Paste attempted'); 
    };

    // ── CONTEXT MENU (right-click) ─────────────────────────────
    let  lastAlertTime = 0;
    const onCtx = (e) => { 
      e.preventDefault(); 
    const now = Date.now();
    if (now - lastAlertTime > 2000) { // 2 sec cooldown
        notify("Right-click is not allowed during the exam");
        lastAlertTime = now;
    //report('CONTEXT_MENU', 'Right-click blocked'); 
    }
  };

    // ── KEYBOARD SHORTCUTS ─────────────────────────────────────
    const onKey = (e) => {
      const k = e.key.toLowerCase();

      // DevTools shortcuts
      if (e.key === 'F12') { 
        e.preventDefault(); 
        report('KEYBOARD_SHORTCUT', 'F12 blocked'); 
        return; }
      if (e.ctrlKey && e.shiftKey && ['i','j','c'].includes(k)) {
        e.preventDefault(); 
        report('KEYBOARD_SHORTCUT', `Ctrl+Shift+${e.key} blocked`); 
        return;
      }
      // Copy/paste/view-source
      if (e.ctrlKey && ['c','v','x','u','a','s'].includes(k)) {
        e.preventDefault(); 
        notify("Keyboard shortcuts are not allowed during the exam");
        //report('KEYBOARD_SHORTCUT', `Ctrl+${e.key} blocked`); 
        return;
      }
      // ESC: prevent default to suppress fullscreen exit key in some browsers
      if (e.key === 'Escape') 
        {
           e.preventDefault();
           notify("Exiting fullscreen mode is not allowed during the exam");
          //report('KEYBOARD_SHORTCUT', 'Escape key blocked');
        }
      // Alt+Tab (only detectable if window is still focused)
      if (e.altKey && e.key === 'Tab') 
        { 
          e.preventDefault(); report('KEYBOARD_SHORTCUT', 'Alt+Tab blocked'); 
        }
    };

    // ── MOUSE LEAVE ─────────────────────────────────────────────
    // Debounced 2s — moving the mouse off the page momentarily is common
    const onMouseLeave = () => {
      mouseLeaveTimerRef.current = setTimeout(() => {
        report('MOUSE_LEAVE', 'Mouse left the document window');
      }, 2000);
    };
    const onMouseEnter = () => {
      if (mouseLeaveTimerRef.current) {
        clearTimeout(mouseLeaveTimerRef.current);
        mouseLeaveTimerRef.current = null;
      }
    };

    // ── DEVTOOLS DETECTION (size heuristic, every 3s) ──────────
    const checkDevtools = () => {
      const widthDiff  = window.outerWidth  - window.innerWidth;
      const heightDiff = window.outerHeight - window.innerHeight;
      const threshold  = 160; // pixels — typical docked DevTools panel width/height
      if (widthDiff > threshold || heightDiff > threshold) {
        report('DEVTOOLS_OPEN', `DevTools heuristic: w+${widthDiff} h+${heightDiff}`);
      }
    };
    devtoolsCheckRef.current = setInterval(checkDevtools, 3000);
  
    // ── REGISTER ALL LISTENERS ─────────────────────────────────
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('copy',  onCopy);
    document.addEventListener('cut',   onCut);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('mouseenter', onMouseEnter);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('copy',  onCopy);
      document.removeEventListener('cut',   onCut);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('mouseenter', onMouseEnter);
      if (devtoolsCheckRef.current) clearInterval(devtoolsCheckRef.current);
      if (mouseLeaveTimerRef.current) clearTimeout(mouseLeaveTimerRef.current);
    };
  }, [enabled, report, notify]);
}
