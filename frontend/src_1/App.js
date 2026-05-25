import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import StudentDashboard from './pages/StudentDashboard';
import ExamPage from './pages/ExamPage';
import ResultPage from './pages/ResultPage';
import TeacherDashboard from './pages/TeacherDashboard';
import AdminDashboard from './pages/AdminDashboard';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/student" element={<ProtectedRoute role="STUDENT"><StudentDashboard /></ProtectedRoute>} />
          <Route path="/exam/:examId" element={<ProtectedRoute role="STUDENT"><ExamPage /></ProtectedRoute>} />
          <Route path="/result/:attemptId" element={<ProtectedRoute role="STUDENT"><ResultPage /></ProtectedRoute>} />
          <Route path="/teacher" element={<ProtectedRoute role="TEACHER"><TeacherDashboard /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute role="ADMIN"><AdminDashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
