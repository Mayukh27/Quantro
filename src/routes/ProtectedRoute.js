import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
export default function ProtectedRoute({ children, role, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  const allowedRoles = Array.isArray(roles) && roles.length > 0
    ? roles
    : role
      ? [role]
      : [];

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    const r = user.role === 'ADMIN' ? '/admin' : user.role === 'TEACHER' ? '/teacher' : '/student';
    return <Navigate to={r} replace />;
  }
  return children;
}
