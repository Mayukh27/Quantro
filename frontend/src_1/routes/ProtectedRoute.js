import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
export default function ProtectedRoute({ children, role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    const r = user.role === 'ADMIN' ? '/admin' : user.role === 'TEACHER' ? '/teacher' : '/student';
    return <Navigate to={r} replace />;
  }
  return children;
}
