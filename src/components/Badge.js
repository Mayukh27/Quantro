import React from "react";
const P = {
  success: { background:"var(--success-bg)", color:"var(--success)" },
  danger:  { background:"var(--danger-bg)",  color:"var(--danger)" },
  warning: { background:"var(--warning-bg)", color:"var(--warning)" },
  info:    { background:"#e0f0ff",           color:"var(--info)" },
  muted:   { background:"#f0f0f0",           color:"var(--text-muted)" },
  review:  { background:"var(--review-bg)",  color:"var(--review)" },
  primary: { background:"var(--primary-50)", color:"var(--primary)" },
};
function Badge({ children, variant="muted" }) {
  return <span style={{ ...(P[variant]||P.muted), padding:"2px 8px", borderRadius:3,
    fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.4, display:"inline-block" }}>{children}</span>;
}
export default Badge;
