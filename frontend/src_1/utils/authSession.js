export function setLocalAuthUser(user) {
  localStorage.setItem('examportal_user', JSON.stringify(user));
  localStorage.setItem('is_logged_in', 'true');
}

export function clearLocalAuthState(options = {}) {
  const { clearExamActive = true } = options;
  localStorage.removeItem('examportal_user');
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('token');
  localStorage.setItem('is_logged_in', 'false');
  if (clearExamActive) {
    localStorage.removeItem('exam_active');
  }
}

export async function runLogoutFlow({ apiClient, logout, onError }) {
  try {
    await apiClient.post('/auth/logout');
  } catch (error) {
    if (onError) {
      onError(error);
    }
  }

  logout();
  localStorage.removeItem('exam_active');
}
