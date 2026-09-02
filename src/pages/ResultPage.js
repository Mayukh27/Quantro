import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getResult, downloadResultPdf } from '../api/attemptApi';
import Spinner from '../components/Spinner';

export default function ResultPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [breakdown, setBreakdown] = useState({});
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    const load = () => {
      getResult(attemptId)
        .then(res => {
          const r = res.data.data;
          setResult(r);
          if (r.subjectWiseBreakdown) {
            try { setBreakdown(JSON.parse(r.subjectWiseBreakdown)); } catch(e) {}
          }
          setLoading(false);
        })
        .catch(err => {
          if (err.response?.status === 400 || err.response?.status === 404) {
            setTimeout(load, 3000);
          } else {
            setError(err.response?.data?.message || 'Failed to load result.');
            setLoading(false);
          }
        });
    };
    load();
  }, [attemptId]);

  /* ── PDF DOWNLOAD ────────────────────────────────────────────── */
  const handleDownloadPdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      const res = await downloadResultPdf(attemptId);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `result_attempt_${attemptId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('PDF download failed: ' + (err.response?.data?.message || 'Please try again.'));
    } finally {
      setPdfLoading(false);
    }
  }, [attemptId]);

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div style={{ textAlign:'center' }}>
        <Spinner size={40} />
        <p style={{ marginTop:16, color:'var(--text-muted)' }}>Evaluating your answers...</p>
        <p style={{ marginTop:6, fontSize:12, color:'var(--text-muted)' }}>This may take a few seconds.</p>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, padding:40, maxWidth:480, textAlign:'center', boxShadow:'var(--shadow-md)' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>❌</div>
        <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Result Unavailable</h2>
        <p style={{ color:'var(--text-muted)', marginBottom:24 }}>{error}</p>
        <button onClick={() => navigate('/student')}
          style={{ padding:'10px 24px', background:'var(--primary)', color:'#fff', border:'none', borderRadius:6, fontWeight:600, cursor:'pointer' }}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );

  const pct = result.totalQuestions > 0
    ? Math.round((result.correct / result.totalQuestions) * 100) : 0;
  const scoreColor = pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', padding:'32px 20px' }}>
      <div style={{ maxWidth:800, margin:'0 auto' }}>

        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:72, height:72,
            background: pct >= 50 ? '#dcfce7' : '#fef2f2', borderRadius:'50%', marginBottom:16 }}>
            <span style={{ fontSize:36 }}>{pct >= 50 ? '🏆' : '📋'}</span>
          </div>
          <h1 style={{ fontSize:28, fontWeight:700, marginBottom:6 }}>Exam Result</h1>
          <p style={{ color:'var(--text-muted)' }}>Attempt #{attemptId}</p>
          {user?.studentYear && (
            <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:4 }}>Batch Year: {user.studentYear}</p>
          )}
        </div>

        {/* Score card */}
        <div style={{ background:'#fff', borderRadius:12, boxShadow:'var(--shadow-md)', padding:32, marginBottom:24, textAlign:'center' }}>
          <div style={{ fontSize:56, fontWeight:800, color:scoreColor, marginBottom:4 }}>
            {result.totalScore?.toFixed(2) ?? '0'}
          </div>
          <div style={{ fontSize:16, color:'var(--text-muted)', marginBottom:24 }}>Total Score</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:16, marginBottom:28 }}>
            {[
              { label:'Correct',     val:result.correct,         color:'var(--success)', bg:'#f0fdf4' },
              { label:'Wrong',       val:result.wrong,           color:'var(--danger)',  bg:'#fef2f2' },
              { label:'Unattempted', val:result.unattempted,     color:'var(--text-muted)', bg:'var(--bg-panel)' },
              { label:'Total',       val:result.totalQuestions,  color:'var(--primary)', bg:'var(--primary-light)' },
            ].map(stat => (
              <div key={stat.label} style={{ background:stat.bg, borderRadius:10, padding:'16px 8px' }}>
                <div style={{ fontSize:28, fontWeight:800, color:stat.color }}>{stat.val ?? 0}</div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4, fontWeight:600 }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* PDF DOWNLOAD BUTTON */}
          <button
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            style={{
              display:'inline-flex', alignItems:'center', gap:8,
              padding:'11px 28px', background:'#1e3a5f', color:'#fff',
              border:'none', borderRadius:8, fontWeight:700, fontSize:14, cursor:'pointer',
              opacity: pdfLoading ? 0.7 : 1
            }}>
            {pdfLoading ? <Spinner size={16} color="#fff" /> : <span>⬇</span>}
            {pdfLoading ? 'Generating PDF...' : 'Download Result as PDF'}
          </button>
        </div>

        {/* Subject breakdown */}
        {Object.keys(breakdown).length > 0 && (
          <div style={{ background:'#fff', borderRadius:12, boxShadow:'var(--shadow-sm)', overflow:'hidden', marginBottom:24 }}>
            <div style={{ padding:'16px 24px', borderBottom:'1px solid var(--border)', background:'var(--bg-panel)' }}>
              <h3 style={{ fontSize:16, fontWeight:700 }}>Subject-wise Breakdown</h3>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ background:'var(--bg-panel)', borderBottom:'1px solid var(--border)' }}>
                    {['Subject','Total','Correct','Wrong','Unattempted','Score'].map(h => (
                      <th key={h} style={{ padding:'12px 16px', textAlign:'left', fontSize:12, fontWeight:700, color:'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(breakdown).map(([subj, data], i) => (
                    <tr key={subj} style={{ borderBottom:'1px solid var(--border-light)', background:i%2?'#fafafa':'#fff' }}>
                      <td style={{ padding:'12px 16px', fontWeight:600, fontSize:13 }}>{subj}</td>
                      <td style={{ padding:'12px 16px', fontSize:13 }}>{data.total ?? 0}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:'var(--success)', fontWeight:600 }}>{data.correct ?? 0}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:'var(--danger)',  fontWeight:600 }}>{data.wrong ?? 0}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:'var(--text-muted)' }}>{data.unattempted ?? 0}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, fontWeight:700,
                        color:(data.score ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {(data.score ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Violation notice */}
        {result.violationSummary && result.violationSummary !== '[]' && (
          <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:10, padding:16, marginBottom:24 }}>
            <h4 style={{ color:'var(--warning)', fontWeight:700, marginBottom:4 }}>⚠️ Proctoring Violations Detected</h4>
            <p style={{ fontSize:13, color:'var(--text-secondary)' }}>
              One or more browser violations were recorded during this exam session.
            </p>
          </div>
        )}

        <div style={{ textAlign:'center' }}>
          <button onClick={() => navigate('/student')}
            style={{ padding:'12px 32px', background:'var(--primary)', color:'#fff', border:'none', borderRadius:8, fontWeight:700, fontSize:15, cursor:'pointer' }}>
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
