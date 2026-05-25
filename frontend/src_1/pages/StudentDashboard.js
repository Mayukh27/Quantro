import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getActiveExams, getUpcomingExams } from '../api/examApi';
import BrandLogo from '../components/BrandLogo';
import Spinner from '../components/Spinner';
import api from '../api/axiosConfig';
import { runLogoutFlow } from '../utils/authSession';

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  useEffect(() => {
  const handleBack = async () => {
    await runLogoutFlow({
      apiClient: api,
      logout,
      onError: () => console.warn("Logout failed")
    });
    navigate('/login', { replace: true });
  };

  window.history.pushState(null, "", window.location.href);
  window.addEventListener("popstate", handleBack);

  return () => {
    window.removeEventListener("popstate", handleBack);
  };
}, [logout, navigate]);
  useEffect(() => {
  const loadExams = async () => {
    try {
      const [upcomingRes, activeRes] = await Promise.all([ getUpcomingExams(), getActiveExams() ]);
      const upcoming = upcomingRes.data.data || [];
      const active = activeRes.data.data || [];
      // combine both lists
      setExams([...active, ...upcoming]);
    } catch (err) {
      console.error(err);
      setError('Failed to load exams.');
    } finally {
      setLoading(false);
    }
  }; loadExams();
}, []);



  const handleLogout = async () => {
    await runLogoutFlow({
      apiClient: api,
      logout,
      onError: () => console.warn("Logout API failed")
    });
    navigate('/login');
  };

  const formatDate = (dt) => dt ? new Date(dt).toLocaleString() : '-';
  const activeExams = exams.filter(e => new Date(e.scheduledStart) <= new Date());
  const upcomingExams = exams.filter( e => new Date(e.scheduledStart) > new Date());

  return (
  <div style={{ minHeight:'100vh', background:'var(--bg)' }}>

    {/* Navbar */}
    <div style={{ background:'#fff', borderBottom:'1px solid var(--border)', padding:'0 0px', height:56, display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'var(--shadow-sm)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <BrandLogo variant="text" width={140} />
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:16 }}>
        <span style={{ fontSize:13, color:'var(--text-secondary)' }}>
          Welcome, <strong>{user?.fullName}</strong>
        </span>

        <button
          onClick={handleLogout}
          style={{
            padding:'6px 14px',
            border:'1px solid var(--border)',
            borderRadius:6,
            background:'#fff',
            color:'var(--text-secondary)',
            cursor:'pointer',
            fontSize:13
          }}
        >
          Sign out
        </button>
      </div>
    </div>


    <div style={{ maxWidth:1000, margin:'0 auto', padding:'32px 24px' }}>

      <div style={{ marginBottom:24 }}>
        <h2 style={{ fontSize:22, fontWeight:700 }}>Available Exams</h2>
        <p style={{ color:'var(--text-muted)', marginTop:4 }}>
          Active exams you can take right now.
        </p>
      </div>


      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:60 }}>
          <Spinner size={36} />
        </div>

      ) : error ? (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'var(--danger)', padding:16, borderRadius:8 }}>
          {error}
        </div>

      ) : exams.length === 0 ? (
        <div style={{ background:'#fff', borderRadius:12, boxShadow:'var(--shadow-sm)', padding:60, textAlign:'center' }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📭</div>
          <h3 style={{ fontSize:18, fontWeight:600, color:'var(--text-secondary)' }}>No active exams</h3>
          <p style={{ color:'var(--text-muted)', marginTop:8 }}>Check back later for upcoming examinations.</p>
        </div>

      ) : (

        <div>

          {/* LIVE EXAMS */}
          {activeExams.length > 0 && (
            <>
              <h3 style={{ marginBottom:16 }}>🟢 Live Exams</h3>

              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:20, marginBottom:30 }}>

                {activeExams.map(exam => (

                  <div key={exam.id} style={{ background:'#fff', borderRadius:12, boxShadow:'var(--shadow-sm)', overflow:'hidden', display:'flex', flexDirection:'column' }}>

                    <div style={{ padding:'20px 20px 0' }}>

                      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:10 }}>
                        <h3 style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)', flex:1 }}>
                          {exam.title}
                        </h3>

                        <span style={{
                          marginLeft:10,
                          padding:'3px 8px',
                          background:'#dcfce7',
                          color:'#166534',
                          fontSize:11,
                          fontWeight:700,
                          borderRadius:4
                        }}>
                          LIVE
                        </span>
                      </div>

                      {exam.description && (
                        <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:12 }}>
                          {exam.description}
                        </p>
                      )}

                      <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:16 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text-secondary)' }}>
                          <span>⏱️</span>
                          <span>{exam.durationMinutes} minutes</span>
                        </div>

                        <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text-secondary)' }}>
                          <span>📅</span>
                          <span>Ends: {formatDate(exam.scheduledEnd)}</span>
                        </div>

                        {exam.totalMarks && (
                          <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text-secondary)' }}>
                            <span>🏆</span>
                            <span>{exam.totalMarks} marks</span>
                          </div>
                        )}
                      </div>

                    </div>

                    <div style={{ padding:'0 20px 20px', marginTop:'auto' }}>
                      <button
  onClick={async () => {

    const elem = document.documentElement;
    if (localStorage.getItem("exam_active")) {
    alert("Exam already running in another tab");
    return;
    }
    localStorage.setItem("exam_active", "true");
    if (elem.requestFullscreen) {
      try {
        await elem.requestFullscreen();
      } catch (err) {
        console.warn("Fullscreen request failed:", err);
      }
    }

    navigate('/exam/' + exam.id);

  }}
  style={{
    width:'100%',
    padding:'10px',
    background:'var(--primary)',
    color:'#fff',
    border:'none',
    borderRadius:6,
    fontSize:14,
    fontWeight:600,
    cursor:'pointer'
  }}
>
  Start Exam
</button>
                    </div>

                  </div>

                ))}

              </div>
            </>
          )}


          {/* UPCOMING EXAMS */}
          {upcomingExams.length > 0 && (
            <>
              <h3 style={{ marginBottom:16 }}>🟡 Upcoming Exams</h3>

              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:20 }}>

                {upcomingExams.map(exam => (

                  <div key={exam.id} style={{ background:'#fff', borderRadius:12, boxShadow:'var(--shadow-sm)', overflow:'hidden', display:'flex', flexDirection:'column' }}>

                    <div style={{ padding:'20px 20px 0' }}>

                      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:10 }}>
                        <h3 style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)', flex:1 }}>
                          {exam.title}
                        </h3>

                        <span style={{
                          marginLeft:10,
                          padding:'3px 8px',
                          background:'#fef9c3',
                          color:'#92400e',
                          fontSize:11,
                          fontWeight:700,
                          borderRadius:4
                        }}>
                          UPCOMING
                        </span>
                      </div>

                      <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:16 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text-secondary)' }}>
                          <span>📅</span>
                          <span>Starts: {formatDate(exam.scheduledStart)}</span>
                        </div>
                      </div>

                    </div>

                    <div style={{ padding:'0 20px 20px', marginTop:'auto' }}>
                      <button
                        disabled
                        style={{
                          width:'100%',
                          padding:'10px',
                          background:'#94a3b8',
                          color:'#fff',
                          border:'none',
                          borderRadius:6,
                          fontSize:14,
                          fontWeight:600,
                          cursor:'not-allowed'
                        }}
                      >
                        Not Started
                      </button>
                    </div>

                  </div>

                ))}

              </div>
            </>
          )}

        </div>

      )}

    </div>

  </div>
);
}