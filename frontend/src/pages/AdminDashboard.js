import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getPendingTeachers, getAllTeachers, getAllStudents,
  bulkRegisterStudents, approveTeacher, getStats,
  getSubjects, createSubject, deleteSubject
} from '../api/adminApi';
import { createBlueprint, createExam, publishExam, cancelExam, rescheduleExam, getAllExams, getBlueprints, deleteBlueprint, deleteExam, updateBlueprint } from '../api/examApi';
import ExamResultsViewer from '../components/ExamResultsViewer';
import BrandLogo from '../components/BrandLogo';
import Spinner from '../components/Spinner';
import api from '../api/axiosConfig';
import { runLogoutFlow } from '../utils/authSession';

const TABS = ['Overview','Students','Teachers','Subjects','Blueprints','Exams','Results'];
const tabIcon = { Overview:'📊', Students:'🎓', Teachers:'👨‍🏫', Subjects:'📚', Blueprints:'🗺', Exams:'📋', Results:'🏆' };

// ── Helpers ──────────────────────────────────────────────────────────────────
const inp = { width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:5, fontSize:13, boxSizing:'border-box' };
const lbl = { fontSize:12, fontWeight:700, color:'var(--text-secondary)', display:'block', marginBottom:5 };

function statusBadge(s) {
  const map = { DRAFT:['#f5f3ff','#6d28d9'], PUBLISHED:['#f0fdf4','#166534'], COMPLETED:['#f1f5f9','#64748b'], CANCELLED:['#fef2f2','#991b1b'] };
  const [bg,color] = map[s]||['#f1f5f9','#64748b'];
  return <span style={{padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:700,background:bg,color}}>{s}</span>;
}

// ── Excel export helper (pure JS, no library needed) ─────────────────────────
function exportToExcel(rows, headers, filename) {
  // Build a simple TSV that Excel opens natively, then trigger download as .csv
  // For a proper xlsx we use a data URI with tab-separated values
  const lines = [headers.join('\t'), ...rows.map(r => headers.map(h => {
    const v = r[h] ?? '';
    return String(v).replace(/\t/g, ' ');
  }).join('\t'))];
  const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Search + Filter bar ───────────────────────────────────────────────────────
function FilterBar({ filters, onChange, fields, placeholder }) {
  return (
    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',padding:'12px 16px',background:'#f8fafc',borderBottom:'1px solid var(--border)'}}>
      <input
        placeholder={placeholder || 'Search...'}
        value={filters.search || ''}
        onChange={e => onChange({ ...filters, search: e.target.value })}
        style={{...inp, width:220, margin:0}}
      />
      {fields.map(f => (
        <select key={f.key} value={filters[f.key] || ''} onChange={e => onChange({ ...filters, [f.key]: e.target.value })}
          style={{...inp, width:'auto', margin:0, minWidth:120}}>
          <option value="">All {f.label}</option>
          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
    </div>
  );
}

// ── STUDENTS TAB ─────────────────────────────────────────────────────────────
function StudentsTab({ flash }) {
  const [students, setStudents]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [bulkFile, setBulkFile]     = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [filters, setFilters]       = useState({ search:'', stream:'', section:'', year:'' });

  const load = useCallback(() => {
    setLoading(true);
    getAllStudents()
      .then(r => setStudents(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Unique option values for filter dropdowns
  const streams  = useMemo(() => [...new Set(students.map(s => s.stream).filter(Boolean))].sort(), [students]);
  const sections = useMemo(() => [...new Set(students.map(s => s.section).filter(Boolean))].sort(), [students]);
  const years    = useMemo(() => [...new Set(students.map(s => s.studentYear).filter(Boolean))].sort(), [students]);

  // Apply filters
  const filtered = useMemo(() => {
    const q = (filters.search || '').toLowerCase();
    return students.filter(s => {
      const matchSearch = !q || [s.enrollmentNo, s.fullName, s.stream, s.section, s.studentYear, s.classRollNo, s.email]
        .some(v => v && String(v).toLowerCase().includes(q));
      const matchStream  = !filters.stream  || s.stream  === filters.stream;
      const matchSection = !filters.section || s.section === filters.section;
      const matchYear    = !filters.year    || s.studentYear === filters.year;
      return matchSearch && matchStream && matchSection && matchYear;
    });
  }, [students, filters]);

  const handleBulkUpload = async () => {
    if (!bulkFile) { flash('Please choose a CSV/Excel file first.', false); return; }
    setBulkLoading(true);
    try {
      const res  = await bulkRegisterStudents(bulkFile);
      const data = res.data?.data || {};
      const created = data.created ?? 0;
      const skipped = data.skipped ?? 0;
      const errors  = Array.isArray(data.errors) ? data.errors.filter(Boolean) : [];
      const detail  = errors.length > 0 ? ` ${errors.slice(0,2).join(' | ')}` : '';
      flash(`Bulk upload: ${created} created, ${skipped} skipped.${detail}`, skipped === 0);
      setBulkFile(null);
      load();
    } catch(e) { flash(e.response?.data?.message || 'Bulk upload failed.', false); }
    finally { setBulkLoading(false); }
  };

  const handleExport = () => {
    const headers = ['enrollmentNo','fullName','stream','section','studentYear','classRollNo','dateOfBirth','email','createdAt'];
    const labelMap = { enrollmentNo:'Enrollment No', fullName:'Name', stream:'Stream', section:'Section', studentYear:'Year', classRollNo:'Roll No', dateOfBirth:'DOB', email:'Email', createdAt:'Registered On' };
    const rows = filtered.map(s => ({
      enrollmentNo: s.enrollmentNo || '',
      fullName:     s.fullName     || '',
      stream:       s.stream       || '',
      section:      s.section      || '',
      studentYear:  s.studentYear  || '',
      classRollNo:  s.classRollNo  || '',
      dateOfBirth:  s.dateOfBirth  || '',
      email:        s.email        || '',
      createdAt:    s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '',
    }));
    const suffix = [filters.stream, filters.section, filters.year].filter(Boolean).join('_') || 'all';
    exportToExcel(rows, headers, `students_${suffix}.csv`);
    // Show user-friendly header names by rebuilding with mapped headers
    const displayRows = filtered.map(s => {
      const r = {};
      headers.forEach(h => {
        let v = s[h] ?? '';
        if (h === 'createdAt' && v) v = new Date(v).toLocaleDateString();
        r[labelMap[h]] = v;
      });
      return r;
    });
    exportToExcel(displayRows, headers.map(h => labelMap[h]),
      `students_${suffix}.tsv`);
  };

  const filterFields = [
    { key:'stream',  label:'Stream',  options: streams  },
    { key:'section', label:'Section', options: sections },
    { key:'year',    label:'Year',    options: years    },
  ];

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <h2 style={{fontSize:22,fontWeight:700}}>Students ({filtered.length}{filtered.length !== students.length ? ` of ${students.length}` : ''})</h2>
        <button onClick={handleExport} disabled={filtered.length === 0}
          style={{padding:'8px 16px',background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0',borderRadius:6,fontWeight:600,cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',gap:6}}>
          ⬇ Export Excel
        </button>
      </div>

      {/* Bulk upload */}
      <div style={{background:'#fff',borderRadius:10,boxShadow:'var(--shadow-sm)',padding:20,marginBottom:20}}>
        <h3 style={{fontSize:14,fontWeight:700,marginBottom:4}}>Bulk Register Students</h3>
        <p style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
          Upload CSV/Excel with headers: Enrollment No, Name, Stream, Section, Batch Year (e.g. 2023-2027, 2027 passout, or 2023 admission), Class Roll No, Date of Birth.
        </p>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <input type="file" accept=".csv,.xls,.xlsx" onChange={e => setBulkFile(e.target.files?.[0] || null)} style={{fontSize:13}} />
          <button onClick={handleBulkUpload} disabled={bulkLoading || !bulkFile}
            style={{padding:'8px 16px',background:'var(--primary)',color:'#fff',border:'none',borderRadius:6,fontWeight:600,cursor:'pointer',opacity:(!bulkFile||bulkLoading)?0.5:1}}>
            {bulkLoading ? 'Uploading...' : 'Upload & Register'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{background:'#fff',borderRadius:10,boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
        <FilterBar filters={filters} onChange={setFilters} fields={filterFields} placeholder="Search" />

        {loading ? (
          <div style={{padding:40,display:'flex',justifyContent:'center'}}><Spinner size={32}/></div>
        ) : filtered.length === 0 ? (
          <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>
            {students.length === 0 ? 'No students registered yet.' : 'No students match the current filters.'}
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}>
                  {['Enrollment','Name','Year','Stream','Section','Roll No','DOB','Email','Registered'].map(h => (
                    <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'var(--text-secondary)',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, ri) => (
                  <tr key={s.id} style={{borderBottom:'1px solid var(--border-light)',background:ri%2?'#fafafa':'#fff'}}>
                    <td style={{padding:'10px 14px',fontWeight:600,whiteSpace:'nowrap'}}>{s.enrollmentNo || '—'}</td>
                    <td style={{padding:'10px 14px',fontWeight:600,whiteSpace:'nowrap'}}>{s.fullName}</td>
                    <td style={{padding:'10px 14px',color:'var(--text-muted)'}}>{s.studentYear || '—'}</td>
                    <td style={{padding:'10px 14px',color:'var(--text-muted)'}}>{s.stream || '—'}</td>
                    <td style={{padding:'10px 14px',color:'var(--text-muted)'}}>{s.section || '—'}</td>
                    <td style={{padding:'10px 14px',color:'var(--text-muted)'}}>{s.classRollNo || '—'}</td>
                    <td style={{padding:'10px 14px',color:'var(--text-muted)',whiteSpace:'nowrap'}}>{s.dateOfBirth || '—'}</td>
                    <td style={{padding:'10px 14px',color:'var(--text-muted)'}}>{s.email}</td>
                    <td style={{padding:'10px 14px',color:'var(--text-muted)',whiteSpace:'nowrap'}}>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TEACHERS TAB ─────────────────────────────────────────────────────────────
function TeachersTab({ flash }) {
  const [pending,  setPending]  = useState([]);
  const [approved, setApproved] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [view,     setView]     = useState('pending'); // 'pending' | 'approved'

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getPendingTeachers(), getAllTeachers()])
      .then(([pr, ar]) => {
        setPending(pr.data.data  || []);
        // getAllTeachers returns all (including pending); filter to approved
        const all = ar.data.data || [];
        setApproved(all.filter(t => t.approved));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id) => {
    try {
      await approveTeacher(id);
      const teacher = pending.find(t => t.id === id);
      setPending(p => p.filter(t => t.id !== id));
      if (teacher) setApproved(a => [...a, { ...teacher, approved: true }]);
      flash('Teacher approved.');
    } catch(e) { flash(e.response?.data?.message || 'Failed to approve.', false); }
  };

  const filteredApproved = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? approved : approved.filter(t =>
      [t.fullName, t.email].some(v => v && v.toLowerCase().includes(q))
    );
  }, [approved, search]);

  const filteredPending = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? pending : pending.filter(t =>
      [t.fullName, t.email].some(v => v && v.toLowerCase().includes(q))
    );
  }, [pending, search]);

  return (
    <div>
      <h2 style={{fontSize:22,fontWeight:700,marginBottom:20}}>Teachers</h2>

      {/* Tab toggle */}
      <div style={{display:'flex',gap:0,marginBottom:20,background:'#fff',borderRadius:8,boxShadow:'var(--shadow-sm)',overflow:'hidden',width:'fit-content',border:'1px solid var(--border)'}}>
        {[
          { key:'pending',  label:`Pending Approvals`, count: pending.length },
          { key:'approved', label:`Approved Teachers`, count: approved.length },
        ].map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            style={{padding:'10px 20px',border:'none',cursor:'pointer',fontWeight:view===t.key?700:400,fontSize:13,
              background:view===t.key?'var(--primary)':'transparent',color:view===t.key?'#fff':'var(--text-secondary)'}}>
            {t.label}
            <span style={{marginLeft:6,padding:'1px 7px',borderRadius:10,fontSize:11,fontWeight:700,
              background:view===t.key?'rgba(255,255,255,0.2)':'var(--bg-panel)',color:view===t.key?'#fff':'var(--text-muted)'}}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{display:'flex',justifyContent:'center',padding:40}}><Spinner size={36}/></div>
      ) : view === 'pending' ? (
        <div>
          <div style={{ padding:'12px 16px', background:'#f8fafc', borderBottom:'1px solid var(--border)', borderRadius:8, marginBottom:16, boxShadow:'var(--shadow-sm)' }}>
            <input placeholder="Search by name or email..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{...inp, width:280, margin:0}} />
          </div>
        {filteredPending.length === 0 ? (
          <div style={{background:'#fff',borderRadius:12,padding:40,textAlign:'center',boxShadow:'var(--shadow-sm)'}}>
            <div style={{fontSize:40,marginBottom:12}}>✅</div>
            <p style={{color:'var(--text-muted)'}}>{pending.length === 0 ? 'No pending teacher approvals.' : 'No teachers match your search.'}</p>
          </div>
        ) : (
          <div style={{background:'#fff',borderRadius:12,boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}>
                  {['Name','Email','Registered','Action'].map(h => (
                    <th key={h} style={{padding:'12px 16px',textAlign:'left',fontSize:12,fontWeight:700,color:'var(--text-secondary)'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPending.map(t => (
                  <tr key={t.id} style={{borderBottom:'1px solid var(--border-light)'}}>
                    <td style={{padding:'12px 16px',fontWeight:600}}>{t.fullName}</td>
                    <td style={{padding:'12px 16px',color:'var(--text-muted)'}}>{t.email}</td>
                    <td style={{padding:'12px 16px',color:'var(--text-muted)'}}>{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}</td>
                    <td style={{padding:'12px 16px'}}>
                      <button onClick={() => handleApprove(t.id)}
                        style={{padding:'6px 16px',background:'var(--success)',color:'#fff',border:'none',borderRadius:5,fontWeight:600,cursor:'pointer',fontSize:12}}>
                        Approve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      ) : (
        <div style={{background:'#fff',borderRadius:12,boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
          <div style={{padding:'12px 16px',background:'#f8fafc',borderBottom:'1px solid var(--border)'}}>
            <input placeholder="Search by name or email..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{...inp, width:280, margin:0}} />
          </div>
          {filteredApproved.length === 0 ? (
            <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>
              {approved.length === 0 ? 'No approved teachers yet.' : 'No teachers match your search.'}
            </div>
          ) : (
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}>
                  {['Name','Email','Registered','Status'].map(h => (
                    <th key={h} style={{padding:'12px 16px',textAlign:'left',fontSize:12,fontWeight:700,color:'var(--text-secondary)'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredApproved.map((t, ri) => (
                  <tr key={t.id} style={{borderBottom:'1px solid var(--border-light)',background:ri%2?'#fafafa':'#fff'}}>
                    <td style={{padding:'12px 16px',fontWeight:600}}>{t.fullName}</td>
                    <td style={{padding:'12px 16px',color:'var(--text-muted)'}}>{t.email}</td>
                    <td style={{padding:'12px 16px',color:'var(--text-muted)'}}>{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}</td>
                    <td style={{padding:'12px 16px'}}>
                      <span style={{padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:700,background:'#f0fdf4',color:'#166534'}}>Approved</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab,      setTab]      = useState('Overview');
  const [stats,    setStats]    = useState({});
  const [subjects, setSubjects] = useState([]);
  const [exams,    setExams]    = useState([]);
  const [blueprints, setBlueprints] = useState([]);
  const [selectedBlueprint, setSelectedBlueprint] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [msg,      setMsg]      = useState({ text:'', ok:true });
  const [subjectForm, setSubjectForm] = useState({ name:'', code:'', description:'' });
  const [examForm,    setExamForm]    = useState({ title:'', description:'', blueprintId:'', scheduledStart:'', scheduledEnd:'', durationMinutes:60 });
  const [blueprintForm, setBlueprintForm] = useState({ name:'', description:'', durationMinutes:60, totalMarks:10, entries:[] });
  const [isEditingBlueprint, setIsEditingBlueprint] = useState(false);
  const [editingBlueprintId, setEditingBlueprintId] = useState(null);
  const showSectionName = blueprintForm.entries.length > 1;
  const isBlueprintLocked = useCallback((blueprintId) => {
    if (!blueprintId) return false;
    return exams.some(e => e.blueprintId === blueprintId && e.status !== 'DRAFT' && e.status !== 'CANCELLED');
  }, [exams]);
  const getBlueprintDuration = useCallback((blueprintId) => {
    if (!blueprintId) return null;
    return blueprints.find(b => b.id === blueprintId)?.durationMinutes ?? null;
  }, [blueprints]);

  const flash = useCallback((text, ok=true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg({ text:'', ok:true }), 4000);
  }, []);

  // Navigate to a tab from Overview cards
  const goToTab = useCallback((t) => { setTab(t); setMsg({ text:'', ok:true }); }, []);

  useEffect(() => {
    const handleBack = async () => {
      await runLogoutFlow({ apiClient:api, logout, onError:()=>console.warn('Logout failed') });
      navigate('/login', { replace:true });
    };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, [logout, navigate]);

  useEffect(() => {
    getStats().then(r => setStats(r.data.data || {})).catch(() => {});
    getSubjects().then(r => setSubjects(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'Exams') {
      setLoading(true);
      Promise.all([getAllExams(), getBlueprints()])
        .then(([er, br]) => { setExams(er.data.data||[]); setBlueprints(br.data.data||[]); })
        .catch(()=>{})
        .finally(()=>setLoading(false));
    }
    if (tab === 'Blueprints') {
      Promise.all([getBlueprints(), getAllExams()])
        .then(([br, er]) => { setBlueprints(br.data.data||[]); setExams(er.data.data||[]); })
        .catch(()=>{});
    }
  }, [tab]);

  useEffect(() => {
    if (!examForm.blueprintId) return;
    const duration = getBlueprintDuration(examForm.blueprintId);
    if (!duration) return;
    if (examForm.durationMinutes === duration) return;
    setExamForm(f => ({ ...f, durationMinutes: duration }));
  }, [examForm.blueprintId, examForm.durationMinutes, getBlueprintDuration]);

  const handleCreateSubject = async (e) => {
    e.preventDefault();
    try { const r=await createSubject(subjectForm); setSubjects(p=>[...p,r.data.data]); setSubjectForm({name:'',code:'',description:''}); flash('Subject created.'); }
    catch(e) { flash(e.response?.data?.message||'Failed to create subject.',false); }
  };

  const handleDeleteSubject = async (id, name) => {
    if (!window.confirm('Delete subject "'+name+'" and ALL its questions?')) return;
    try { await deleteSubject(id); setSubjects(p=>p.filter(s=>s.id!==id)); flash('Subject deleted.'); }
    catch(e) { flash(e.response?.data?.message||'Failed to delete subject.',false); }
  };

  const handleCreateBlueprint = async (e) => {
    e.preventDefault();
    if (isEditingBlueprint && editingBlueprintId) {
      try {
        const r = await updateBlueprint(editingBlueprintId, blueprintForm);
        const updated = r.data?.data;
        setBlueprints(p => p.map(b => b.id === editingBlueprintId ? updated : b));
        setSelectedBlueprint(prev => prev && prev.id === editingBlueprintId ? updated : prev);
        setBlueprintForm({name:'',description:'',durationMinutes:60,totalMarks:10,entries:[]});
        setIsEditingBlueprint(false);
        setEditingBlueprintId(null);
        flash('Blueprint updated.');
      } catch(e) {
        flash(e.response?.data?.message||'Failed to update blueprint.',false);
      }
      return;
    }

    try { const r=await createBlueprint(blueprintForm); setBlueprints(p=>[...p,r.data.data]); setBlueprintForm({name:'',description:'',durationMinutes:60,totalMarks:10,entries:[]}); flash('Blueprint created.'); }
    catch(e) { flash(e.response?.data?.message||'Failed to create blueprint.',false); }
  };

  const handleEditBlueprint = (bp) => {
    if (!bp) return;
    setBlueprintForm({
      name: bp.name || '',
      description: bp.description || '',
      durationMinutes: bp.durationMinutes || 60,
      totalMarks: bp.totalMarks || 0,
      entries: (bp.entries || []).map(e => ({
        subjectId: e.subjectId || '',
        sectionName: e.sectionName || '',
        questionCount: e.questionCount || 0,
        marksPerQuestion: e.marksPerQuestion ?? 1,
        negativeMarks: e.negativeMarks ?? 0.25
      }))
    });
    setIsEditingBlueprint(true);
    setEditingBlueprintId(bp.id);
  };

  const handleCancelBlueprintEdit = () => {
    setBlueprintForm({name:'',description:'',durationMinutes:60,totalMarks:10,entries:[]});
    setIsEditingBlueprint(false);
    setEditingBlueprintId(null);
  };

  const handleDeleteBlueprint = async (id) => {
    if (!window.confirm('Delete this blueprint?')) return;
    try { await deleteBlueprint(id); setBlueprints(p=>p.filter(b=>b.id!==id)); setSelectedBlueprint(null); flash('Blueprint deleted.'); }
    catch(e) { flash(e.response?.data?.message||'Cannot delete blueprint in use.',false); }
  };

  const handleCreateExam = async (e) => {
    e.preventDefault();
    try { const r=await createExam(examForm); setExams(p=>[...p,r.data.data]); setExamForm({title:'',description:'',blueprintId:'',scheduledStart:'',scheduledEnd:'',durationMinutes:60}); flash('Exam created as DRAFT.'); }
    catch(e) { flash(e.response?.data?.message||'Failed to create exam.',false); }
  };

  const handlePublish = async (id) => {
    try { await publishExam(id); setExams(p=>p.map(e=>e.id===id?{...e,status:'PUBLISHED'}:e)); flash('Exam published.'); }
    catch(e) { flash(e.response?.data?.message||'Publish failed.',false); }
  };

  const handleCancelExam = async (exam) => {
    if (!window.confirm(`Cancel "${exam.title}"? Students will no longer be able to attempt it.`)) return;
    try {
      const res = await cancelExam(exam.id);
      const updated = res.data?.data;
      setExams(p => p.map(e => e.id === exam.id ? { ...e, ...updated } : e));
      flash('Exam cancelled.');
    } catch (e) {
      flash(e.response?.data?.message || 'Cancel failed.', false);
    }
  };

  const handleDeleteExam = async (exam) => {
    if (!window.confirm(`Delete "${exam.title}"? This removes attempts and results.`)) return;
    try {
      await deleteExam(exam.id);
      setExams(p => p.filter(e => e.id !== exam.id));
      flash('Exam deleted.');
    } catch (e) {
      flash(e.response?.data?.message || 'Delete failed.', false);
    }
  };

  const formatLocal = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleRescheduleExam = async (exam) => {
    const startInput = window.prompt('New start time (YYYY-MM-DDTHH:mm)', formatLocal(exam.scheduledStart));
    if (!startInput) return;
    const endInput = window.prompt('New end time (YYYY-MM-DDTHH:mm)', formatLocal(exam.scheduledEnd));
    if (!endInput) return;
    try {
      const res = await rescheduleExam(exam.id, { scheduledStart: startInput, scheduledEnd: endInput });
      const updated = res.data?.data;
      setExams(p => p.map(e => e.id === exam.id ? { ...e, ...updated } : e));
      flash('Exam rescheduled.');
    } catch (e) {
      flash(e.response?.data?.message || 'Reschedule failed.', false);
    }
  };

  const handleLogout = async () => {
    await runLogoutFlow({ apiClient:api, logout, onError:()=>console.warn('Logout API failed') });
    navigate('/login');
  };

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',flexDirection:'column'}}>

      {/* Navbar */}
      <div style={{background:'#fff',borderBottom:'1px solid var(--border)',height:56,display:'flex',alignItems:'center',padding:'0 0px',justifyContent:'space-between',boxShadow:'var(--shadow-sm)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <BrandLogo variant="text" width={140} />
          <span style={{marginLeft:8,padding:'2px 8px',background:'#fef3c7',color:'#92400e',borderRadius:4,fontSize:11,fontWeight:700}}>ADMIN</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <span style={{fontSize:13,color:'var(--text-secondary)'}}>Welcome, <strong>{user?.fullName}</strong></span>
          <button onClick={handleLogout} style={{padding:'6px 14px',border:'1px solid var(--border)',borderRadius:6,background:'#fff',color:'var(--text-secondary)',cursor:'pointer',fontSize:13}}>Sign out</button>
        </div>
      </div>

      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* Sidebar */}
        <div style={{width:200,background:'#fff',borderRight:'1px solid var(--border)',flexShrink:0,overflowY:'auto'}}>
          {TABS.map(t => (
            <button key={t} onClick={() => goToTab(t)}
              style={{width:'100%',textAlign:'left',padding:'12px 20px',border:'none',borderBottom:'1px solid var(--border-light)',
                background:tab===t?'var(--primary-light)':'transparent',
                color:tab===t?'var(--primary)':'var(--text-primary)',
                fontWeight:tab===t?700:400,cursor:'pointer',fontSize:14}}>
              {tabIcon[t]} {t}
            </button>
          ))}
        </div>

        {/* Main */}
        <div style={{flex:1,overflowY:'auto',padding:28}}>
          {msg.text && (
            <div style={{background:msg.ok?'#f0fdf4':'#fef2f2',border:'1px solid '+(msg.ok?'#bbf7d0':'#fecaca'),
              color:msg.ok?'var(--success)':'var(--danger)',padding:'10px 16px',borderRadius:7,marginBottom:20,fontSize:13,fontWeight:600}}>
              {msg.text}
            </div>
          )}

          {/* ── OVERVIEW ── */}
          {tab === 'Overview' && (
            <div>
              <h2 style={{fontSize:22,fontWeight:700,marginBottom:20}}>Platform Overview</h2>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:20,marginBottom:24}}>
                {[
                  { label:'Total Students', val:stats.totalStudents??'—', icon:'🎓', color:'var(--primary)', tab:'Students', hint:'Click to manage students' },
                  { label:'Total Teachers', val:stats.totalTeachers??'—', icon:'👨‍🏫', color:'var(--success)', tab:'Teachers', hint:'Click to manage teachers' },
                  { label:'Subjects',       val:subjects.length,          icon:'📚', color:'var(--warning)', tab:'Subjects', hint:'Click to manage subjects' },
                ].map(c => (
                  <button key={c.label} onClick={() => goToTab(c.tab)}
                    style={{background:'#fff',borderRadius:12,boxShadow:'var(--shadow-sm)',padding:24,border:'1px solid transparent',
                      textAlign:'left',cursor:'pointer',transition:'border-color 0.15s',outline:'none'}}
                    onMouseEnter={e => e.currentTarget.style.borderColor='var(--primary)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor='transparent'}>
                    <div style={{display:'flex',alignItems:'center',gap:12}}>
                      <span style={{fontSize:28}}>{c.icon}</span>
                      <div>
                        <div style={{fontSize:28,fontWeight:800,color:c.color}}>{c.val}</div>
                        <div style={{fontSize:13,color:'var(--text-muted)'}}>{c.label}</div>
                        <div style={{fontSize:11,color:'var(--primary)',marginTop:2,fontWeight:600}}>{c.hint}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/*{/* Quick stats row */}
             {/*} <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:20}}>
                {[
                  { label:'Total Exams',      val:stats.totalExams??'—',      icon:'📋', color:'#6d28d9', tab:'Exams' },
                  { label:'Active Blueprints', val:stats.totalBlueprints??'—', icon:'🗺',  color:'#0369a1', tab:'Blueprints' },
                  { label:'Results Ready',    val:stats.totalResults??'—',    icon:'🏆', color:'#b45309', tab:'Results' },
                ].map(c => (
                  <button key={c.label} onClick={() => goToTab(c.tab)}
                    style={{background:'#fff',borderRadius:12,boxShadow:'var(--shadow-sm)',padding:'16px 20px',border:'1px solid transparent',
                      textAlign:'left',cursor:'pointer',transition:'border-color 0.15s'}}
                    onMouseEnter={e => e.currentTarget.style.borderColor=c.color}
                    onMouseLeave={e => e.currentTarget.style.borderColor='transparent'}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:22}}>{c.icon}</span>
                      <div>
                        <div style={{fontSize:20,fontWeight:800,color:c.color}}>{c.val}</div>
                        <div style={{fontSize:12,color:'var(--text-muted)'}}>{c.label}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>*/}
            </div>
          )}

          {/* ── STUDENTS ── */}
          {tab === 'Students' && <StudentsTab flash={flash} />}

          {/* ── TEACHERS ── */}
          {tab === 'Teachers' && <TeachersTab flash={flash} />}

          {/* ── SUBJECTS ── */}
          {tab === 'Subjects' && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
              <div style={{background:'#fff',borderRadius:10,boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
                <div style={{padding:'14px 20px',background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}>
                  <h3 style={{fontSize:15,fontWeight:700}}>Create New Subject</h3>
                </div>
                <form onSubmit={handleCreateSubject} style={{padding:20,display:'flex',flexDirection:'column',gap:14}}>
                  <div><label style={lbl}>Subject Name</label><input value={subjectForm.name} onChange={e=>setSubjectForm(f=>({...f,name:e.target.value}))} required placeholder="Engineering Mathematics" style={inp}/></div>
                  <div><label style={lbl}>Subject Code</label><input value={subjectForm.code} onChange={e=>setSubjectForm(f=>({...f,code:e.target.value}))} required placeholder="MATH101" style={inp}/></div>
                  <div><label style={lbl}>Description</label><textarea value={subjectForm.description} onChange={e=>setSubjectForm(f=>({...f,description:e.target.value}))} rows={3} style={{...inp,resize:'vertical',fontFamily:'inherit'}}/></div>
                  <button type="submit" style={{padding:'10px',background:'var(--primary)',color:'#fff',border:'none',borderRadius:5,fontWeight:600,cursor:'pointer'}}>Create Subject</button>
                </form>
              </div>
              <div style={{background:'#fff',borderRadius:10,boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
                <div style={{padding:'14px 20px',background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}>
                  <h3 style={{fontSize:15,fontWeight:700}}>All Subjects ({subjects.length})</h3>
                </div>
                <div style={{maxHeight:420,overflowY:'auto'}}>
                  {subjects.map(s => (
                    <div key={s.id} style={{padding:'12px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:14}}>{s.name}</div>
                        <div style={{fontSize:12,color:'var(--text-muted)'}}>Code: <strong>{s.code}</strong></div>
                      </div>
                      <button onClick={() => handleDeleteSubject(s.id, s.name)}
                        style={{padding:'5px 12px',background:'#fef2f2',color:'var(--danger)',border:'1px solid #fecaca',borderRadius:5,cursor:'pointer',fontSize:12,fontWeight:600}}>
                        🗑 Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── BLUEPRINTS ── */}
          {tab === 'Blueprints' && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
              <div style={{background:'#fff',padding:24,borderRadius:10,boxShadow:'var(--shadow-sm)'}}>
                <h3 style={{fontSize:15,fontWeight:700,marginBottom:18}}>{isEditingBlueprint ? 'Edit Blueprint' : 'Create Blueprint'}</h3>
                {isEditingBlueprint && (
                  <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:10}}>
                    Editing is allowed only when no published/completed exams reference this blueprint.
                  </div>
                )}
                {isEditingBlueprint && isBlueprintLocked(editingBlueprintId) && (
                  <div style={{padding:'8px 12px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:6,color:'#92400e',fontSize:12,fontWeight:600,marginBottom:10}}>
                    Locked: A published or completed exam is using this blueprint. Cancel or delete that exam to edit.
                  </div>
                )}
                <form onSubmit={handleCreateBlueprint} style={{display:'flex',flexDirection:'column',gap:12}}>
                  <div><label style={lbl}>Blueprint Name</label>
                    <input value={blueprintForm.name} onChange={e=>setBlueprintForm(f=>({...f,name:e.target.value}))} style={inp} required placeholder="e.g. GATE 2025"/>
                  </div>
                  <div><label style={lbl}>Description</label>
                    <input value={blueprintForm.description} onChange={e=>setBlueprintForm(f=>({...f,description:e.target.value}))} style={inp} placeholder="Optional"/>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div><label style={lbl}>Duration (minutes)</label>
                      <input type="number" min={5} value={blueprintForm.durationMinutes} onChange={e=>setBlueprintForm(f=>({...f,durationMinutes:Number(e.target.value)}))} style={inp}/>
                    </div>
                    <div><label style={lbl}>Total Marks (auto)</label>
                      <input readOnly value={blueprintForm.entries.reduce((s,e)=>s+(e.questionCount||0)*(e.marksPerQuestion||0),0)} style={{...inp,background:'#f9fafb',cursor:'default'}}/>
                    </div>
                  </div>
                  <div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                      <label style={{...lbl,marginBottom:0}}>Subject Entries</label>
                      <button type="button"
                        onClick={()=>setBlueprintForm(f=>({...f,entries:[...f.entries,{subjectId:'',sectionName:'',questionCount:10,marksPerQuestion:1,negativeMarks:0.25}]}))}
                        style={{padding:'4px 12px',background:'var(--primary-light)',color:'var(--primary)',border:'1px solid var(--primary)',borderRadius:5,fontWeight:700,cursor:'pointer',fontSize:12}}>
                        + Add Subject
                      </button>
                    </div>
                    {blueprintForm.entries.length===0 && (
                      <div style={{padding:'14px',background:'#f9fafb',border:'1px dashed var(--border)',borderRadius:6,textAlign:'center',fontSize:13,color:'var(--text-muted)'}}>
                        Click "+ Add Subject" to add subjects to this blueprint
                      </div>
                    )}
                    {blueprintForm.entries.map((entry,i)=>(
                      <div key={i} style={{border:'1px solid var(--border)',borderRadius:7,padding:12,marginBottom:8,background:'#fafafa'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                          <span style={{fontSize:12,fontWeight:700,color:'var(--primary)'}}>Entry {i+1}</span>
                          <button type="button" onClick={()=>setBlueprintForm(f=>({...f,entries:f.entries.filter((_,j)=>j!==i)}))}
                            style={{border:'none',background:'transparent',color:'var(--danger)',cursor:'pointer',fontSize:16}}>✕</button>
                        </div>
                        <div style={{marginBottom:8}}>
                          <label style={lbl}>Subject</label>
                          <select value={entry.subjectId} onChange={e=>setBlueprintForm(f=>({...f,entries:f.entries.map((en,j)=>j===i?{...en,subjectId:Number(e.target.value)}:en)}))} required style={inp}>
                            <option value="">Select Subject</option>
                            {subjects.map(s=><option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                          </select>
                        </div>
                        {showSectionName && (
                          <div style={{marginBottom:8}}>
                            <label style={lbl}>Section Name</label>
                            <input value={entry.sectionName||''} onChange={e=>setBlueprintForm(f=>({...f,entries:f.entries.map((en,j)=>j===i?{...en,sectionName:e.target.value}:en)}))}
                              placeholder="e.g. Section A (leave blank if not needed)" style={inp}/>
                          </div>
                        )}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                          <div><label style={lbl}>Questions</label>
                            <input type="number" min={1} value={entry.questionCount} onChange={e=>setBlueprintForm(f=>({...f,entries:f.entries.map((en,j)=>j===i?{...en,questionCount:Number(e.target.value)}:en)}))} style={inp}/>
                          </div>
                          <div><label style={lbl}>Marks (+)</label>
                            <input type="number" min={0} step={0.25} value={entry.marksPerQuestion} onChange={e=>setBlueprintForm(f=>({...f,entries:f.entries.map((en,j)=>j===i?{...en,marksPerQuestion:Number(e.target.value)}:en)}))} style={inp}/>
                          </div>
                          <div><label style={lbl}>Negative (-)</label>
                            <input type="number" min={0} step="any" value={entry.negativeMarks??0.25} onChange={e=>setBlueprintForm(f=>({...f,entries:f.entries.map((en,j)=>j===i?{...en,negativeMarks:Number(e.target.value)}:en)}))} style={inp}/>
                          </div>
                        </div>
                        {entry.questionCount>0 && entry.marksPerQuestion>0 && (
                          <div style={{marginTop:6,fontSize:12,color:'var(--text-muted)',background:'#f0f9ff',padding:'4px 10px',borderRadius:4}}>
                            {entry.questionCount} × {entry.marksPerQuestion} = <b>{entry.questionCount*entry.marksPerQuestion}</b> marks
                          </div>
                        )}
                      </div>
                    ))}
                    {blueprintForm.entries.length>0 && (
                      <div style={{padding:'8px 12px',background:'var(--primary-light)',borderRadius:6,fontSize:13,fontWeight:700,color:'var(--primary)',display:'flex',justifyContent:'space-between'}}>
                        <span>Total Questions: {blueprintForm.entries.reduce((s,e)=>s+(e.questionCount||0),0)}</span>
                        <span>Total Marks: {blueprintForm.entries.reduce((s,e)=>s+(e.questionCount||0)*(e.marksPerQuestion||0),0)}</span>
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex',gap:10,alignItems:'center'}}>
                    <button type="submit" disabled={blueprintForm.entries.length===0||blueprintForm.entries.some(e=>!e.subjectId)||isBlueprintLocked(editingBlueprintId)}
                      style={{padding:'11px',background:'var(--primary)',color:'#fff',border:'none',borderRadius:6,fontWeight:700,cursor:'pointer',
                        opacity:(blueprintForm.entries.length===0||blueprintForm.entries.some(e=>!e.subjectId)||isBlueprintLocked(editingBlueprintId))?0.5:1}}>
                      {isEditingBlueprint ? 'Update Blueprint' : 'Create Blueprint'}
                    </button>
                    {isEditingBlueprint && (
                      <button type="button" onClick={handleCancelBlueprintEdit}
                        style={{padding:'10px 12px',background:'#fff',color:'var(--text-secondary)',border:'1px solid var(--border)',borderRadius:6,fontWeight:600,cursor:'pointer'}}>
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>
              <div style={{background:'#fff',borderRadius:10,boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
                {!selectedBlueprint ? (
                  <>
                    <div style={{padding:'14px 20px',background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}>
                      <h3 style={{fontSize:15,fontWeight:700}}>Blueprints ({blueprints.length})</h3>
                    </div>
                    <div style={{maxHeight:600,overflowY:'auto'}}>
                      {blueprints.length===0 && <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}><div style={{fontSize:32,marginBottom:10}}>🗺</div>No blueprints yet.</div>}
                      {blueprints.map(b=>(
                        <div key={b.id} style={{padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <div>
                            <div style={{fontWeight:600,fontSize:14}}>{b.name}</div>
                            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>{b.durationMinutes} min | {b.totalMarks} marks | {b.entries?.length||0} subject(s)</div>
                          </div>
                          <div style={{display:'flex',gap:6}}>
                            <button onClick={()=>setSelectedBlueprint(b)} style={{padding:'5px 12px',border:'1px solid var(--border)',background:'#fff',borderRadius:5,cursor:'pointer',fontSize:12,fontWeight:600}}>👁 View</button>
                            <button onClick={()=>handleEditBlueprint(b)} style={{padding:'5px 12px',border:'1px solid #bfdbfe',background:'#eff6ff',color:'#1d4ed8',borderRadius:5,cursor:'pointer',fontSize:12,fontWeight:600}}>✏ Edit</button>
                            <button onClick={()=>handleDeleteBlueprint(b.id)} style={{padding:'5px 12px',background:'#fef2f2',color:'var(--danger)',border:'1px solid #fecaca',borderRadius:5,cursor:'pointer',fontSize:12,fontWeight:600}}>🗑 Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{padding:'14px 20px',background:'var(--bg-panel)',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <h3 style={{fontSize:15,fontWeight:700}}>{selectedBlueprint.name}</h3>
                      <button onClick={()=>setSelectedBlueprint(null)} style={{border:'none',background:'transparent',fontSize:18,cursor:'pointer',color:'var(--text-muted)'}}>✖</button>
                    </div>
                    <div style={{padding:20}}>
                      {selectedBlueprint.description && <p style={{color:'var(--text-muted)',marginBottom:12,fontSize:13}}>{selectedBlueprint.description}</p>}
                      <div style={{display:'flex',gap:20,marginBottom:16,fontSize:13,alignItems:'center',flexWrap:'wrap'}}>
                        <span>⏱ <b>{selectedBlueprint.durationMinutes} min</b></span>
                        <span>🏆 <b>{selectedBlueprint.totalMarks} marks</b></span>
                        <span>📚 <b>{selectedBlueprint.entries?.length||0} subject(s)</b></span>
                        <button onClick={()=>handleEditBlueprint(selectedBlueprint)}
                          style={{padding:'5px 10px',border:'1px solid #bfdbfe',background:'#eff6ff',color:'#1d4ed8',borderRadius:5,cursor:'pointer',fontSize:12,fontWeight:600}}>
                          ✏ Edit Blueprint
                        </button>
                      </div>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <thead><tr style={{background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}>
                          {['Subject','Section Name','Questions','Marks (+)','Negative (-)','Subtotal'].map(h=>(
                            <th key={h} style={{padding:'8px 10px',textAlign:'left',fontWeight:700,color:'var(--text-secondary)',fontSize:11}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {selectedBlueprint.entries?.map((e,i)=>{
                            const subj=subjects.find(s=>s.id===e.subjectId);
                            return (
                              <tr key={i} style={{borderBottom:'1px solid var(--border-light)',background:i%2?'#fafafa':'#fff'}}>
                                <td style={{padding:'8px 10px',fontWeight:600}}>{subj?.name||('Subject '+e.subjectId)}</td>
                                <td style={{padding:'8px 10px',color:'var(--text-muted)',fontStyle:e.sectionName?'normal':'italic'}}>{e.sectionName||'—'}</td>
                                <td style={{padding:'8px 10px'}}>{e.questionCount}</td>
                                <td style={{padding:'8px 10px',color:'var(--success)',fontWeight:600}}>+{e.marksPerQuestion}</td>
                                <td style={{padding:'8px 10px',color:'var(--danger)',fontWeight:600}}>-{e.negativeMarks??0.25}</td>
                                <td style={{padding:'8px 10px',fontWeight:700}}>{(e.questionCount||0)*(e.marksPerQuestion||0)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot><tr style={{background:'var(--primary-light)',borderTop:'2px solid var(--primary)'}}>
                          <td colSpan={2} style={{padding:'9px 10px',fontWeight:700,color:'var(--primary)'}}>Total</td>
                          <td style={{padding:'9px 10px',fontWeight:700}}>{selectedBlueprint.entries?.reduce((s,e)=>s+(e.questionCount||0),0)}</td>
                          <td colSpan={2}></td>
                          <td style={{padding:'9px 10px',fontWeight:800,color:'var(--primary)'}}>{selectedBlueprint.totalMarks}</td>
                        </tr></tfoot>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── EXAMS ── */}
          {tab === 'Exams' && (
            <div>
              <h2 style={{fontSize:22,fontWeight:700,marginBottom:20}}>Exam Management</h2>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
                <div style={{background:'#fff',borderRadius:10,boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
                  <div style={{padding:'14px 20px',background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}><h3 style={{fontSize:15,fontWeight:700}}>Create New Exam</h3></div>
                  <form onSubmit={handleCreateExam} style={{padding:20,display:'flex',flexDirection:'column',gap:12}}>
                    <div><label style={lbl}>Title</label><input value={examForm.title} onChange={e=>setExamForm(f=>({...f,title:e.target.value}))} required style={inp}/></div>
                    <div><label style={lbl}>Description</label><input value={examForm.description} onChange={e=>setExamForm(f=>({...f,description:e.target.value}))} style={inp}/></div>
                    <div><label style={lbl}>Blueprint</label>
                      <select value={examForm.blueprintId} onChange={e=>{
                        const id = Number(e.target.value);
                        const selected = blueprints.find(b => b.id === id);
                        setExamForm(f => ({
                          ...f,
                          blueprintId: id,
                          durationMinutes: selected?.durationMinutes || f.durationMinutes
                        }));
                      }} required style={inp}>
                        <option value="">Select Blueprint</option>
                        {blueprints.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                      <div><label style={lbl}>Start Time</label><input type="datetime-local" value={examForm.scheduledStart} onChange={e=>setExamForm(f=>({...f,scheduledStart:e.target.value}))} required style={inp}/></div>
                      <div><label style={lbl}>End Time</label><input type="datetime-local" value={examForm.scheduledEnd} onChange={e=>setExamForm(f=>({...f,scheduledEnd:e.target.value}))} required style={inp}/></div>
                    </div>
                    <div><label style={lbl}>Duration (minutes)</label><input type="number" value={examForm.durationMinutes} min={10} disabled={!!examForm.blueprintId} style={inp}/></div>
                    <button type="submit" style={{padding:'10px',background:'var(--primary)',color:'#fff',border:'none',borderRadius:5,fontWeight:600,cursor:'pointer'}}>Create Exam</button>
                  </form>
                </div>
                <div style={{background:'#fff',borderRadius:10,boxShadow:'var(--shadow-sm)',overflow:'hidden'}}>
                  <div style={{padding:'14px 20px',background:'var(--bg-panel)',borderBottom:'1px solid var(--border)'}}><h3 style={{fontSize:15,fontWeight:700}}>All Exams</h3></div>
                  <div style={{maxHeight:420,overflowY:'auto'}}>
                    {loading ? <div style={{padding:30,display:'flex',justifyContent:'center'}}><Spinner/></div>
                    : exams.length===0 ? <div style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>No exams created yet.</div>
                    : exams.map(e=>(
                      <div key={e.id} style={{padding:'14px 20px',borderBottom:'1px solid var(--border-light)'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                          <div style={{fontWeight:600,fontSize:14}}>{e.title}</div>
                          {statusBadge(e.status)}
                        </div>
                        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:10}}>{getBlueprintDuration(e.blueprintId) ?? e.durationMinutes} min | {e.scheduledStart?new Date(e.scheduledStart).toLocaleString():'-'}</div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          {e.status==='DRAFT' && (
                            <button onClick={()=>handlePublish(e.id)}
                              style={{padding:'5px 14px',background:'var(--success)',color:'#fff',border:'none',borderRadius:4,fontWeight:600,cursor:'pointer',fontSize:12}}>
                              Publish Exam
                            </button>
                          )}
                          {e.status==='PUBLISHED' && (
                            <>
                              <button onClick={()=>handleRescheduleExam(e)}
                                style={{padding:'5px 12px',background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',borderRadius:4,fontWeight:600,cursor:'pointer',fontSize:12}}>
                                Reschedule
                              </button>
                              <button onClick={()=>handleCancelExam(e)}
                                style={{padding:'5px 12px',background:'#fef2f2',color:'#991b1b',border:'1px solid #fecaca',borderRadius:4,fontWeight:600,cursor:'pointer',fontSize:12}}>
                                Cancel
                              </button>
                            </>
                          )}
                          {e.status!=='PUBLISHED' && (
                            <button onClick={()=>handleDeleteExam(e)}
                              style={{padding:'2px 0',background:'transparent',color:'var(--danger)',border:'none',fontWeight:600,cursor:'pointer',fontSize:12,display:'inline-flex',alignItems:'center',gap:6}}>
                              🗑 Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── RESULTS ── */}
          {tab === 'Results' && <ExamResultsViewer />}
        </div>
      </div>
    </div>
  );
}