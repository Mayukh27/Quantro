import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { register } from '../api/authApi';
import BrandLogo from '../components/BrandLogo';
import Spinner from '../components/Spinner';

export default function RegisterPage() {
  const [form, setForm] = useState({
    email:'',
    password:'',
    fullName:'',
    role:'STUDENT',
    enrollmentNo:'',
    stream:'',
    section:'',
    studentYear:'',
    classRollNo:'',
    dateOfBirth:''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login: authLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await register(form);
      const user = res.data.data;
      authLogin(user);
      if (user.role === 'TEACHER') {
        setError('Registration successful! Please wait for admin approval before logging in.');
        setLoading(false); return;
      }
      navigate('/student');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed.');
    } finally { setLoading(false); }
  };

  const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:14, outline:'none' };
  const lbl = { display:'block', fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginBottom:6 };

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:440 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}>
            <BrandLogo variant="text" width={290} />
          </div>
          <h1 style={{ fontSize:24, fontWeight:700 }}>Create Account</h1>
          <p style={{ color:'var(--text-muted)', marginTop:4 }}>Join QUANTRO today</p>
        </div>

        <div style={{ background:'#fff', borderRadius:12, boxShadow:'var(--shadow-md)', padding:32 }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom:16 }}>
              <label style={lbl}>Full Name</label>
              <input value={form.fullName} onChange={e=>setForm(f=>({...f,fullName:e.target.value}))} required placeholder="John Doe" style={inp} />
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={lbl}>Email address</label>
              <input type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} required={form.role==='TEACHER'} placeholder={form.role==='STUDENT' ? 'Optional for students' : 'you@example.com'} style={inp} />
            </div>

            {form.role === 'TEACHER' && (
              <div style={{ marginBottom:16 }}>
                <label style={lbl}>Password</label>
                <input type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} required placeholder="Min 8 characters" minLength={8} style={inp} />
              </div>
            )}

            {form.role === 'STUDENT' && (
              <>
                <div style={{ marginBottom:16 }}>
                  <label style={lbl}>Enrollment No</label>
                  <input value={form.enrollmentNo} onChange={e=>setForm(f=>({...f,enrollmentNo:e.target.value}))} required placeholder="ENR2025001" style={inp} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
                  <div>
                    <label style={lbl}>Stream</label>
                    <input value={form.stream} onChange={e=>setForm(f=>({...f,stream:e.target.value}))} required placeholder="Science" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Section</label>
                    <input value={form.section} onChange={e=>setForm(f=>({...f,section:e.target.value}))} required placeholder="A" style={inp} />
                  </div>
                </div>
                <div style={{ marginBottom:16 }}>
                  <label style={lbl}>Year</label>
                  <input value={form.studentYear} onChange={e=>setForm(f=>({...f,studentYear:e.target.value}))} required placeholder="2026 or 1" style={inp} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
                  <div>
                    <label style={lbl}>Class Roll No</label>
                    <input value={form.classRollNo} onChange={e=>setForm(f=>({...f,classRollNo:e.target.value}))} required placeholder="23" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Date of Birth</label>
                    <input type="date" value={form.dateOfBirth} onChange={e=>setForm(f=>({...f,dateOfBirth:e.target.value}))} required style={inp} />
                  </div>
                </div>
                <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:-8, marginBottom:12 }}>
                  Student login password will be your date of birth in yyyy-MM-dd format.
                </p>
              </>
            )}

            <div style={{ marginBottom:22 }}>
              <label style={lbl}>I am a</label>
              <div style={{ display:'flex', gap:10 }}>
                {['STUDENT','TEACHER'].map(role => (
                  <button key={role} type="button" onClick={()=>setForm(f=>({...f,role}))}
                    style={{ flex:1, padding:'10px', border:'2px solid '+(form.role===role?'var(--primary)':'var(--border)'),
                      borderRadius:6, background:form.role===role?'var(--primary-light)':'#fff',
                      color:form.role===role?'var(--primary)':'var(--text-secondary)', fontWeight:600, cursor:'pointer' }}>
                    {role === 'STUDENT' ? ' Student' : ' Teacher'}
                  </button>
                ))}
              </div>
              {form.role === 'TEACHER' && (
                <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>
                  Teacher accounts require admin approval before they can log in.
                </p>
              )}
            </div>
            {error && (
              <div style={{ background: error.includes('successful') ? '#f0fdf4' : '#fef2f2',
                border:'1px solid '+(error.includes('successful')?'#bbf7d0':'#fecaca'),
                color: error.includes('successful') ? 'var(--success)' : 'var(--danger)',
                padding:'10px 14px', borderRadius:6, fontSize:13, marginBottom:16 }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading}
              style={{ width:'100%', padding:'11px', background:'var(--primary)', color:'#fff', border:'none', borderRadius:6, fontSize:15, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {loading ? <Spinner size={18} color="#fff" /> : null}
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
          <p style={{ textAlign:'center', marginTop:20, fontSize:13, color:'var(--text-muted)' }}>
            Already have an account? <Link to="/login" style={{ color:'var(--primary)', fontWeight:600 }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
