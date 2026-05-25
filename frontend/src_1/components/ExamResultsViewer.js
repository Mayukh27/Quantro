import React, { useEffect, useState, useMemo } from 'react';
import { getExamsWithResults, getExamStudentResults, downloadExamStudentResultsExcel, evaluateExamResults } from '../api/adminApi';
import { downloadResultPdf } from '../api/attemptApi';
import Spinner from './Spinner';

/**
 * ExamResultsViewer
 * Reusable component for Admin and Teacher dashboards.
 * Flow: Exam list → click exam → student results table → click row → expand
 *       subject-wise breakdown + full violation log
 */
export default function ExamResultsViewer() {
  const [exams,          setExams]          = useState([]);
  const [selectedExam,   setSelectedExam]   = useState(null);
  const [results,        setResults]        = useState([]);
  const [expandedRow,    setExpandedRow]    = useState(null);
  const [loadingExams,   setLoadingExams]   = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [pdfLoading,     setPdfLoading]     = useState(null); // attemptId being downloaded
  const [excelLoading,   setExcelLoading]   = useState(false);
  const [evaluateLoading, setEvaluateLoading] = useState(false);
  const [filters,        setFilters]        = useState({ search:'', status:'', violations:'', year:'', stream:'', section:'', marks:'' });
  const [error,          setError]          = useState('');
  const [examSearch,     setExamSearch]     = useState('');
  const [examStatus,     setExamStatus]     = useState('');

  /* Load all exams */
  useEffect(() => {
    getExamsWithResults()
      .then(r => setExams(r.data.data || []))
      .catch(() => setError('Failed to load exams.'))
      .finally(() => setLoadingExams(false));
  }, []);

  /* Load student results when an exam is selected */
  const selectExam = (exam) => {
    setSelectedExam(exam);
    setResults([]);
    setExpandedRow(null);
    setFilters({ search:'', status:'', violations:'', year:'', stream:'', section:'', marks:'' });
    setLoadingResults(true);
    getExamStudentResults(exam.id)
      .then(r => setResults(r.data.data || []))
      .catch(() => setError('Failed to load results for this exam.'))
      .finally(() => setLoadingResults(false));
  };

  const refreshResults = async (examId) => {
    setLoadingResults(true);
    try {
      const res = await getExamStudentResults(examId);
      setResults(res.data.data || []);
    } catch (e) {
      setError('Failed to load results for this exam.');
    } finally {
      setLoadingResults(false);
    }
  };

  const handleEvaluateExam = async () => {
    if (!selectedExam) return;
    setEvaluateLoading(true);
    try {
      await evaluateExamResults(selectedExam.id);
      await refreshResults(selectedExam.id);
    } catch (e) {
      setError('Evaluation failed.');
    } finally {
      setEvaluateLoading(false);
    }
  };

  const handleDownloadPdf = async (attemptId) => {
    setPdfLoading(attemptId);
    try {
      const res = await downloadResultPdf(attemptId);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `result_${attemptId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('PDF download failed.');
    } finally {
      setPdfLoading(null);
    }
  };

  const handleDownloadExcel = async () => {
    if (!selectedExam) return;
    setExcelLoading(true);
    try {
      if (hasActiveFilters) {
        const headers = ['Student','Email','Year','Stream','Section','Marks','Correct','Wrong','Unattempted','Violations','Status','Submitted At','Evaluated At'];
        const rows = filteredResults.map(r => {
          const totalV = (r.violationCount || 0) + (r.fullscreenExitCount || 0);
          return {
            Student: r.studentName || '',
            Email: r.studentEmail || '',
            Year: r.studentYear || '',
            Stream: r.studentStream || '',
            Section: r.studentSection || '',
            Marks: r.totalScore?.toFixed(2) ?? '—',
            Correct: r.correct ?? 0,
            Wrong: r.wrong ?? 0,
            Unattempted: r.unattempted ?? 0,
            Violations: totalV,
            Status: r.status ? r.status.replace('_',' ') : '',
            'Submitted At': r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '',
            'Evaluated At': r.evaluatedAt ? new Date(r.evaluatedAt).toLocaleString() : ''
          };
        });
        exportToExcel(rows, headers, `${selectedExam.title || 'exam'}_filtered_results.tsv`);
      } else {
        const res = await downloadExamStudentResultsExcel(selectedExam.id);
        const blob = new Blob(
          [res.data],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedExam.title || 'exam'}_detailed_results.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      alert('Excel download failed.');
    } finally {
      setExcelLoading(false);
    }
  };

  const exportToExcel = (rows, headers, filename) => {
    // Excel opens TSV natively; keep it simple and dependency-free
    const lines = [headers.join('\t'), ...rows.map(r => headers.map(h => {
      const v = r[h] ?? '';
      return String(v).replace(/\t/g, ' ');
    }).join('\t'))];
    const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const years = useMemo(() => [...new Set(results.map(r => r.studentYear).filter(Boolean))].sort(), [results]);
  const streams = useMemo(() => [...new Set(results.map(r => r.studentStream).filter(Boolean))].sort(), [results]);
  const sections = useMemo(() => [...new Set(results.map(r => r.studentSection).filter(Boolean))].sort(), [results]);

  const filteredExams = useMemo(() => {
    const q = examSearch.toLowerCase();
    return exams.filter(e => {
      const matchSearch = !q || [e.title, e.description].some(v => v && v.toLowerCase().includes(q));
      const matchStatus = !examStatus || e.status === examStatus;
      return matchSearch && matchStatus;
    });
  }, [exams, examSearch, examStatus]);

  const parseMarksFilter = (raw) => {
    if (!raw) return null;
    const s = raw.replace(/\s+/g, '');
    const rangeMatch = s.match(/^(\d+(?:\.\d+)?)(?:-|\.\.)(\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      if (Number.isNaN(min) || Number.isNaN(max)) return null;
      const low = Math.min(min, max);
      const high = Math.max(min, max);
      return (v) => v >= low && v <= high;
    }

    const opMatch = s.match(/^(>=|<=|>|<)(\d+(?:\.\d+)?)$/);
    if (opMatch) {
      const op = opMatch[1];
      const val = parseFloat(opMatch[2]);
      if (Number.isNaN(val)) return null;
      return (v) => {
        if (op === '>=') return v >= val;
        if (op === '<=') return v <= val;
        if (op === '>') return v > val;
        if (op === '<') return v < val;
        return true;
      };
    }

    const trailingMatch = s.match(/^(\d+(?:\.\d+)?)(>=|<=|>|<)$/);
    if (trailingMatch) {
      const val = parseFloat(trailingMatch[1]);
      const op = trailingMatch[2];
      if (Number.isNaN(val)) return null;
      // Support "70<" meaning greater than 70, "70>" meaning less than 70.
      return (v) => {
        if (op === '<') return v > val;
        if (op === '>') return v < val;
        if (op === '<=') return v >= val;
        if (op === '>=') return v <= val;
        return true;
      };
    }

    const exact = parseFloat(s);
    if (!Number.isNaN(exact)) return (v) => v === exact;
    return null;
  };

  const filteredResults = useMemo(() => {
    const q = (filters.search || '').toLowerCase();
    const marksPredicate = parseMarksFilter(filters.marks);
    return results.filter(r => {
      const matchSearch = !q || [r.studentName, r.studentEmail]
        .some(v => v && String(v).toLowerCase().includes(q));
      const matchStatus = !filters.status || r.status === filters.status;
      const totalV = (r.violationCount || 0) + (r.fullscreenExitCount || 0);
      const matchViolations = !filters.violations
        || (filters.violations === 'with' && totalV > 0)
        || (filters.violations === 'none' && totalV === 0);
      const matchYear = !filters.year || r.studentYear === filters.year;
      const matchStream = !filters.stream || r.studentStream === filters.stream;
      const matchSection = !filters.section || r.studentSection === filters.section;
      const score = r.totalScore ?? 0;
      const matchMarks = !marksPredicate || marksPredicate(score);
      return matchSearch && matchStatus && matchViolations && matchYear && matchStream && matchSection && matchMarks;
    });
  }, [results, filters]);

  const hasActiveFilters = Boolean(
    filters.search || filters.status || filters.violations || filters.year || filters.stream || filters.section || filters.marks
  );

  const statusBadge = (s) => {
    const map = {
      EVALUATED:     ['#f0fdf4','#166534'],
      SUBMITTED:     ['#eff6ff','#1d4ed8'],
      AUTO_SUBMITTED:['#fef3c7','#92400e'],
      IN_PROGRESS:   ['#f1f5f9','#64748b'],
    };
    const [bg, color] = map[s] || ['#f1f5f9','#64748b'];
    return <span style={{ padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, background:bg, color }}>{s?.replace('_',' ')}</span>;
  };

  const violationBadge = (type) => {
    const colors = {
      TAB_SWITCH:'#fef3c7,#92400e', WINDOW_BLUR:'#fef3c7,#92400e',
      FULLSCREEN_EXIT:'#fffbeb,#b45309', COPY_PASTE:'#fef2f2,#991b1b',
      CONTEXT_MENU:'#fef2f2,#991b1b', KEYBOARD_SHORTCUT:'#fef2f2,#991b1b',
      MOUSE_LEAVE:'#f0f9ff,#0369a1', DEVTOOLS_OPEN:'#fdf4ff,#7e22ce'
    };
    const [bg, color] = (colors[type] || '#f1f5f9,#64748b').split(',');
    return (
      <span key={type} style={{ display:'inline-block', padding:'2px 7px', borderRadius:3, fontSize:11, fontWeight:700, background:bg, color, marginRight:4, marginBottom:3 }}>
        {type?.replace(/_/g,' ')}
      </span>
    );
  };

  const cell = { padding:'12px 14px', fontSize:13, borderBottom:'1px solid var(--border-light)' };
  const hdr  = { padding:'11px 14px', fontSize:12, fontWeight:700, color:'var(--text-secondary)',
                 background:'var(--bg-panel)', borderBottom:'1px solid var(--border)', textAlign:'left' };

  return (
    <div>
      <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>Exam Results</h2>
      <p style={{ color:'var(--text-muted)', marginBottom:24, fontSize:14 }}>
        Select an exam to view all student results with subject-wise breakdown and violation logs.
      </p>

      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'var(--danger)',
          padding:'10px 14px', borderRadius:7, marginBottom:16, fontSize:13 }}>{error}</div>
      )}

      {/* EXAM LIST */}
      {!selectedExam ? (
        loadingExams ? (
          <div style={{ display:'flex', justifyContent:'center', padding:50 }}><Spinner size={36} /></div>
        ) : exams.length === 0 ? (
          <div style={{ background:'#fff', borderRadius:12, padding:48, textAlign:'center', boxShadow:'var(--shadow-sm)' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
            <p style={{ color:'var(--text-muted)' }}>No exams with results yet.</p>
          </div>
        ) : (
          <div>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>
              <input
                placeholder="Search exams..."
                value={examSearch}
                onChange={e => setExamSearch(e.target.value)}
                style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, width:240 }}
              />
              <select
                value={examStatus}
                onChange={e => setExamStatus(e.target.value)}
                style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13 }}
              >
                <option value="">All Status</option>
                {['DRAFT','PUBLISHED','COMPLETED','CANCELLED'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {filteredExams.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:12, padding:40, textAlign:'center', boxShadow:'var(--shadow-sm)' }}>
                <p style={{ color:'var(--text-muted)' }}>No exams match your filters.</p>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:16 }}>
                {filteredExams.map(exam => (
              <div key={exam.id} onClick={() => selectExam(exam)}
                style={{ background:'#fff', borderRadius:10, boxShadow:'var(--shadow-sm)', padding:20,
                  cursor:'pointer', border:'2px solid transparent', transition:'border-color 0.15s',
                  ':hover': { borderColor:'var(--primary)' } }}
                onMouseEnter={e => e.currentTarget.style.borderColor='var(--primary)'}
                onMouseLeave={e => e.currentTarget.style.borderColor='transparent'}>
                <div style={{ fontWeight:700, fontSize:15, marginBottom:6 }}>{exam.title}</div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:10 }}>
                  {exam.durationMinutes} min
                  {exam.scheduledStart && ' · ' + new Date(exam.scheduledStart).toLocaleDateString()}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  {(() => {
                    const map = { DRAFT:['#f5f3ff','#6d28d9'], PUBLISHED:['#f0fdf4','#166534'], COMPLETED:['#f1f5f9','#64748b'] };
                    const [bg,color] = map[exam.status] || ['#f1f5f9','#64748b'];
                    return <span style={{ padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, background:bg, color }}>{exam.status}</span>;
                  })()}
                  <span style={{ fontSize:12, color:'var(--primary)', fontWeight:600 }}>View Results →</span>
                </div>
              </div>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        /* STUDENT RESULTS TABLE */
        <div>
          {/* Back + exam header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:20 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <button onClick={() => { setSelectedExam(null); setResults([]); setExpandedRow(null); setFilters({ search:'', status:'', violations:'', year:'', stream:'', section:'', marks:'' }); }}
              style={{ padding:'7px 14px', border:'1px solid var(--border)', borderRadius:6, background:'#fff',
                color:'var(--text-secondary)', cursor:'pointer', fontWeight:600, fontSize:13 }}>
              ← All Exams
            </button>
            <div>
              <div style={{ fontWeight:700, fontSize:17 }}>{selectedExam.title}</div>
              <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                {filteredResults.length} student{filteredResults.length !== 1 ? 's' : ''} attempted
                {filteredResults.length !== results.length ? ` (of ${results.length})` : ''}
              </div>
            </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <button
                onClick={handleEvaluateExam}
                disabled={loadingResults || evaluateLoading}
                style={{
                  padding:'8px 14px',
                  background:'#0f172a',
                  color:'#fff',
                  border:'none',
                  borderRadius:6,
                  fontWeight:700,
                  fontSize:12,
                  cursor:(loadingResults || evaluateLoading) ? 'not-allowed' : 'pointer',
                  opacity:(loadingResults || evaluateLoading) ? 0.6 : 1
                }}
              >
                {evaluateLoading ? 'Evaluating…' : 'Evaluate Now'}
              </button>
              <button
                onClick={handleDownloadExcel}
                disabled={loadingResults || excelLoading || filteredResults.length === 0}
                style={{
                  padding:'8px 14px',
                  background:'#166534',
                  color:'#fff',
                  border:'none',
                  borderRadius:6,
                  fontWeight:700,
                  fontSize:12,
                  cursor:(loadingResults || excelLoading || filteredResults.length === 0) ? 'not-allowed' : 'pointer',
                  opacity:(loadingResults || excelLoading || filteredResults.length === 0) ? 0.6 : 1
                }}
              >
                {excelLoading ? 'Preparing…' : (hasActiveFilters ? '⬇ Filtered Excel' : '⬇ Detailed Excel')}
              </button>
            </div>
          </div>

          {loadingResults ? (
            <div style={{ display:'flex', justifyContent:'center', padding:50 }}><Spinner size={36} /></div>
          ) : results.length === 0 ? (
            <div style={{ background:'#fff', borderRadius:12, padding:40, textAlign:'center', boxShadow:'var(--shadow-sm)' }}>
              <p style={{ color:'var(--text-muted)', marginBottom:12 }}>No evaluated results for this exam yet.</p>
              <button
                onClick={handleEvaluateExam}
                disabled={evaluateLoading}
                style={{
                  padding:'8px 14px',
                  background:'#0f172a',
                  color:'#fff',
                  border:'none',
                  borderRadius:6,
                  fontWeight:700,
                  fontSize:12,
                  cursor:evaluateLoading ? 'not-allowed' : 'pointer',
                  opacity:evaluateLoading ? 0.6 : 1
                }}
              >
                {evaluateLoading ? 'Evaluating…' : 'Evaluate Now'}
              </button>
            </div>
          ) : (
            <div style={{ background:'#fff', borderRadius:12, boxShadow:'var(--shadow-sm)', overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', background:'#f8fafc', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                  <input
                    placeholder="Search by name or email..."
                    value={filters.search}
                    onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                    style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, width:240 }}
                  />
                  <select
                    value={filters.year}
                    onChange={e => setFilters(f => ({ ...f, year: e.target.value }))}
                    style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13 }}
                  >
                    <option value="">All Years</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select
                    value={filters.stream}
                    onChange={e => setFilters(f => ({ ...f, stream: e.target.value }))}
                    style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13 }}
                  >
                    <option value="">All Streams</option>
                    {streams.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select
                    value={filters.section}
                    onChange={e => setFilters(f => ({ ...f, section: e.target.value }))}
                    style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13 }}
                  >
                    <option value="">All Sections</option>
                    {sections.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select
                    value={filters.status}
                    onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                    style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13 }}
                  >
                    <option value="">All Status</option>
                    {['EVALUATED','SUBMITTED','AUTO_SUBMITTED','IN_PROGRESS'].map(s => (
                      <option key={s} value={s}>{s.replace('_',' ')}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Marks (e.g. >30, 30-70, 70<)"
                    value={filters.marks}
                    onChange={e => setFilters(f => ({ ...f, marks: e.target.value }))}
                    style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, width:200 }}
                  />
                  <select
                    value={filters.violations}
                    onChange={e => setFilters(f => ({ ...f, violations: e.target.value }))}
                    style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13 }}
                  >
                    <option value="">All Violations</option>
                    <option value="with">With violations</option>
                    <option value="none">No violations</option>
                  </select>
                  {hasActiveFilters && (
                    <button
                      onClick={() => setFilters({ search:'', status:'', violations:'', year:'', stream:'', section:'', marks:'' })}
                      style={{ padding:'8px 12px', border:'1px solid var(--border)', borderRadius:6, background:'#fff', color:'var(--text-secondary)', cursor:'pointer', fontWeight:600, fontSize:12 }}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    {['Rank','Student','Email','Year','Stream','Section','Marks','Correct','Wrong','Unattempted','Violations','Status','Actions'].map(h => (
                      <th key={h} style={hdr}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r, idx) => {
                    const isExpanded = expandedRow === r.attemptId;
                    const totalV = (r.violationCount || 0) + (r.fullscreenExitCount || 0);
                    return (
                      <React.Fragment key={r.attemptId}>
                        {/* SUMMARY ROW */}
                        <tr
                          onClick={() => setExpandedRow(isExpanded ? null : r.attemptId)}
                          style={{ cursor:'pointer', background: isExpanded ? '#f0f9ff' : (idx%2?'#fafafa':'#fff'),
                            borderLeft: isExpanded ? '3px solid var(--primary)' : '3px solid transparent' }}>
                          <td style={{...cell, fontWeight:700, color:'var(--primary)', textAlign:'center'}}>{idx+1}</td>
                          <td style={{...cell, fontWeight:600}}>{r.studentName}</td>
                          <td style={{...cell, color:'var(--text-muted)', fontSize:12}}>{r.studentEmail}</td>
                          <td style={{...cell, color:'var(--text-muted)'}}>{r.studentYear || '—'}</td>
                          <td style={{...cell, color:'var(--text-muted)'}}>{r.studentStream || '—'}</td>
                          <td style={{...cell, color:'var(--text-muted)'}}>{r.studentSection || '—'}</td>
                          <td style={{...cell, fontWeight:800,
                            color: r.totalScore >= (r.totalQuestions*0.7) ? 'var(--success)'
                                  : r.totalScore >= (r.totalQuestions*0.4) ? 'var(--warning)' : 'var(--danger)'}}>
                            {r.totalScore?.toFixed(2) ?? '—'}
                          </td>
                          <td style={{...cell, color:'var(--success)', fontWeight:600}}>{r.correct ?? 0}</td>
                          <td style={{...cell, color:'var(--danger)', fontWeight:600}}>{r.wrong ?? 0}</td>
                          <td style={{...cell, color:'var(--text-muted)'}}>{r.unattempted ?? 0}</td>
                          <td style={cell}>
                            {totalV > 0 ? (
                              <span style={{ padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, background:'#fef3c7', color:'#92400e' }}>
                                {totalV} violation{totalV!==1?'s':''}
                              </span>
                            ) : (
                              <span style={{ color:'var(--text-muted)', fontSize:12 }}>None</span>
                            )}
                          </td>
                          <td style={cell}>{statusBadge(r.status)}</td>
                          <td style={cell}>
                            <div style={{ display:'flex', gap:6 }}>
                              <span style={{ fontSize:12, color:'var(--primary)', fontWeight:600 }}>
                                {isExpanded ? '▲ Hide' : '▼ Details'}
                              </span>
                              <button
                                onClick={e => { e.stopPropagation(); handleDownloadPdf(r.attemptId); }}
                                disabled={pdfLoading===r.attemptId}
                                style={{ padding:'3px 10px', background:'#1e3a5f', color:'#fff', border:'none',
                                  borderRadius:4, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                                {pdfLoading===r.attemptId ? '…' : '⬇ PDF'}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* EXPANDED DETAIL ROW */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={13} style={{ padding:'0', background:'#f0f9ff' }}>
                              <div style={{ padding:'20px 24px', borderTop:'1px solid #bfdbfe', borderBottom:'1px solid #bfdbfe' }}>
                                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>

                                  {/* SUBJECT BREAKDOWN */}
                                  <div>
                                    <h4 style={{ fontSize:14, fontWeight:700, marginBottom:12, color:'var(--text-primary)' }}>
                                      Subject-wise Breakdown
                                    </h4>
                                    {Object.keys(r.subjectWiseBreakdown || {}).length === 0 ? (
                                      <p style={{ fontSize:13, color:'var(--text-muted)' }}>No breakdown data.</p>
                                    ) : (
                                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                                        <thead>
                                          <tr style={{ background:'#dbeafe' }}>
                                            {['Subject','Total','✓','✗','—','Score'].map(h => (
                                              <th key={h} style={{ padding:'7px 10px', textAlign:'left', fontWeight:700, color:'#1e40af' }}>{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {Object.entries(r.subjectWiseBreakdown).map(([subj, d], si) => (
                                            <tr key={subj} style={{ background: si%2?'#eff6ff':'#fff', borderBottom:'1px solid #dbeafe' }}>
                                              <td style={{ padding:'7px 10px', fontWeight:600 }}>{subj}</td>
                                              <td style={{ padding:'7px 10px' }}>{d.total ?? 0}</td>
                                              <td style={{ padding:'7px 10px', color:'var(--success)', fontWeight:700 }}>{d.correct ?? 0}</td>
                                              <td style={{ padding:'7px 10px', color:'var(--danger)', fontWeight:700 }}>{d.wrong ?? 0}</td>
                                              <td style={{ padding:'7px 10px', color:'var(--text-muted)' }}>{d.unattempted ?? 0}</td>
                                              <td style={{ padding:'7px 10px', fontWeight:700,
                                                color:(d.score??0)>=0?'var(--success)':'var(--danger)' }}>
                                                {(d.score??0).toFixed(2)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>

                                  {/* VIOLATION LOG */}
                                  <div>
                                    <h4 style={{ fontSize:14, fontWeight:700, marginBottom:12, color:'var(--text-primary)' }}>
                                      Violation Log
                                      {r.violations?.length > 0 && (
                                        <span style={{ marginLeft:8, padding:'1px 6px', background:'#fee2e2', color:'#991b1b',
                                          borderRadius:3, fontSize:11, fontWeight:700 }}>
                                          {r.violations.length} event{r.violations.length!==1?'s':''}
                                        </span>
                                      )}
                                    </h4>
                                    {/* Summary badges */}
                                    <div style={{ marginBottom:10 }}>
                                      <span style={{ fontSize:12, color:'var(--text-muted)', marginRight:8 }}>Hard violations:</span>
                                      <span style={{ fontWeight:700, color:'var(--danger)' }}>{r.violationCount ?? 0}</span>
                                      <span style={{ fontSize:12, color:'var(--text-muted)', marginLeft:12, marginRight:8 }}>Fullscreen exits:</span>
                                      <span style={{ fontWeight:700, color:'var(--warning)' }}>{r.fullscreenExitCount ?? 0}</span>
                                    </div>
                                    {!r.violations || r.violations.length === 0 ? (
                                      <div style={{ padding:'12px 16px', background:'#f0fdf4', borderRadius:6, fontSize:13, color:'var(--success)', fontWeight:600 }}>
                                        ✓ No violations recorded
                                      </div>
                                    ) : (
                                      <div style={{ maxHeight:240, overflowY:'auto', border:'1px solid #fecaca', borderRadius:6 }}>
                                        {r.violations.map((v, vi) => (
                                          <div key={vi} style={{ padding:'8px 12px', borderBottom:'1px solid #fee2e2', background: vi%2?'#fff':'#fef2f2' }}>
                                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                                              {violationBadge(v.violationType)}
                                              <span style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap', flexShrink:0 }}>
                                                {v.occurredAt ? new Date(v.occurredAt).toLocaleTimeString() : ''}
                                              </span>
                                            </div>
                                            {v.details && (
                                              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3 }}>{v.details}</div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Timestamps */}
                                <div style={{ marginTop:14, display:'flex', gap:24, fontSize:12, color:'var(--text-muted)' }}>
                                  {r.submittedAt && <span>Submitted: {new Date(r.submittedAt).toLocaleString()}</span>}
                                  {r.evaluatedAt && <span>Evaluated: {new Date(r.evaluatedAt).toLocaleString()}</span>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
