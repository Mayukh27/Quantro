import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { login } from '../api/authApi';
import BrandLogo from '../components/BrandLogo';
import Spinner from '../components/Spinner';

export default function LoginPage() {
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login: authLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log("Login clicked"); 
    setError('');setLoading(true);
    try {
      console.log("Calling API..."); 
      const res = await login(form);
      console.log("Response:", res);  
      const user = res.data.data;
      localStorage.setItem('examportal_user', JSON.stringify({
      token: user.token,
      sessionToken: user.sessionToken,
      role: user.role,
      userId: user.userId,
      email: user.email
    }));
      authLogin(user);
      if (user.role === 'ADMIN') navigate('/admin');
      else if (user.role === 'TEACHER') navigate('/teacher');
      else navigate('/student');
    } catch (err) {
         const msg = err.response?.data?.message || "";
         if (msg.toLowerCase().includes("already logged in")) {
             setError("You are already logged in on another device.");
            }
          else {
             setError("Login failed. Please check your credentials.");
            }
        }
      finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:10 }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}>
            <BrandLogo variant="text" width={390} style={{ transform: 'translateX(-10px)' }} />
          </div>
          <p style={{ color:'var(--text-muted)', marginTop:4 }}>Sign in to your account</p>
        </div>

        <div style={{ background:'#fff', borderRadius:12, boxShadow:'var(--shadow-md)', padding:32 }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom:18 }}>
              <label style={{ display:'block', fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginBottom:6 }}>Enrollment No</label>
              <input type="text" value={form.identifier} onChange={e => setForm(f=>({...f,identifier:e.target.value}))}
                required placeholder=""
                style={{ width:'100%', padding:'10px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:14, outline:'none' }} />
            </div>
            <div style={{ marginBottom:22 }}>
              <label style={{ display:'block', fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginBottom:6 }}>Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f=>({...f,password:e.target.value}))}
                required
                placeholder=""
                style={{ width:'100%', padding:'10px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:14, outline:'none' }}
              />
              <label style={{ display:'inline-flex', alignItems:'center', gap:8, marginTop:8, fontSize:12, color:'var(--text-secondary)', cursor:'pointer' }}>
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={e => setShowPassword(e.target.checked)}
                />
                {showPassword ? 'Hide password' : 'Show password'}
              </label>
            </div>
            {error && (
              <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'var(--danger)', padding:'10px 14px', borderRadius:6, fontSize:13, marginBottom:16 }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading}
              style={{ width:'100%', padding:'11px', background:'var(--primary)', color:'#fff', border:'none', borderRadius:6, fontSize:15, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {loading ? <Spinner size={18} color="#fff" /> : null}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <p style={{ textAlign:'center', marginTop:20, fontSize:13, color:'var(--text-muted)' }}>
            Don't have an account? <Link to="/register" style={{ color:'var(--primary)', fontWeight:600 }}>Register</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
