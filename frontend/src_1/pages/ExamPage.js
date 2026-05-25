import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { startExam, saveAnswers, submitExam } from '../api/attemptApi';
import useTimer from '../hooks/useTimer';
import useViolationDetector from '../hooks/useViolationDetector';
import Spinner from '../components/Spinner';
import BrandLogo from '../components/BrandLogo';

const STATUS = {
  NOT_VISITED:     { bg: '#cbd5e1', color: '#334155', label: 'Not Visited' },
  NOT_ANSWERED:    { bg: '#ef4444', color: '#fff',    label: 'Not Answered' },
  ANSWERED:        { bg: '#22c55e', color: '#fff',    label: 'Answered' },
  MARKED:          { bg: '#f97316', color: '#fff',    label: 'Marked for Review' },
  ANSWERED_MARKED: { bg: '#8b5cf6', color: '#fff',    label: 'Answered & Marked' },
};

function getStatus(qId, answers, visited, marked) {
  const ans = answers[String(qId)];
  const isMarked   = marked.includes(qId);
  const isAnswered = ans !== undefined && ans !== -1;
  const isVisited  = visited.has(qId);
  if (!isVisited) return 'NOT_VISITED';
  if (isAnswered && isMarked) return 'ANSWERED_MARKED';
  if (isMarked)   return 'MARKED';
  if (isAnswered) return 'ANSWERED';
  return 'NOT_ANSWERED';
}

/* ─────────────────────────────────────────────────────────────────
   Fullscreen Warning Modal
   Shown when the student exits fullscreen. Displays a countdown
   and prompts them to re-enter. If they do not re-enter within
   graceSeconds the exam is auto-submitted by the backend.
───────────────────────────────────────────────────────────────── */
function FullscreenWarningModal({ exitsRemaining, graceSeconds, onReturnToFullscreen }) {
  const [countdown, setCountdown] = useState(graceSeconds);

  useEffect(() => {
    setCountdown(graceSeconds);
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [graceSeconds]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 40, maxWidth: 460, width: '90%',
        textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,0.5)'
      }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>⚠️</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, color: '#b45309' }}>
          Fullscreen Exited
        </h2>
        <p style={{ color: '#6b7280', marginBottom: 6, lineHeight: 1.6 }}>
          You have exited fullscreen mode. This has been recorded as a violation.
        </p>
        {exitsRemaining > 0 ? (
          <p style={{ color: '#dc2626', fontWeight: 700, marginBottom: 24 }}>
            {exitsRemaining} warning(s) remaining before auto-submit.
          </p>
        ) : (
          <p style={{ color: '#dc2626', fontWeight: 700, marginBottom: 24 }}>
            No more warnings — exam will auto-submit.
          </p>
        )}
        <div style={{
          fontSize: 48, fontWeight: 800, fontFamily: 'monospace',
          color: countdown <= 5 ? '#dc2626' : '#1e3a5f', marginBottom: 24
        }}>
          {String(countdown).padStart(2, '0')}s
        </div>
        <button
          onClick={onReturnToFullscreen}
          style={{
            width: '100%', padding: '13px', background: '#1e3a5f', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: 'pointer'
          }}>
          🔲 Return to Fullscreen
        </button>
        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 12 }}>
          Click the button above or the exam will continue to record violations.
        </p>
      </div>
    </div>
  );
}

export default function ExamPage() {
  const { examId } = useParams();
  const navigate   = useNavigate();
  const { user }   = useAuth();

  const [session,     setSession]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [currentIdx,  setCurrentIdx]  = useState(0);
  const [answers,     setAnswers]     = useState({});
  const [marked,      setMarked]      = useState([]);
  const [visited,     setVisited]     = useState(new Set());
  const [activeSection, setActiveSection] = useState(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [snackbar,    setSnackbar]    = useState('');
  const [imageModalSrc, setImageModalSrc] = useState(null);
  const [imageModalZoomed, setImageModalZoomed] = useState(false);

  /* ── FULLSCREEN STATE ────────────────────────────────────────── */
  const [fsWarning,   setFsWarning]   = useState(null);  // { graceSeconds, exitsRemaining }
  const fsWarningRef  = useRef(false);                   // prevents double-modal

  const autoSaveRef = useRef(null);
  const snackbarTimerRef = useRef(null);
  const redirectTimerRef = useRef(null);
  const latestAnswersRef = useRef({});
  const latestMarkedRef = useRef([]);
  const saveChainRef = useRef(Promise.resolve());
  const startedRef    = useRef(false);

  const showSnackbar = useCallback((message) => {
    if (!message) return;
    setSnackbar(message);
  }, []);

  const queueSaveAnswers = useCallback(async (attemptId, payload) => {
    if (!attemptId) return;

    const runSave = async () => {
      await saveAnswers(attemptId, payload);
    };

    const next = saveChainRef.current.then(runSave, runSave);
    saveChainRef.current = next.catch(() => {});
    return next;
  }, []);

  /* ── LOAD SESSION ───────────────────────────────────────────── */
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    startExam(examId)
      .then(res => {
        const s = res.data.data || res.data;
        setSession(s);
        if (s.savedAnswers)  setAnswers(s.savedAnswers);
        if (s.markedForReview) setMarked(s.markedForReview);
        if (s.sections)      setActiveSection(Object.keys(s.sections)[0]);
        setVisited(new Set());
      })
      .catch(err => {
        // Release stale lock if backend rejects start (e.g. already submitted).
        localStorage.removeItem('exam_active');
        setError(err.response?.data?.message || 'Failed to start exam.');
      })
      .finally(() => setLoading(false));
  }, [examId]);

  /* ── ENTER FULLSCREEN ON SESSION LOAD ───────────────────────── */
  useEffect(() => {
    if (!session) return;
    const enter = async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
      } catch (e) { /* browser may deny on first load without user gesture */ }
    };
    enter();
  }, [session]);

  /* ── SUBMIT ──────────────────────────────────────────────────── */
  const doSubmit = useCallback(async () => {
    if (!session || submitting || submitted) return;
    setSubmitting(true);
    try {
      await queueSaveAnswers(session.attemptId, {
        answers: { ...latestAnswersRef.current },
        markedForReview: [...latestMarkedRef.current]
      });
      await submitExam(session.attemptId);
      localStorage.removeItem('exam_active');
      // Exit fullscreen cleanly on submit
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      }
      setSubmitted(true);
      redirectTimerRef.current = setTimeout(() => {
        navigate('/student');
      }, 5000);
    } catch (err) {
      setError('Submission failed: ' + (err.response?.data?.message || 'Please try again.'));
      setSubmitting(false);
    }
  }, [session, submitting, submitted, navigate, queueSaveAnswers]);

  /* ── FULLSCREEN EXIT CALLBACK (from violation detector) ──────── */
  const handleFullscreenExit = useCallback((data) => {
    // data = { graceSeconds, exitsRemaining, autoSubmitted, fullscreenExitCount, ... }
    if (data.autoSubmitted) {
      // Backend auto-submitted — no modal needed, just redirect
      doSubmit();
      return;
    }
    if (fsWarningRef.current) return; // don't stack modals
    fsWarningRef.current = true;
    setFsWarning({ graceSeconds: data.graceSeconds, exitsRemaining: data.exitsRemaining });
  }, [doSubmit]);

  /* ── RETURN TO FULLSCREEN (from modal button) ─────────────────── */
  const handleReturnFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {}
    setFsWarning(null);
    fsWarningRef.current = false;
  }, []);

  const openImageModal = useCallback((src, e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    setImageModalSrc(src);
    setImageModalZoomed(true);
  }, []);
  const closeImageModal = useCallback(() => setImageModalSrc(null), []);
  useEffect(() => { if (!imageModalSrc) setImageModalZoomed(false); }, [imageModalSrc]);

  useEffect(() => {
    if (!imageModalSrc) return;
    const onKey = (ev) => { if (ev.key === 'Escape') closeImageModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageModalSrc, closeImageModal]);

  const handleBackToDashboard = useCallback(() => {
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    navigate('/student');
  }, [navigate]);

  useEffect(() => {
    latestAnswersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    latestMarkedRef.current = marked;
  }, [marked]);

  useEffect(() => {
    if (!snackbar) return;
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    snackbarTimerRef.current = setTimeout(() => setSnackbar(''), 2200);
    return () => {
      if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    };
  }, [snackbar]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  /* ── PREVENT REFRESH / BACK ─────────────────────────────────── */
  useEffect(() => {
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, []);

  /* ── MARK VISITED ────────────────────────────────────────────── */
  useEffect(() => {
    if (session?.questions?.[currentIdx]) {
      setVisited(prev => new Set([...prev, session.questions[currentIdx].id]));
    }
  }, [currentIdx, session]);

  /* ── AUTO-SAVE ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!session) return;
    autoSaveRef.current = setInterval(async () => {
      try {
        await queueSaveAnswers(session.attemptId, {
          answers: { ...latestAnswersRef.current },
          markedForReview: [...latestMarkedRef.current]
        });
      } catch (e) {}
    }, 30000);
    return () => clearInterval(autoSaveRef.current);
  }, [session, queueSaveAnswers]);

  const { format, isWarning, isCritical } = useTimer(
    session ? session.timeRemainingSeconds : null,
    doSubmit
  );

  /* ── VIOLATION DETECTOR ─────────────────────────────────────── */
  useViolationDetector(
    session?.attemptId,
    !!session,
    doSubmit,           // onAutoSubmit (hard violations)
    handleFullscreenExit, // onFullscreenExit (grace modal)
    showSnackbar
  );

  const handleAnswer = (qId, optIdx) =>
    setAnswers(prev => {
      const next = { ...prev, [String(qId)]: optIdx };
      latestAnswersRef.current = next;
      return next;
    });

  const handleMark = (qId) =>
    setMarked(prev => {
      const next = prev.includes(qId) ? prev.filter(x => x !== qId) : [...prev, qId];
      latestMarkedRef.current = next;
      return next;
    });

  const handleClear = (qId) =>
    setAnswers(prev => {
      const next = { ...prev };
      delete next[String(qId)];
      latestAnswersRef.current = next;
      return next;
    });

  const getSectionQuestions = () => {
    if (!session || !activeSection) return Array.from({length: session?.questions?.length || 0}, (_,i) => i);
    return session.sections[activeSection] || [];
  };

  /* ── LOADING / ERROR ─────────────────────────────────────────── */
  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div style={{ textAlign:'center' }}><Spinner size={40} />
        <p style={{ marginTop:16, color:'var(--text-muted)' }}>Loading exam session...</p>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, padding:40, maxWidth:480, textAlign:'center', boxShadow:'var(--shadow-md)' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
        <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Cannot Load Exam</h2>
        <p style={{ color:'var(--text-muted)', marginBottom:24 }}>{error}</p>
        <button onClick={() => { localStorage.removeItem('exam_active'); navigate('/student'); }}
          style={{ padding:'10px 24px', background:'var(--primary)', color:'#fff', border:'none', borderRadius:6, fontWeight:600, cursor:'pointer' }}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );

  if (!session) return null;

  if (submitted) return (
    <div style={{ minHeight:'100vh', background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ textAlign:'center', maxWidth:480, width:'100%' }}>
        <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
        <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Answers Recorded</h2>
        <p style={{ color:'var(--text-muted)', marginBottom:20 }}>
          Your answers have been recorded. You can return to your dashboard now.
        </p>
        <button
          onClick={handleBackToDashboard}
          style={{ padding:'10px 20px', background:'var(--primary)', color:'#fff', border:'none', borderRadius:6, fontWeight:600, cursor:'pointer' }}
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );

  if (!session.questions?.length) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, padding:40, maxWidth:520, textAlign:'center', boxShadow:'var(--shadow-md)' }}>
        <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>No Questions Available</h2>
        <p style={{ color:'var(--text-muted)', marginBottom:24 }}>
          This exam session has no questions assigned. Please contact your instructor.
        </p>
        <button onClick={() => { localStorage.removeItem('exam_active'); navigate('/student'); }}
          style={{ padding:'10px 24px', background:'var(--primary)', color:'#fff', border:'none', borderRadius:6, fontWeight:600, cursor:'pointer' }}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );

  const q = session.questions[currentIdx];
  const hasCombinedOptionIllustration = !!q.hasCombinedOptionImage;
  const questionIllustrationSrc = q.hasQuestionImage ? `/questions/${q.id}/image` : null;
  const optionIllustrationSrc = hasCombinedOptionIllustration
    ? `/questions/${q.id}/combined-option-image`
    : null;
  const questionText = (q.questionText || '').trim();
  const isCodeLike = (() => {
    if (!questionText) return false;
    const t = String(questionText);
    const hasLineBreaks = t.includes('\n') || t.includes('\r');
    const hasCodePunctuation = /[{};]|->|::/.test(t) || /\([^\)]*\)/.test(t);
    const hasCodeKeywords = /\b(if|else|for|while|return|def|class|function|public|private|static|switch|case)\b/.test(t);
    return hasLineBreaks || (hasCodePunctuation && hasCodeKeywords) || /\b#include\b/.test(t);
  })();
  const isQuestionTextBlank =
    questionText === '' ||
    questionText === 'Image-based question' ||
    questionText === 'Question:';
  const f = format ? format() : { h:'00', m:'00', s:'00' };
  const sectionNames = session.sectionOrder || (session.sections ? Object.keys(session.sections) : []);

  return (
    <div style={{ height:'100vh', background:'#f1f5f9', display:'flex', flexDirection:'column', userSelect:'none', overflow:'hidden' }}>

      {/* FULLSCREEN WARNING MODAL */}
      {fsWarning && (
        <FullscreenWarningModal
          exitsRemaining={fsWarning.exitsRemaining}
          graceSeconds={fsWarning.graceSeconds}
          onReturnToFullscreen={handleReturnFullscreen}
        />
      )}


      {/* TOP BAR */}
      <div style={{ background:'#1e3a5f', color:'#fff', height:52, display:'flex', alignItems:'center', padding:'0 20px', justifyContent:'space-between', flexShrink:0, zIndex:100 }}>
        <div style={{ fontWeight:700, fontSize:15, maxWidth:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {session.examTitle}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.1)', padding:'6px 14px', borderRadius:6 }}>
            <span style={{ fontSize:14 }}>⏱</span>
            <span style={{ fontFamily:'monospace', fontSize:18, fontWeight:700, letterSpacing:2,
              color: isCritical ? '#fca5a5' : isWarning ? '#fcd34d' : '#fff' }}>
              {f.h}:{f.m}:{f.s}
            </span>
          </div>
          <button onClick={() => setShowConfirm(true)} disabled={submitting}
            style={{ padding:'7px 18px', background:'#e11d48', color:'#fff', border:'none', borderRadius:6, fontWeight:700, cursor:'pointer', fontSize:13 }}>
            Submit Test
          </button>
        </div>
      </div>

      {/* MAIN BODY */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* LEFT PANEL */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0, minHeight:0 }}>

          {/* Question header */}
          <div style={{ background:'#e2e8f0', padding:'10px 20px', borderBottom:'1px solid #cbd5e1', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontWeight:700, fontSize:14, color:'#334155' }}>
                Question {currentIdx + 1} of {session.questions.length}
              </span>
              <div style={{ display:'flex', gap:8 }}>
                <span style={{ background:'#dcfce7', color:'#166534', padding:'3px 10px', borderRadius:4, fontSize:12, fontWeight:700 }}>
                  +{q.marks}
                </span>
                {q.negativeMarks > 0 && (
                  <span style={{ background:'#fee2e2', color:'#991b1b', padding:'3px 10px', borderRadius:4, fontSize:12, fontWeight:700 }}>
                    -{q.negativeMarks}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Question text + options */}
          <div style={{ flex:1, overflowY:'auto', padding:24 }}>
            <div style={{ background:'#fff', borderRadius:10, padding:24, marginBottom:16, boxShadow:'var(--shadow-sm)' }}>
              {isQuestionTextBlank && (
                <div style={{ fontSize:14, fontWeight:700, color:'var(--text-secondary)', marginBottom:8 }}>
                  Question:
                </div>
              )}

              {questionIllustrationSrc && (
                <div style={{ marginBottom: 14 }}>
                  <img
                    src={questionIllustrationSrc}
                    alt="Question illustration"
                    draggable={false}
                    onMouseDown={e => e.preventDefault()}
                    onClick={e => openImageModal(questionIllustrationSrc, e)}
                    onContextMenu={e => e.preventDefault()}
                    style={{ maxWidth:'100%', maxHeight:320, objectFit:'contain', borderRadius:6,
                      display:'block', border:'1px solid var(--border)', background:'#fff' }}
                  />
                </div>
              )}

              {/* Question text (may be empty when image alone is used) */}
              {!isQuestionTextBlank && (
                <p style={{
                  fontSize:15,
                  lineHeight:1.7,
                  color:'var(--text-primary)',
                  fontWeight:500,
                  margin:0,
                  whiteSpace:'pre-wrap',
                  wordBreak:'break-word',
                  fontFamily: isCodeLike ? 'Consolas, "Courier New", monospace' : 'inherit',
                  background: isCodeLike ? '#f8fafc' : 'transparent',
                  border: isCodeLike ? '1px solid var(--border)' : 'none',
                  borderRadius: isCodeLike ? 6 : 0,
                  padding: isCodeLike ? '10px 12px' : 0
                }}>
                  {questionText}
                </p>
              )}

              {/* Combined option image shown below the question */}
              {optionIllustrationSrc && (
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--text-secondary)', marginBottom:8 }}>
                    Options:
                  </div>
                  <img
                    src={optionIllustrationSrc}
                    alt="Options"
                    draggable={false}
                    onMouseDown={e => e.preventDefault()}
                    onClick={e => openImageModal(optionIllustrationSrc, e)}
                    onContextMenu={e => e.preventDefault()}
                    style={{ maxWidth:'100%', maxHeight:420, objectFit:'contain', borderRadius:6,
                      display:'block', border:'1px solid var(--border)', background:'#fff' }}
                  />
                </div>
              )}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {q.options.map((opt, i) => {
                const selected = answers[String(q.id)] === i;
                const hasOptImg = q.optionHasImage && q.optionHasImage[i];
                return (
                  <div key={i} onClick={() => handleAnswer(q.id, i)}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                      background: selected ? '#eff6ff' : '#fff',
                      border:'2px solid '+(selected ? 'var(--primary)' : 'var(--border)'),
                      borderRadius:8, cursor:'pointer', transition:'border-color 0.1s, background 0.1s' }}>
                    {/* Radio indicator */}
                    <div style={{ width:22, height:22, borderRadius:'50%', flexShrink:0,
                      border:'2px solid '+(selected?'var(--primary)':'#cbd5e1'),
                      background:selected?'var(--primary)':'#fff',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {selected && <div style={{ width:8, height:8, borderRadius:'50%', background:'#fff' }} />}
                    </div>
                    {/* Option label */}
                    <span style={{ fontSize:13, fontWeight:600, color:'var(--text-muted)', minWidth:18 }}>
                      {String.fromCharCode(65+i)}.
                    </span>
                    {/* Option content: image and/or text */}
                    <div style={{ flex:1 }}>
                      {hasOptImg && (
                        <img
                          src={`/questions/${q.id}/option-image/${i}`}
                          alt={`Option ${String.fromCharCode(65+i)}`}
                          draggable={false}
                          onMouseDown={e => e.preventDefault()}
                          onClick={e => openImageModal(`/questions/${q.id}/option-image/${i}`, e)}
                          onContextMenu={e => e.preventDefault()}
                          style={{ maxWidth:'100%', maxHeight:280, objectFit:'contain', borderRadius:4,
                            display:'block', marginBottom: opt ? 6 : 0, border:'1px solid var(--border)' }}
                        />
                      )}
                      {opt && (
                        <span style={{ fontSize:14, color:'var(--text-primary)', lineHeight:1.5 }}>{opt}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom nav */}
          <div style={{ background:'#fff', borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => handleMark(q.id)}
                style={{ padding:'8px 16px',
                  border:'1px solid '+(marked.includes(q.id)?'#f97316':'var(--border)'),
                  background:marked.includes(q.id)?'#fff7ed':'#fff',
                  color:marked.includes(q.id)?'#f97316':'var(--text-secondary)',
                  borderRadius:6, cursor:'pointer', fontWeight:600, fontSize:13 }}>
                {marked.includes(q.id) ? '🔖 Unmark' : '🔖 Mark for Review'}
              </button>
              <button onClick={() => handleClear(q.id)}
                style={{ padding:'8px 16px', border:'1px solid var(--border)', background:'#fff',
                  color:'var(--text-secondary)', borderRadius:6, cursor:'pointer', fontWeight:600, fontSize:13 }}>
                ✕ Clear
              </button>
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setCurrentIdx(i => Math.max(0, i-1))} disabled={currentIdx===0}
                style={{ padding:'8px 18px', border:'1px solid var(--border)', background:'#fff',
                  color:'var(--text-secondary)', borderRadius:6, cursor:'pointer', fontWeight:600, fontSize:13,
                  opacity:currentIdx===0?0.4:1 }}>
                ← Prev
              </button>
              <button onClick={() => setCurrentIdx(i => Math.min(session.questions.length-1, i+1))}
                disabled={currentIdx===session.questions.length-1}
                style={{ padding:'8px 18px', background:'var(--primary)', color:'#fff', border:'none',
                  borderRadius:6, cursor:'pointer', fontWeight:600, fontSize:13,
                  opacity:currentIdx===session.questions.length-1?0.5:1 }}>
                Next →
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ width:260, background:'#fff', borderLeft:'1px solid var(--border)', display:'flex', flexDirection:'column', flexShrink:0, minHeight:0 }}>

          {/* Candidate info */}
          <div style={{ padding:'14px 16px', background:'#1e3a5f', color:'#fff' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:38, height:38, borderRadius:'50%', background:'rgba(255,255,255,0.2)',
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>
                👤
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:13 }}>{user?.fullName || 'Candidate'}</div>
                <div style={{ fontSize:11, opacity:0.7 }}>Student</div>
              </div>
            </div>
          </div>

          {/* Section tabs */}
          {sectionNames.length > 1 && (
            <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)', background:'#f8fafc' }}>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {sectionNames.map(s => (
                  <button key={s} onClick={() => setActiveSection(s)}
                    style={{ padding:'4px 10px', borderRadius:4,
                      border:'1px solid '+(activeSection===s?'var(--primary)':'var(--border)'),
                      background:activeSection===s?'var(--primary-light)':'#fff',
                      color:activeSection===s?'var(--primary)':'var(--text-secondary)',
                      fontWeight:600, fontSize:11, cursor:'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)', display:'flex', flexWrap:'wrap', gap:5 }}>
            {Object.entries(STATUS).map(([k, v]) => (
              <div key={k} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                <div style={{ width:12, height:12, borderRadius:2, background:v.bg, border:'1px solid rgba(0,0,0,0.1)', flexShrink:0 }} />
                <span style={{ fontSize:10, color:'var(--text-muted)' }}>{v.label}</span>
              </div>
            ))}
          </div>

          {/* Question number grid */}
          <div style={{ flex:1, overflowY:'auto', padding:12, minHeight:0 }}>
            {/* Section label */}
            {sectionNames.length > 1 && (
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', marginBottom:8, textTransform:'uppercase', letterSpacing:0.5 }}>
                {activeSection}
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:5 }}>
              {getSectionQuestions().map((idx, posInSection) => {
                const iq = session.questions[idx];
                if (!iq) return null;
                const statusKey = getStatus(iq.id, answers, visited, marked);
                const s = STATUS[statusKey];
                const isCurrent = idx === currentIdx;
                return (
                  <button key={idx} onClick={() => setCurrentIdx(idx)}
                    style={{ aspectRatio:'1', background:s.bg, color:s.color,
                      border:isCurrent?'2px solid #1e3a5f':'2px solid transparent',
                      borderRadius:6, fontWeight:700, fontSize:12, cursor:'pointer',
                      outline:isCurrent?'2px solid #93c5fd':'none', outlineOffset:1 }}>
                    {/* Per-section numbering: 1,2,3,... within each section */}
                    {posInSection + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary counts */}
          <div style={{ padding:'10px 12px', borderTop:'1px solid var(--border)', background:'#f8fafc' }}>
            {Object.entries(STATUS).map(([k, v]) => {
              const count = session.questions.filter((_, i) =>
                getStatus(session.questions[i].id, answers, visited, marked) === k).length;
              return count > 0 ? (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'2px 0' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:9, height:9, borderRadius:2, background:v.bg, flexShrink:0 }} />
                    <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{v.label}</span>
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color:'var(--text-primary)' }}>{count}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      </div>

      {/* Image modal lightbox (no focus change) */}
      {imageModalSrc && (
        <div onClick={closeImageModal} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div style={{ position:'absolute', top:18, right:18, zIndex:10000 }}>
            <button onClick={closeImageModal} style={{ background:'rgba(0,0,0,0.6)', color:'#fff', border:'none', padding:'8px 10px', borderRadius:6, cursor:'pointer', fontSize:16 }}>✕</button>
          </div>
          <img
            src={imageModalSrc}
            alt="Preview"
            onClick={e => { e.stopPropagation(); setImageModalZoomed(z => !z); }}
            style={{
              width: imageModalZoomed ? 'min(68vw, 700px)' : 'min(44vw, 460px)',
              maxWidth: 'none',
              height: 'auto',
              maxHeight: '76vh',
              borderRadius:8,
              boxShadow:'0 30px 80px rgba(0,0,0,0.6)',
              cursor:'zoom-in',
              transition:'width 180ms ease'
            }}
          />
        </div>
      )}

      {/* CONFIRM SUBMIT MODAL */}
      {showConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:32, maxWidth:440, width:'90%', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Submit Exam?</h2>
            <p style={{ color:'var(--text-muted)', marginBottom:20, lineHeight:1.6 }}>
              You are about to submit your exam. This action cannot be undone.
            </p>
            <div style={{ background:'var(--bg-panel)', borderRadius:8, padding:14, marginBottom:20 }}>
              {Object.entries(STATUS).map(([k, v]) => {
                const count = session.questions.filter((_, i) =>
                  getStatus(session.questions[i].id, answers, visited, marked) === k).length;
                return count > 0 ? (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border-light)' }}>
                    <span style={{ fontSize:13, color:'var(--text-secondary)' }}>{v.label}</span>
                    <span style={{ fontSize:13, fontWeight:700 }}>{count}</span>
                  </div>
                ) : null;
              })}
            </div>
            <div style={{ display:'flex', gap:12 }}>
              <button onClick={() => setShowConfirm(false)}
                style={{ flex:1, padding:'11px', border:'1px solid var(--border)', borderRadius:6, background:'#fff', fontWeight:600, cursor:'pointer', fontSize:14 }}>
                Continue Exam
              </button>
              <button onClick={() => { setShowConfirm(false); doSubmit(); }} disabled={submitting}
                style={{ flex:1, padding:'11px', background:'#e11d48', color:'#fff', border:'none', borderRadius:6, fontWeight:700, cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {submitting ? <Spinner size={16} color="#fff" /> : null}
                {submitting ? 'Submitting...' : 'Submit Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {snackbar && (
        <div style={{
          position:'fixed',
          left:'50%',
          bottom:20,
          transform:'translateX(-50%)',
          background:'rgba(15,23,42,0.95)',
          color:'#fff',
          padding:'10px 14px',
          borderRadius:8,
          fontSize:13,
          fontWeight:600,
          zIndex:10001,
          boxShadow:'0 8px 24px rgba(0,0,0,0.25)'
        }}>
          {snackbar}
        </div>
      )}
    </div>
  );
}