import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api/axiosConfig";
import { runLogoutFlow } from "../utils/authSession";
import BrandLogo from "./BrandLogo";

const ROLE_LABEL = { ADMIN:"Administrator", TEACHER:"Teacher", STUDENT:"Student" };

function Topbar({ subtitle }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div style={{ background:"var(--primary)", color:"#fff", height:"var(--topbar-height)",
      padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between",
      flexShrink:0, boxShadow:"var(--shadow-md)", zIndex:100 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <BrandLogo width={132} style={{ filter: 'brightness(0) invert(1)' }} />
        {subtitle && <div style={{ fontSize:11, opacity:0.75, lineHeight:1.3 }}>{subtitle}</div>}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:13, fontWeight:600 }}>{user?.fullName}</div>
          <div style={{ fontSize:11, opacity:0.75 }}>{ROLE_LABEL[user?.role]}</div>
        </div>
        <button onClick={async () => {
          await runLogoutFlow({
            apiClient: api,
            logout,
            onError: () => console.warn("Logout failed")
          });
          navigate("/login");
        }}
          style={{ background:"rgba(255,255,255,0.12)", color:"#fff", border:"1px solid rgba(255,255,255,0.25)",
            padding:"5px 14px", borderRadius:5, fontSize:13, cursor:"pointer", fontWeight:500 }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default Topbar;
