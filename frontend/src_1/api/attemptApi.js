import api from './axiosConfig';
export const startExam = (examId) => api.post('/attempts/start/'+examId);
export const saveAnswers = (attemptId, data) => api.put('/attempts/'+attemptId+'/answers', data);
export const submitExam = (attemptId) => api.post('/attempts/'+attemptId+'/submit');
export const getResult = (attemptId) => api.get('/results/'+attemptId);
export const getMyResults = () => api.get('/results/my');
/** CHANGE: Download result PDF as blob */
export const downloadResultPdf = (attemptId) =>
  api.get('/results/pdf/'+attemptId, { responseType: 'blob' });
