import React from 'react';
export default function Spinner({ size=24, color='var(--primary)' }) {
  return (
    <div style={{display:'inline-flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:size,height:size,borderRadius:'50%',border:'3px solid '+color+'33',borderTopColor:color,animation:'spin 0.7s linear infinite'}} />
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
